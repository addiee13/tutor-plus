begin;
set local search_path = public, extensions, pg_catalog;

-- Drafts may be incomplete and are not public. Publication remains database-gated on positive rate, active subject,
-- future availability, and complete in-person coverage when that mode is selected.
alter table public.tutor_profiles alter column hourly_rate_minor drop not null;

create or replace function private.tutor_is_ready(tutor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tutor_profiles as tutors
    join public.profiles as profiles on profiles.id = tutors.user_id
    join auth.users as users on users.id = profiles.id
    where tutors.id = tutor and profiles.status = 'active' and profiles.adult_attested
      and users.email_confirmed_at is not null and tutors.hourly_rate_minor between 1 and 100000000
      and exists (select 1 from public.user_roles where user_id = profiles.id and role = 'tutor')
      and exists (select 1 from public.tutor_subjects as links join public.subjects as subjects
        on subjects.id = links.subject_id where links.tutor_id = tutor and subjects.active)
      and exists (select 1 from public.availability_rules where tutor_id = tutor and active
        and (valid_until is null or valid_until >= current_date))
      and (not tutors.supports_in_person or (tutors.service_area_label is not null
        and tutors.approximate_location is not null and tutors.service_radius_km is not null))
  );
$$;

create or replace function private.sync_tutor_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Public snapshot columns require a price. Incomplete private drafts remain in tutor_profiles only.
  if new.hourly_rate_minor is null then return new; end if;
  insert into public.public_tutor_snapshots values (
    new.id,new.public_display_name,new.public_avatar_url,new.headline,new.bio,new.credentials_text,
    new.experience_years,new.hourly_rate_minor,new.currency,new.supports_virtual,new.supports_in_person,
    new.service_area_label,new.approximate_location,new.service_radius_km,new.updated_at
  ) on conflict (id) do update set
    public_display_name = excluded.public_display_name,public_avatar_url = excluded.public_avatar_url,
    headline = excluded.headline,bio = excluded.bio,credentials_text = excluded.credentials_text,
    experience_years = excluded.experience_years,hourly_rate_minor = excluded.hourly_rate_minor,
    currency = excluded.currency,supports_virtual = excluded.supports_virtual,
    supports_in_person = excluded.supports_in_person,service_area_label = excluded.service_area_label,
    approximate_location = excluded.approximate_location,service_radius_km = excluded.service_radius_km,
    updated_at = excluded.updated_at;
  return new;
end;
$$;

create function private.save_tutor_listing_impl(
  listing uuid, expected_version integer, public_display_name text, public_avatar_url text,
  headline text, bio text, credentials_text text, experience_years integer, hourly_rate_minor bigint,
  currency text, supports_virtual boolean, supports_in_person boolean, service_area_label text,
  latitude double precision, longitude double precision, service_radius_km numeric, offerings jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); selected_listing uuid; current_version integer; entry jsonb;
