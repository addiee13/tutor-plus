begin;
set local search_path = public, extensions, pg_catalog;

-- Tutor listing and offered subjects are saved in one authenticated transaction. Listing IDs can only be
-- reused by their owner; a first save always creates a draft and never publishes a user-submitted snapshot.
create function public.save_tutor_listing(
  listing uuid,
  public_display_name text,
  public_avatar_url text,
  headline text,
  bio text,
  credentials_text text,
  experience_years integer,
  hourly_rate_minor bigint,
  currency text,
  supports_virtual boolean,
  supports_in_person boolean,
  service_area_label text,
  latitude double precision,
  longitude double precision,
  service_radius_km numeric,
  offerings jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  selected_listing uuid;
  entry jsonb;
begin
  if actor is null or not private.active_actor() or not private.has_role('tutor') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if public_display_name is null or length(btrim(public_display_name)) not between 1 and 100
    or headline is null or length(btrim(headline)) not between 1 and 200
    or bio is null or length(btrim(bio)) not between 1 and 4000
    or (public_avatar_url is not null and (length(public_avatar_url) > 500 or public_avatar_url !~ '^https://'))
    or (credentials_text is not null and length(credentials_text) > 2000)
    or experience_years is null or experience_years not between 0 and 80
    or hourly_rate_minor is null or hourly_rate_minor not between 1 and 100000000
    or currency is null or currency !~ '^[A-Z]{3}$'
    or supports_virtual is null or supports_in_person is null or not (supports_virtual or supports_in_person)
    or (service_area_label is not null and length(service_area_label) > 200)
    or (service_radius_km is not null and (service_radius_km <= 0 or service_radius_km > 1000))
    or ((latitude is null) <> (longitude is null))
    or (latitude is not null and latitude not between -90 and 90)
    or (longitude is not null and longitude not between -180 and 180)
    or (supports_in_person and (service_area_label is null or length(btrim(service_area_label)) = 0
      or latitude is null or service_radius_km is null)) then
    raise exception 'Invalid tutor listing' using errcode = '22023';
  end if;
  if jsonb_typeof(offerings) <> 'array' or jsonb_array_length(offerings) > 100 then
    raise exception 'Invalid tutor subjects' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(offerings) as rows(value)
    where jsonb_typeof(rows.value) <> 'object'
      or coalesce(rows.value ->> 'subject_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (rows.value ? 'expertise' and rows.value -> 'expertise' <> 'null'::jsonb
        and (jsonb_typeof(rows.value -> 'expertise') <> 'string' or length(rows.value ->> 'expertise') > 1000))
      or (rows.value ? 'rate_override_minor' and rows.value -> 'rate_override_minor' <> 'null'::jsonb
        and (jsonb_typeof(rows.value -> 'rate_override_minor') <> 'number'
          or (rows.value ->> 'rate_override_minor') !~ '^[0-9]+$'
          or (rows.value ->> 'rate_override_minor')::numeric not between 1 and 100000000))
  ) then raise exception 'Invalid tutor subject' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(offerings) as rows(value)
    group by (rows.value ->> 'subject_id')::uuid having count(*) > 1
  ) then raise exception 'Duplicate tutor subject' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(offerings) as rows(value)
    left join public.subjects as subjects on subjects.id = (rows.value ->> 'subject_id')::uuid and subjects.active
    where subjects.id is null
  ) then raise exception 'Unknown or inactive subject' using errcode = '22023'; end if;

  if listing is null then
    insert into public.tutor_profiles(
      user_id, public_display_name, public_avatar_url, headline, bio, credentials_text,
      experience_years, hourly_rate_minor, currency, supports_virtual, supports_in_person,
      service_area_label, approximate_location, service_radius_km, publication_state
    ) values (
      actor, btrim(public_display_name), public_avatar_url, btrim(headline), btrim(bio), nullif(btrim(credentials_text), ''),
      experience_years, hourly_rate_minor, currency, supports_virtual, supports_in_person,
      nullif(btrim(service_area_label), case when supports_in_person then '' else null end),
      case when latitude is null then null
        else extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography end,
      service_radius_km, 'draft'
    ) returning id into selected_listing;
  else
    update public.tutor_profiles as tutors set
      public_display_name = btrim(save_tutor_listing.public_display_name),
      public_avatar_url = save_tutor_listing.public_avatar_url,
      headline = btrim(save_tutor_listing.headline),
      bio = btrim(save_tutor_listing.bio),
      credentials_text = nullif(btrim(save_tutor_listing.credentials_text), ''),
      experience_years = save_tutor_listing.experience_years,
      hourly_rate_minor = save_tutor_listing.hourly_rate_minor,
      currency = save_tutor_listing.currency,
      supports_virtual = save_tutor_listing.supports_virtual,
      supports_in_person = save_tutor_listing.supports_in_person,
      service_area_label = nullif(btrim(save_tutor_listing.service_area_label), ''),
      approximate_location = case when latitude is null then null
        else extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography end,
      service_radius_km = save_tutor_listing.service_radius_km
    where tutors.id = listing and tutors.user_id = actor
    returning tutors.id into selected_listing;
    if selected_listing is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  end if;

  perform 1 from public.tutor_profiles where id = selected_listing for update;
  delete from public.tutor_subjects as links where links.tutor_id = selected_listing
    and not exists (
      select 1 from jsonb_array_elements(offerings) as rows(value)
      where (rows.value ->> 'subject_id')::uuid = links.subject_id
    );
  for entry in select value from jsonb_array_elements(offerings) as rows(value) loop
    insert into public.tutor_subjects(tutor_id, subject_id, expertise, rate_override_minor)
    values (
      selected_listing,
      (entry ->> 'subject_id')::uuid,
      nullif(btrim(entry ->> 'expertise'), ''),
      case when entry -> 'rate_override_minor' is null or entry -> 'rate_override_minor' = 'null'::jsonb
        then null else (entry ->> 'rate_override_minor')::bigint end
    ) on conflict (tutor_id, subject_id) do update set
      expertise = excluded.expertise, rate_override_minor = excluded.rate_override_minor;
  end loop;
  return selected_listing;
