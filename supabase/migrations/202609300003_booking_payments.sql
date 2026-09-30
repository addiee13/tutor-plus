begin;
set local search_path = public, extensions, pg_catalog;

create table private.booking_policy (
  singleton boolean primary key default true check (singleton),
  lead_minutes integer not null check (lead_minutes >= 0),
  advance_days integer not null check (advance_days between 1 and 730),
  buffer_minutes integer not null check (buffer_minutes between 0 and 120),
  hold_minutes integer not null check (hold_minutes between 1 and 60),
  minimum_minutes integer not null check (minimum_minutes > 0),
  maximum_minutes integer not null check (maximum_minutes >= minimum_minutes),
  fee_basis_points integer not null check (fee_basis_points between 0 and 10000)
);
insert into private.booking_policy values (true, 60, 365, 10, 15, 15, 180, 0);
revoke all on private.booking_policy from public, anon, authenticated, service_role;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete restrict,
  tutor_id uuid not null references public.tutor_profiles(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  starts_at timestamptz not null check (isfinite(starts_at)),
  ends_at timestamptz not null check (isfinite(ends_at)),
  blocking_starts_at timestamptz not null check (isfinite(blocking_starts_at)),
  blocking_ends_at timestamptz not null check (isfinite(blocking_ends_at)),
  blocking_range tstzrange generated always as (tstzrange(blocking_starts_at, blocking_ends_at, '[)')) stored,
  mode text not null check (mode in ('virtual', 'in_person')),
  price_minor bigint not null check (price_minor > 0),
  platform_fee_minor bigint not null check (platform_fee_minor between 0 and price_minor),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('draft', 'payment_pending', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  hold_expires_at timestamptz,
  policy_snapshot jsonb not null check (jsonb_typeof(policy_snapshot) = 'object'),
  cancellation_reason text check (length(cancellation_reason) <= 500),
  request_key text not null check (length(request_key) between 1 and 200),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, request_key),
  foreign key (tutor_id, subject_id) references public.tutor_subjects(tutor_id, subject_id) on delete restrict,
  check (starts_at < ends_at and blocking_starts_at <= starts_at and blocking_ends_at >= ends_at),
  check ((status = 'payment_pending' and hold_expires_at is not null) or (status <> 'payment_pending')),
  exclude using gist (tutor_id with =, blocking_range with &&)
    where (status in ('payment_pending', 'confirmed', 'in_progress')),
  exclude using gist (student_id with =, blocking_range with &&)
    where (status in ('payment_pending', 'confirmed', 'in_progress'))
);
create index bookings_tutor_time_idx on public.bookings(tutor_id, starts_at);
create index bookings_student_time_idx on public.bookings(student_id, starts_at);
create index bookings_subject_idx on public.bookings(subject_id);
create index bookings_tutor_subject_idx on public.bookings(tutor_id, subject_id);
create index bookings_hold_idx on public.bookings(hold_expires_at) where status = 'payment_pending';

create table public.booking_private_details (
  booking_id uuid primary key references public.bookings(id) on delete restrict,
  meeting_url text check (length(meeting_url) <= 1000 and meeting_url ~ '^https://'),
  meeting_place text check (length(meeting_place) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  event_type text not null,
  from_state text,
  to_state text not null,
  reason text,
  booking_version integer not null,
  created_at timestamptz not null default now(),
  unique (booking_id, booking_version)
);
create index booking_events_actor_idx on public.booking_events(actor_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  provider_payment_id text unique,
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),
  amount_minor bigint not null check (amount_minor > 0),
  fee_minor bigint not null check (fee_minor between 0 and amount_minor),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  state text not null default 'created' check (state in ('created', 'requires_action', 'processing', 'paid', 'failed', 'partially_refunded', 'refunded')),
  paid_at timestamptz,
  refunded_at timestamptz,
  last_provider_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  provider_event_id text not null unique check (length(provider_event_id) between 1 and 200),
  event_type text not null,
  safe_state_snapshot jsonb not null check (jsonb_typeof(safe_state_snapshot) = 'object'),
  provider_occurred_at timestamptz not null check (isfinite(provider_occurred_at)),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index payment_events_payment_time_idx on public.payment_events(payment_id, created_at);
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  provider_refund_id text unique,
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),
  amount_minor bigint not null check (amount_minor > 0),
  state text not null default 'requested' check (state in ('requested', 'pending', 'succeeded', 'failed')),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  requested_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index refunds_payment_state_idx on public.refunds(payment_id, state);
