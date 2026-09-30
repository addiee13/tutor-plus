begin;

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists btree_gist with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
set local search_path = public, extensions, pg_catalog;

create function private.valid_timezone(value text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = value);
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  bio text check (length(bio) <= 4000),
  avatar_path text check (length(avatar_path) <= 500),
  timezone text not null default 'UTC' check (private.valid_timezone(timezone)),
  city text check (length(city) <= 100),
  region text check (length(region) <= 100),
  postal_code text check (length(postal_code) <= 20),
  country_code char(2) check (country_code ~ '^[A-Z]{2}$'),
  learning_preferences jsonb not null default '{}' check (
    jsonb_typeof(learning_preferences) = 'object' and octet_length(learning_preferences::text) <= 4096),
  adult_attested boolean not null default false,
  adult_attested_at timestamptz,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (adult_attested = (adult_attested_at is not null))
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('student', 'tutor', 'administrator')),
  granted_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
create index user_roles_grantor_idx on public.user_roles(granted_by);
create index user_roles_role_idx on public.user_roles(role, user_id);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  reason text not null,
  safe_metadata jsonb not null default '{}' check (jsonb_typeof(safe_metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index audit_logs_actor_time_idx on public.audit_logs(actor_id, created_at desc);
create index audit_logs_entity_time_idx on public.audit_logs(entity_type, entity_id, created_at desc);

create function public.current_session_started_at() returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  session_text text := auth.jwt() ->> 'session_id';
  started_at timestamptz;
begin
  if session_text is null or session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  select sessions.created_at into started_at from auth.sessions as sessions
  where sessions.id = session_text::uuid and sessions.user_id = auth.uid()
    and sessions.created_at <= statement_timestamp()
    and sessions.created_at > statement_timestamp() - interval '24 hours'
    and (sessions.not_after is null or sessions.not_after > statement_timestamp());
  return started_at;
end;
$$;

create function private.active_actor() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_session_started_at() is not null and exists (
    select 1 from public.profiles as profiles join auth.users as users on users.id = profiles.id
    where profiles.id = auth.uid() and profiles.status = 'active' and profiles.adult_attested
      and users.email_confirmed_at is not null
  );
$$;

create function private.has_role(requested_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.active_actor() and exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = requested_role
  );
$$;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger profiles_touch before update on public.profiles
for each row execute function private.touch_updated_at();

create function private.provision_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  initial_role text := coalesce(new.raw_user_meta_data ->> 'initial_role', new.raw_user_meta_data ->> 'role', 'student');
  attested boolean := coalesce(new.raw_user_meta_data -> 'adult_attested' = 'true'::jsonb, false);
  display_text text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', 'New member'));
  timezone_text text := coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC');
begin
  if initial_role not in ('student', 'tutor') then
    raise exception 'Invalid initial capability' using errcode = '22023';
  end if;
  if not private.valid_timezone(timezone_text) then
    raise exception 'Invalid timezone' using errcode = '22023';
  end if;
  insert into public.profiles(id, display_name, timezone, adult_attested, adult_attested_at)
  values (new.id, display_text, timezone_text, attested, case when attested then statement_timestamp() end);
  insert into public.user_roles(user_id, role) values (new.id, initial_role);
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, reason, safe_metadata)
  values (new.id, 'account.provisioned', 'profiles', new.id, 'Managed Auth signup', jsonb_build_object('initial_role', initial_role));
  return new;
end;
$$;
create trigger tutorplus_auth_signup after insert on auth.users
for each row execute function private.provision_profile();

create function private.assert_administrator() returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  perform pg_catalog.pg_advisory_xact_lock(93126001);
  perform 1 from public.profiles where id = actor for update;
  if not private.has_role('administrator') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return actor;
end;
$$;

create function public.grant_user_role(target uuid, requested_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.assert_administrator();
begin
  if requested_role not in ('student', 'tutor', 'administrator') or requested_role is null then
    raise exception 'Invalid capability' using errcode = '22023';
  end if;
  perform 1 from public.profiles where id = target and status = 'active' and adult_attested for update;
  if not found then raise exception 'Ineligible target' using errcode = '22023'; end if;
  insert into public.user_roles(user_id, role, granted_by) values (target, requested_role, actor)
  on conflict (user_id, role) do nothing;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, reason, safe_metadata)
  values (actor, 'role.granted', 'profiles', target, 'Administrator capability grant', jsonb_build_object('role', requested_role));
end;
$$;

create function public.revoke_user_role(target uuid, requested_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.assert_administrator();
begin
  if requested_role not in ('student', 'tutor', 'administrator') or requested_role is null then
    raise exception 'Invalid capability' using errcode = '22023';
  end if;
  if target = actor and requested_role = 'administrator' then
    raise exception 'Cannot revoke own administrator capability' using errcode = '22023';
  end if;
  perform 1 from public.profiles where id = target for update;
  delete from public.user_roles where user_id = target and role = requested_role;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, reason, safe_metadata)
  values (actor, 'role.revoked', 'profiles', target, 'Administrator capability revocation', jsonb_build_object('role', requested_role));
end;
$$;

create function public.set_user_status(target uuid, requested_status text, reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.assert_administrator();
begin
  if requested_status is null or requested_status not in ('active', 'inactive')
    or reason is null or length(btrim(reason)) not between 1 and 500 or target = actor then
    raise exception 'Invalid status change' using errcode = '22023';
  end if;
  update public.profiles set status = requested_status where id = target;
  if not found then raise exception 'Unknown target' using errcode = '22023'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, reason, safe_metadata)
  values (actor, 'account.status_changed', 'profiles', target, reason, jsonb_build_object('status', requested_status));
end;
$$;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_logs enable row level security;
revoke all on public.profiles, public.user_roles, public.audit_logs from public, anon, authenticated;
grant select on public.profiles, public.user_roles, public.audit_logs to authenticated;
grant update(display_name, bio, avatar_path, timezone, city, region, postal_code, country_code, learning_preferences)
on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
using (private.active_actor() and id = auth.uid());
create policy profiles_edit on public.profiles for update to authenticated
using (private.active_actor() and id = auth.uid()) with check (private.active_actor() and id = auth.uid());
create policy roles_read on public.user_roles for select to authenticated
using (private.active_actor() and (user_id = auth.uid() or private.has_role('administrator')));
create policy audit_read on public.audit_logs for select to authenticated
using (private.has_role('administrator'));

revoke all on function public.current_session_started_at(), public.grant_user_role(uuid, text),
public.revoke_user_role(uuid, text), public.set_user_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.current_session_started_at(), public.grant_user_role(uuid, text),
public.revoke_user_role(uuid, text), public.set_user_status(uuid, text, text) to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.valid_timezone(text), private.active_actor(), private.has_role(text) to authenticated;

commit;

begin;
set local search_path = public, extensions, pg_catalog;

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.subjects(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id <> id)
);
create index subjects_parent_idx on public.subjects(parent_id);
create index subjects_catalog_idx on public.subjects(active, sort_order, name);

