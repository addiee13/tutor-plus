begin;

insert into public.subjects(id, name, slug, sort_order) values
('a1000000-0000-4000-8000-000000000001', 'Math', 'math', 1),
('a1000000-0000-4000-8000-000000000002', 'Science', 'science', 2),
('a1000000-0000-4000-8000-000000000003', 'Reading/Writing', 'reading-writing', 3);

create function private.guard_booking_payment_state() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.status <> 'payment_pending' then
    raise exception 'New bookings must begin with a pending payment hold' using errcode = '22023';
  end if;
  if new.status = 'confirmed' and not exists (
    select 1 from public.payments where booking_id = new.id and state = 'paid') then
    raise exception 'Confirmation requires captured authoritative payment' using errcode = '22023';
  end if;
  if new.status = 'in_progress' and not exists (
    select 1 from public.booking_private_details where booking_id = new.id
    and ((new.mode = 'virtual' and meeting_url is not null) or (new.mode = 'in_person' and meeting_place is not null))) then
    raise exception 'Session requires private meeting details' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger bookings_payment_state before insert or update on public.bookings
for each row execute function private.guard_booking_payment_state();

create function private.prevent_history_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'History is append-only' using errcode = '22023';
end;
$$;
create trigger audit_logs_append_only before update or delete on public.audit_logs
for each row execute function private.prevent_history_mutation();
create trigger booking_events_append_only before update or delete on public.booking_events
for each row execute function private.prevent_history_mutation();

create function private.guard_subject_tree() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(93126002);
  if new.parent_id is not null and exists (
    with recursive ancestors as (
      select id, parent_id from public.subjects where id = new.parent_id
      union
      select subjects.id, subjects.parent_id from public.subjects as subjects
      join ancestors on subjects.id = ancestors.parent_id
    ) select 1 from ancestors where id = new.id
  ) then
    raise exception 'Subject hierarchy cycle' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger subjects_acyclic before insert or update on public.subjects
for each row execute function private.guard_subject_tree();

revoke insert, update, delete, truncate, references, trigger on public.profiles, public.user_roles, public.audit_logs,
public.subjects, public.tutor_profiles, public.tutor_subjects, public.availability_rules, public.availability_exceptions,
public.public_tutor_snapshots, public.bookings, public.booking_events, public.payments, public.payment_events,
public.refunds, public.payout_refs from service_role;
revoke all on public.booking_private_details from service_role;
grant select, insert, update on public.booking_private_details to service_role;
grant select on public.payments, public.payment_events, public.refunds, public.bookings to service_role;
revoke delete on public.tutor_profiles from authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.tutor_is_public(uuid) to anon, authenticated;
grant execute on function private.valid_timezone(text), private.active_actor(), private.has_role(text), private.owns_tutor(uuid),
private.booking_participant(uuid), private.payment_participant(uuid) to authenticated;

commit;
