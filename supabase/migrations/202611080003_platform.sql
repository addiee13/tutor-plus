begin;
set local search_path = public, extensions, pg_catalog;

-- Feed rows are generated only from a private deduplicated outbox. The worker can see its private payload;
-- authenticated users can see only feed rows addressed to themselves.
create table private.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  dedup_key text not null unique check (length(dedup_key) between 1 and 300),
  recipient_id uuid not null references public.profiles(id) on delete restrict,
  category text not null check (category in ('booking','session','assessment','assignment','study_plan','review','safety','system')),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 2000),
  target_path text check (target_path is null or (target_path like '/%' and target_path not like '//%')),
  scheduled_at timestamptz not null default statement_timestamp(),
  state text not null default 'pending' check (state in ('pending','processing','accepted','cancelled','failed')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz not null default statement_timestamp(),
  email_state text not null default 'queued' check (email_state in ('queued','accepted','disabled','not_configured','retrying','failed')),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,80}$'),
  booking_id uuid references public.bookings(id) on delete restrict,
  booking_version integer,
  reminder_offset_minutes integer check (reminder_offset_minutes in (60,1440)),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check ((booking_id is null) = (booking_version is null)),
  check (reminder_offset_minutes is null or booking_id is not null)
);
create index notification_outbox_due_idx on private.notification_outbox(next_attempt_at,scheduled_at)
  where state in ('pending','processing');
create index notification_outbox_recipient_idx on private.notification_outbox(recipient_id,created_at desc);
revoke all on private.notification_outbox from public,anon,authenticated,service_role;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null unique references private.notification_outbox(id) on delete restrict,
  recipient_id uuid not null references public.profiles(id) on delete restrict,
  category text not null check (category in ('booking','session','assessment','assignment','study_plan','review','safety','system')),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 2000),
  target_path text check (target_path is null or (target_path like '/%' and target_path not like '//%')),
  read_at timestamptz,
  created_at timestamptz not null default statement_timestamp()
);
create index notifications_recipient_feed_idx on public.notifications(recipient_id,created_at desc,id);
create table public.notification_preferences (
  user_id uuid not null references public.profiles(id) on delete restrict,
  category text not null check (category in ('booking','session','assessment','assignment','study_plan','review','safety','system')),
  email_enabled boolean not null default false,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (user_id,category)
);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid references public.subjects(id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 2000),
  url text not null check (url ~ '^https://[^[:space:]]+$' and length(url) <= 2000),
  resource_type text not null check (resource_type in ('article','video','practice','reference','other')),
  attribution text check (attribution is null or length(attribution) <= 500),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create index resources_active_subject_title_idx on public.resources(active,subject_id,title);

create table public.notification_templates (
  id uuid not null,
  version integer not null check (version > 0),
  category text not null check (category in ('booking','session','assessment','assignment','study_plan','review','safety','system')),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 2000),
  target_path text check (target_path is null or (target_path like '/%' and target_path not like '//%')),
  active boolean not null default true,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (id,version)
);
create unique index notification_templates_one_active_version on public.notification_templates(id) where active;

create table public.safety_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  target_user_id uuid references public.profiles(id) on delete restrict,
  target_review_id uuid references public.reviews(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  state text not null default 'open' check (state in ('open','reviewing','resolved','dismissed')),
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolution_reason text check (resolution_reason is null or length(resolution_reason) <= 500),
  created_at timestamptz not null default statement_timestamp(),
  resolved_at timestamptz,
  check (num_nonnulls(target_user_id,target_review_id) = 1),
  check ((state in ('resolved','dismissed')) = (resolved_at is not null))
);
create index safety_reports_state_time_idx on public.safety_reports(state,created_at desc);
create index safety_reports_reporter_time_idx on public.safety_reports(reporter_id,created_at desc);

create table private.assistant_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  question_sha256 text not null check (question_sha256 ~ '^[0-9a-f]{64}$'),
  question_chars integer not null check (question_chars between 1 and 10000),
  selected_context jsonb not null default '{}' check (jsonb_typeof(selected_context) = 'object'),
  model text not null check (length(model) between 1 and 100),
  state text not null default 'started' check (state in ('started','succeeded','refused','failed')),
  provider_response_id text check (provider_response_id is null or length(provider_response_id) <= 200),
  output_chars integer check (output_chars is null or output_chars between 0 and 20000),
  created_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz
);
create index assistant_requests_quota_idx on private.assistant_requests(user_id,created_at desc);
revoke all on private.assistant_requests from public,anon,authenticated,service_role;