end;
$$;

revoke all on function public.save_tutor_listing(uuid, text, text, text, text, text, integer, bigint, text,
  boolean, boolean, text, double precision, double precision, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.save_tutor_listing(uuid, text, text, text, text, text, integer, bigint, text,
  boolean, boolean, text, double precision, double precision, numeric, jsonb) to authenticated;

-- Bounded public discovery returns only tutor-approved snapshot fields, rating aggregates and subject IDs.
-- Exact availability is optional but, when requested, it is a hard rule + exception + booking-conflict filter.
create function public.list_public_tutors(
  search_query text,
  subject uuid,
  requested_mode text,
  min_rate bigint,
  max_rate bigint,
  min_rating numeric,
  search_latitude double precision,
  search_longitude double precision,
  max_distance_km numeric,
  available_at timestamptz,
  duration_minutes integer,
  sort_by text,
  page_size integer,
  page_offset integer
) returns table(
  id uuid,
  public_display_name text,
  public_avatar_url text,
  headline text,
  bio text,
  credentials_text text,
  experience_years smallint,
  hourly_rate_minor bigint,
  currency char(3),
  supports_virtual boolean,
  supports_in_person boolean,
  service_area_label text,
  service_radius_km numeric,
  rating_count integer,
  rating_average numeric,
  distance_km numeric,
  subject_ids uuid[]
)
language plpgsql stable security definer set search_path = '' as $$
declare
  center extensions.geography;
  policy private.booking_policy;
begin
  if (search_query is not null and length(btrim(search_query)) > 120)
    or (requested_mode is not null and requested_mode not in ('virtual', 'in_person'))
    or (min_rate is not null and min_rate < 0) or (max_rate is not null and max_rate < 0)
    or (min_rate is not null and max_rate is not null and min_rate > max_rate)
    or (min_rating is not null and min_rating not between 1 and 5)
    or (sort_by is null or sort_by not in ('relevance', 'rating', 'rate', 'name', 'distance'))
    or page_size is null or page_size not between 1 and 51
    or page_offset is null or page_offset not between 0 and 50000
    or ((search_latitude is null) <> (search_longitude is null))
    or ((search_latitude is null) <> (max_distance_km is null))
    or (search_latitude is not null and search_latitude not between -90 and 90)
    or (search_longitude is not null and search_longitude not between -180 and 180)
    or (max_distance_km is not null and (max_distance_km <= 0 or max_distance_km > 1000))
    or ((available_at is null) <> (duration_minutes is null))
    or (available_at is not null and (not isfinite(available_at) or duration_minutes not between 15 and 180))
    or (sort_by = 'distance' and search_latitude is null) then
    raise exception 'Invalid tutor search' using errcode = '22023';
  end if;
  if search_latitude is not null then
    center := extensions.st_setsrid(extensions.st_makepoint(search_longitude, search_latitude), 4326)::extensions.geography;
  end if;
  if available_at is not null then select * into policy from private.booking_policy where singleton; end if;

  return query
  with candidates as (
    select
      snapshots.id,
      snapshots.public_display_name,
      snapshots.public_avatar_url,
      snapshots.headline,
      snapshots.bio,
      snapshots.credentials_text,
      snapshots.experience_years,
      snapshots.hourly_rate_minor,
      snapshots.currency,
      snapshots.supports_virtual,
      snapshots.supports_in_person,
      snapshots.service_area_label,
      snapshots.service_radius_km,
      coalesce(ratings.rating_count, 0)::integer as rating_count,
      ratings.rating_avg::numeric as rating_average,
      case when center is null or snapshots.approximate_location is null then null::numeric
        else (extensions.st_distance(snapshots.approximate_location, center) / 1000)::numeric(10,2) end as distance_km,
      coalesce(subjects.subject_ids, array[]::uuid[]) as subject_ids,
      coalesce(selected_subject.rate_override_minor, snapshots.hourly_rate_minor) as effective_rate,
      snapshots.approximate_location
    from public.public_tutor_snapshots as snapshots
    left join public.tutor_rating_summaries as ratings on ratings.tutor_id = snapshots.id
    left join lateral (
      select array_agg(links.subject_id order by catalog.sort_order, catalog.name) as subject_ids
      from public.tutor_subjects as links join public.subjects as catalog
        on catalog.id = links.subject_id and catalog.active
      where links.tutor_id = snapshots.id
    ) as subjects on true
    left join public.tutor_subjects as selected_subject
      on selected_subject.tutor_id = snapshots.id and selected_subject.subject_id = subject
  )
  select candidates.id, candidates.public_display_name, candidates.public_avatar_url, candidates.headline,
    candidates.bio, candidates.credentials_text, candidates.experience_years, candidates.hourly_rate_minor,
    candidates.currency, candidates.supports_virtual, candidates.supports_in_person, candidates.service_area_label,
    candidates.service_radius_km, candidates.rating_count, candidates.rating_average, candidates.distance_km,
    candidates.subject_ids
  from candidates
  where private.tutor_is_public(candidates.id)
    and (search_query is null or btrim(search_query) = '' or
      pg_catalog.strpos(pg_catalog.lower(pg_catalog.concat_ws(' ', candidates.public_display_name, candidates.headline,
        candidates.bio, candidates.credentials_text, candidates.service_area_label)), pg_catalog.lower(btrim(search_query))) > 0)
    and (requested_mode is null or (requested_mode = 'virtual' and candidates.supports_virtual)
      or (requested_mode = 'in_person' and candidates.supports_in_person))
    and (subject is null or subject = any(candidates.subject_ids))
    and (min_rate is null or candidates.effective_rate >= min_rate)
    and (max_rate is null or candidates.effective_rate <= max_rate)
    and (min_rating is null or candidates.rating_average >= min_rating)
    and (center is null or (candidates.approximate_location is not null and
      extensions.st_dwithin(candidates.approximate_location, center, max_distance_km * 1000)))
    and (available_at is null or (
      private.slot_is_available(candidates.id,
        available_at - make_interval(mins => policy.buffer_minutes),
        available_at + make_interval(mins => duration_minutes + policy.buffer_minutes))
      and not exists (
        select 1 from public.bookings as bookings
        where bookings.tutor_id = candidates.id
          and (bookings.status in ('confirmed', 'in_progress')
            or (bookings.status = 'payment_pending' and bookings.hold_expires_at > statement_timestamp()))
          and bookings.blocking_range && tstzrange(
            available_at - make_interval(mins => policy.buffer_minutes),
            available_at + make_interval(mins => duration_minutes + policy.buffer_minutes), '[)')
      )
    ))
  order by
    case when sort_by = 'distance' or (sort_by = 'relevance' and center is not null) then candidates.distance_km end asc nulls last,
    case when sort_by in ('rating', 'relevance') then candidates.rating_average end desc nulls last,
    case when sort_by = 'rate' then candidates.effective_rate end asc nulls last,
    case when sort_by = 'name' then pg_catalog.lower(candidates.public_display_name) end asc nulls last,
    candidates.id
  limit page_size offset page_offset;
end;
$$;

revoke all on function public.list_public_tutors(text, uuid, text, bigint, bigint, numeric,
  double precision, double precision, numeric, timestamptz, integer, text, integer, integer)
from public, anon, authenticated;
grant execute on function public.list_public_tutors(text, uuid, text, bigint, bigint, numeric,
  double precision, double precision, numeric, timestamptz, integer, text, integer, integer)
to anon, authenticated;

-- Private meeting details remain participant-readable through the existing policy. Writes use a single narrow RPC,
-- because PostgREST upserts require UPDATE privilege on the conflict key as well as the mutable columns.
revoke insert, update on public.booking_private_details from authenticated;

create function private.touch_booking_private_details() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then new.booking_id := old.booking_id; new.created_at := old.created_at; end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger booking_private_details_touch before insert or update on public.booking_private_details
for each row execute function private.touch_booking_private_details();

create function public.save_booking_private_details(booking uuid, meeting_url text, meeting_place text)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  booking_status text;
  saved_at timestamptz;
begin
  if not private.booking_tutor(booking) then raise exception 'Not authorized' using errcode = '42501'; end if;
  select bookings.status into booking_status from public.bookings as bookings
  where bookings.id = booking for update;
  if booking_status is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if booking_status not in ('payment_pending', 'confirmed', 'in_progress') then
    raise exception 'Meeting details cannot be changed for this booking' using errcode = '22023';
  end if;
  insert into public.booking_private_details(booking_id, meeting_url, meeting_place)
  values (booking, meeting_url, meeting_place)
  on conflict (booking_id) do update set meeting_url = excluded.meeting_url, meeting_place = excluded.meeting_place
  returning updated_at into saved_at;
  return saved_at;
end;
$$;

revoke all on function public.save_booking_private_details(uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_booking_private_details(uuid, text, text) to authenticated;

-- A private idempotency ledger makes a successful reschedule safe to replay even after the original booking is
-- cancelled (or the replacement advances state). It stores only replacement intent and booking identifiers.
create table private.booking_reschedules (
  original_booking_id uuid primary key references public.bookings(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  tutor_id uuid not null references public.tutor_profiles(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  mode text not null check (mode in ('virtual', 'in_person')),
  request_key text not null check (length(request_key) between 1 and 200),
  replacement_booking_id uuid not null unique references public.bookings(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (student_id, request_key),
  check (starts_at < ends_at)
);
revoke all on private.booking_reschedules from public, anon, authenticated, service_role;

-- Replace an unpaid hold atomically. A booking with any payment row is never changed here, and the replacement
-- always comes from the canonical create_booking path, which returns only a payment_pending reservation.
create function public.reschedule_booking(
  booking uuid,
  tutor uuid,
  subject uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  mode text,
  request_key text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  old_tutor uuid;
  selected public.bookings;
  prior private.booking_reschedules;
  replacement uuid;
begin
  if actor is null or not private.active_actor() or not private.has_role('student') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if tutor is null or subject is null or starts_at is null or ends_at is null or not isfinite(starts_at)
    or not isfinite(ends_at) or ends_at <= starts_at or mode not in ('virtual', 'in_person')
    or request_key is null or length(request_key) not between 1 and 200 then
    raise exception 'Invalid reschedule request' using errcode = '22023';
  end if;

  select * into prior from private.booking_reschedules as saved
  where saved.original_booking_id = booking and saved.student_id = actor;
  if found then
    if (prior.tutor_id, prior.subject_id, prior.starts_at, prior.ends_at, prior.mode, prior.request_key)
      is distinct from (tutor, subject, starts_at, ends_at, mode, request_key) then
      raise exception 'Reschedule key reused with different input' using errcode = '22023';
    end if;
    return prior.replacement_booking_id;
  end if;

  select existing.tutor_id into old_tutor from public.bookings as existing
  where existing.id = booking and existing.student_id = actor;
  if old_tutor is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform tutors.id from public.tutor_profiles as tutors
  where tutors.id = any(array[old_tutor, tutor]::uuid[]) order by tutors.id for update;
  perform 1 from public.profiles where id = actor for update;
  select existing.* into selected from public.bookings as existing
  where existing.id = booking and existing.student_id = actor for update;
  if not found then raise exception 'Not authorized' using errcode = '42501'; end if;

  -- Recheck after the lock: a concurrent retry may have committed while this call waited.
  select * into prior from private.booking_reschedules as saved
  where saved.original_booking_id = booking and saved.student_id = actor;
  if found then
    if (prior.tutor_id, prior.subject_id, prior.starts_at, prior.ends_at, prior.mode, prior.request_key)
      is distinct from (tutor, subject, starts_at, ends_at, mode, request_key) then
      raise exception 'Reschedule key reused with different input' using errcode = '22023';
    end if;
    return prior.replacement_booking_id;
  end if;

  if selected.status <> 'payment_pending' or selected.hold_expires_at <= statement_timestamp() then
    raise exception 'Only an active payment-pending hold can be rescheduled' using errcode = '22023';
  end if;
  if exists (select 1 from public.payments where booking_id = selected.id) then
    raise exception 'A booking with a payment attempt cannot be rescheduled here' using errcode = '22023';
  end if;
  update public.bookings set status = 'cancelled', cancellation_reason = 'Rescheduled by student'
  where id = selected.id;
  replacement := public.create_booking(tutor, subject, starts_at, ends_at, mode, request_key);
  insert into private.booking_reschedules(original_booking_id, student_id, tutor_id, subject_id,
    starts_at, ends_at, mode, request_key, replacement_booking_id)
  values (booking, actor, tutor, subject, starts_at, ends_at, mode, request_key, replacement);
  return replacement;
end;
$$;

revoke all on function public.reschedule_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text)
from public, anon, authenticated;
grant execute on function public.reschedule_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text)
to authenticated;

revoke all on function private.touch_booking_private_details() from public, anon, authenticated;
grant execute on function private.booking_tutor(uuid) to authenticated;

commit;
