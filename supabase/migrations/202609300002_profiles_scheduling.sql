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