create function private.notification_required(category text) returns boolean
language sql immutable set search_path = '' as $$ select category in ('booking','safety','system'); $$;

create function private.enqueue_notification(dedup text,recipient uuid,category text,title text,body text,target text,
  due_at timestamptz default statement_timestamp(),booking uuid default null,version_no integer default null,
  reminder integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if recipient is null or category not in ('booking','session','assessment','assignment','study_plan','review','safety','system')
    or length(btrim(title)) not between 1 and 200 or length(btrim(body)) not between 1 and 2000 then
    raise exception 'Invalid notice' using errcode = '22023';
  end if;
  insert into private.notification_outbox(dedup_key,recipient_id,category,title,body,target_path,scheduled_at,
    booking_id,booking_version,reminder_offset_minutes)
  values(dedup,recipient,category,btrim(title),btrim(body),target,due_at,booking,version_no,reminder)
  on conflict (dedup_key) do update set dedup_key = excluded.dedup_key returning id into result;
  return result;
end;
$$;

create function private.on_booking_event_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare student uuid; tutor_user uuid;
begin
  select bookings.student_id,tutors.user_id into student,tutor_user from public.bookings as bookings
    join public.tutor_profiles as tutors on tutors.id = bookings.tutor_id where bookings.id = new.booking_id;
  if student is not null then perform private.enqueue_notification('booking-event:'||new.id||':'||student,
    student,'booking','Booking update','Your tutoring booking has an update.','/bookings',statement_timestamp(),new.booking_id,new.booking_version); end if;
  if tutor_user is not null and tutor_user <> student then perform private.enqueue_notification('booking-event:'||new.id||':'||tutor_user,
    tutor_user,'booking','Booking update','Your tutoring booking has an update.','/bookings',statement_timestamp(),new.booking_id,new.booking_version); end if;
  return new;
end;
$$;
create trigger booking_event_notice after insert on public.booking_events for each row execute function private.on_booking_event_notice();

create function private.on_review_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tutor_user uuid;
begin
  select user_id into tutor_user from public.tutor_profiles where id = new.tutor_id;
  perform private.enqueue_notification('review:'||new.id||':'||tutor_user,tutor_user,'review','New session review',
    'A learner left a review for a completed session.','/reviews'); return new;
end;
$$;
create trigger review_notice after insert on public.reviews for each row execute function private.on_review_notice();

create function private.on_assessment_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'assigned' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.enqueue_notification('assessment-assigned:'||new.id||':'||new.updated_at,new.student_id,'assessment',
      'Assessment assigned','A tutor assigned an assessment.','/assessments'); end if;
  return new;
end;
$$;
create trigger assessment_notice after insert or update of status on public.assessments for each row execute function private.on_assessment_notice();

create function private.on_assignment_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'assigned' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.enqueue_notification('assignment-assigned:'||new.id||':'||new.updated_at,new.student_id,'assignment',
      'Assignment assigned','A tutor assigned an assignment.','/assignments'); end if;
  return new;
end;
$$;
create trigger assignment_notice after insert or update of status on public.assignments for each row execute function private.on_assignment_notice();

create function private.on_study_plan_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue_notification('study-plan:'||new.id||':revision:'||new.current_revision,new.student_id,'study_plan',
    'Study plan updated','A tutor created or updated a study plan.','/study-plans'); return new;
end;
$$;
create trigger study_plan_notice after insert on public.study_plans for each row execute function private.on_study_plan_notice();

create function public.mark_notification_read(notification uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare read_time timestamptz;
begin
  if not private.active_actor() then raise exception 'Not authorized' using errcode = '42501'; end if;
  update public.notifications set read_at = coalesce(read_at,statement_timestamp())
  where id = notification and recipient_id = auth.uid() returning read_at into read_time;
  if read_time is null then raise exception 'Notice unavailable' using errcode = '42501'; end if;
  return read_time;
end;
$$;

create function public.save_notification_preference(category text,email_enabled boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare selected boolean;
begin
  if not private.active_actor() or category not in ('booking','session','assessment','assignment','study_plan','review','safety','system')
    or email_enabled is null then raise exception 'Invalid preference' using errcode = '22023'; end if;
  selected := email_enabled or private.notification_required(category);
  insert into public.notification_preferences(user_id,category,email_enabled)
  values(auth.uid(),category,selected)
  on conflict(user_id,category) do update set email_enabled = excluded.email_enabled,updated_at = statement_timestamp()
  returning email_enabled into selected;
  return selected;
end;
$$;

create function public.submit_safety_report(tutor uuid,target_user uuid,target_review uuid,report_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare reporter uuid := auth.uid(); target uuid; result uuid;
begin
  if not private.active_actor() or num_nonnulls(tutor,target_user,target_review) <> 1
    or report_reason is null or length(btrim(report_reason)) not between 1 and 2000 then
    raise exception 'Invalid report' using errcode = '22023'; end if;
  if tutor is not null then
    select user_id into target from public.tutor_profiles where id = tutor and publication_state = 'published';
  elsif target_review is not null then
    select tutors.user_id into target from public.reviews as reviews
      join public.tutor_profiles as tutors on tutors.id = reviews.tutor_id
      where reviews.id = target_review and reviews.status = 'visible';
  else target := target_user; end if;
  if target is null or target = reporter then raise exception 'Report target unavailable' using errcode = '22023'; end if;
  insert into public.safety_reports(reporter_id,target_user_id,target_review_id,reason)
  values(reporter,target,target_review,btrim(report_reason)) returning id into result;
  perform private.enqueue_notification('safety-report:'||result||':'||reporter,reporter,'safety',
    'Report received','Your safety report was received and will be reviewed.','/support');
  return result;
end;
$$;

create function public.resolve_safety_report(report uuid,requested_state text,reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.assert_administrator();
begin
  if requested_state not in ('reviewing','resolved','dismissed') or reason is null or length(btrim(reason)) not between 1 and 500 then
    raise exception 'Invalid report resolution' using errcode = '22023'; end if;
  update public.safety_reports as reports set state = requested_state,
    resolved_by = case when requested_state in ('resolved','dismissed') then actor else null end,
    resolution_reason = btrim(reason),
    resolved_at = case when requested_state in ('resolved','dismissed') then statement_timestamp() else null end
  where reports.id = report;
  if not found then raise exception 'Unknown report' using errcode = '22023'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,reason,safe_metadata)
  values(actor,'safety.report_resolved','safety_reports',report,btrim(reason),jsonb_build_object('state',requested_state));
end;
$$;

create function public.save_resource(resource uuid,subject uuid,resource_title text,resource_description text,
  resource_url text,resource_type text,resource_attribution text,is_active boolean,confirmed boolean,reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.assert_administrator(); result uuid := coalesce(resource,gen_random_uuid());
begin
  if confirmed is not true or reason is null or length(btrim(reason)) not between 1 and 500
    or resource_title is null or length(btrim(resource_title)) not between 1 and 200
    or resource_description is null or length(resource_description) > 2000
    or resource_url is null or resource_url !~ '^https://[^[:space:]]+$' or length(resource_url) > 2000
    or resource_type not in ('article','video','practice','reference','other')
    or (resource_attribution is not null and length(resource_attribution) > 500) or is_active is null then
    raise exception 'Invalid resource change' using errcode = '22023'; end if;
  if resource is null then
    insert into public.resources(id,subject_id,title,description,url,resource_type,attribution,active,created_by)
    values(result,subject,btrim(resource_title),btrim(resource_description),resource_url,resource_type,
      nullif(btrim(resource_attribution),''),is_active,actor);
  else
    update public.resources as existing set subject_id = save_resource.subject,title = btrim(resource_title),
      description = btrim(resource_description),url = resource_url,resource_type = save_resource.resource_type,
      attribution = nullif(btrim(resource_attribution),''),active = is_active,updated_at = statement_timestamp()
      where existing.id = resource;
    if not found then raise exception 'Unknown resource' using errcode = '22023'; end if;
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,reason,safe_metadata)
  values(actor,'catalog.resource_saved','resources',result,btrim(reason),jsonb_build_object('active',is_active));
  return result;
end;
$$;

create function public.save_subject(subject uuid,subject_name text,subject_slug text,parent uuid,
  is_active boolean,sort_position integer,confirmed boolean,reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.assert_administrator(); result uuid := coalesce(subject,gen_random_uuid());
begin
  if confirmed is not true or reason is null or length(btrim(reason)) not between 1 and 500
    or subject_name is null or length(btrim(subject_name)) not between 1 and 100
    or subject_slug is null or subject_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(subject_slug) > 120
    or is_active is null or sort_position is null or sort_position not between -100000 and 100000 or parent = subject then
    raise exception 'Invalid subject change' using errcode = '22023'; end if;
  if subject is null then
    insert into public.subjects(id,name,slug,parent_id,active,sort_order)
    values(result,btrim(subject_name),subject_slug,parent,is_active,sort_position);
  else
    update public.subjects as existing set name = btrim(subject_name),slug = subject_slug,parent_id = parent,
      active = is_active,sort_order = sort_position,updated_at = statement_timestamp() where existing.id = subject;
    if not found then raise exception 'Unknown subject' using errcode = '22023'; end if;
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,reason,safe_metadata)
  values(actor,'catalog.subject_saved','subjects',result,btrim(reason),jsonb_build_object('active',is_active));
  return result;
end;
$$;

create function public.save_notification_template(template uuid,category text,template_title text,template_body text,
  target text,is_active boolean,confirmed boolean,reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.assert_administrator(); result uuid := coalesce(template,gen_random_uuid()); next_version integer;
begin
  if confirmed is not true or reason is null or length(btrim(reason)) not between 1 and 500
    or category not in ('booking','session','assessment','assignment','study_plan','review','safety','system')
    or template_title is null or length(btrim(template_title)) not between 1 and 200
    or template_body is null or length(btrim(template_body)) not between 1 and 2000 or is_active is null
    or (target is not null and (target not like '/%' or target like '//%')) then
    raise exception 'Invalid template change' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(result::text,0));
  select coalesce(max(versions.version),0)+1 into next_version from public.notification_templates as versions where versions.id = result;
  if is_active then update public.notification_templates as old set active = false where old.id = result and old.active; end if;
  insert into public.notification_templates(id,version,category,title,body,target_path,active,updated_by)
  values(result,next_version,category,btrim(template_title),btrim(template_body),target,is_active,actor);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,reason,safe_metadata)
  values(actor,'notification.template_saved','notification_templates',result,btrim(reason),jsonb_build_object('version',next_version,'active',is_active));
  return result;
end;
$$;

create function public.admin_search_users(search_text text,page_size integer,page_offset integer)
returns table(id uuid,email text,display_name text,status text,roles text[],created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_administrator();
  if search_text is not null and length(search_text) > 120 then raise exception 'Search too long' using errcode = '22023'; end if;
  return query select profiles.id,users.email::text,profiles.display_name,profiles.status,
    coalesce(array_agg(roles.role order by roles.role) filter(where roles.role is not null),'{}'),profiles.created_at
  from public.profiles as profiles join auth.users as users on users.id = profiles.id
  left join public.user_roles as roles on roles.user_id = profiles.id
  where search_text is null or profiles.display_name ilike '%'||search_text||'%' or users.email ilike '%'||search_text||'%'
  group by profiles.id,users.email,profiles.display_name,profiles.status,profiles.created_at
  order by profiles.created_at desc,profiles.id limit greatest(1,least(coalesce(page_size,25),51))
  offset greatest(0,least(coalesce(page_offset,0),100000));
end;
$$;

create function public.set_admin_user_status(target uuid,active boolean,confirmed boolean,reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if confirmed is not true or active is null or reason is null or length(btrim(reason)) not between 1 and 500 then
    raise exception 'Confirmation and reason are required' using errcode = '22023'; end if;
  perform public.set_user_status(target,case when active then 'active' else 'inactive' end,btrim(reason));
end;
$$;

-- The scheduler creates only reminders whose target instant is still in the future. A claimed reminder is
-- revalidated against current booking status/version, so a cancel or move invalidates old work before delivery.
create function public.enqueue_booking_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare item record; offset_minutes integer; due_at timestamptz; queued integer := 0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  update private.notification_outbox as notices set state = 'cancelled',updated_at = statement_timestamp()
  where notices.reminder_offset_minutes is not null and notices.state in ('pending','processing')
    and not exists(select 1 from public.bookings as bookings where bookings.id = notices.booking_id
      and bookings.status = 'confirmed' and bookings.version = notices.booking_version);
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

create function public.claim_notification_outbox(batch_size integer)
returns table(id uuid,recipient_email text,category text,title text,body text,target_path text,email_enabled boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  return query with candidates as (
    select notices.id from private.notification_outbox as notices
    where notices.state = 'pending' and notices.scheduled_at <= statement_timestamp()
      and notices.next_attempt_at <= statement_timestamp() and notices.attempt_count < 5
      and (notices.booking_id is null or exists(select 1 from public.bookings as bookings where bookings.id = notices.booking_id
        and bookings.status = 'confirmed' and (notices.reminder_offset_minutes is null or bookings.version = notices.booking_version)))
    order by notices.scheduled_at,notices.id for update skip locked limit greatest(1,least(coalesce(batch_size,50),100))
  ), claimed as (
    update private.notification_outbox as notices set state = 'processing',attempt_count = notices.attempt_count + 1,
      updated_at = statement_timestamp() from candidates where notices.id = candidates.id returning notices.*
  ), inserted_feed as (
    insert into public.notifications(outbox_id,recipient_id,category,title,body,target_path)
    select claimed.id,claimed.recipient_id,claimed.category,claimed.title,claimed.body,claimed.target_path from claimed
    on conflict(outbox_id) do nothing returning outbox_id
  )
  select claimed.id,users.email::text,claimed.category,claimed.title,claimed.body,claimed.target_path,
    private.notification_required(claimed.category) or coalesce(preferences.email_enabled,false)
  from claimed join auth.users as users on users.id = claimed.recipient_id
  left join public.notification_preferences as preferences on preferences.user_id = claimed.recipient_id
    and preferences.category = claimed.category;
end;
$$;

create function public.complete_notification_outbox(notice uuid,outcome text,error_code text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare current_attempt integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if outcome not in ('accepted','disabled','not_configured','retry','failed','cancelled')
    or (error_code is not null and error_code !~ '^[a-z0-9_]{1,80}$') then raise exception 'Invalid outcome' using errcode = '22023'; end if;
  select attempt_count into current_attempt from private.notification_outbox where id = notice and state = 'processing' for update;
  if not found then raise exception 'Notice unavailable' using errcode = '22023'; end if;
  update private.notification_outbox set
    state = case when outcome in ('accepted','disabled','not_configured','cancelled') then 'accepted'
      when outcome = 'retry' and current_attempt < 5 then 'pending' else 'failed' end,
    email_state = case when outcome = 'retry' and current_attempt < 5 then 'retrying' else outcome end,
    last_error_code = error_code,
    next_attempt_at = case when outcome = 'retry' and current_attempt < 5
      then statement_timestamp()+make_interval(secs => least(3600,30*(2^greatest(current_attempt-1,0)))) else next_attempt_at end,
    updated_at = statement_timestamp()
  where id = notice;
end;
$$;

create function public.start_assistant_request(question_hash text,chars integer,selected_context jsonb,
  model_name text,prompt_limit integer,daily_quota integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); result uuid;
begin
  if actor is null or not private.active_actor() or not private.has_role('student') then raise exception 'Not authorized' using errcode = '42501'; end if;
  if question_hash !~ '^[0-9a-f]{64}$' or chars not between 1 and greatest(1,least(coalesce(prompt_limit,100),10000))
    or jsonb_typeof(selected_context) <> 'object' or length(model_name) not between 1 and 100
    or daily_quota not between 1 and 100 then raise exception 'Invalid assistant request' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':assistant:'||current_date::text,0));
  if (select count(*) from private.assistant_requests where user_id = actor and created_at >= date_trunc('day',statement_timestamp())) >= daily_quota
    then raise exception 'Daily assistant limit reached' using errcode = '22023'; end if;
  insert into private.assistant_requests(user_id,question_sha256,question_chars,selected_context,model)
    values(actor,question_hash,chars,selected_context,model_name) returning id into result;
  return result;
end;
$$;

create function public.finish_assistant_request(request uuid,outcome text,response_id text,chars integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.active_actor() or outcome not in ('succeeded','refused','failed')
    or (response_id is not null and length(response_id)>200) or (chars is not null and chars not between 0 and 20000)
    then raise exception 'Invalid completion' using errcode = '22023'; end if;
  update private.assistant_requests set state = outcome,provider_response_id = response_id,output_chars = chars,
    finished_at = statement_timestamp() where id = request and user_id = auth.uid() and state = 'started';
  if not found then raise exception 'Request unavailable' using errcode = '42501'; end if;
end;
$$;

create function public.admin_read_safety_reports(page_size integer,page_offset integer)
returns setof public.safety_reports language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_administrator();
  return query select reports.* from public.safety_reports as reports order by reports.created_at desc,reports.id
    limit greatest(1,least(coalesce(page_size,100),200)) offset greatest(0,least(coalesce(page_offset,0),100000));
end;
$$;

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.resources enable row level security;
alter table public.notification_templates enable row level security;
alter table public.safety_reports enable row level security;
revoke all on public.notifications,public.notification_preferences,public.resources,public.notification_templates,public.safety_reports
  from public,anon,authenticated,service_role;
grant select on public.notifications,public.notification_preferences,public.resources,public.notification_templates,public.safety_reports to authenticated;
grant select on public.resources to anon;
create policy notification_recipient_read on public.notifications for select to authenticated
  using (private.active_actor() and recipient_id = auth.uid());
create policy notification_preference_owner_read on public.notification_preferences for select to authenticated
  using (private.active_actor() and user_id = auth.uid());
create policy public_active_resources on public.resources for select to anon,authenticated using (active);
create policy admin_inactive_resources on public.resources for select to authenticated using (private.has_role('administrator'));
create policy active_templates_read on public.notification_templates for select to authenticated
  using (active and private.active_actor());
create policy safety_report_read on public.safety_reports for select to authenticated
  using (private.active_actor() and (reporter_id = auth.uid() or private.has_role('administrator')));

revoke all on function public.mark_notification_read(uuid),public.save_notification_preference(text,boolean),
  public.submit_safety_report(uuid,uuid,uuid,text),public.resolve_safety_report(uuid,text,text),
  public.save_resource(uuid,uuid,text,text,text,text,text,boolean,boolean,text),public.save_subject(uuid,text,text,uuid,boolean,integer,boolean,text),
  public.save_notification_template(uuid,text,text,text,text,boolean,boolean,text),public.admin_search_users(text,integer,integer),
  public.set_admin_user_status(uuid,boolean,boolean,text),public.enqueue_booking_reminders(),public.claim_notification_outbox(integer),
  public.complete_notification_outbox(uuid,text,text),public.start_assistant_request(text,integer,jsonb,text,integer,integer),
  public.finish_assistant_request(uuid,text,text,integer),public.admin_read_safety_reports(integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.mark_notification_read(uuid),public.save_notification_preference(text,boolean),
  public.submit_safety_report(uuid,uuid,uuid,text),public.resolve_safety_report(uuid,text,text),
  public.save_resource(uuid,uuid,text,text,text,text,text,boolean,boolean,text),public.save_subject(uuid,text,text,uuid,boolean,integer,boolean,text),
  public.save_notification_template(uuid,text,text,text,text,boolean,boolean,text),public.admin_search_users(text,integer,integer),
  public.set_admin_user_status(uuid,boolean,boolean,text),public.start_assistant_request(text,integer,jsonb,text,integer,integer),
  public.finish_assistant_request(uuid,text,text,integer) to authenticated;
grant execute on function public.enqueue_booking_reminders(),public.claim_notification_outbox(integer),
  public.complete_notification_outbox(uuid,text,text),public.admin_read_safety_reports(integer,integer) to service_role;

revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.notification_required(text) to authenticated;

commit;
