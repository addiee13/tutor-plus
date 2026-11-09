begin;
set local search_path = public, extensions, pg_catalog;

-- A definition version is an immutable snapshot of the assigned prompt, questions, and private answer keys.
-- Existing assigned assessments have always frozen this definition; version 1 is a faithful snapshot of that
-- immutable state and existing attempts are backfilled to the same version without changing scores or answers.
alter table public.assessments add column if not exists definition_version integer not null default 0
  check (definition_version between 0 and 100000);

create table public.assessment_definition_versions (
  assessment_id uuid not null references public.assessments(id) on delete restrict,
  version_no integer not null check (version_no between 1 and 100000),
  definition jsonb not null check (jsonb_typeof(definition)='object' and octet_length(definition::text)<=524288),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  primary key (assessment_id,version_no)
);

create function private.assessment_definition_snapshot(selected_assessment uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'title',assessments.title,
    'instructions',assessments.instructions,
    'purpose',assessments.purpose,
    'due_at',assessments.due_at,
    'questions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',questions.id,'position',questions.position,'prompt',questions.prompt,'kind',questions.kind,
        'choices',questions.choices,'points',questions.points,'correct_choice',answer_keys.correct_choice
      ) order by questions.position)
      from public.assessment_questions as questions
      left join public.assessment_answer_keys as answer_keys on answer_keys.question_id=questions.id
      where questions.assessment_id=assessments.id
    ),'[]'::jsonb)
  ) from public.assessments as assessments where assessments.id=selected_assessment;
$$;

-- Preserve historical definitions and attempt provenance. A draft has no assigned definition (version 0).
insert into public.assessment_definition_versions(assessment_id,version_no,definition,created_by,created_at)
select assessments.id,1,private.assessment_definition_snapshot(assessments.id),tutors.user_id,coalesce(assessments.assigned_at,assessments.created_at)
from public.assessments as assessments
join public.tutor_profiles as tutors on tutors.id=assessments.tutor_id
where assessments.status<>'draft'
on conflict (assessment_id,version_no) do nothing;
update public.assessments set definition_version=1 where status<>'draft' and definition_version=0;
alter table public.assessments add constraint assessments_definition_version_state_check
  check ((status='draft' and definition_version=0) or (status<>'draft' and definition_version>=1));

alter table public.assessment_attempts add column if not exists definition_version integer not null default 1
  check (definition_version between 1 and 100000);
update public.assessment_attempts as attempts set definition_version=assessments.definition_version
from public.assessments as assessments where assessments.id=attempts.assessment_id
  and attempts.definition_version is distinct from assessments.definition_version;
alter table public.assessment_attempts add constraint assessment_attempts_definition_version_fk
  foreign key (assessment_id,definition_version)
  references public.assessment_definition_versions(assessment_id,version_no) on delete restrict;

create function private.guard_assessment_definition_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected public.assessments;
begin
  if tg_op<>'INSERT' then raise exception 'Assessment definition versions are immutable' using errcode='22023'; end if;
  select * into selected from public.assessments where id=new.assessment_id for update;
  if not found or selected.status<>'draft' or not private.owns_tutor(selected.tutor_id)
    or new.created_by<>auth.uid() or new.version_no<>selected.definition_version+1
    or new.definition is distinct from private.assessment_definition_snapshot(selected.id) then
    raise exception 'Definition version must snapshot the current tutor-owned draft' using errcode='42501';
  end if;
  new.created_at:=statement_timestamp();
  return new;
end;
$$;
create trigger assessment_definition_versions_guard before insert or update or delete on public.assessment_definition_versions
for each row execute function private.guard_assessment_definition_snapshot();

create function private.guard_assessment_definition_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' then
    if new.status<>'draft' or new.definition_version<>0 then raise exception 'New assessments start without an assigned definition' using errcode='22023'; end if;
    return new;
  end if;
  if old.status='draft' and new.status='assigned' then
    if new.definition_version<>old.definition_version+1 or not exists (
      select 1 from public.assessment_definition_versions as versions
      where versions.assessment_id=new.id and versions.version_no=new.definition_version) then
      raise exception 'Assignment requires an immutable definition snapshot' using errcode='22023';
    end if;
  elsif new.definition_version is distinct from old.definition_version then
    raise exception 'Assigned assessment definition version is immutable' using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger assessments_definition_version_guard before insert or update on public.assessments
for each row execute function private.guard_assessment_definition_version();

create or replace function public.assign_learning_assessment(assessment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare selected public.assessments; next_version integer;
begin
  select * into selected from public.assessments where id=assessment for update;
  if not found or not private.owns_tutor(selected.tutor_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  if selected.status<>'draft' then raise exception 'Only draft assessments can be assigned' using errcode='22023'; end if;
  if not exists(select 1 from public.assessment_questions where assessment_id=selected.id)
    or exists(select 1 from public.assessment_questions as questions
      left join public.assessment_answer_keys as keys on keys.question_id=questions.id
      where questions.assessment_id=selected.id and questions.kind='single_choice' and keys.question_id is null) then
    raise exception 'Assign requires questions and keys for every choice question' using errcode='22023';
  end if;
  next_version:=selected.definition_version+1;
  insert into public.assessment_definition_versions(assessment_id,version_no,definition,created_by)
  values(selected.id,next_version,private.assessment_definition_snapshot(selected.id),auth.uid());
  update public.assessments set status='assigned',definition_version=next_version where id=selected.id;
end;
$$;

create function private.guard_attempt_definition_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected public.assessments;
begin
  if tg_op='INSERT' then
    select * into selected from public.assessments where id=new.assessment_id;
    if not found or selected.definition_version<1 or selected.status not in ('assigned','submitted','scored')
      or not exists(select 1 from public.assessment_definition_versions as versions
        where versions.assessment_id=selected.id and versions.version_no=selected.definition_version) then
      raise exception 'Attempt requires an assigned definition version' using errcode='22023';
    end if;
    new.definition_version:=selected.definition_version;
  elsif new.definition_version is distinct from old.definition_version then
    raise exception 'Attempt definition provenance is immutable' using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger assessment_attempts_definition_version_guard before insert or update on public.assessment_attempts
for each row execute function private.guard_attempt_definition_version();

alter table public.assessment_definition_versions enable row level security;
revoke all on public.assessment_definition_versions from public,anon,authenticated,service_role;
grant select on public.assessment_definition_versions to authenticated;
create policy assessment_definition_versions_tutor_read on public.assessment_definition_versions for select to authenticated
  using (exists(select 1 from public.assessments as assessments where assessments.id=assessment_id and private.owns_tutor(assessments.tutor_id)));
revoke all on function private.assessment_definition_snapshot(uuid),private.guard_assessment_definition_snapshot(),
  private.guard_assessment_definition_version(),private.guard_attempt_definition_version() from public,anon,authenticated;

commit;