create table public.tutor_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete restrict,
  public_display_name text not null check (length(btrim(public_display_name)) between 1 and 100),
  public_avatar_url text check (length(public_avatar_url) <= 500 and public_avatar_url ~ '^https://'),
  headline text not null check (length(btrim(headline)) between 1 and 200),
  bio text not null check (length(btrim(bio)) between 1 and 4000),
  credentials_text text check (length(credentials_text) <= 2000),
  experience_years smallint not null default 0 check (experience_years between 0 and 80),
  hourly_rate_minor bigint not null check (hourly_rate_minor between 1 and 100000000),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  supports_virtual boolean not null default true,
  supports_in_person boolean not null default false,
  service_area_label text check (length(service_area_label) <= 200),
  approximate_location extensions.geography(Point,4326),
  service_radius_km numeric(6,2) check (service_radius_km > 0 and service_radius_km <= 1000),
  publication_state text not null default 'draft' check (publication_state in ('draft', 'review_ready', 'published', 'paused')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (supports_virtual or supports_in_person),
  check (not supports_in_person or publication_state <> 'published'
    or (approximate_location is not null and service_radius_km is not null and service_area_label is not null))
);
create index tutor_profiles_geo_idx on public.tutor_profiles using gist(approximate_location);
create index tutor_profiles_publication_idx on public.tutor_profiles(publication_state);

