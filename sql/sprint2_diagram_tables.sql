-- Simplified Sprint 2 schema for the report's Schema Visualizer figure.
-- Ten tables from Section 6.0 with their essential columns only. The full schema,
-- with every constraint and support table, is in supabase/migrations/ and sql/sprint2_tables.sql.
-- Uses its own schema so it never touches the application's public tables.

begin;

drop schema if exists diagram cascade;
create schema diagram;

create table diagram.profiles (
  id uuid primary key references auth.users(id),
  display_name text not null,
  timezone text not null default 'UTC',
  adult_attested boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table diagram.user_roles (
  user_id uuid not null references diagram.profiles(id),
  role text not null check (role in ('student', 'tutor', 'administrator')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table diagram.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references diagram.profiles(id),
  action text not null,
  reason text,
  created_at timestamptz not null default now()
);

create table diagram.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

create table diagram.tutor_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references diagram.profiles(id),
  headline text not null,
  bio text not null,
  hourly_rate_minor int not null check (hourly_rate_minor > 0),
  publication_state text not null default 'draft',
  created_at timestamptz not null default now()
);

create table diagram.tutor_subjects (
  tutor_id uuid not null references diagram.tutor_profiles(id),
  subject_id uuid not null references diagram.subjects(id),
  primary key (tutor_id, subject_id)
);

create table diagram.availability_rules (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references diagram.tutor_profiles(id),
  weekday int not null check (weekday between 0 and 6),
  local_start time not null,
  local_end time not null,
  active boolean not null default true
);

create table diagram.bookings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references diagram.profiles(id),
  tutor_id uuid not null references diagram.tutor_profiles(id),
  subject_id uuid not null references diagram.subjects(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price_minor int not null,
  status text not null default 'payment_pending',
  created_at timestamptz not null default now()
);

create table diagram.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references diagram.bookings(id),
  amount_minor int not null,
  state text not null default 'pending',
  paid_at timestamptz
);

create table diagram.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references diagram.payments(id),
  requested_by uuid references diagram.profiles(id),
  amount_minor int not null,
  state text not null default 'requested',
  created_at timestamptz not null default now()
);

commit;