begin
  if actor is null or not private.active_actor() or not private.has_role('tutor') then
    raise exception 'Not authorized' using errcode = '42501'; end if;
  if public_display_name is null or length(btrim(public_display_name)) not between 1 and 100
    or headline is null or length(btrim(headline)) not between 1 and 200
    or bio is null or length(btrim(bio)) not between 1 and 4000
    or (public_avatar_url is not null and (length(public_avatar_url) > 500 or public_avatar_url !~ '^https://'))
    or (credentials_text is not null and length(credentials_text) > 2000)
    or experience_years is null or experience_years not between 0 and 80
    or (hourly_rate_minor is not null and hourly_rate_minor not between 1 and 100000000)
    or currency is null or currency !~ '^[A-Z]{3}$'
    or supports_virtual is null or supports_in_person is null or not (supports_virtual or supports_in_person)
    or (service_area_label is not null and length(service_area_label) > 200)
    or (service_radius_km is not null and (service_radius_km <= 0 or service_radius_km > 1000))
    or ((latitude is null) <> (longitude is null))
    or (latitude is not null and not (latitude between -90 and 90))
    or (longitude is not null and not (longitude between -180 and 180)) then
    raise exception 'Invalid tutor listing' using errcode = '22023'; end if;
  if jsonb_typeof(offerings) is distinct from 'array' or jsonb_array_length(offerings) > 100 then
    raise exception 'Invalid tutor subjects' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(offerings) as rows(value)
    where jsonb_typeof(rows.value) <> 'object'
      or coalesce(rows.value ->> 'subject_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (rows.value ? 'expertise' and rows.value -> 'expertise' <> 'null'::jsonb
        and (jsonb_typeof(rows.value -> 'expertise') <> 'string' or length(rows.value ->> 'expertise') > 1000))
      or (rows.value ? 'rate_override_minor' and rows.value -> 'rate_override_minor' <> 'null'::jsonb
        and (jsonb_typeof(rows.value -> 'rate_override_minor') <> 'number'
          or (rows.value ->> 'rate_override_minor') !~ '^[0-9]+$'
          or (rows.value ->> 'rate_override_minor')::numeric not between 1 and 100000000))) then
    raise exception 'Invalid tutor subject' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(offerings) as rows(value)
    group by (rows.value ->> 'subject_id')::uuid having count(*) > 1) then
    raise exception 'Duplicate tutor subject' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(offerings) as rows(value)
    left join public.subjects as catalog on catalog.id = (rows.value ->> 'subject_id')::uuid and catalog.active
    where catalog.id is null) then raise exception 'Unknown or inactive subject' using errcode = '22023'; end if;

  if listing is null then
    if expected_version is not null then raise exception 'Unexpected listing version' using errcode = '22023'; end if;
    insert into public.tutor_profiles(user_id,public_display_name,public_avatar_url,headline,bio,credentials_text,
      experience_years,hourly_rate_minor,currency,supports_virtual,supports_in_person,service_area_label,
      approximate_location,service_radius_km,publication_state)
    values(actor,btrim(public_display_name),public_avatar_url,btrim(headline),btrim(bio),nullif(btrim(credentials_text),''),
      experience_years,hourly_rate_minor,currency,supports_virtual,supports_in_person,nullif(btrim(service_area_label),''),
      case when latitude is null then null else extensions.st_setsrid(extensions.st_makepoint(longitude,latitude),4326)::extensions.geography end,
      service_radius_km,'draft') returning id into selected_listing;
  else
    select tutors.version into current_version from public.tutor_profiles as tutors
      where tutors.id = listing and tutors.user_id = actor for update;
    if not found then raise exception 'Not authorized' using errcode = '42501'; end if;
    if expected_version is null or expected_version <> current_version then
      raise exception 'Listing changed in another editor. Refresh before saving.' using errcode = '40001'; end if;
    update public.tutor_profiles as tutors set
      public_display_name = btrim(save_tutor_listing_impl.public_display_name),public_avatar_url = save_tutor_listing_impl.public_avatar_url,
      headline = btrim(save_tutor_listing_impl.headline),bio = btrim(save_tutor_listing_impl.bio),
      credentials_text = nullif(btrim(save_tutor_listing_impl.credentials_text),''),experience_years = save_tutor_listing_impl.experience_years,
      hourly_rate_minor = save_tutor_listing_impl.hourly_rate_minor,currency = save_tutor_listing_impl.currency,
      supports_virtual = save_tutor_listing_impl.supports_virtual,supports_in_person = save_tutor_listing_impl.supports_in_person,
      service_area_label = nullif(btrim(save_tutor_listing_impl.service_area_label),''),
      approximate_location = case when save_tutor_listing_impl.latitude is null then null
        else extensions.st_setsrid(extensions.st_makepoint(save_tutor_listing_impl.longitude,save_tutor_listing_impl.latitude),4326)::extensions.geography end,
      service_radius_km = save_tutor_listing_impl.service_radius_km
    where tutors.id = listing and tutors.user_id = actor returning tutors.id into selected_listing;
    if not found then raise exception 'Not authorized' using errcode = '42501'; end if;
  end if;

  delete from public.tutor_subjects as links where links.tutor_id = selected_listing
    and not exists(select 1 from jsonb_array_elements(offerings) as rows(value)
      where (rows.value ->> 'subject_id')::uuid = links.subject_id);
  for entry in select value from jsonb_array_elements(offerings) as rows(value) loop
    insert into public.tutor_subjects(tutor_id,subject_id,expertise,rate_override_minor)
    values(selected_listing,(entry ->> 'subject_id')::uuid,nullif(btrim(entry ->> 'expertise'),''),
      case when entry -> 'rate_override_minor' is null or entry -> 'rate_override_minor' = 'null'::jsonb
        then null else (entry ->> 'rate_override_minor')::bigint end)
    on conflict(tutor_id,subject_id) do update set expertise = excluded.expertise,rate_override_minor = excluded.rate_override_minor;
  end loop;
  return selected_listing;