create table public.tutor_subjects (
  tutor_id uuid not null references public.tutor_profiles(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  expertise text check (length(expertise) <= 1000),
  rate_override_minor bigint check (rate_override_minor between 1 and 100000000),
  created_at timestamptz not null default now(),
  primary key (tutor_id, subject_id)
);
create index tutor_subjects_subject_idx on public.tutor_subjects(subject_id, tutor_id);

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles(id) on delete restrict,
  weekday smallint not null check (weekday between 0 and 6),
  local_start time not null,
  local_end time not null,
  timezone text not null check (private.valid_timezone(timezone)),
  valid_from date not null,
  valid_until date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (local_start < local_end),
  check (isfinite(valid_from) and (valid_until is null or (isfinite(valid_until) and valid_until >= valid_from))),
  exclude using gist (tutor_id with =, weekday with =, timezone with =,
    daterange(valid_from, valid_until, '[]') with &&,
    int8range(extract(epoch from local_start)::bigint, extract(epoch from local_end)::bigint, '[)') with &&)
    where (active)
);
create index availability_rules_tutor_idx on public.availability_rules(tutor_id, weekday, active);

create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles(id) on delete restrict,
  local_date date not null check (isfinite(local_date)),
  local_start time,
  local_end time,
  timezone text not null check (private.valid_timezone(timezone)),
  exception_type text not null check (exception_type in ('unavailable', 'additional')),
  reason text check (length(reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((local_start is null and local_end is null and exception_type = 'unavailable')
    or (local_start is not null and local_end is not null and local_start < local_end))
);
create index availability_exceptions_tutor_date_idx on public.availability_exceptions(tutor_id, local_date);

create table public.public_tutor_snapshots (
  id uuid primary key references public.tutor_profiles(id) on delete restrict,
  public_display_name text not null,
  public_avatar_url text,
  headline text not null,
  bio text not null,
  credentials_text text,
  experience_years smallint not null,
  hourly_rate_minor bigint not null,
  currency char(3) not null,
  supports_virtual boolean not null,
  supports_in_person boolean not null,
  service_area_label text,
  approximate_location extensions.geography(Point,4326),
  service_radius_km numeric(6,2),
  updated_at timestamptz not null
);
create index public_tutor_snapshots_geo_idx on public.public_tutor_snapshots using gist(approximate_location);

create function private.owns_tutor(tutor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('tutor') and exists (
    select 1 from public.tutor_profiles where id = tutor and user_id = auth.uid()
  );
$$;

create function private.tutor_is_ready(tutor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tutor_profiles as tutors
    join public.profiles as profiles on profiles.id = tutors.user_id
    join auth.users as users on users.id = profiles.id
    where tutors.id = tutor and profiles.status = 'active' and profiles.adult_attested
      and users.email_confirmed_at is not null
      and exists (select 1 from public.user_roles where user_id = profiles.id and role = 'tutor')
      and exists (select 1 from public.tutor_subjects as links join public.subjects as subjects
        on subjects.id = links.subject_id where links.tutor_id = tutor and subjects.active)
      and exists (select 1 from public.availability_rules where tutor_id = tutor and active
        and (valid_until is null or valid_until >= current_date))
  );
$$;

create function private.tutor_is_public(tutor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.tutor_is_ready(tutor) and exists (
    select 1 from public.tutor_profiles where id = tutor and publication_state = 'published'
  );
$$;

create function private.guard_tutor_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.user_id <> old.user_id or new.created_at <> old.created_at then
      raise exception 'Immutable tutor identity' using errcode = '22023';
    end if;
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  if new.publication_state = 'published' and not private.tutor_is_ready(new.id) then
    raise exception 'Tutor not ready for publication' using errcode = '22023';
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger tutor_profiles_guard before insert or update on public.tutor_profiles
for each row execute function private.guard_tutor_profile();

create function private.sync_tutor_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.public_tutor_snapshots values (
    new.id, new.public_display_name, new.public_avatar_url, new.headline, new.bio, new.credentials_text,
    new.experience_years, new.hourly_rate_minor, new.currency, new.supports_virtual, new.supports_in_person,
    new.service_area_label, new.approximate_location, new.service_radius_km, new.updated_at
  ) on conflict (id) do update set
    public_display_name = excluded.public_display_name, public_avatar_url = excluded.public_avatar_url,
    headline = excluded.headline, bio = excluded.bio, credentials_text = excluded.credentials_text,
    experience_years = excluded.experience_years, hourly_rate_minor = excluded.hourly_rate_minor,
    currency = excluded.currency, supports_virtual = excluded.supports_virtual,
    supports_in_person = excluded.supports_in_person, service_area_label = excluded.service_area_label,
    approximate_location = excluded.approximate_location, service_radius_km = excluded.service_radius_km,
    updated_at = excluded.updated_at;
  return new;
end;
$$;
create trigger tutor_snapshot_sync after insert or update on public.tutor_profiles
for each row execute function private.sync_tutor_snapshot();

create function private.lock_tutor_schedule() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tutor uuid;
begin
  tutor := case when tg_op = 'DELETE' then old.tutor_id else new.tutor_id end;
  if tg_op = 'UPDATE' and new.tutor_id <> old.tutor_id then
    raise exception 'Immutable schedule owner' using errcode = '22023';
  end if;
  perform 1 from public.tutor_profiles where id = tutor for update;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger availability_rules_lock before insert or update or delete on public.availability_rules
for each row execute function private.lock_tutor_schedule();
create trigger availability_exceptions_lock before insert or update or delete on public.availability_exceptions
for each row execute function private.lock_tutor_schedule();
create trigger tutor_subjects_lock before insert or update or delete on public.tutor_subjects
for each row execute function private.lock_tutor_schedule();
create trigger subjects_touch before update on public.subjects for each row execute function private.touch_updated_at();
create trigger availability_rules_touch before update on public.availability_rules for each row execute function private.touch_updated_at();
create trigger availability_exceptions_touch before update on public.availability_exceptions for each row execute function private.touch_updated_at();

alter table public.subjects enable row level security;
alter table public.tutor_profiles enable row level security;
alter table public.tutor_subjects enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.public_tutor_snapshots enable row level security;
revoke all on public.subjects, public.tutor_profiles, public.tutor_subjects, public.availability_rules,
public.availability_exceptions, public.public_tutor_snapshots from public, anon, authenticated;
grant select on public.subjects, public.public_tutor_snapshots to anon, authenticated;
grant select, insert, delete on public.tutor_profiles, public.tutor_subjects,
public.availability_rules, public.availability_exceptions to authenticated;
grant update(public_display_name, public_avatar_url, headline, bio, credentials_text, experience_years,
hourly_rate_minor, currency, supports_virtual, supports_in_person, service_area_label, approximate_location,
service_radius_km, publication_state) on public.tutor_profiles to authenticated;
grant update(expertise, rate_override_minor) on public.tutor_subjects to authenticated;
grant update(weekday, local_start, local_end, timezone, valid_from, valid_until, active) on public.availability_rules to authenticated;
grant update(local_date, local_start, local_end, timezone, exception_type, reason) on public.availability_exceptions to authenticated;
create policy subjects_public on public.subjects for select to anon, authenticated using (active);
create policy snapshots_public on public.public_tutor_snapshots for select to anon, authenticated
using (private.tutor_is_public(id));
create policy tutor_owner_read on public.tutor_profiles for select to authenticated using (private.owns_tutor(id));
create policy tutor_owner_insert on public.tutor_profiles for insert to authenticated
with check (private.has_role('tutor') and user_id = auth.uid() and publication_state = 'draft');
create policy tutor_owner_update on public.tutor_profiles for update to authenticated
using (private.owns_tutor(id)) with check (private.owns_tutor(id));
create policy tutor_subjects_owner on public.tutor_subjects for all to authenticated
using (private.owns_tutor(tutor_id)) with check (private.owns_tutor(tutor_id));
create policy availability_rules_owner on public.availability_rules for all to authenticated
using (private.owns_tutor(tutor_id)) with check (private.owns_tutor(tutor_id));
create policy availability_exceptions_owner on public.availability_exceptions for all to authenticated
using (private.owns_tutor(tutor_id)) with check (private.owns_tutor(tutor_id));

grant usage on schema private to anon;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.tutor_is_public(uuid) to anon, authenticated;
grant execute on function private.valid_timezone(text), private.active_actor(), private.has_role(text), private.owns_tutor(uuid) to authenticated;

commit;

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

begin;

create function private.revalidate_schedule() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tutor uuid := case when tg_op = 'DELETE' then old.tutor_id else new.tutor_id end;
begin
  if exists (select 1 from public.bookings where tutor_id = tutor
    and status in ('payment_pending', 'confirmed', 'in_progress') and ends_at > statement_timestamp()
    and not private.slot_is_available(tutor, blocking_starts_at, blocking_ends_at)) then
    raise exception 'Schedule change invalidates an active reservation' using errcode = '22023';
  end if;
  return null;
end;
$$;
create trigger availability_rules_revalidate after insert or update or delete on public.availability_rules
for each row execute function private.revalidate_schedule();
create trigger availability_exceptions_revalidate after insert or update or delete on public.availability_exceptions
for each row execute function private.revalidate_schedule();

create function public.prepare_booking_payment(booking uuid, request_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected_booking public.bookings; existing public.payments; payment uuid;
begin
  select * into selected_booking from public.bookings where id = booking for update;
  if not found or selected_booking.status <> 'payment_pending' or selected_booking.hold_expires_at <= statement_timestamp() then
    raise exception 'Booking not payable' using errcode = '22023';
  end if;
  select * into existing from public.payments where booking_id = booking;
  if found then
    if existing.idempotency_key <> request_key then
      raise exception 'Payment key mismatch' using errcode = '22023';
    end if;
    return existing.id;
  end if;
  insert into public.payments(booking_id, idempotency_key, amount_minor, fee_minor, currency)
  values (booking, request_key, selected_booking.price_minor, selected_booking.platform_fee_minor, selected_booking.currency)
  returning id into payment;
  return payment;
end;
$$;

create function public.apply_verified_payment_event(payment uuid, event_id text, requested_state text,
  occurred_at timestamptz, provider_payment_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare selected_payment public.payments; selected_booking public.bookings; prior public.payment_events; tutor uuid;
begin
  if requested_state is null or requested_state not in ('requires_action', 'processing', 'paid', 'failed')
    or occurred_at is null or not isfinite(occurred_at) or occurred_at > statement_timestamp() + interval '5 minutes'
    or event_id is null or length(event_id) not between 1 and 200
    or provider_payment_id is null or length(provider_payment_id) not between 1 and 200 then
    raise exception 'Invalid verified event' using errcode = '22023';
  end if;
  select bookings.tutor_id into tutor from public.bookings as bookings join public.payments as payments
    on payments.booking_id = bookings.id where payments.id = payment;
  perform 1 from public.tutor_profiles where id = tutor for update;
  select bookings.* into selected_booking from public.bookings as bookings join public.payments as payments
    on payments.booking_id = bookings.id where payments.id = payment for update of bookings;
  select * into selected_payment from public.payments where id = payment for update;
  if not found then raise exception 'Unknown payment' using errcode = '22023'; end if;
  insert into public.payment_events(payment_id, provider_event_id, event_type, safe_state_snapshot, provider_occurred_at)
  values (payment, event_id, requested_state, jsonb_build_object('state', requested_state), occurred_at)
  on conflict (provider_event_id) do nothing;
  if not found then
    select * into prior from public.payment_events where provider_event_id = event_id;
    if (prior.payment_id, prior.event_type, prior.provider_occurred_at) is distinct from (payment, requested_state, occurred_at) then
      raise exception 'Provider event identity mismatch' using errcode = '22023';
    end if;
    return false;
  end if;
  if selected_payment.provider_payment_id is not null and selected_payment.provider_payment_id <> apply_verified_payment_event.provider_payment_id then
    raise exception 'Provider payment identity mismatch' using errcode = '22023';
  end if;
  if (selected_payment.last_provider_event_at is not null and occurred_at < selected_payment.last_provider_event_at)
    or selected_payment.state in ('paid', 'partially_refunded', 'refunded')
    or (selected_payment.state = 'processing' and requested_state = 'requires_action')
    or (selected_payment.state = 'failed' and requested_state in ('requires_action', 'processing')) then
    update public.payment_events set processed_at = statement_timestamp(),
      safe_state_snapshot = jsonb_build_object('state', requested_state, 'ignored', true) where provider_event_id = event_id;
    return false;
  end if;
  update public.payments set state = requested_state, last_provider_event_at = occurred_at,
    provider_payment_id = apply_verified_payment_event.provider_payment_id,
    paid_at = case when requested_state = 'paid' then occurred_at else paid_at end where id = payment;
  if requested_state = 'paid' and selected_booking.status = 'payment_pending' then
    if selected_booking.hold_expires_at > statement_timestamp() then
      update public.bookings set status = 'confirmed' where id = selected_booking.id;
    else
      update public.bookings set status = 'cancelled', cancellation_reason = 'Payment arrived after hold expired; refund review required'
      where id = selected_booking.id;
    end if;
  end if;
  update public.payment_events set processed_at = statement_timestamp() where provider_event_id = event_id;
  return true;
end;
$$;

create function public.reserve_refund(payment uuid, request_key text, amount_minor bigint, reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare existing public.refunds; refund uuid;
begin
  perform 1 from public.payments where id = payment for update;
  if not found then raise exception 'Unknown payment' using errcode = '22023'; end if;
  select * into existing from public.refunds where idempotency_key = request_key;
  if found then
    if (existing.payment_id, existing.amount_minor, existing.reason) is distinct from (payment, reserve_refund.amount_minor, reserve_refund.reason) then
      raise exception 'Refund key reused' using errcode = '22023';
    end if;
    return existing.id;
  end if;
  insert into public.refunds(payment_id, idempotency_key, amount_minor, reason)
  values (payment, request_key, amount_minor, reason) returning id into refund;
  return refund;
end;
$$;

create function public.apply_verified_refund_event(refund uuid, event_id text, requested_state text,
  occurred_at timestamptz, provider_refund_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare selected_refund public.refunds; selected_payment public.payments; prior public.payment_events; total numeric;
begin
  if requested_state is null or requested_state not in ('pending', 'succeeded', 'failed')
    or occurred_at is null or not isfinite(occurred_at) or occurred_at > statement_timestamp() + interval '5 minutes'
    or event_id is null or length(event_id) not between 1 and 200
    or provider_refund_id is null or length(provider_refund_id) not between 1 and 200 then
    raise exception 'Invalid verified refund event' using errcode = '22023';
  end if;
  select * into selected_refund from public.refunds where id = refund;
  if not found then raise exception 'Unknown refund' using errcode = '22023'; end if;
  select * into selected_payment from public.payments where id = selected_refund.payment_id for update;
  select * into selected_refund from public.refunds where id = refund for update;
  insert into public.payment_events(payment_id, provider_event_id, event_type, safe_state_snapshot, provider_occurred_at)
  values (selected_payment.id, event_id, 'refund.' || requested_state,
    jsonb_build_object('refund_id', refund, 'state', requested_state), occurred_at) on conflict (provider_event_id) do nothing;
  if not found then
    select * into prior from public.payment_events where provider_event_id = event_id;
    if (prior.payment_id, prior.event_type, prior.provider_occurred_at, prior.safe_state_snapshot ->> 'refund_id')
      is distinct from (selected_payment.id, 'refund.' || requested_state, occurred_at, refund::text) then
      raise exception 'Provider event identity mismatch' using errcode = '22023';
    end if;
    return false;
  end if;
  if selected_refund.provider_refund_id is not null and selected_refund.provider_refund_id <> apply_verified_refund_event.provider_refund_id then
    raise exception 'Provider refund identity mismatch' using errcode = '22023';
  end if;
  if selected_refund.state in ('succeeded', 'failed') then
    update public.payment_events set processed_at = statement_timestamp(),
      safe_state_snapshot = safe_state_snapshot || '{"ignored":true}'::jsonb where provider_event_id = event_id;
    return false;
  end if;
  update public.refunds set state = requested_state, provider_refund_id = apply_verified_refund_event.provider_refund_id where id = refund;
  if requested_state = 'succeeded' then
    select coalesce(sum(amount_minor), 0) into total from public.refunds where payment_id = selected_payment.id and state = 'succeeded';
    update public.payments set state = case when total = amount_minor then 'refunded' else 'partially_refunded' end,
      refunded_at = case when total = amount_minor then occurred_at else null end where id = selected_payment.id;
  end if;
  update public.payment_events set processed_at = statement_timestamp() where provider_event_id = event_id;
  return true;
end;
$$;

revoke all on function public.prepare_booking_payment(uuid, text),
public.apply_verified_payment_event(uuid, text, text, timestamptz, text), public.reserve_refund(uuid, text, bigint, text),
public.apply_verified_refund_event(uuid, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.prepare_booking_payment(uuid, text),
public.apply_verified_payment_event(uuid, text, text, timestamptz, text), public.reserve_refund(uuid, text, bigint, text),
public.apply_verified_refund_event(uuid, text, text, timestamptz, text) to service_role;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.tutor_is_public(uuid) to anon, authenticated;
grant execute on function private.valid_timezone(text), private.active_actor(), private.has_role(text), private.owns_tutor(uuid),
private.booking_participant(uuid), private.payment_participant(uuid) to authenticated;

commit;

begin;

create table private.admin_bootstrap_guard (
  singleton boolean primary key default true check (singleton),
  target uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
revoke all on private.admin_bootstrap_guard from public, anon, authenticated, service_role;

create function public.bootstrap_initial_admin(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(93126001);
  if exists (select 1 from private.admin_bootstrap_guard) or exists (
    select 1 from public.user_roles where role = 'administrator') then
    raise exception 'Initial administrator already established' using errcode = '22023';
  end if;
  perform 1 from public.profiles as profiles join auth.users as users on users.id = profiles.id
  where profiles.id = target and profiles.status = 'active' and profiles.adult_attested
    and users.email_confirmed_at is not null for update of profiles;
  if not found then raise exception 'Ineligible bootstrap target' using errcode = '22023'; end if;
  insert into private.admin_bootstrap_guard(singleton, target) values (true, target);
  insert into public.user_roles(user_id, role, granted_by) values (target, 'administrator', null);
  insert into public.audit_logs(action, entity_type, entity_id, reason)
  values ('admin.bootstrap', 'profiles', target, 'One-time privileged administrator bootstrap');
end;
$$;
revoke all on function public.bootstrap_initial_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_initial_admin(uuid) to service_role;

commit;

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

begin;

create function public.list_public_tutor_subjects(tutor uuid)
returns table(subject_id uuid, name text, slug text, hourly_rate_minor bigint, currency char(3))
language sql stable security definer set search_path = '' as $$
  select subjects.id, subjects.name, subjects.slug,
    coalesce(links.rate_override_minor, tutors.hourly_rate_minor), tutors.currency
  from public.tutor_subjects as links join public.subjects as subjects on subjects.id = links.subject_id
  join public.tutor_profiles as tutors on tutors.id = links.tutor_id
  where links.tutor_id = tutor and subjects.active and private.tutor_is_public(tutor)
  order by subjects.sort_order, subjects.name;
$$;
revoke all on function public.list_public_tutor_subjects(uuid) from public, anon, authenticated;
grant execute on function public.list_public_tutor_subjects(uuid) to anon, authenticated;

commit;

begin;

alter policy tutor_owner_read on public.tutor_profiles
using (user_id = auth.uid() and private.has_role('tutor'));
alter policy tutor_owner_update on public.tutor_profiles
using (user_id = auth.uid() and private.has_role('tutor'))
with check (user_id = auth.uid() and private.has_role('tutor'));

commit;
