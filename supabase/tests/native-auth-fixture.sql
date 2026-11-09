-- Local PostgreSQL compatibility fixture, NOT an implementation of Supabase Auth.
-- Only the managed columns/functions consumed by application SQL are represented.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key, email text, email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'
);
create table auth.sessions (
  id uuid primary key, user_id uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz,
  not_after timestamptz
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select auth.jwt()->>'role'
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
