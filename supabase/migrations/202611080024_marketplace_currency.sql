begin;
set local search_path = public, extensions, pg_catalog;

create function public.list_public_tutors_v3(
  search_query text,subject uuid,requested_mode text,min_rate bigint,max_rate bigint,min_rating numeric,
  language_tags text[],search_latitude double precision,search_longitude double precision,max_distance_km numeric,
  available_at timestamptz,duration_minutes integer,sort_by text,page_size integer,page_offset integer,
  budget_currency text default 'USD'
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
    or budget_currency is null or budget_currency !~ '^[A-Z]{3}$'
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
    -- Apply budget comparisons only in that currency; an unpriced search keeps other currencies visible.
    and ((min_rate is null and max_rate is null) or candidates.currency=budget_currency)
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
    case when sort_by='rate' and min_rate is null and max_rate is null then candidates.currency end asc nulls last,
    case when sort_by='rate' then candidates.effective_rate end asc nulls last,
    case when sort_by='name' then pg_catalog.lower(candidates.public_display_name) end asc nulls last,candidates.id
  limit page_size offset page_offset;
end;
$$;

-- Preserve the previous RPC contract with an explicit USD interpretation for existing clients.
create or replace function public.list_public_tutors_v2(
  search_query text,subject uuid,requested_mode text,min_rate bigint,max_rate bigint,min_rating numeric,
  language_tags text[],search_latitude double precision,search_longitude double precision,max_distance_km numeric,
  available_at timestamptz,duration_minutes integer,sort_by text,page_size integer,page_offset integer
) returns table(
  id uuid,public_display_name text,public_avatar_url text,headline text,bio text,credentials_text text,
  experience_years smallint,hourly_rate_minor bigint,currency char(3),supports_virtual boolean,supports_in_person boolean,
  service_area_label text,service_radius_km numeric,rating_count integer,rating_average numeric,distance_km numeric,
  subject_ids uuid[],tutor_languages text[]
)
language sql stable security definer set search_path = '' as $$
  select * from public.list_public_tutors_v3(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'USD'
  );
$$;

revoke all on function public.list_public_tutors_v3(text,uuid,text,bigint,bigint,numeric,text[],double precision,double precision,numeric,timestamptz,integer,text,integer,integer,text),
  public.list_public_tutors_v2(text,uuid,text,bigint,bigint,numeric,text[],double precision,double precision,numeric,timestamptz,integer,text,integer,integer)
from public,anon,authenticated,service_role;
grant execute on function public.list_public_tutors_v3(text,uuid,text,bigint,bigint,numeric,text[],double precision,double precision,numeric,timestamptz,integer,text,integer,integer,text),
  public.list_public_tutors_v2(text,uuid,text,bigint,bigint,numeric,text[],double precision,double precision,numeric,timestamptz,integer,text,integer,integer)
to anon,authenticated;

commit;
