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