end;
$$;

create function public.save_tutor_listing(
  listing uuid,public_display_name text,public_avatar_url text,headline text,bio text,credentials_text text,
  experience_years integer,hourly_rate_minor bigint,currency text,supports_virtual boolean,supports_in_person boolean,
  service_area_label text,latitude double precision,longitude double precision,service_radius_km numeric,offerings jsonb,
  expected_version integer
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return private.save_tutor_listing_impl(listing,expected_version,public_display_name,public_avatar_url,headline,bio,
    credentials_text,experience_years,hourly_rate_minor,currency,supports_virtual,supports_in_person,service_area_label,
    latitude,longitude,service_radius_km,offerings);
end;
$$;

-- Preserve the original create contract for existing callers, but reject versionless edits.
create or replace function public.save_tutor_listing(
  listing uuid,public_display_name text,public_avatar_url text,headline text,bio text,credentials_text text,
  experience_years integer,hourly_rate_minor bigint,currency text,supports_virtual boolean,supports_in_person boolean,
  service_area_label text,latitude double precision,longitude double precision,service_radius_km numeric,offerings jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if listing is not null then raise exception 'Expected listing version is required for edits' using errcode = '40001'; end if;
  return private.save_tutor_listing_impl(null,null,public_display_name,public_avatar_url,headline,bio,credentials_text,
    experience_years,hourly_rate_minor,currency,supports_virtual,supports_in_person,service_area_label,
    latitude,longitude,service_radius_km,offerings);
end;
$$;
revoke all on function private.save_tutor_listing_impl(uuid,integer,text,text,text,text,text,integer,bigint,text,boolean,boolean,text,double precision,double precision,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.save_tutor_listing(uuid,text,text,text,text,text,integer,bigint,text,boolean,boolean,text,double precision,double precision,numeric,jsonb),
  public.save_tutor_listing(uuid,text,text,text,text,text,integer,bigint,text,boolean,boolean,text,double precision,double precision,numeric,jsonb,integer)
  from public,anon,authenticated;
grant execute on function public.save_tutor_listing(uuid,text,text,text,text,text,integer,bigint,text,boolean,boolean,text,double precision,double precision,numeric,jsonb),
  public.save_tutor_listing(uuid,text,text,text,text,text,integer,bigint,text,boolean,boolean,text,double precision,double precision,numeric,jsonb,integer) to authenticated;

-- Submission recommendations are explicit learner feedback; no claim of independent platform verification is implied.
alter table public.reviews add column recommended boolean not null default false;
alter table public.tutor_rating_summaries add column recommendation_count integer not null default 0
  check (recommendation_count between 0 and rating_count);

create or replace function private.guard_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected_booking public.bookings;
begin
  if tg_op = 'INSERT' then
    select * into selected_booking from public.bookings where id = new.booking_id for update;
    if not found or selected_booking.status <> 'completed' then raise exception 'Only completed sessions can be reviewed' using errcode = '22023'; end if;
    if new.student_id <> selected_booking.student_id or new.tutor_id <> selected_booking.tutor_id then
      raise exception 'Review must belong to the booked student and tutor' using errcode = '22023'; end if;
    if new.status <> 'visible' then raise exception 'New reviews start visible' using errcode = '22023'; end if;
  elsif (new.id,new.booking_id,new.student_id,new.tutor_id,new.rating,new.comment,new.recommended,new.created_at)
      is distinct from (old.id,old.booking_id,old.student_id,old.tutor_id,old.rating,old.comment,old.recommended,old.created_at) then
    raise exception 'Submitted reviews are immutable; only moderation state changes' using errcode = '22023';
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create or replace function private.refresh_tutor_rating() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tutor uuid := new.tutor_id;
begin
  perform pg_catalog.pg_advisory_xact_lock(93126003,pg_catalog.hashtext(tutor::text));
  insert into public.tutor_rating_summaries(tutor_id,rating_count,rating_sum,rating_avg,recommendation_count,updated_at)
  select tutor,count(*)::integer,coalesce(sum(rating),0)::integer,round(avg(rating),2),count(*) filter(where recommended)::integer,statement_timestamp()
    from public.reviews where tutor_id = tutor and status = 'visible'
  on conflict(tutor_id) do update set rating_count = excluded.rating_count,rating_sum = excluded.rating_sum,
    rating_avg = excluded.rating_avg,recommendation_count = excluded.recommendation_count,updated_at = excluded.updated_at;
  return null;
end;
$$;
-- Recompute the new aggregate from current visible reviews without rewriting review history.
update public.tutor_rating_summaries as summaries set recommendation_count = counts.recommended_count
from (select tutors.id as tutor_id,count(reviews.id) filter(where reviews.status='visible' and reviews.recommended)::integer as recommended_count
  from public.tutor_profiles as tutors left join public.reviews as reviews on reviews.tutor_id = tutors.id group by tutors.id) as counts
where summaries.tutor_id = counts.tutor_id;

create function public.submit_review(booking uuid,rating integer,comment text,recommended boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected_booking public.bookings; review_id uuid;
begin
  if not private.booking_student(booking) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if rating is null or rating not between 1 and 5 or recommended is null then raise exception 'Invalid review' using errcode = '22023'; end if;
  select * into selected_booking from public.bookings where id = booking;
  if selected_booking.status <> 'completed' then raise exception 'Only completed sessions can be reviewed' using errcode = '22023'; end if;
  insert into public.reviews(booking_id,student_id,tutor_id,rating,comment,recommended)
  values(booking,auth.uid(),selected_booking.tutor_id,rating,private.require_text(comment,2000,false),recommended)
  returning id into review_id;
  return review_id;
end;
$$;

drop function public.list_public_tutor_reviews(uuid);
create function public.list_public_tutor_reviews(tutor uuid)
returns table(rating smallint,comment text,recommended boolean,created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select reviews.rating,reviews.comment,reviews.recommended,reviews.created_at from public.reviews as reviews
  where reviews.tutor_id = tutor and reviews.status = 'visible' and private.tutor_is_public(tutor)
  order by reviews.created_at desc limit 50;
$$;

create function public.list_public_tutor_activity(tutors uuid[])
returns table(tutor_id uuid,completed_session_count integer,recommended_count integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if cardinality(tutors) > 50 then raise exception 'Too many tutors' using errcode = '22023'; end if;
  return query select selected.id,
    (select count(*)::integer from public.bookings as bookings where bookings.tutor_id = selected.id and bookings.status = 'completed'),
    coalesce(summaries.recommendation_count,0)
  from public.tutor_profiles as selected left join public.tutor_rating_summaries as summaries on summaries.tutor_id = selected.id
  where selected.id = any(coalesce(tutors,'{}'::uuid[])) and private.tutor_is_public(selected.id);
end;
$$;

create table public.matching_factor_versions (
  version integer generated always as identity primary key,
  factors jsonb not null check (jsonb_typeof(factors) = 'array' and jsonb_array_length(factors) between 1 and 5),
  created_by uuid references public.profiles(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default statement_timestamp()
);
revoke all on public.matching_factor_versions from public,anon,authenticated,service_role;
insert into public.matching_factor_versions(factors,created_by,reason) values (
  '[{"key":"rate_fit","label":"Rate fit","weight":0.35,"active":true},{"key":"teaching_preference","label":"Teaching preference","weight":0.2,"active":true},{"key":"rating","label":"Public rating","weight":0.15,"active":true},{"key":"experience","label":"Tutor experience","weight":0.15,"active":true},{"key":"completed_sessions","label":"Completed sessions","weight":0.15,"active":true}]'::jsonb,
  null,'Initial documented matching factors');

create function private.valid_matching_factors(factors jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb; seen text[] := '{}'; total numeric := 0; active_count integer := 0;
begin
  if jsonb_typeof(factors) is distinct from 'array' or jsonb_array_length(factors) not between 1 and 5 then return false; end if;
  for item in select value from jsonb_array_elements(factors) loop
    if jsonb_typeof(item) <> 'object' or coalesce(item->>'key','') not in ('rate_fit','teaching_preference','rating','experience','completed_sessions')
      or coalesce(item->>'label','') = '' or length(item->>'label') > 80
      or jsonb_typeof(item->'active') <> 'boolean' or jsonb_typeof(item->'weight') <> 'number'
      or (item->>'weight')::numeric < 0 or (item->>'weight')::numeric > 1 then return false; end if;
    if (item->>'key') = any(seen) then return false; end if;
    seen := array_append(seen,item->>'key');
    if (item->>'active')::boolean then total := total + (item->>'weight')::numeric; active_count := active_count + 1; end if;
  end loop;
  return active_count > 0 and abs(total - 1) < 0.000001;
exception when others then return false;
end;
$$;

create function public.read_matching_factor_version()
returns table(version integer,factors jsonb,created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select versions.version,versions.factors,versions.created_at from public.matching_factor_versions as versions
  order by versions.version desc limit 1;
$$;

create function public.save_matching_factor_version(factors jsonb,reason text,confirmed boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.assert_administrator(); next_version integer;
begin
  if confirmed is not true or reason is null or length(btrim(reason)) not between 1 and 500
    or not private.valid_matching_factors(factors) then raise exception 'Invalid factor version' using errcode = '22023'; end if;
  insert into public.matching_factor_versions(factors,created_by,reason) values(factors,actor,btrim(reason)) returning version into next_version;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,reason,safe_metadata)
  values(actor,'matching.factor_version_saved','matching_factor_versions',null,btrim(reason),jsonb_build_object('version',next_version));
  return next_version;
end;
$$;
revoke all on function private.valid_matching_factors(jsonb),public.read_matching_factor_version(),public.save_matching_factor_version(jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.read_matching_factor_version() to anon,authenticated;
grant execute on function public.save_matching_factor_version(jsonb,text,boolean) to authenticated;
grant execute on function private.valid_matching_factors(jsonb) to authenticated;

-- Same-ID confirmed reschedule. The guarded write token is a private transactional row, so the existing booking
-- immutability trigger stays in force for every write outside this one authorized RPC.
create table private.booking_move_authorizations (
  backend_pid integer not null,
  transaction_id bigint not null,
  booking_id uuid not null,
  actor_id uuid not null,
  primary key(backend_pid,transaction_id,booking_id,actor_id)
);
revoke all on private.booking_move_authorizations from public,anon,authenticated,service_role;
create table public.booking_reschedule_history (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  old_starts_at timestamptz not null,
  old_ends_at timestamptz not null,
  new_starts_at timestamptz not null,
  new_ends_at timestamptz not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  request_key text not null check (length(request_key) between 1 and 200),
  booking_version integer not null check (booking_version > 0),
  created_at timestamptz not null default statement_timestamp(),
  unique(actor_id,request_key),
  check(old_starts_at < old_ends_at and new_starts_at < new_ends_at and old_starts_at <> new_starts_at)
);
create index booking_reschedule_history_booking_idx on public.booking_reschedule_history(booking_id,created_at desc);
alter table public.booking_reschedule_history enable row level security;
revoke all on public.booking_reschedule_history from public,anon,authenticated,service_role;
grant select on public.booking_reschedule_history to authenticated;
create policy booking_reschedule_history_participant on public.booking_reschedule_history for select to authenticated
  using(private.booking_participant(booking_id));

create or replace function private.guard_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tutor_user uuid; authorized_move boolean := false;
begin
  select user_id into tutor_user from public.tutor_profiles where id = new.tutor_id for update;
  if tg_op = 'INSERT' then
    if new.student_id = tutor_user or not exists(
      select 1 from public.profiles as profiles join auth.users as users on users.id = profiles.id
      join public.user_roles as roles on roles.user_id = profiles.id and roles.role = 'student'
      where profiles.id = new.student_id and profiles.status = 'active' and profiles.adult_attested and users.email_confirmed_at is not null
    ) or not private.tutor_is_public(new.tutor_id) then raise exception 'Ineligible booking participants' using errcode = '22023'; end if;
    if not private.slot_is_available(new.tutor_id,new.blocking_starts_at,new.blocking_ends_at) then raise exception 'Slot unavailable' using errcode = '22023'; end if;
  else
    select exists(select 1 from private.booking_move_authorizations as grants
      where grants.backend_pid = pg_catalog.pg_backend_pid() and grants.transaction_id = pg_catalog.txid_current()
        and grants.booking_id = old.id and grants.actor_id = auth.uid()) into authorized_move;
    if (new.id,new.student_id,new.tutor_id,new.subject_id,new.mode,new.price_minor,new.platform_fee_minor,new.currency,
        new.policy_snapshot,new.request_key,new.created_at,new.hold_expires_at)
      is distinct from (old.id,old.student_id,old.tutor_id,old.subject_id,old.mode,old.price_minor,old.platform_fee_minor,
        old.currency,old.policy_snapshot,old.request_key,old.created_at,old.hold_expires_at) then
      raise exception 'Immutable booking snapshot' using errcode = '22023'; end if;
    if (new.starts_at,new.ends_at,new.blocking_starts_at,new.blocking_ends_at) is distinct from
        (old.starts_at,old.ends_at,old.blocking_starts_at,old.blocking_ends_at) and not authorized_move then
      raise exception 'Booking time is immutable outside authorized rescheduling' using errcode = '22023'; end if;
    if authorized_move and (old.status <> 'confirmed' or new.status <> old.status) then
      raise exception 'Only confirmed booking time may be moved' using errcode = '22023'; end if;
    if new.status <> old.status and not (
      (old.status = 'draft' and new.status in ('payment_pending','cancelled')) or
      (old.status = 'payment_pending' and new.status in ('confirmed','cancelled')) or
      (old.status = 'confirmed' and new.status in ('in_progress','cancelled')) or
      (old.status = 'in_progress' and new.status = 'completed')) then
      raise exception 'Invalid booking transition' using errcode = '22023'; end if;
    new.version := old.version + 1;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create function private.reject_reschedule_history_mutation() returns trigger
language plpgsql set search_path = '' as $$ begin raise exception 'Reschedule history is immutable' using errcode = '22023'; end; $$;
create trigger booking_reschedule_history_immutable before update or delete on public.booking_reschedule_history
  for each row execute function private.reject_reschedule_history_mutation();

create function public.reschedule_booking_v2(booking uuid,tutor uuid,subject uuid,starts_at timestamptz,ends_at timestamptz,
  mode text,request_key text,confirmed_move boolean,reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); selected public.bookings; prior public.booking_reschedule_history; policy private.booking_policy;
  duration_seconds numeric; buffer_minutes integer; old_starts_at timestamptz; old_ends_at timestamptz; initial_status text;
begin
  if actor is null or not private.active_actor() or not private.has_role('student') then raise exception 'Not authorized' using errcode = '42501'; end if;
  if booking is null or tutor is null or subject is null or starts_at is null or ends_at is null
    or not isfinite(starts_at) or not isfinite(ends_at) or ends_at <= starts_at
    or mode not in ('virtual','in_person') or request_key is null or length(request_key) not between 1 and 200
    or confirmed_move is null then raise exception 'Invalid reschedule request' using errcode = '22023'; end if;
  select * into prior from public.booking_reschedule_history as history where history.actor_id = actor and history.request_key = reschedule_booking_v2.request_key;
  if found then
    if prior.booking_id <> booking or (prior.new_starts_at,prior.new_ends_at) is distinct from (starts_at,ends_at)
      then raise exception 'Reschedule key reused with different input' using errcode = '22023'; end if;
    return booking;
  end if;
  select * into selected from public.bookings as bookings where bookings.id = booking and bookings.student_id = actor;
  if not found then raise exception 'Not authorized' using errcode = '42501'; end if;
  if selected.status = 'payment_pending' then
    if confirmed_move then raise exception 'Pending holds do not use confirmed moves' using errcode = '22023'; end if;
    return public.reschedule_booking(booking,tutor,subject,starts_at,ends_at,mode,request_key);
  end if;
  if selected.status <> 'confirmed' or confirmed_move is not true or reason is null or length(btrim(reason)) not between 1 and 500 then
    raise exception 'Confirmed rescheduling requires an explicit confirmation and reason' using errcode = '22023'; end if;
  perform 1 from public.tutor_profiles where id = selected.tutor_id for update;
  perform 1 from public.profiles where id = actor for update;
  select * into selected from public.bookings as bookings where bookings.id = booking and bookings.student_id = actor for update;
  if not found or selected.status <> 'confirmed' then raise exception 'Booking changed while rescheduling. Refresh and try again.' using errcode = '40001'; end if;
  select * into prior from public.booking_reschedule_history as history
    where history.actor_id = actor and history.request_key = reschedule_booking_v2.request_key for update;
  if found then
    if prior.booking_id <> booking or (prior.new_starts_at,prior.new_ends_at) is distinct from (starts_at,ends_at)
      then raise exception 'Reschedule key reused with different input' using errcode = '22023'; end if;
    return booking;
  end if;
  old_starts_at := selected.starts_at;
  old_ends_at := selected.ends_at;
  if (selected.tutor_id,selected.subject_id,selected.mode) is distinct from (tutor,subject,mode)
    or extract(epoch from (ends_at-starts_at)) <> extract(epoch from (selected.ends_at-selected.starts_at)) then
    raise exception 'A confirmed move must preserve tutor, subject, mode and duration' using errcode = '22023'; end if;
  duration_seconds := extract(epoch from (ends_at-starts_at));
  if mod(duration_seconds,60) <> 0 then raise exception 'Duration must be whole minutes' using errcode = '22023'; end if;
  select * into policy from private.booking_policy where singleton;
  if duration_seconds < policy.minimum_minutes*60 or duration_seconds > policy.maximum_minutes*60
    or starts_at < statement_timestamp()+make_interval(mins => policy.lead_minutes)
    or starts_at > statement_timestamp()+make_interval(days => policy.advance_days)
    or (mode='virtual' and not (select supports_virtual from public.tutor_profiles where id=tutor))
    or (mode='in_person' and not (select supports_in_person from public.tutor_profiles where id=tutor))
    or not private.slot_is_available(tutor,starts_at,ends_at) then
    raise exception 'Requested time is not available' using errcode = '22023'; end if;
  insert into private.booking_move_authorizations(backend_pid,transaction_id,booking_id,actor_id)
    values(pg_catalog.pg_backend_pid(),pg_catalog.txid_current(),booking,actor);
  buffer_minutes := (policy.buffer_minutes)::integer;
  update public.bookings set starts_at = reschedule_booking_v2.starts_at,ends_at = reschedule_booking_v2.ends_at,
    blocking_starts_at = reschedule_booking_v2.starts_at-make_interval(mins => buffer_minutes),
    blocking_ends_at = reschedule_booking_v2.ends_at+make_interval(mins => buffer_minutes)
    where id = booking returning * into selected;
  delete from private.booking_move_authorizations where backend_pid=pg_catalog.pg_backend_pid()
    and transaction_id=pg_catalog.txid_current() and booking_id=booking and actor_id=actor;
  insert into public.booking_reschedule_history(booking_id,actor_id,old_starts_at,old_ends_at,new_starts_at,new_ends_at,reason,request_key,booking_version)
  values(booking,actor,old_starts_at,old_ends_at,starts_at,ends_at,btrim(reason),request_key,selected.version);
  return booking;
end;
$$;

-- Preserve existing booking rows and old request keys while requiring whole-minute durations for all future writes.
alter table public.bookings add constraint bookings_whole_minute_duration
  check (mod(extract(epoch from (ends_at-starts_at))::numeric,60) = 0) not valid;

revoke all on function public.submit_review(uuid,integer,text,boolean),public.list_public_tutor_reviews(uuid),
  public.list_public_tutor_activity(uuid[]),public.reschedule_booking_v2(uuid,uuid,uuid,timestamptz,timestamptz,text,text,boolean,text)
  from public,anon,authenticated;
grant execute on function public.submit_review(uuid,integer,text,boolean) to authenticated;
grant execute on function public.list_public_tutor_reviews(uuid),public.list_public_tutor_activity(uuid[]) to anon,authenticated;
grant execute on function public.reschedule_booking_v2(uuid,uuid,uuid,timestamptz,timestamptz,text,text,boolean,text) to authenticated;
revoke all on function private.guard_booking(),private.tutor_is_ready(uuid),private.sync_tutor_snapshot(),private.reject_reschedule_history_mutation() from public,anon,authenticated;
grant execute on function private.tutor_is_ready(uuid),private.guard_booking(),private.sync_tutor_snapshot(),private.reject_reschedule_history_mutation() to authenticated;
revoke all on function private.save_tutor_listing_impl(uuid,integer,text,text,text,text,text,integer,bigint,text,boolean,boolean,text,double precision,double precision,numeric,jsonb),private.valid_matching_factors(jsonb) from public,anon,authenticated;

commit;
