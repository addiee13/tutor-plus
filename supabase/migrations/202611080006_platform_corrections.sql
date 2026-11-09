begin;
set local search_path = public, extensions, pg_catalog;

-- Restoring the precise SECURITY DEFINER helper grants removed by the earlier blanket revoke. These are the
-- established authorization predicates used by RLS and storage policies; no private table access is granted.
grant execute on function private.tutor_is_public(uuid) to anon,authenticated;
grant execute on function private.valid_timezone(text),private.active_actor(),private.has_role(text),private.owns_tutor(uuid),
  private.booking_participant(uuid),private.payment_participant(uuid),private.owns_assessment(uuid),
  private.assigned_assessment(uuid),private.assignment_reader(uuid),private.submission_reader(uuid),
  private.assignment_file_uploadable(text,boolean),private.assignment_file_reader(text),
  private.assignment_file_orphan_owner(text),private.learning_plan_reader(uuid),
  private.valid_structured_study_goals(jsonb) to authenticated;

-- Preserve request parameter names without ambiguous SQL identifiers.
drop function public.save_notification_preference(text,boolean);
create function public.save_notification_preference(requested_category text,requested_email_enabled boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare selected_email_enabled boolean;
begin
  if not private.active_actor() or requested_category not in ('booking','session','assessment','assignment','study_plan','review','safety','system')
    or requested_email_enabled is null then raise exception 'Invalid preference' using errcode = '22023'; end if;
  selected_email_enabled := requested_email_enabled or private.notification_required(requested_category);
  insert into public.notification_preferences as saved_preference(user_id,category,email_enabled)
  values(auth.uid(),requested_category,selected_email_enabled)
  on conflict(user_id,category) do update set email_enabled = excluded.email_enabled,updated_at = statement_timestamp()
  returning saved_preference.email_enabled into selected_email_enabled;
  return selected_email_enabled;
end;
$$;

-- Keep in-app and email states separate. Accepted means Resend accepted the request; only a verified webhook
-- may record delivered/bounced/complained outcomes.
alter table private.notification_outbox drop constraint notification_outbox_email_state_check;
alter table private.notification_outbox add constraint notification_outbox_email_state_check check
  (email_state in ('queued','accepted','delivered','bounced','complained','failed','disabled','not_configured','retrying','cancelled'));
alter table private.notification_outbox add column provider_email_id text;
create unique index notification_outbox_provider_email_uq on private.notification_outbox(provider_email_id) where provider_email_id is not null;
alter table public.notifications add column delivery_state text not null default 'queued'
  check (delivery_state in ('queued','accepted','delivered','bounced','complained','failed','disabled','not_configured','retrying','cancelled'));
create policy notification_templates_admin_read on public.notification_templates for select to authenticated using (private.has_role('administrator'));
drop policy active_templates_read on public.notification_templates;
create policy active_templates_read on public.notification_templates for select to authenticated
  using (active and private.active_actor());

create or replace function public.enqueue_booking_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare item record; offset_minutes integer; due_at timestamptz; queued integer := 0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  update private.notification_outbox as notices set state = 'cancelled',email_state = 'cancelled',updated_at = statement_timestamp()
  where notices.reminder_offset_minutes is not null and notices.state in ('pending','processing')
    and not exists(select 1 from public.bookings as bookings where bookings.id = notices.booking_id
      and bookings.status = 'confirmed' and bookings.version = notices.booking_version);
  update public.notifications as feed set delivery_state = 'cancelled'
    from private.notification_outbox as notices where feed.outbox_id = notices.id and notices.email_state = 'cancelled';
  for item in select bookings.id,bookings.student_id,bookings.starts_at,bookings.version,tutors.user_id
    from public.bookings as bookings join public.tutor_profiles as tutors on tutors.id = bookings.tutor_id
    where bookings.status = 'confirmed' and bookings.starts_at > statement_timestamp()
  loop
    foreach offset_minutes in array array[1440,60] loop
      due_at := item.starts_at - make_interval(mins => offset_minutes);
      if due_at > statement_timestamp() then
        perform private.enqueue_notification('booking-reminder:'||item.id||':'||item.version||':'||offset_minutes||':'||item.student_id,
          item.student_id,'booking','Upcoming tutoring session','Your tutoring session is coming up.','/bookings',due_at,item.id,item.version,offset_minutes);
        perform private.enqueue_notification('booking-reminder:'||item.id||':'||item.version||':'||offset_minutes||':'||item.user_id,
          item.user_id,'booking','Upcoming tutoring session','Your tutoring session is coming up.','/bookings',due_at,item.id,item.version,offset_minutes);
        queued := queued + 2;
      end if;
    end loop;
  end loop;
  return queued;
end;
$$;

create or replace function public.claim_notification_outbox(batch_size integer)
returns table(id uuid,recipient_email text,category text,title text,body text,target_path text,email_enabled boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  update private.notification_outbox as notices set state = 'failed',email_state = 'failed',updated_at = statement_timestamp()
    where notices.state = 'processing' and notices.updated_at < statement_timestamp()-interval '5 minutes' and notices.attempt_count >= 5;
  return query with candidates as (
    select notices.id from private.notification_outbox as notices
    where (notices.state = 'pending' or (notices.state = 'processing' and notices.updated_at < statement_timestamp()-interval '5 minutes'))
      and notices.scheduled_at <= statement_timestamp() and notices.next_attempt_at <= statement_timestamp()
      and notices.attempt_count < 5
      and (notices.booking_id is null or exists(select 1 from public.bookings as bookings where bookings.id = notices.booking_id))
      and (notices.reminder_offset_minutes is null or exists(select 1 from public.bookings as bookings
        where bookings.id = notices.booking_id and bookings.status = 'confirmed' and bookings.version = notices.booking_version))
    order by notices.scheduled_at,notices.id for update skip locked limit greatest(1,least(coalesce(batch_size,50),100))
  ), claimed as (
    update private.notification_outbox as notices set state = 'processing',attempt_count = notices.attempt_count+1,
      updated_at = statement_timestamp() from candidates where notices.id = candidates.id returning notices.*
  ), inserted_feed as (
    insert into public.notifications(outbox_id,recipient_id,category,title,body,target_path,delivery_state)
    select claimed.id,claimed.recipient_id,claimed.category,claimed.title,claimed.body,claimed.target_path,claimed.email_state from claimed
    on conflict(outbox_id) do nothing returning outbox_id
  )
  select claimed.id,users.email::text,claimed.category,claimed.title,claimed.body,claimed.target_path,
    private.notification_required(claimed.category) or coalesce(preferences.email_enabled,false)
  from claimed join auth.users as users on users.id = claimed.recipient_id
  left join public.notification_preferences as preferences on preferences.user_id = claimed.recipient_id
    and preferences.category = claimed.category;
end;
$$;

drop function public.complete_notification_outbox(uuid,text,text);
create function public.complete_notification_outbox(notice uuid,outcome text,error_code text,provider_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare current_attempt integer; next_state text; next_email_state text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if outcome not in ('accepted','disabled','not_configured','retry','failed','cancelled')
    or (error_code is not null and error_code !~ '^[a-z0-9_]{1,80}$')
    or (provider_id is not null and length(provider_id) > 200) then raise exception 'Invalid outcome' using errcode = '22023'; end if;
  select attempt_count into current_attempt from private.notification_outbox where id = notice and state = 'processing' for update;
  if not found then raise exception 'Notice unavailable' using errcode = '22023'; end if;
  next_state := case when outcome in ('accepted','disabled','not_configured','cancelled') then 'accepted'
    when outcome = 'retry' and current_attempt < 5 then 'pending' else 'failed' end;
  next_email_state := case when outcome = 'retry' and current_attempt >= 5 then 'failed'
    when outcome = 'retry' then 'retrying' else outcome end;
  update private.notification_outbox set state = next_state,email_state = next_email_state,last_error_code = error_code,
    provider_email_id = coalesce(provider_id,provider_email_id),
    next_attempt_at = case when outcome = 'retry' and current_attempt < 5
      then statement_timestamp()+make_interval(secs => least(3600,30*(2^greatest(current_attempt-1,0)))) else next_attempt_at end,
    updated_at = statement_timestamp() where id = notice;
  if provider_id is not null then
    update private.notification_delivery_events set outbox_id = notice
      where provider_email_id = provider_id and outbox_id is null;
    select case
      when bool_or(events.event_type = 'email.complained') then 'complained'
      when bool_or(events.event_type = 'email.bounced') then 'bounced'
      when bool_or(events.event_type = 'email.delivered') then 'delivered'
      when bool_or(events.event_type = 'email.failed') then 'failed'
      when bool_or(events.event_type in ('email.sent','email.delivery_delayed')) then 'accepted'
      else next_email_state end
      into next_email_state from private.notification_delivery_events as events where events.outbox_id = notice;
  end if;
  update private.notification_outbox set email_state = next_email_state where id = notice;
  update public.notifications set delivery_state = next_email_state where outbox_id = notice;
end;
$$;

create table private.notification_delivery_events (
  event_id text primary key check (length(event_id) between 1 and 200),
  provider_email_id text not null check (length(provider_email_id) between 1 and 200),
  event_type text not null check (event_type in ('email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed')),
  event_created_at timestamptz,
  outbox_id uuid references private.notification_outbox(id) on delete restrict,
  received_at timestamptz not null default statement_timestamp()
);
create index notification_delivery_events_outbox_idx on private.notification_delivery_events(outbox_id,received_at desc);
revoke all on private.notification_delivery_events from public,anon,authenticated,service_role;

create function public.record_resend_delivery_event(event_id text,provider_email_id text,event_type text,event_created_at timestamptz)
returns table(duplicate boolean,matched boolean,delivery_state text)
language plpgsql security definer set search_path = '' as $$
declare linked_id uuid; current_state text; next_state text; inserted_id text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if event_id is null or length(event_id) not between 1 and 200 or provider_email_id is null
    or length(provider_email_id) not between 1 and 200
    or event_type not in ('email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed')
    or (event_created_at is not null and not isfinite(event_created_at)) then raise exception 'Invalid delivery event' using errcode = '22023'; end if;
  select notices.id,notices.email_state into linked_id,current_state from private.notification_outbox as notices
    where notices.provider_email_id = record_resend_delivery_event.provider_email_id for update;
  insert into private.notification_delivery_events(event_id,provider_email_id,event_type,event_created_at,outbox_id)
    values(record_resend_delivery_event.event_id,record_resend_delivery_event.provider_email_id,event_type,event_created_at,linked_id)
    on conflict(event_id) do nothing returning event_id into inserted_id;
  if inserted_id is null then
    return query select true,linked_id is not null,current_state;
    return;
  end if;
  if linked_id is null then return query select false,false,null::text; return; end if;
  next_state := case
    when current_state = 'complained' then current_state
    when event_type = 'email.complained' then 'complained'
    when current_state in ('delivered','bounced') then current_state
    when event_type = 'email.delivered' then 'delivered'
    when event_type = 'email.bounced' then 'bounced'
    when current_state = 'failed' then current_state
    when event_type = 'email.failed' then 'failed'
    when event_type in ('email.sent','email.delivery_delayed') then 'accepted'
    else current_state end;
  update private.notification_outbox set email_state = next_state,updated_at = statement_timestamp() where id = linked_id;
  update public.notifications set delivery_state = next_state where outbox_id = linked_id;
  return query select false,true,next_state;
end;
$$;

create function public.set_admin_user_role(target uuid,requested_role text,operation text,confirmed boolean,reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.assert_administrator();
begin
  if confirmed is not true or requested_role not in ('student','tutor','administrator') or operation not in ('grant','revoke')
    or reason is null or length(btrim(reason)) not between 1 and 500 then raise exception 'Invalid role change' using errcode = '22023'; end if;
  if operation = 'grant' then
    perform 1 from public.profiles where id = target and status = 'active' and adult_attested for update;
    if not found then raise exception 'Ineligible target' using errcode = '22023'; end if;
    insert into public.user_roles(user_id,role,granted_by) values(target,requested_role,actor) on conflict(user_id,role) do nothing;
  else
    if target = actor and requested_role = 'administrator' then raise exception 'Cannot revoke own administrator capability' using errcode = '22023'; end if;
    delete from public.user_roles where user_id = target and role = requested_role;
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,reason,safe_metadata)
  values(actor,'role.'||operation,'profiles',target,btrim(reason),jsonb_build_object('role',requested_role));
end;
$$;

-- Add immutable booking context before compiling the replay-safe reschedule routine.
alter table public.booking_reschedule_history add column tutor_id uuid references public.tutor_profiles(id) on delete restrict;
alter table public.booking_reschedule_history add column subject_id uuid references public.subjects(id) on delete restrict;
alter table public.booking_reschedule_history add column mode text check (mode in ('virtual','in_person'));
-- The existing history mutation trigger remains enabled for normal operation. Disable it only within this
-- transaction to populate the newly added intent columns from each immutable booking snapshot.
alter table public.booking_reschedule_history disable trigger booking_reschedule_history_immutable;
update public.booking_reschedule_history as history set tutor_id=bookings.tutor_id,subject_id=bookings.subject_id,mode=bookings.mode
from public.bookings as bookings where bookings.id=history.booking_id;
alter table public.booking_reschedule_history enable trigger booking_reschedule_history_immutable;
alter table public.booking_reschedule_history alter column tutor_id set not null;
alter table public.booking_reschedule_history alter column subject_id set not null;
alter table public.booking_reschedule_history alter column mode set not null;

-- Participant-only history for confirmed moves, with buffer-aware availability checked in both RPC and guard.
create or replace function private.guard_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tutor_user uuid; authorized_move boolean := false;
begin
  select user_id into tutor_user from public.tutor_profiles where id = new.tutor_id for update;
  if tg_op = 'INSERT' then
    if new.student_id = tutor_user or not exists(select 1 from public.profiles as profiles join auth.users as users on users.id=profiles.id
      join public.user_roles as roles on roles.user_id=profiles.id and roles.role='student'
      where profiles.id=new.student_id and profiles.status='active' and profiles.adult_attested and users.email_confirmed_at is not null)
      or not private.tutor_is_public(new.tutor_id) then raise exception 'Ineligible booking participants' using errcode='22023'; end if;
    if not private.slot_is_available(new.tutor_id,new.blocking_starts_at,new.blocking_ends_at) then raise exception 'Slot unavailable' using errcode='22023'; end if;
  else
    select exists(select 1 from private.booking_move_authorizations as grants
      where grants.backend_pid=pg_catalog.pg_backend_pid() and grants.transaction_id=pg_catalog.txid_current()
        and grants.booking_id=old.id and grants.actor_id=auth.uid()) into authorized_move;
    if (new.id,new.student_id,new.tutor_id,new.subject_id,new.mode,new.price_minor,new.platform_fee_minor,new.currency,new.policy_snapshot,new.request_key,new.created_at,new.hold_expires_at)
      is distinct from (old.id,old.student_id,old.tutor_id,old.subject_id,old.mode,old.price_minor,old.platform_fee_minor,old.currency,old.policy_snapshot,old.request_key,old.created_at,old.hold_expires_at)
      then raise exception 'Immutable booking snapshot' using errcode='22023'; end if;
    if (new.starts_at,new.ends_at,new.blocking_starts_at,new.blocking_ends_at) is distinct from
      (old.starts_at,old.ends_at,old.blocking_starts_at,old.blocking_ends_at) and not authorized_move then
      raise exception 'Booking time is immutable outside authorized rescheduling' using errcode='22023'; end if;
    if authorized_move and (old.status<>'confirmed' or new.status<>old.status
      or not private.slot_is_available(new.tutor_id,new.blocking_starts_at,new.blocking_ends_at)) then
      raise exception 'Confirmed move is not available with its buffer' using errcode='22023'; end if;
    if new.status <> old.status and not ((old.status='draft' and new.status in ('payment_pending','cancelled')) or
      (old.status='payment_pending' and new.status in ('confirmed','cancelled')) or
      (old.status='confirmed' and new.status in ('in_progress','cancelled')) or (old.status='in_progress' and new.status='completed'))
      then raise exception 'Invalid booking transition' using errcode='22023'; end if;
    new.version := old.version+1;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create or replace function public.reschedule_booking_v2(booking uuid,tutor uuid,subject uuid,starts_at timestamptz,ends_at timestamptz,
  mode text,request_key text,confirmed_move boolean,reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); selected public.bookings; prior public.booking_reschedule_history; policy private.booking_policy;
  duration_seconds numeric; buffer_minutes integer; old_starts_at timestamptz; old_ends_at timestamptz;
begin
  if actor is null or not private.active_actor() or not private.has_role('student') then raise exception 'Not authorized' using errcode='42501'; end if;
  if booking is null or tutor is null or subject is null or starts_at is null or ends_at is null or not isfinite(starts_at) or not isfinite(ends_at)
    or ends_at<=starts_at or mode not in ('virtual','in_person') or request_key is null or length(request_key) not between 1 and 200
    or confirmed_move is null then raise exception 'Invalid reschedule request' using errcode='22023'; end if;
  select * into prior from public.booking_reschedule_history as history where history.actor_id=actor and history.request_key=reschedule_booking_v2.request_key;
  if found then
    if prior.booking_id<>booking or prior.tutor_id<>tutor or prior.subject_id<>subject or prior.mode<>mode
      or (prior.new_starts_at,prior.new_ends_at) is distinct from (starts_at,ends_at) or confirmed_move is not true
      or reason is null or prior.reason is distinct from btrim(reason)
      then raise exception 'Reschedule key reused with different input' using errcode='22023'; end if;
    return booking;
  end if;
  -- Delegate both initial pending moves and retries to the canonical replacement flow. Its private idempotency
  -- record preserves the replacement booking identity even after the original hold has been cancelled.
  if confirmed_move is false then
    return public.reschedule_booking(booking,tutor,subject,starts_at,ends_at,mode,request_key);
  end if;
  select * into selected from public.bookings as bookings where bookings.id=booking and bookings.student_id=actor;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  if selected.status<>'confirmed' or confirmed_move is not true or reason is null or length(btrim(reason)) not between 1 and 500 then
    raise exception 'Confirmed rescheduling requires an explicit confirmation and reason' using errcode='22023'; end if;
  perform 1 from public.tutor_profiles where id=selected.tutor_id for update;
  perform 1 from public.profiles where id=actor for update;
  select * into selected from public.bookings as bookings where bookings.id=booking and bookings.student_id=actor for update;
  if not found or selected.status<>'confirmed' then raise exception 'Booking changed while rescheduling' using errcode='40001'; end if;
  select * into prior from public.booking_reschedule_history as history where history.actor_id=actor and history.request_key=reschedule_booking_v2.request_key for update;
  if found then
    if prior.booking_id<>booking or prior.tutor_id<>tutor or prior.subject_id<>subject or prior.mode<>mode
      or (prior.new_starts_at,prior.new_ends_at) is distinct from (starts_at,ends_at)
      or confirmed_move is not true or reason is null or prior.reason is distinct from btrim(reason)
      then raise exception 'Reschedule key reused with different input' using errcode='22023'; end if;
    return booking;
  end if;
  old_starts_at:=selected.starts_at; old_ends_at:=selected.ends_at;
  if (selected.tutor_id,selected.subject_id,selected.mode) is distinct from (tutor,subject,mode)
    or extract(epoch from (ends_at-starts_at))<>extract(epoch from (selected.ends_at-selected.starts_at))
    then raise exception 'A confirmed move must preserve tutor, subject, mode and duration' using errcode='22023'; end if;
  duration_seconds:=extract(epoch from (ends_at-starts_at));
  if mod(duration_seconds,60)<>0 then raise exception 'Duration must be whole minutes' using errcode='22023'; end if;
  select * into policy from private.booking_policy where singleton;
  buffer_minutes:=policy.buffer_minutes;
  if duration_seconds<policy.minimum_minutes*60 or duration_seconds>policy.maximum_minutes*60
    or starts_at<statement_timestamp()+make_interval(mins=>policy.lead_minutes)
    or starts_at>statement_timestamp()+make_interval(days=>policy.advance_days)
    or (mode='virtual' and not (select supports_virtual from public.tutor_profiles where id=tutor))
    or (mode='in_person' and not (select supports_in_person from public.tutor_profiles where id=tutor))
    or not private.slot_is_available(tutor,starts_at-make_interval(mins=>buffer_minutes),ends_at+make_interval(mins=>buffer_minutes))
    then raise exception 'Requested time is not available with its buffer' using errcode='22023'; end if;
  insert into private.booking_move_authorizations(backend_pid,transaction_id,booking_id,actor_id)
    values(pg_catalog.pg_backend_pid(),pg_catalog.txid_current(),booking,actor);
  update public.bookings set starts_at=reschedule_booking_v2.starts_at,ends_at=reschedule_booking_v2.ends_at,
    blocking_starts_at=reschedule_booking_v2.starts_at-make_interval(mins=>buffer_minutes),
    blocking_ends_at=reschedule_booking_v2.ends_at+make_interval(mins=>buffer_minutes) where id=booking returning * into selected;
  delete from private.booking_move_authorizations where backend_pid=pg_catalog.pg_backend_pid()
    and transaction_id=pg_catalog.txid_current() and booking_id=booking and actor_id=actor;
  insert into public.booking_reschedule_history(booking_id,actor_id,old_starts_at,old_ends_at,new_starts_at,new_ends_at,
    reason,request_key,booking_version,tutor_id,subject_id,mode)
  values(booking,actor,old_starts_at,old_ends_at,starts_at,ends_at,btrim(reason),request_key,selected.version,tutor,subject,mode);
  return booking;
end;
$$;

revoke all on function public.save_notification_preference(text,boolean),public.claim_notification_outbox(integer),
  public.complete_notification_outbox(uuid,text,text,text),public.record_resend_delivery_event(text,text,text,timestamptz),
  public.set_admin_user_role(uuid,text,text,boolean,text),public.reschedule_booking_v2(uuid,uuid,uuid,timestamptz,timestamptz,text,text,boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function public.save_notification_preference(text,boolean),public.set_admin_user_role(uuid,text,text,boolean,text),
  public.reschedule_booking_v2(uuid,uuid,uuid,timestamptz,timestamptz,text,text,boolean,text) to authenticated;
grant execute on function public.claim_notification_outbox(integer),public.complete_notification_outbox(uuid,text,text,text),
  public.record_resend_delivery_event(text,text,text,timestamptz) to service_role;
grant execute on function private.guard_booking() to authenticated;

commit;
