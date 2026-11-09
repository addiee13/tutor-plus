begin;
set local search_path = public, extensions, pg_catalog;

-- Each admin edit creates an immutable assessment-template version.
create table private.assessment_template_versions (
  template_id uuid not null,
  version_no integer not null check (version_no between 1 and 100000),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 4000),
  subject_id uuid references public.subjects(id) on delete restrict,
  purpose text not null check (purpose in ('diagnostic','pre_session','post_session','milestone')),
  questions jsonb not null check (jsonb_typeof(questions)='array' and octet_length(questions::text)<=524288),
  active boolean not null,
  created_by uuid references public.profiles(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default statement_timestamp(),
  primary key (template_id,version_no)
);
revoke all on private.assessment_template_versions from public,anon,authenticated,service_role;

create function private.valid_assessment_template_questions(items jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb; payload jsonb;
begin
  if items is null or jsonb_typeof(items) is distinct from 'array'
    or jsonb_array_length(items) not between 1 and 100 then return false; end if;
  if exists(select 1 from jsonb_array_elements(items) as rows(item)
    where jsonb_typeof(rows.item) is distinct from 'object'
      or nullif(btrim(rows.item->>'topic'),'') is null or length(rows.item->>'topic')>200) then return false; end if;
  payload:=jsonb_build_object('title','Assessment template','purpose','diagnostic','questions',items);
  return private.valid_assessment_payload(payload);
exception when others then return false;
end;
$$;

create function private.reject_assessment_template_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Assessment template versions are immutable' using errcode='22023';
end;
$$;
create trigger assessment_template_versions_immutable before update or delete on private.assessment_template_versions
for each row execute function private.reject_assessment_template_mutation();

create function public.save_assessment_template(
  p_template uuid,p_expected_version integer,p_title text,p_description text,p_subject uuid,p_purpose text,
  p_questions jsonb,p_active boolean,p_confirmed boolean,p_reason text
) returns table(template_id uuid,version_no integer)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.assert_administrator(); selected_id uuid:=coalesce(p_template,gen_random_uuid());
  current_version integer; next_version integer;
begin
  if p_confirmed is not true or p_reason is null or length(btrim(p_reason)) not between 1 and 500
    or p_title is null or length(btrim(p_title)) not between 1 and 200
    or p_description is null or length(p_description)>4000
    or (p_subject is not null and not exists(select 1 from public.subjects where id=p_subject and active))
    or p_purpose not in ('diagnostic','pre_session','post_session','milestone')
    or p_active is null or not private.valid_assessment_template_questions(p_questions) then
    raise exception 'Invalid assessment template' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(selected_id::text,0));
  select max(versions.version_no) into current_version from private.assessment_template_versions as versions
    where versions.template_id=selected_id;
  if p_template is null then
    if current_version is not null or p_expected_version is not null then raise exception 'Template version conflict' using errcode='40001'; end if;
    next_version:=1;
  else
    if current_version is null then raise exception 'Unknown template' using errcode='22023'; end if;
    if p_expected_version is distinct from current_version then raise exception 'Template version conflict' using errcode='40001'; end if;
    next_version:=current_version+1;
  end if;
  insert into private.assessment_template_versions(template_id,version_no,title,description,subject_id,purpose,questions,active,created_by,reason)
  values(selected_id,next_version,btrim(p_title),p_description,p_subject,p_purpose,p_questions,p_active,actor,btrim(p_reason));
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,reason,safe_metadata)
  values(actor,'assessment.template_version_saved','assessment_templates',selected_id,btrim(p_reason),
    jsonb_build_object('version',next_version,'active',p_active,'subject_id',p_subject));
  return query select selected_id,next_version;
end;
$$;