create index refunds_requestor_idx on public.refunds(requested_by);
create table public.payout_refs (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  connected_account_id text not null,
  provider_transfer_id text unique,
  provider_charge_id text,
  state text not null check (state in ('pending', 'verified', 'failed', 'reversed')),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payout_refs_payment_idx on public.payout_refs(payment_id);

create function private.booking_participant(booking uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.active_actor() and exists (
    select 1 from public.bookings as bookings join public.tutor_profiles as tutors on tutors.id = bookings.tutor_id
    where bookings.id = booking and (bookings.student_id = auth.uid() or tutors.user_id = auth.uid())
  );
$$;
create function private.payment_participant(payment uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.payments where id = payment and private.booking_participant(booking_id));
$$;

create function private.slot_is_available(tutor uuid, start_time timestamptz, end_time timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select start_time < end_time and (
    exists (
      select 1 from public.availability_rules as rules
      where rules.tutor_id = tutor and rules.active
        and (start_time at time zone rules.timezone)::date >= rules.valid_from
        and (rules.valid_until is null or (start_time at time zone rules.timezone)::date <= rules.valid_until)
        and extract(dow from start_time at time zone rules.timezone) = rules.weekday
        and start_time >= (((start_time at time zone rules.timezone)::date + rules.local_start) at time zone rules.timezone)
        and end_time <= (((start_time at time zone rules.timezone)::date + rules.local_end) at time zone rules.timezone)
    ) or exists (
      select 1 from public.availability_exceptions as additions
      where additions.tutor_id = tutor and additions.exception_type = 'additional'
        and start_time >= ((additions.local_date + additions.local_start) at time zone additions.timezone)
        and end_time <= ((additions.local_date + additions.local_end) at time zone additions.timezone)
    )
  ) and not exists (
    select 1 from public.availability_exceptions as unavailable
    where unavailable.tutor_id = tutor and unavailable.exception_type = 'unavailable'
      and tstzrange(start_time, end_time, '[)') && tstzrange(
        ((unavailable.local_date + coalesce(unavailable.local_start, time '00:00')) at time zone unavailable.timezone),
        (case when unavailable.local_end is null then (unavailable.local_date + 1)::timestamp
          else unavailable.local_date + unavailable.local_end end at time zone unavailable.timezone), '[)')
  );
$$;

create function private.guard_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tutor_user uuid;
begin
  select user_id into tutor_user from public.tutor_profiles where id = new.tutor_id for update;
  if tg_op = 'INSERT' then
    if new.student_id = tutor_user or not exists (
      select 1 from public.profiles as profiles join auth.users as users on users.id = profiles.id
      join public.user_roles as roles on roles.user_id = profiles.id and roles.role = 'student'
      where profiles.id = new.student_id and profiles.status = 'active' and profiles.adult_attested
        and users.email_confirmed_at is not null
    ) or not private.tutor_is_public(new.tutor_id) then
      raise exception 'Ineligible booking participants' using errcode = '22023';
    end if;
    if not private.slot_is_available(new.tutor_id, new.blocking_starts_at, new.blocking_ends_at) then
      raise exception 'Slot unavailable' using errcode = '22023';
    end if;
  else
    if (new.student_id, new.tutor_id, new.subject_id, new.starts_at, new.ends_at, new.blocking_starts_at,
      new.blocking_ends_at, new.mode, new.price_minor, new.platform_fee_minor, new.currency,
      new.policy_snapshot, new.request_key, new.created_at, new.hold_expires_at)
      is distinct from (old.student_id, old.tutor_id, old.subject_id, old.starts_at, old.ends_at,
      old.blocking_starts_at, old.blocking_ends_at, old.mode, old.price_minor, old.platform_fee_minor,
      old.currency, old.policy_snapshot, old.request_key, old.created_at, old.hold_expires_at) then
      raise exception 'Immutable booking snapshot' using errcode = '22023';
    end if;
    if new.status <> old.status and not (
      (old.status = 'draft' and new.status in ('payment_pending', 'cancelled')) or
      (old.status = 'payment_pending' and new.status in ('confirmed', 'cancelled')) or
      (old.status = 'confirmed' and new.status in ('in_progress', 'cancelled')) or
      (old.status = 'in_progress' and new.status = 'completed')) then
      raise exception 'Invalid booking transition' using errcode = '22023';
    end if;
    new.version := old.version + 1;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger bookings_guard before insert or update on public.bookings for each row execute function private.guard_booking();

create function private.record_booking_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.booking_events(booking_id, actor_id, event_type, from_state, to_state, reason, booking_version)
  values (new.id, auth.uid(), case when tg_op = 'INSERT' then 'booking.created' else 'booking.transition' end,
    case when tg_op = 'UPDATE' then old.status end, new.status, new.cancellation_reason, new.version);
  return new;
end;
$$;
create trigger bookings_history after insert or update on public.bookings for each row execute function private.record_booking_event();

create function public.create_booking(tutor uuid, subject uuid, starts_at timestamptz, ends_at timestamptz,
  mode text, request_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  selected_tutor public.tutor_profiles;
  configuration private.booking_policy;
  existing public.bookings;
  duration_seconds numeric := extract(epoch from ends_at - starts_at);
  hourly_rate bigint;
  computed_price bigint;
  booking_id uuid;
begin
  if not private.has_role('student') then raise exception 'Not authorized' using errcode = '42501'; end if;
  if starts_at is null or ends_at is null or not isfinite(starts_at) or not isfinite(ends_at)
    or duration_seconds <= 0 or mode is null or mode not in ('virtual', 'in_person')
    or request_key is null or length(request_key) not between 1 and 200 then
    raise exception 'Invalid booking input' using errcode = '22023';
  end if;
  select * into selected_tutor from public.tutor_profiles where id = tutor for update;
  if not found then raise exception 'Unknown tutor' using errcode = '22023'; end if;
  perform 1 from public.profiles where id = actor for update;
  select * into existing from public.bookings where student_id = actor and bookings.request_key = create_booking.request_key;
  if found then
    if (existing.tutor_id, existing.subject_id, existing.starts_at, existing.ends_at, existing.mode)
      is distinct from (tutor, subject, create_booking.starts_at, create_booking.ends_at, create_booking.mode) then
      raise exception 'Idempotency key reused with different input' using errcode = '22023';
    end if;
    return existing.id;
  end if;
  select * into configuration from private.booking_policy where singleton;
  if duration_seconds < configuration.minimum_minutes * 60 or duration_seconds > configuration.maximum_minutes * 60
    or starts_at < statement_timestamp() + make_interval(mins => configuration.lead_minutes)
    or starts_at > statement_timestamp() + make_interval(days => configuration.advance_days)
    or (mode = 'virtual' and not selected_tutor.supports_virtual)
    or (mode = 'in_person' and not selected_tutor.supports_in_person) then
    raise exception 'Invalid booking window or mode' using errcode = '22023';
  end if;
  select coalesce(links.rate_override_minor, selected_tutor.hourly_rate_minor) into hourly_rate
  from public.tutor_subjects as links join public.subjects as subjects on subjects.id = links.subject_id
  where links.tutor_id = tutor and links.subject_id = subject and subjects.active;
  if not found then raise exception 'Subject unavailable' using errcode = '22023'; end if;
  update public.bookings set status = 'cancelled', cancellation_reason = 'Payment hold expired'
  where tutor_id = tutor and status = 'payment_pending' and hold_expires_at <= statement_timestamp();
  update public.bookings set status = 'cancelled', cancellation_reason = 'Payment hold expired'
  where student_id = actor and status = 'payment_pending' and hold_expires_at <= statement_timestamp();
  computed_price := ceil(hourly_rate::numeric * duration_seconds / 3600)::bigint;
  insert into public.bookings(student_id, tutor_id, subject_id, starts_at, ends_at, blocking_starts_at,
    blocking_ends_at, mode, price_minor, platform_fee_minor, currency, status, hold_expires_at, policy_snapshot, request_key)
  values (actor, tutor, subject, starts_at, ends_at,
    starts_at - make_interval(mins => configuration.buffer_minutes), ends_at + make_interval(mins => configuration.buffer_minutes),
    mode, computed_price, ceil(computed_price::numeric * configuration.fee_basis_points / 10000)::bigint,
    selected_tutor.currency, 'payment_pending', statement_timestamp() + make_interval(mins => configuration.hold_minutes),
    jsonb_build_object('hourly_rate_minor', hourly_rate, 'buffer_minutes', configuration.buffer_minutes,
      'hold_minutes', configuration.hold_minutes, 'fee_basis_points', configuration.fee_basis_points), request_key)
  returning id into booking_id;
  return booking_id;
end;
$$;

create function public.cancel_booking(booking uuid, reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare tutor uuid;
begin
  if not private.booking_participant(booking) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if reason is null or length(btrim(reason)) not between 1 and 500 then
    raise exception 'Reason required' using errcode = '22023';
  end if;
  select tutor_id into tutor from public.bookings where id = booking;
  perform 1 from public.tutor_profiles where id = tutor for update;
  update public.bookings set status = 'cancelled', cancellation_reason = reason
  where id = booking and status in ('draft', 'payment_pending', 'confirmed');
  if not found and not exists (select 1 from public.bookings where id = booking and status = 'cancelled') then
    raise exception 'Booking cannot be cancelled' using errcode = '22023';
  end if;
end;
$$;

create function private.guard_payment_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare booking public.bookings;
begin
  select * into booking from public.bookings where id = new.booking_id;
  if (new.amount_minor, new.fee_minor, new.currency) is distinct from
    (booking.price_minor, booking.platform_fee_minor, booking.currency) then
    raise exception 'Payment must match booking snapshot' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and (new.id, new.booking_id, new.amount_minor, new.fee_minor, new.currency, new.idempotency_key)
    is distinct from (old.id, old.booking_id, old.amount_minor, old.fee_minor, old.currency, old.idempotency_key) then
    raise exception 'Immutable payment snapshot' using errcode = '22023';
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger payments_guard before insert or update on public.payments for each row execute function private.guard_payment_snapshot();

create function private.guard_refund_total() returns trigger
language plpgsql security definer set search_path = '' as $$
declare payment public.payments; reserved numeric;
begin
  select * into payment from public.payments where id = new.payment_id for update;
  if tg_op = 'UPDATE' then
    if (new.id, new.payment_id, new.amount_minor, new.idempotency_key, new.requested_by)
      is distinct from (old.id, old.payment_id, old.amount_minor, old.idempotency_key, old.requested_by) then
      raise exception 'Immutable refund request' using errcode = '22023';
    end if;
    if new.state <> old.state and not (
      (old.state = 'requested' and new.state in ('pending', 'succeeded', 'failed')) or
      (old.state = 'pending' and new.state in ('succeeded', 'failed'))) then
      raise exception 'Invalid refund transition' using errcode = '22023';
    end if;
  end if;
  if new.state in ('requested', 'pending', 'succeeded') then
    if payment.state not in ('paid', 'partially_refunded', 'refunded') then
      raise exception 'Payment not captured' using errcode = '22023';
    end if;
    select coalesce(sum(amount_minor), 0) into reserved from public.refunds
    where payment_id = new.payment_id and id <> new.id and state in ('requested', 'pending', 'succeeded');
    if reserved + new.amount_minor > payment.amount_minor then
      raise exception 'Refund exceeds captured amount' using errcode = '22023';
    end if;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger refunds_guard before insert or update on public.refunds for each row execute function private.guard_refund_total();

alter table public.bookings enable row level security;
alter table public.booking_private_details enable row level security;
alter table public.booking_events enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.refunds enable row level security;
alter table public.payout_refs enable row level security;
revoke all on public.bookings, public.booking_private_details, public.booking_events, public.payments,
public.payment_events, public.refunds, public.payout_refs from public, anon, authenticated;
grant select on public.bookings, public.booking_private_details, public.booking_events to authenticated;
grant select(id, booking_id, amount_minor, fee_minor, currency, state, paid_at, refunded_at, created_at, updated_at)
on public.payments to authenticated;
grant select(id, payment_id, amount_minor, state, reason, created_at, updated_at) on public.refunds to authenticated;
create policy bookings_read on public.bookings for select to authenticated using (private.booking_participant(id));
create policy booking_details_read on public.booking_private_details for select to authenticated using (private.booking_participant(booking_id));
create policy booking_events_read on public.booking_events for select to authenticated using (private.booking_participant(booking_id));
create policy payments_read on public.payments for select to authenticated using (private.booking_participant(booking_id));
create policy refunds_read on public.refunds for select to authenticated using (private.payment_participant(payment_id));
create policy payment_events_server_only on public.payment_events for all to authenticated using (false) with check (false);
create policy payouts_server_only on public.payout_refs for all to authenticated using (false) with check (false);

revoke all on function public.create_booking(uuid, uuid, timestamptz, timestamptz, text, text), public.cancel_booking(uuid, text)
from public, anon, authenticated;
grant execute on function public.create_booking(uuid, uuid, timestamptz, timestamptz, text, text), public.cancel_booking(uuid, text) to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.tutor_is_public(uuid) to anon, authenticated;
grant execute on function private.valid_timezone(text), private.active_actor(), private.has_role(text), private.owns_tutor(uuid),
private.booking_participant(uuid), private.payment_participant(uuid) to authenticated;

commit;
