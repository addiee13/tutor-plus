begin;
set local search_path = public, extensions, pg_catalog;

-- Student preferences stay private on the profile row. The preferred mode is descriptive only; it is not
-- an authorization signal and does not relax tutor availability or booking eligibility checks.
create function private.valid_learning_interests(input_values text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(coalesce(input_values,'{}'))<=20 and not exists(
    select 1 from unnest(coalesce(input_values,'{}')) as entries(value)
    where value is null or length(btrim(value)) not between 1 and 60 or value ~ '[[:cntrl:]]'
  ) and cardinality(coalesce(input_values,'{}'))=(
    select count(distinct lower(btrim(value))) from unnest(coalesce(input_values,'{}')) as entries(value)
  );
$$;
alter table public.profiles
  add column learning_interests text[] not null default '{}',
  add column preferred_mode text not null default 'no_preference'
    check (preferred_mode in ('virtual','in_person','no_preference'));
alter table public.profiles add constraint profiles_learning_interests_valid
  check (private.valid_learning_interests(learning_interests));
grant update(learning_interests,preferred_mode) on public.profiles to authenticated;

-- Tutor language claims are explicit public listing facts. They are not inferred from profile or protected data.
create function private.valid_tutor_languages(input_values text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(coalesce(input_values,'{}'))<=20 and not exists(
    select 1 from unnest(coalesce(input_values,'{}')) as entries(value)
    where value is null or value !~ '^[a-z]{2,3}(-([A-Z]{2}|[A-Z][a-z]{3}))?$'
  ) and cardinality(coalesce(input_values,'{}'))=(
    select count(distinct lower(value)) from unnest(coalesce(input_values,'{}')) as entries(value)
  );
$$;
alter table public.tutor_profiles add column tutor_languages text[] not null default '{}';
alter table public.tutor_profiles add constraint tutor_profiles_languages_valid
  check (private.valid_tutor_languages(tutor_languages));
alter table public.public_tutor_snapshots add column tutor_languages text[] not null default '{}';

create or replace function private.sync_tutor_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.hourly_rate_minor is null then return new; end if;
  insert into public.public_tutor_snapshots(
    id,public_display_name,public_avatar_url,headline,bio,credentials_text,experience_years,hourly_rate_minor,
    currency,supports_virtual,supports_in_person,service_area_label,approximate_location,service_radius_km,
    updated_at,tutor_languages
  ) values (
    new.id,new.public_display_name,new.public_avatar_url,new.headline,new.bio,new.credentials_text,new.experience_years,
    new.hourly_rate_minor,new.currency,new.supports_virtual,new.supports_in_person,new.service_area_label,
    new.approximate_location,new.service_radius_km,new.updated_at,new.tutor_languages
  ) on conflict (id) do update set
    public_display_name=excluded.public_display_name,public_avatar_url=excluded.public_avatar_url,
    headline=excluded.headline,bio=excluded.bio,credentials_text=excluded.credentials_text,
    experience_years=excluded.experience_years,hourly_rate_minor=excluded.hourly_rate_minor,
    currency=excluded.currency,supports_virtual=excluded.supports_virtual,supports_in_person=excluded.supports_in_person,
    service_area_label=excluded.service_area_label,approximate_location=excluded.approximate_location,
    service_radius_km=excluded.service_radius_km,updated_at=excluded.updated_at,
    tutor_languages=excluded.tutor_languages;
  return new;
end;
$$;

create function public.save_tutor_languages(tutor uuid,expected_version integer,languages text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare current_version integer;
begin
  if not private.active_actor() or not private.has_role('tutor') then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if languages is null or cardinality(languages)>20 or exists(
    select 1 from unnest(languages) as entries(value)
    where value is null or value !~ '^[a-z]{2,3}(-([A-Z]{2}|[A-Z][a-z]{3}))?$'
  ) or cardinality(languages)<>(select count(distinct lower(value)) from unnest(languages) as entries(value)) then
    raise exception 'Invalid language tags' using errcode='22023';
  end if;
  select version into current_version from public.tutor_profiles
    where id=tutor and user_id=auth.uid() for update;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  if expected_version is null or expected_version<>current_version then
    raise exception 'Listing changed in another editor. Refresh before saving.' using errcode='40001';
  end if;
  update public.tutor_profiles set tutor_languages=languages where id=tutor;
end;
$$;

-- Student notes are private by default. Tutors can read only the explicitly shared, non-private projection below.
create function private.valid_booking_topics(input_values text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(coalesce(input_values,'{}'))<=10 and not exists(
    select 1 from unnest(coalesce(input_values,'{}')) as entries(value)
    where value is null or length(btrim(value)) not between 1 and 80 or value ~ '[[:cntrl:]]'
  ) and cardinality(coalesce(input_values,'{}'))=(
    select count(distinct lower(btrim(value))) from unnest(coalesce(input_values,'{}')) as entries(value)
  );
$$;
create table public.booking_student_notes (
  booking_id uuid primary key references public.bookings(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  learning_goal text check (learning_goal is null or length(learning_goal)<=500),
  topics text[] not null default '{}',
  questions text check (questions is null or length(questions)<=2000),
  private_note text check (private_note is null or length(private_note)<=1000),
  share_with_tutor boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (private.valid_booking_topics(topics))
);
alter table public.booking_student_notes enable row level security;
revoke all on public.booking_student_notes from public,anon,authenticated,service_role;
grant select on public.booking_student_notes to authenticated;
create policy booking_student_notes_owner_read on public.booking_student_notes for select to authenticated
  using(private.active_actor() and private.has_role('student') and student_id=auth.uid());

create function private.valid_booking_student_notes(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare note_topics jsonb; object_key_count integer;
begin
  if jsonb_typeof(value) is distinct from 'object' then return false; end if;
  select count(*) into object_key_count from jsonb_object_keys(value) as object_keys(key);
  if object_key_count<>5 or not (value ?& array['learningGoal','topics','questions','privateNote','shareWithTutor'])
    or jsonb_typeof(value->'topics') is distinct from 'array'
    or jsonb_array_length(value->'topics')>10
    or jsonb_typeof(value->'shareWithTutor') is distinct from 'boolean'
    or (value->'learningGoal'<>'null'::jsonb and (jsonb_typeof(value->'learningGoal')<>'string' or length(value->>'learningGoal')>500))
    or (value->'questions'<>'null'::jsonb and (jsonb_typeof(value->'questions')<>'string' or length(value->>'questions')>2000))
    or (value->'privateNote'<>'null'::jsonb and (jsonb_typeof(value->'privateNote')<>'string' or length(value->>'privateNote')>1000)) then
    return false;
  end if;
  select value->'topics' into note_topics;
  if exists(select 1 from jsonb_array_elements(note_topics) as rows(item)
    where jsonb_typeof(rows.item)<>'string' or length(btrim(rows.item#>>'{}')) not between 1 and 80
      or (rows.item#>>'{}') ~ '[[:cntrl:]]') then return false; end if;
  return (select count(*)=count(distinct lower(btrim(rows.item#>>'{}')))
    from jsonb_array_elements(note_topics) as rows(item));
exception when others then return false;
end;
$$;

create function private.save_booking_student_notes_impl(booking uuid,value jsonb) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare student uuid:=auth.uid(); saved_at timestamptz;
begin
  if not private.active_actor() or not private.has_role('student') then raise exception 'Not authorized' using errcode='42501'; end if;
  if not private.valid_booking_student_notes(value) then raise exception 'Invalid booking notes' using errcode='22023'; end if;
  perform 1 from public.bookings where id=booking and student_id=student for update;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  insert into public.booking_student_notes(booking_id,student_id,learning_goal,topics,questions,private_note,share_with_tutor)
  values(booking,student,nullif(btrim(value->>'learningGoal'),''),
    coalesce(array(select btrim(rows.item#>>'{}') from jsonb_array_elements(value->'topics') as rows(item)),'{}'),
    nullif(btrim(value->>'questions'),''),nullif(btrim(value->>'privateNote'),''),(value->>'shareWithTutor')::boolean)
  on conflict(booking_id) do update set learning_goal=excluded.learning_goal,topics=excluded.topics,
    questions=excluded.questions,private_note=excluded.private_note,share_with_tutor=excluded.share_with_tutor,
    updated_at=statement_timestamp()
  returning updated_at into saved_at;
  return saved_at;
end;
$$;

create function public.save_booking_student_notes(booking uuid,notes jsonb) returns timestamptz
language plpgsql security definer set search_path = '' as $$
begin return private.save_booking_student_notes_impl(booking,notes); end;
$$;

create function public.read_tutor_booking_notes(booking uuid)
returns table(booking_id uuid,learning_goal text,topics text[],questions text,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.booking_tutor(booking) then raise exception 'Not authorized' using errcode='42501'; end if;
  return query select notes.booking_id,notes.learning_goal,notes.topics,notes.questions,notes.updated_at
    from public.booking_student_notes as notes
    where notes.booking_id=read_tutor_booking_notes.booking and notes.share_with_tutor;
end;
$$;

-- Booking creation and student notes commit together. A validation or note-write failure rolls back the hold.
create function public.create_booking_with_notes(tutor uuid,subject uuid,starts_at timestamptz,ends_at timestamptz,
  mode text,request_key text,student_notes jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare created_booking uuid;
begin
  if not private.valid_booking_student_notes(student_notes) then raise exception 'Invalid booking notes' using errcode='22023'; end if;
  created_booking:=public.create_booking(tutor,subject,starts_at,ends_at,mode,request_key);
  perform private.save_booking_student_notes_impl(created_booking,student_notes);
  return created_booking;
end;
$$;

-- Versioned discovery keeps language eligibility in SQL before ordering and pagination.
create function public.list_public_tutors_v2(
  search_query text,subject uuid,requested_mode text,min_rate bigint,max_rate bigint,min_rating numeric,
  language_tags text[],search_latitude double precision,search_longitude double precision,max_distance_km numeric,
  available_at timestamptz,duration_minutes integer,sort_by text,page_size integer,page_offset integer
) returns table(
  id uuid,public_display_name text,public_avatar_url text,headline text,bio text,credentials_text text,
  experience_years smallint,hourly_rate_minor bigint,currency char(3),supports_virtual boolean,supports_in_person boolean,
  service_area_label text,service_radius_km numeric,rating_count integer,rating_average numeric,distance_km numeric,
  subject_ids uuid[],tutor_languages text[]
)
language plpgsql stable security definer set search_path = '' as $$
declare center extensions.geography; policy private.booking_policy;
begin
  if (search_query is not null and length(btrim(search_query))>120)
    or (requested_mode is not null and requested_mode not in ('virtual','in_person'))
    or (min_rate is not null and min_rate<0) or (max_rate is not null and max_rate<0)
    or (min_rate is not null and max_rate is not null and min_rate>max_rate)
    or (min_rating is not null and min_rating not between 1 and 5)
    or (sort_by is null or sort_by not in ('relevance','rating','rate','name','distance'))
    or page_size is null or page_size not between 1 and 51 or page_offset is null or page_offset not between 0 and 50000
    or ((search_latitude is null)<>(search_longitude is null))
    or ((search_latitude is null)<>(max_distance_km is null))
    or (search_latitude is not null and search_latitude not between -90 and 90)
    or (search_longitude is not null and search_longitude not between -180 and 180)
    or (max_distance_km is not null and (max_distance_km<=0 or max_distance_km>1000))
    or ((available_at is null)<>(duration_minutes is null))
    or (available_at is not null and (not isfinite(available_at) or duration_minutes not between 15 and 180))
    or (sort_by='distance' and search_latitude is null)
    or cardinality(coalesce(language_tags,'{}'))>20
    or exists(select 1 from unnest(coalesce(language_tags,'{}')) as entries(value)
      where value is null or value !~ '^[a-z]{2,3}(-([A-Z]{2}|[A-Z][a-z]{3}))?$')
    or cardinality(coalesce(language_tags,'{}'))<>
      (select count(distinct lower(entries.value)) from unnest(coalesce(language_tags,'{}')) as entries(value)) then
    raise exception 'Invalid tutor search' using errcode='22023';
  end if;
  if search_latitude is not null then center:=extensions.st_setsrid(extensions.st_makepoint(search_longitude,search_latitude),4326)::extensions.geography; end if;
  if available_at is not null then select * into policy from private.booking_policy where singleton; end if;
  return query with candidates as (
    select snapshots.id,snapshots.public_display_name,snapshots.public_avatar_url,snapshots.headline,snapshots.bio,
      snapshots.credentials_text,snapshots.experience_years,snapshots.hourly_rate_minor,snapshots.currency,
      snapshots.supports_virtual,snapshots.supports_in_person,snapshots.service_area_label,snapshots.service_radius_km,
      coalesce(ratings.rating_count,0)::integer as rating_count,ratings.rating_avg::numeric as rating_average,
      case when center is null or snapshots.approximate_location is null then null::numeric
        else (extensions.st_distance(snapshots.approximate_location,center)/1000)::numeric(10,2) end as distance_km,
      coalesce(subjects.subject_ids,'{}'::uuid[]) as subject_ids,
      coalesce(selected_subject.rate_override_minor,snapshots.hourly_rate_minor) as effective_rate,
      snapshots.approximate_location,snapshots.tutor_languages
    from public.public_tutor_snapshots as snapshots
    left join public.tutor_rating_summaries as ratings on ratings.tutor_id=snapshots.id
    left join lateral(
      select array_agg(links.subject_id order by catalog.sort_order,catalog.name) as subject_ids
      from public.tutor_subjects as links join public.subjects as catalog on catalog.id=links.subject_id and catalog.active
      where links.tutor_id=snapshots.id
    ) as subjects on true
    left join public.tutor_subjects as selected_subject on selected_subject.tutor_id=snapshots.id
      and selected_subject.subject_id=subject
  )
  select candidates.id,candidates.public_display_name,candidates.public_avatar_url,candidates.headline,candidates.bio,
    candidates.credentials_text,candidates.experience_years,candidates.hourly_rate_minor,candidates.currency,
    candidates.supports_virtual,candidates.supports_in_person,candidates.service_area_label,candidates.service_radius_km,
    candidates.rating_count,candidates.rating_average,candidates.distance_km,candidates.subject_ids,candidates.tutor_languages
  from candidates
  where private.tutor_is_public(candidates.id)
    and (search_query is null or btrim(search_query)='' or pg_catalog.strpos(
      pg_catalog.lower(pg_catalog.concat_ws(' ',candidates.public_display_name,candidates.headline,candidates.bio,
        candidates.credentials_text,candidates.service_area_label)),pg_catalog.lower(btrim(search_query)))>0)
    and (requested_mode is null or (requested_mode='virtual' and candidates.supports_virtual)
      or (requested_mode='in_person' and candidates.supports_in_person))
    and (subject is null or subject=any(candidates.subject_ids))
    and (min_rate is null or candidates.effective_rate>=min_rate)
    and (max_rate is null or candidates.effective_rate<=max_rate)
    and (min_rating is null or candidates.rating_average>=min_rating)
    and (cardinality(coalesce(language_tags,'{}'))=0 or exists(
      select 1 from unnest(candidates.tutor_languages) as listed(tag)
      join unnest(language_tags) as requested(tag) on lower(listed.tag)=lower(requested.tag)))
    and (center is null or (candidates.approximate_location is not null
      and extensions.st_dwithin(candidates.approximate_location,center,max_distance_km*1000)))
    and (available_at is null or (
      private.slot_is_available(candidates.id,available_at-make_interval(mins=>policy.buffer_minutes),
        available_at+make_interval(mins=>duration_minutes+policy.buffer_minutes))
      and not exists(select 1 from public.bookings as bookings where bookings.tutor_id=candidates.id
        and (bookings.status in ('confirmed','in_progress') or
          (bookings.status='payment_pending' and bookings.hold_expires_at>statement_timestamp()))
        and bookings.blocking_range && tstzrange(available_at-make_interval(mins=>policy.buffer_minutes),
          available_at+make_interval(mins=>duration_minutes+policy.buffer_minutes),'[)'))))
  order by case when sort_by='distance' or (sort_by='relevance' and center is not null) then candidates.distance_km end asc nulls last,
    case when sort_by in ('rating','relevance') then candidates.rating_average end desc nulls last,
    case when sort_by='rate' then candidates.effective_rate end asc nulls last,
    case when sort_by='name' then pg_catalog.lower(candidates.public_display_name) end asc nulls last,candidates.id
  limit page_size offset page_offset;
end;
$$;

-- The review identifier is a safe public reference for a user-initiated safety report; participant identities and
-- booking identifiers remain private.
drop function public.list_public_tutor_reviews(uuid);
create function public.list_public_tutor_reviews(tutor uuid)
returns table(id uuid,rating smallint,comment text,recommended boolean,created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select reviews.id,reviews.rating,reviews.comment,reviews.recommended,reviews.created_at
  from public.reviews as reviews
  where reviews.tutor_id=tutor and reviews.status='visible' and private.tutor_is_public(tutor)
  order by reviews.created_at desc limit 50;
$$;

-- A private avatar bucket allows only an authenticated owner to upload, replace, delete, or sign their own object.
do $avatar_storage$
begin
  -- Supabase installs Storage before application migrations. The optional check also permits SQL-only
  -- migration validation in a plain PostgreSQL fixture, where Storage is deliberately absent.
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    execute $sql$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('profile-avatars','profile-avatars',false,3145728,array['image/jpeg','image/png','image/webp'])
      on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types$sql$;
    execute 'drop policy if exists profile_avatar_owner_read on storage.objects';
    execute 'drop policy if exists profile_avatar_owner_insert on storage.objects';
    execute 'drop policy if exists profile_avatar_owner_delete on storage.objects';
    execute $sql$create policy profile_avatar_owner_read on storage.objects for select to authenticated
      using(bucket_id='profile-avatars' and private.active_actor() and (storage.foldername(name))[1]=auth.uid()::text)$sql$;
    execute $sql$create policy profile_avatar_owner_insert on storage.objects for insert to authenticated
      with check(bucket_id='profile-avatars' and private.active_actor() and (storage.foldername(name))[1]=auth.uid()::text)$sql$;
    execute $sql$create policy profile_avatar_owner_delete on storage.objects for delete to authenticated
      using(bucket_id='profile-avatars' and private.active_actor() and (storage.foldername(name))[1]=auth.uid()::text)$sql$;
  end if;
end;
$avatar_storage$;

-- Source-backed notifications are invalidated if the assignment/assessment is no longer assigned or a
-- milestone was revised/completed before a delayed job claims it.
alter table private.notification_outbox
  add column source_kind text check (source_kind in ('assignment_due','assessment_due','milestone_risk')),
  add column source_id uuid,
  add column source_version text check (source_version is null or length(source_version)<=200),
  add constraint notification_outbox_source_shape check (
    (source_kind is null and source_id is null and source_version is null) or
    (source_kind is not null and source_id is not null and source_version is not null)
  );

create function private.notification_source_is_current(kind text,source uuid,version_text text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare revision_no integer; milestone_id text; target_day date; utc_today date:=timezone('UTC',statement_timestamp())::date;
begin
  if kind='assignment_due' then
    return exists(select 1 from public.assignments as assignments where assignments.id=source
      and assignments.status='assigned' and assignments.due_at>statement_timestamp()
      and extract(epoch from assignments.due_at)::text=version_text);
  elsif kind='assessment_due' then
    return exists(select 1 from public.assessments as assessments where assessments.id=source
      and assessments.status='assigned' and assessments.due_at>statement_timestamp()
      and extract(epoch from assessments.due_at)::text=version_text);
  elsif kind='milestone_risk' then
    if version_text !~ '^\d+:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}$' then return false; end if;
    revision_no:=split_part(version_text,':',1)::integer;
    milestone_id:=split_part(version_text,':',2);
    target_day:=split_part(version_text,':',3)::date;
    return target_day<=utc_today+1 and exists(
      select 1 from public.study_plans as plans join public.study_plan_revisions as revisions
        on revisions.plan_id=plans.id and revisions.revision_no=plans.current_revision,
        lateral jsonb_array_elements(revisions.goals) as goals(goal),
        lateral jsonb_array_elements(goals.goal->'milestones') as milestones(milestone)
      where plans.id=source and plans.status='active' and plans.current_revision=revision_no
        and milestones.milestone->>'id'=milestone_id
        and milestones.milestone->>'targetDate'=target_day::text
        and milestones.milestone->>'status' in ('planned','in_progress','blocked')
    );
  end if;
  return false;
exception when others then return false;
end;
$$;

create or replace function private.on_booking_event_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare student uuid; tutor_user uuid;
begin
  select bookings.student_id,tutors.user_id into student,tutor_user from public.bookings as bookings
    join public.tutor_profiles as tutors on tutors.id=bookings.tutor_id where bookings.id=new.booking_id;
  if student is not null then
    perform private.enqueue_notification('booking-event:'||new.id||':'||student,student,'booking','Booking update',
      'Your tutoring booking has an update.','/bookings',statement_timestamp(),new.booking_id,new.booking_version);
  end if;
  if tutor_user is not null and tutor_user<>student then
    perform private.enqueue_notification('booking-event:'||new.id||':'||tutor_user,tutor_user,'booking','Booking update',
      'Your tutoring booking has an update.','/bookings',statement_timestamp(),new.booking_id,new.booking_version);
  end if;
  if new.to_state='completed' and student is not null then
    perform private.enqueue_notification('review-prompt:'||new.booking_id||':'||student,student,'review',
      'Share session feedback','A completed tutoring session is ready for your review.','/reviews');
  end if;
  return new;
end;
$$;

create or replace function private.on_assessment_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tutor_user uuid;
begin
  if tg_op='INSERT' then
    if new.status='assigned' then perform private.enqueue_notification('assessment-assigned:'||new.id||':'||new.updated_at,
      new.student_id,'assessment','Assessment assigned','A tutor assigned an assessment.','/assessments'); end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status='assigned' then
      perform private.enqueue_notification('assessment-assigned:'||new.id||':'||new.updated_at,new.student_id,
        'assessment','Assessment assigned','A tutor assigned an assessment.','/assessments');
    elsif new.status='submitted' then
      select user_id into tutor_user from public.tutor_profiles where id=new.tutor_id;
      perform private.enqueue_notification('assessment-submitted:'||new.id||':'||new.updated_at,tutor_user,
        'assessment','Assessment submitted','A learner submitted an assessment for review.','/assessments');
    elsif new.status='scored' then
      perform private.enqueue_notification('assessment-scored:'||new.id||':'||new.updated_at,new.student_id,
        'assessment','Assessment scored','Your tutor scored an assessment.','/assessments');
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.on_assignment_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tutor_user uuid;
begin
  if tg_op='INSERT' then
    if new.status='assigned' then perform private.enqueue_notification('assignment-assigned:'||new.id||':'||new.updated_at,
      new.student_id,'assignment','Assignment assigned','A tutor assigned an assignment.','/assignments'); end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status='assigned' then
      perform private.enqueue_notification('assignment-assigned:'||new.id||':'||new.updated_at,new.student_id,
        'assignment','Assignment assigned','A tutor assigned an assignment.','/assignments');
    elsif new.status='submitted' then
      select user_id into tutor_user from public.tutor_profiles where id=new.tutor_id;
      perform private.enqueue_notification('assignment-submitted:'||new.id||':'||new.updated_at,tutor_user,
        'assignment','Assignment submitted','A learner submitted work for review.','/assignments');
    elsif new.status in ('returned','completed') then
      perform private.enqueue_notification('assignment-returned:'||new.id||':'||new.updated_at,new.student_id,
        'assignment','Assignment feedback ready','Your tutor returned feedback on an assignment.','/assignments');
    end if;
  end if;
  return new;
end;
$$;

create function private.on_review_moderation_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform private.enqueue_notification('review-moderation:'||new.id||':'||new.status,new.student_id,'review',
      'Review moderation update',case when new.status='visible' then 'Your review is visible.' else 'Your review is hidden after moderation.' end,'/reviews');
  end if;
  return new;
end;
$$;
create trigger review_moderation_notice after update of status on public.reviews
  for each row execute function private.on_review_moderation_notice();

create function private.on_safety_resolution_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state is distinct from old.state and new.state in ('resolved','dismissed') then
    perform private.enqueue_notification('safety-outcome:'||new.id||':'||new.state,new.reporter_id,'safety',
      'Safety report update','Your safety report has been reviewed.','/support');
  end if;
  return new;
end;
$$;
create trigger safety_resolution_notice after update of state on public.safety_reports
  for each row execute function private.on_safety_resolution_notice();

create function public.enqueue_learning_notices() returns integer
language plpgsql security definer set search_path = '' as $$
declare item record; plan_row record; risk_row record; offset_minutes integer; due_at timestamptz;
  dedup text; next_source_version text; queued integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
  for item in select assignments.id,assignments.student_id,assignments.due_at
    from public.assignments as assignments where assignments.status='assigned'
      and assignments.due_at>statement_timestamp() and assignments.due_at<=statement_timestamp()+interval '25 hours'
      and not exists(select 1 from private.notification_outbox as notices where notices.source_kind='assignment_due'
        and notices.source_id=assignments.id and notices.source_version=extract(epoch from assignments.due_at)::text)
    order by assignments.due_at,assignments.id limit 250
  loop
    next_source_version:=extract(epoch from item.due_at)::text;
    foreach offset_minutes in array array[1440,60] loop
      due_at:=greatest(statement_timestamp(),item.due_at-make_interval(mins=>offset_minutes));
      dedup:='assignment-due:'||item.id||':'||offset_minutes||':'||next_source_version;
      perform private.enqueue_notification(dedup,item.student_id,'assignment','Assignment due soon',
        case when offset_minutes=1440 then 'An assignment is due within 24 hours.' else 'An assignment is due within one hour.' end,
        '/assignments',due_at);
      update private.notification_outbox set source_kind='assignment_due',source_id=item.id,source_version=next_source_version
        where dedup_key=dedup;
      queued:=queued+1;
    end loop;
  end loop;
  for item in select assessments.id,assessments.student_id,assessments.due_at
    from public.assessments as assessments where assessments.status='assigned' and assessments.due_at is not null
      and assessments.due_at>statement_timestamp() and assessments.due_at<=statement_timestamp()+interval '25 hours'
      and not exists(select 1 from private.notification_outbox as notices where notices.source_kind='assessment_due'
        and notices.source_id=assessments.id and notices.source_version=extract(epoch from assessments.due_at)::text)
    order by assessments.due_at,assessments.id limit 250
  loop
    next_source_version:=extract(epoch from item.due_at)::text;
    foreach offset_minutes in array array[1440,60] loop
      due_at:=greatest(statement_timestamp(),item.due_at-make_interval(mins=>offset_minutes));
      dedup:='assessment-due:'||item.id||':'||offset_minutes||':'||next_source_version;
      perform private.enqueue_notification(dedup,item.student_id,'assessment','Assessment due soon',
        case when offset_minutes=1440 then 'An assessment is due within 24 hours.' else 'An assessment is due within one hour.' end,
        '/assessments',due_at);
      update private.notification_outbox set source_kind='assessment_due',source_id=item.id,source_version=next_source_version
        where dedup_key=dedup;
      queued:=queued+1;
    end loop;
  end loop;
  for plan_row in select plans.id as plan_id,plans.student_id,plans.current_revision,revisions.goals
    from public.study_plans as plans join public.study_plan_revisions as revisions
      on revisions.plan_id=plans.id and revisions.revision_no=plans.current_revision
    where plans.status='active' and exists(
      select 1 from jsonb_array_elements(revisions.goals) as goals(goal),
        jsonb_array_elements(goals.goal->'milestones') as milestones(milestone)
      where milestones.milestone->>'status' in ('planned','in_progress','blocked')
        and coalesce(milestones.milestone->>'targetDate','') ~ '^\d{4}-\d{2}-\d{2}$'
        and (milestones.milestone->>'targetDate')::date<=timezone('UTC',statement_timestamp())::date+1
        and not exists(select 1 from private.notification_outbox as notices
          where notices.dedup_key='milestone-risk:'||plans.id||':'||plans.current_revision||':'||
            (milestones.milestone->>'id')||':'||(milestones.milestone->>'targetDate'))
    ) order by plans.updated_at,plans.id limit 250
  loop
    for risk_row in select plan_row.plan_id,plan_row.student_id,plan_row.current_revision,
      milestones.milestone->>'id' as milestone_id,(milestones.milestone->>'targetDate')::date as target_date
      from jsonb_array_elements(plan_row.goals) as goals(goal),jsonb_array_elements(goals.goal->'milestones') as milestones(milestone)
      where milestones.milestone->>'status' in ('planned','in_progress','blocked')
        and coalesce(milestones.milestone->>'targetDate','') ~ '^\d{4}-\d{2}-\d{2}$'
        and (milestones.milestone->>'targetDate')::date<=timezone('UTC',statement_timestamp())::date+1
    loop
      next_source_version:=risk_row.current_revision||':'||risk_row.milestone_id||':'||risk_row.target_date::text;
      dedup:='milestone-risk:'||risk_row.plan_id||':'||next_source_version;
      perform private.enqueue_notification(dedup,risk_row.student_id,'study_plan','Study milestone needs attention',
        'A planned milestone is due soon or overdue. Review your study plan.','/study-plans');
      update private.notification_outbox set source_kind='milestone_risk',source_id=risk_row.plan_id,source_version=next_source_version
        where dedup_key=dedup;
      queued:=queued+1;
    end loop;
  end loop;
  return queued;
end;
$$;

create or replace function public.claim_notification_outbox(batch_size integer)
returns table(id uuid,recipient_email text,category text,title text,body text,target_path text,email_enabled boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
  update private.notification_outbox as notices set state='failed',email_state='failed',updated_at=statement_timestamp()
    where notices.state='processing' and notices.updated_at<statement_timestamp()-interval '5 minutes' and notices.attempt_count>=5;
  update private.notification_outbox as notices set state='cancelled',email_state='cancelled',updated_at=statement_timestamp()
    where notices.source_kind is not null and notices.state in ('pending','processing')
      and not private.notification_source_is_current(notices.source_kind,notices.source_id,notices.source_version);
  update public.notifications as feed set delivery_state='cancelled'
    from private.notification_outbox as notices where feed.outbox_id=notices.id and notices.email_state='cancelled';
  return query with candidates as (
    select notices.id from private.notification_outbox as notices
    where (notices.state='pending' or (notices.state='processing' and notices.updated_at<statement_timestamp()-interval '5 minutes'))
      and notices.scheduled_at<=statement_timestamp() and notices.next_attempt_at<=statement_timestamp()
      and notices.attempt_count<5
      and (notices.booking_id is null or exists(select 1 from public.bookings as bookings where bookings.id=notices.booking_id))
      and (notices.reminder_offset_minutes is null or exists(select 1 from public.bookings as bookings
        where bookings.id=notices.booking_id and bookings.status='confirmed' and bookings.version=notices.booking_version))
      and (notices.source_kind is null or private.notification_source_is_current(notices.source_kind,notices.source_id,notices.source_version))
    order by notices.scheduled_at,notices.id for update skip locked limit greatest(1,least(coalesce(batch_size,50),100))
  ), claimed as (
    update private.notification_outbox as notices set state='processing',attempt_count=notices.attempt_count+1,
      updated_at=statement_timestamp() from candidates where notices.id=candidates.id returning notices.*
  ), inserted_feed as (
    insert into public.notifications(outbox_id,recipient_id,category,title,body,target_path,delivery_state)
      select claimed.id,claimed.recipient_id,claimed.category,claimed.title,claimed.body,claimed.target_path,claimed.email_state from claimed
      on conflict(outbox_id) do nothing returning outbox_id
  )
  select claimed.id,users.email::text,claimed.category,claimed.title,claimed.body,claimed.target_path,
    private.notification_required(claimed.category) or coalesce(preferences.email_enabled,false)
  from claimed join auth.users as users on users.id=claimed.recipient_id
  left join public.notification_preferences as preferences on preferences.user_id=claimed.recipient_id
    and preferences.category=claimed.category;
end;
$$;

revoke all on function private.sync_tutor_snapshot(),private.valid_booking_student_notes(jsonb),
  private.save_booking_student_notes_impl(uuid,jsonb),public.save_tutor_languages(uuid,integer,text[]),
  public.save_booking_student_notes(uuid,jsonb),public.read_tutor_booking_notes(uuid),
  public.create_booking_with_notes(uuid,uuid,timestamptz,timestamptz,text,text,jsonb),
  public.list_public_tutors_v2(text,uuid,text,bigint,bigint,numeric,text[],double precision,double precision,numeric,timestamptz,integer,text,integer,integer),
  public.list_public_tutor_reviews(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.sync_tutor_snapshot() to authenticated;
grant execute on function public.save_tutor_languages(uuid,integer,text[]),public.save_booking_student_notes(uuid,jsonb),
  public.create_booking_with_notes(uuid,uuid,timestamptz,timestamptz,text,text,jsonb) to authenticated;
grant execute on function public.read_tutor_booking_notes(uuid) to authenticated;
grant execute on function public.list_public_tutors_v2(text,uuid,text,bigint,bigint,numeric,text[],double precision,double precision,numeric,timestamptz,integer,text,integer,integer)
  to anon,authenticated;
grant execute on function public.list_public_tutor_reviews(uuid) to anon,authenticated;
revoke all on function private.valid_booking_student_notes(jsonb),private.save_booking_student_notes_impl(uuid,jsonb)
  from public,anon,authenticated,service_role;

revoke all on function private.valid_learning_interests(text[]),private.valid_tutor_languages(text[]),
  private.valid_booking_topics(text[]),private.notification_source_is_current(text,uuid,text),
  private.on_review_moderation_notice(),private.on_safety_resolution_notice(),private.on_booking_event_notice(),
  private.on_assessment_notice(),private.on_assignment_notice(),public.enqueue_learning_notices(),
  public.claim_notification_outbox(integer)
  from public,anon,authenticated,service_role;
grant execute on function private.valid_learning_interests(text[]),private.valid_tutor_languages(text[]),
  private.valid_booking_topics(text[]) to authenticated;
grant execute on function public.enqueue_learning_notices(),public.claim_notification_outbox(integer) to service_role;

commit;