create function public.admin_read_assessment_templates(page_size integer default 100,page_offset integer default 0)
returns table(template_id uuid,version_no integer,title text,description text,subject_id uuid,purpose text,active boolean,questions jsonb,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_administrator();
  return query select current.template_id,current.version_no,current.title,current.description,current.subject_id,current.purpose,
    current.active,current.questions,current.created_at
  from private.assessment_template_versions as current
  where current.version_no=(select max(latest.version_no) from private.assessment_template_versions as latest where latest.template_id=current.template_id)
  order by current.created_at desc,current.template_id
  limit greatest(1,least(coalesce(page_size,100),200)) offset greatest(0,least(coalesce(page_offset,0),100000));
end;
$$;

create function public.tutor_read_assessment_templates(selected_booking uuid)
returns table(template_id uuid,version_no integer,title text,description text,subject_id uuid,purpose text,questions jsonb,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare selected_subject uuid;
begin
  if not private.active_actor() or not private.has_role('tutor') then raise exception 'Not authorized' using errcode='42501'; end if;
  select bookings.subject_id into selected_subject from public.bookings as bookings
    where bookings.id=selected_booking and private.owns_tutor(bookings.tutor_id);
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  return query select current.template_id,current.version_no,current.title,current.description,current.subject_id,current.purpose,current.questions,current.created_at
  from private.assessment_template_versions as current
  where current.active and (current.subject_id is null or current.subject_id=selected_subject)
    and current.version_no=(select max(latest.version_no) from private.assessment_template_versions as latest where latest.template_id=current.template_id)
  order by current.title,current.template_id limit 200;
end;
$$;

alter table public.assessments add column template_id uuid;
alter table public.assessments add column template_version integer;
alter table public.assessments add constraint assessments_template_source_pair
  check ((template_id is null and template_version is null) or (template_id is not null and template_version is not null));
alter table public.assessments add constraint assessments_template_source_fk
  foreign key (template_id,template_version) references private.assessment_template_versions(template_id,version_no) on delete restrict;

create function private.guard_assessment_template_source() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' and (new.template_id is not null or new.template_version is not null) then
    raise exception 'Template provenance is assigned by the template RPC' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.template_id,new.template_version) is distinct from (old.template_id,old.template_version) then
    if old.template_id is not null or old.status<>'draft' or new.status<>'draft'
      or new.template_id is null or new.template_version is null or not private.owns_tutor(new.tutor_id)
      or not exists(select 1 from private.assessment_template_versions as versions
        where versions.template_id=new.template_id and versions.version_no=new.template_version) then
      raise exception 'Assessment template provenance is immutable' using errcode='42501'; end if;
  end if;
  return new;
end;
$$;
create trigger assessment_template_source_guard before insert or update on public.assessments
for each row execute function private.guard_assessment_template_source();

create function public.create_assessment_from_template(selected_template uuid,selected_booking uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected_booking_row public.bookings; selected_tutor public.tutor_profiles;
  selected_template_row private.assessment_template_versions; assessment_id uuid; payload jsonb;
begin
  if not private.active_actor() or not private.has_role('tutor') then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into selected_booking_row from public.bookings as bookings where bookings.id=selected_booking for update;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into selected_tutor from public.tutor_profiles as tutors where tutors.id=selected_booking_row.tutor_id
    and private.owns_tutor(tutors.id);
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into selected_template_row from private.assessment_template_versions as templates
    where templates.template_id=selected_template and templates.version_no=(
      select max(latest.version_no) from private.assessment_template_versions as latest where latest.template_id=selected_template)
      and templates.active and (templates.subject_id is null or templates.subject_id=selected_booking_row.subject_id);
  if not found then raise exception 'Template unavailable for this booking' using errcode='22023'; end if;
  payload:=jsonb_build_object('title',selected_template_row.title,'instructions',nullif(selected_template_row.description,''),
    'purpose',selected_template_row.purpose,'due_at',null,'questions',selected_template_row.questions);
  assessment_id:=public.create_tagged_learning_assessment(selected_tutor.id,selected_booking_row.student_id,
    selected_booking_row.subject_id,selected_booking_row.id,payload);
  update public.assessments set template_id=selected_template_row.template_id,template_version=selected_template_row.version_no where id=assessment_id;
  return assessment_id;
end;
$$;

-- Versioned facts are strictly whitelisted; administrators cannot store SQL expressions or private attributes.
create table private.badge_policy_versions (
  version integer primary key check(version between 1 and 100000),
  thresholds jsonb not null check(jsonb_typeof(thresholds)='array' and jsonb_array_length(thresholds) between 1 and 12),
  created_by uuid references public.profiles(id) on delete restrict,
  reason text not null check(length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default statement_timestamp()
);
revoke all on private.badge_policy_versions from public,anon,authenticated,service_role;
insert into private.badge_policy_versions(version,thresholds,reason) values(1,
  '[{"fact":"completed_sessions","threshold":1,"label":"Completed sessions"},
    {"fact":"visible_reviews","threshold":5,"label":"5+ visible reviews"},
    {"fact":"rating_average","threshold":4.5,"label":"4.5+ visible rating"},
    {"fact":"recommendations","threshold":5,"label":"5+ learner recommendations"}]'::jsonb,
  'Initial bounded factual badge rules');

create function private.valid_badge_thresholds(items jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb; fact_name text; threshold_value numeric;
begin
  if items is null or jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 12 then return false; end if;
  if (select count(distinct value->>'fact') from jsonb_array_elements(items) as rows(value))<>jsonb_array_length(items) then return false; end if;
  for item in select value from jsonb_array_elements(items) loop
    fact_name:=item->>'fact';
    if fact_name not in ('completed_sessions','visible_reviews','rating_average','recommendations')
      or jsonb_typeof(item->'threshold') is distinct from 'number'
      or nullif(btrim(item->>'label'),'') is null or length(item->>'label')>120 then return false; end if;
    threshold_value:=(item->>'threshold')::numeric;
    if (fact_name='rating_average' and threshold_value not between 1 and 5)
      or (fact_name<>'rating_average' and (threshold_value<1 or threshold_value>100000 or trunc(threshold_value)<>threshold_value)) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create function public.admin_read_badge_policy()
returns table(version integer,thresholds jsonb,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_administrator();
  return query select policies.version,policies.thresholds,policies.created_at from private.badge_policy_versions as policies order by policies.version desc limit 1;
end;
$$;

create function public.save_badge_policy(expected_version integer,thresholds jsonb,confirmed boolean,reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.assert_administrator(); current_version integer; next_version integer;
begin
  if confirmed is not true or reason is null or length(btrim(reason)) not between 1 and 500
    or not private.valid_badge_thresholds(thresholds) then raise exception 'Invalid badge policy' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(93126021);
  select max(policies.version) into current_version from private.badge_policy_versions as policies;
  if expected_version is distinct from current_version then raise exception 'Badge policy version conflict' using errcode='40001'; end if;
  next_version:=current_version+1;
  insert into private.badge_policy_versions(version,thresholds,created_by,reason) values(next_version,save_badge_policy.thresholds,actor,btrim(reason));
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,reason,safe_metadata)
    values(actor,'reputation.badge_policy_saved','badge_policy_versions',null,btrim(reason),jsonb_build_object('version',next_version));
  return next_version;
end;
$$;

create function public.list_public_tutor_badges(tutors uuid[])
returns table(tutor_id uuid,policy_version integer,badges jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare selected_policy private.badge_policy_versions;
begin
  if cardinality(tutors)>50 then raise exception 'Too many tutors' using errcode='22023'; end if;
  select * into selected_policy from private.badge_policy_versions as policies order by policies.version desc limit 1;
  return query
  with facts as (
    select selected.id as tutor_id,
      (select count(*)::integer from public.bookings as bookings where bookings.tutor_id=selected.id and bookings.status='completed') as completed_sessions,
      (select count(*)::integer from public.reviews as reviews where reviews.tutor_id=selected.id and reviews.status='visible') as visible_reviews,
      (select round(avg(reviews.rating)::numeric,2) from public.reviews as reviews where reviews.tutor_id=selected.id and reviews.status='visible') as rating_average,
      (select count(*)::integer from public.reviews as reviews where reviews.tutor_id=selected.id and reviews.status='visible' and reviews.recommended) as recommendations
    from public.tutor_profiles as selected where selected.id=any(coalesce(tutors,'{}'::uuid[])) and private.tutor_is_public(selected.id)
  )
  select facts.tutor_id,selected_policy.version,coalesce(jsonb_agg(jsonb_build_object(
      'key',threshold.value->>'fact','label',threshold.value->>'label','policyVersion',selected_policy.version,
      'fact',threshold.value->>'fact','value',case threshold.value->>'fact'
        when 'completed_sessions' then facts.completed_sessions::numeric
        when 'visible_reviews' then facts.visible_reviews::numeric when 'rating_average' then facts.rating_average
        when 'recommendations' then facts.recommendations::numeric end,
      'threshold',(threshold.value->>'threshold')::numeric
    ) order by threshold.ordinality) filter(where case threshold.value->>'fact'
        when 'completed_sessions' then facts.completed_sessions::numeric
        when 'visible_reviews' then facts.visible_reviews::numeric when 'rating_average' then facts.rating_average
        when 'recommendations' then facts.recommendations::numeric end >= (threshold.value->>'threshold')::numeric),'[]'::jsonb)
  from facts cross join lateral jsonb_array_elements(selected_policy.thresholds) with ordinality as threshold(value,ordinality)
  group by facts.tutor_id;
end;
$$;

create function public.read_own_tutor_badge_progress()
returns table(tutor_id uuid,policy_version integer,completed_sessions bigint,visible_reviews bigint,rating_average numeric,recommendations bigint,thresholds jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare selected_tutor uuid; selected_policy private.badge_policy_versions;
begin
  if not private.active_actor() or not private.has_role('tutor') then raise exception 'Not authorized' using errcode='42501'; end if;
  select tutors.id into selected_tutor from public.tutor_profiles as tutors where tutors.user_id=auth.uid();
  if selected_tutor is null then return; end if;
  select * into selected_policy from private.badge_policy_versions as policies order by policies.version desc limit 1;
  return query select selected_tutor,selected_policy.version,
    (select count(*) from public.bookings as bookings where bookings.tutor_id=selected_tutor and bookings.status='completed'),
    (select count(*) from public.reviews as reviews where reviews.tutor_id=selected_tutor and reviews.status='visible'),
    (select round(avg(reviews.rating)::numeric,2) from public.reviews as reviews where reviews.tutor_id=selected_tutor and reviews.status='visible'),
    (select count(*) from public.reviews as reviews where reviews.tutor_id=selected_tutor and reviews.status='visible' and reviews.recommended),
    selected_policy.thresholds;
end;
$$;

revoke all on function private.valid_assessment_template_questions(jsonb),private.reject_assessment_template_mutation(),
  private.guard_assessment_template_source(),private.valid_badge_thresholds(jsonb) from public,anon,authenticated;
revoke all on function public.save_assessment_template(uuid,integer,text,text,uuid,text,jsonb,boolean,boolean,text),
  public.admin_read_assessment_templates(integer,integer),public.tutor_read_assessment_templates(uuid),public.create_assessment_from_template(uuid,uuid),
  public.admin_read_badge_policy(),public.save_badge_policy(integer,jsonb,boolean,text),public.list_public_tutor_badges(uuid[]),
  public.read_own_tutor_badge_progress() from public,anon,authenticated;
grant execute on function public.save_assessment_template(uuid,integer,text,text,uuid,text,jsonb,boolean,boolean,text),
  public.admin_read_assessment_templates(integer,integer),public.tutor_read_assessment_templates(uuid),
  public.create_assessment_from_template(uuid,uuid),public.admin_read_badge_policy(),public.save_badge_policy(integer,jsonb,boolean,text),
  public.read_own_tutor_badge_progress() to authenticated;
grant execute on function public.list_public_tutor_badges(uuid[]) to anon,authenticated;

commit;
