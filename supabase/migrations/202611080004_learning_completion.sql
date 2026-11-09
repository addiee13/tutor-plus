begin;
set local search_path = public, extensions, pg_catalog;

-- Repair two PL/pgSQL name collisions that made valid assessment drafts fail at the SQL boundary.
create or replace function private.valid_assessment_payload(payload jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb; selected_choice text; points integer;
begin
  if payload is null or jsonb_typeof(payload) is distinct from 'object'
    or jsonb_typeof(payload -> 'questions') is distinct from 'array' then return false; end if;
  if jsonb_array_length(payload -> 'questions') not between 1 and 100 then return false; end if;
  if nullif(btrim(payload ->> 'title'), '') is null or length(payload ->> 'title') > 200 then return false; end if;
  if coalesce(payload ->> 'purpose', '') not in ('diagnostic', 'pre_session', 'post_session', 'milestone') then return false; end if;
  if payload -> 'instructions' is not null and payload -> 'instructions' <> 'null'::jsonb
    and length(payload ->> 'instructions') > 4000 then return false; end if;
  for item in select value from jsonb_array_elements(payload -> 'questions') loop
    if jsonb_typeof(item) <> 'object' or nullif(btrim(item ->> 'prompt'), '') is null
      or length(item ->> 'prompt') > 2000 or item ->> 'kind' not in ('single_choice', 'short_answer')
      or coalesce(item ->> 'points', '') !~ '^\d+$' then return false; end if;
    points := (item ->> 'points')::integer;
    if points not between 1 and 100 then return false; end if;
    if item ->> 'kind' = 'single_choice' then
      if jsonb_typeof(item -> 'choices') is distinct from 'array'
        or jsonb_array_length(item -> 'choices') not between 2 and 10
        or nullif(item ->> 'correct_choice', '') is null then return false; end if;
      selected_choice := item ->> 'correct_choice';
      if not exists (select 1 from jsonb_array_elements_text(item -> 'choices') as entries(answer_choice)
        where entries.answer_choice = selected_choice and length(entries.answer_choice) between 1 and 500) then return false; end if;
      if exists (select 1 from jsonb_array_elements_text(item -> 'choices') as entries(answer_choice)
        where length(entries.answer_choice) not between 1 and 500) then return false; end if;
      if (select count(distinct entries.answer_choice)
        from jsonb_array_elements_text(item -> 'choices') as entries(answer_choice)) <> jsonb_array_length(item -> 'choices') then
        return false;
      end if;
    elsif item -> 'choices' is distinct from 'null'::jsonb
      or (item ? 'correct_choice' and item -> 'correct_choice' <> 'null'::jsonb) then
      return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.create_learning_assessment(
  tutor uuid, student uuid, subject uuid, booking uuid, payload jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare created_assessment uuid; item jsonb; question_id uuid; choices jsonb; key_text text; position_no smallint := 0;
begin
  if not private.owns_tutor(tutor) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if not private.eligible_learning_student(student) or not private.tutor_student_related(tutor, student) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform private.check_learning_link(tutor, student, booking);
  if not exists (select 1 from public.tutor_subjects where tutor_id = tutor and subject_id = subject) then
    raise exception 'Subject is not offered by this tutor' using errcode = '22023';
  end if;
  if booking is not null and not exists (select 1 from public.bookings where id = booking and subject_id = subject) then
    raise exception 'Subject must match the linked booking' using errcode = '22023';
  end if;
  if not private.valid_assessment_payload(payload) then raise exception 'Invalid assessment draft' using errcode = '22023'; end if;
  insert into public.assessments(tutor_id, student_id, subject_id, booking_id, title, instructions, purpose, due_at)
  values (tutor, student, subject, booking, private.require_text(payload ->> 'title', 200, true),
    private.require_text(payload ->> 'instructions', 4000, false), payload ->> 'purpose',
    nullif(payload ->> 'due_at', '')::timestamptz)
  returning id into created_assessment;
  for item in select value from jsonb_array_elements(payload -> 'questions') with ordinality as entries(value, ord) order by ord loop
    position_no := position_no + 1;
    choices := case when item -> 'choices' is null or item -> 'choices' = 'null'::jsonb then null else item -> 'choices' end;
    insert into public.assessment_questions(assessment_id, position, prompt, kind, choices, points)
    values (created_assessment, position_no, private.require_text(item ->> 'prompt', 2000, true), item ->> 'kind',
      choices, (item ->> 'points')::smallint)
    returning id into question_id;
    key_text := nullif(item ->> 'correct_choice', '');
    if key_text is not null then
      insert into public.assessment_answer_keys(question_id, correct_choice) values (question_id, key_text);
    end if;
  end loop;
  return created_assessment;
end;
$$;

-- Exact duplicate finalization is idempotent; a changed payload remains an explicit conflict.
create or replace function public.submit_assessment_attempt(assessment uuid, answers jsonb, finalize boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  selected public.assessments;
  existing public.assessment_attempts;
  attempt_id uuid;
  next_no integer;
  objective integer;
  maximum integer;
  has_subjective boolean;
  entry record;
  question public.assessment_questions;
begin
  if not private.has_role('student') then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into selected from public.assessments as records where records.id = submit_assessment_attempt.assessment for update;
  if not found or selected.student_id <> auth.uid() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if answers is null or jsonb_typeof(answers) <> 'object' or octet_length(answers::text) > 65536 or finalize is null then
    raise exception 'Invalid answers' using errcode = '22023';
  end if;
  for entry in select key, value from jsonb_each(answers) loop
    if entry.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Invalid question answer' using errcode = '22023';
    end if;
    select * into question from public.assessment_questions as questions
      where questions.id = entry.key::uuid and questions.assessment_id = selected.id;
    if not found or jsonb_typeof(entry.value) <> 'string' or length(entry.value #>> '{}') > 4000 then
      raise exception 'Invalid question answer' using errcode = '22023';
    end if;
    if question.kind = 'single_choice' and entry.value #>> '{}' <> ''
      and not (question.choices ? (entry.value #>> '{}')) then
      raise exception 'Answer is not one of the available choices' using errcode = '22023';
    end if;
  end loop;
  if selected.status in ('submitted', 'scored') then
    select * into existing from public.assessment_attempts as attempts
      where attempts.assessment_id = selected.id and attempts.student_id = auth.uid()
      order by attempts.attempt_no desc limit 1;
    if finalize and found and existing.status in ('submitted', 'scored') and existing.answers = answers then
      return existing.id;
    end if;
    raise exception 'Finalized attempt cannot be changed' using errcode = '22023';
  end if;
  if selected.status <> 'assigned' then raise exception 'Assessment is not open for an attempt' using errcode = '22023'; end if;
  if selected.due_at is not null and selected.due_at < statement_timestamp() then
    raise exception 'Assessment is closed' using errcode = '22023';
  end if;
  select * into existing from public.assessment_attempts as attempts where attempts.assessment_id = selected.id
    and attempts.student_id = auth.uid() and attempts.status = 'in_progress' for update;
  if found then
    update public.assessment_attempts set answers = submit_assessment_attempt.answers where id = existing.id returning id into attempt_id;
  else
    if (select count(*) from public.assessment_attempts as attempts where attempts.assessment_id = selected.id and attempts.student_id = auth.uid()) >= 20
      or exists (select 1 from public.assessment_attempts as attempts where attempts.assessment_id = selected.id and attempts.status <> 'scored') then
      raise exception 'A tutor must authorize each new retake after the previous attempt is scored' using errcode = '22023';
    end if;
    select coalesce(max(attempts.attempt_no), 0) + 1 into next_no from public.assessment_attempts as attempts
      where attempts.assessment_id = selected.id and attempts.student_id = auth.uid();
    insert into public.assessment_attempts(assessment_id, student_id, attempt_no, answers)
    values (selected.id, auth.uid(), next_no, submit_assessment_attempt.answers) returning id into attempt_id;
  end if;
  if finalize then
    select coalesce(sum(questions.points) filter (where keys.correct_choice = submit_assessment_attempt.answers ->> questions.id::text), 0),
      sum(questions.points), bool_or(questions.kind = 'short_answer')
    into objective, maximum, has_subjective
    from public.assessment_questions as questions
    left join public.assessment_answer_keys as keys on keys.question_id = questions.id
    where questions.assessment_id = selected.id;
    update public.assessment_attempts set status = case when has_subjective then 'submitted' else 'scored' end,
      auto_score = objective, max_score = maximum, submitted_at = statement_timestamp(),
      score = case when has_subjective then null else objective end,
      scored_at = case when has_subjective then null else statement_timestamp() end
    where id = attempt_id;
    update public.assessments set status = case when has_subjective then 'submitted' else 'scored' end where id = selected.id;
  end if;
  return attempt_id;
end;
$$;

-- Storage preflight reports the full multipart request length. The storage bucket and final DB check enforce
-- the actual 10 MiB file limit; a declared actual object size, when present, remains authoritative.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists assignment_submissions_upload on storage.objects';
    execute $policy$
      create policy assignment_submissions_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'assignment-submissions' and private.assignment_file_uploadable(name)
        and metadata ->> 'mimetype' in ('application/pdf', 'image/png', 'image/jpeg', 'text/plain')
        and case when metadata ? 'size'
          then (metadata ->> 'size') ~ '^[0-9]+$' and (metadata ->> 'size')::bigint between 1 and 10485760
          else (metadata ->> 'contentLength') ~ '^[0-9]+$' and (metadata ->> 'contentLength')::bigint between 1 and 12582912 end)
    $policy$;
  end if;
end;
$$;

-- Explicit close is separate from the deadline and the late-work policy. An accepted late submission is still
-- marked late by the existing immutable submission trigger; after closure the student cannot upload or submit.
alter table public.assignments add column if not exists submissions_closed_at timestamptz;
create or replace function private.assignment_file_uploadable(path text, require_open boolean default true) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare assignment_text text; student_text text; selected public.assignments;
begin
  if path !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg|txt)$' then return false; end if;
  assignment_text := split_part(path, '/', 1);
  student_text := split_part(path, '/', 2);
  if student_text <> auth.uid()::text or not private.has_role('student') then return false; end if;
  select * into selected from public.assignments where id = assignment_text::uuid;
  if not found or selected.student_id <> auth.uid() or selected.submission_type <> 'file' then return false; end if;
  if require_open and (selected.submissions_closed_at is not null or selected.status not in ('assigned', 'returned')
    or (statement_timestamp() > selected.due_at and not selected.accepts_late)) then return false; end if;
  return true;
end;
$$;

create or replace function private.guard_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected public.assignments;
begin
  select * into selected from public.assignments where id = new.assignment_id for update;
  if not found or new.student_id <> selected.student_id then raise exception 'Submission must come from the assigned student' using errcode = '22023'; end if;
  if selected.submissions_closed_at is not null or selected.status not in ('assigned', 'returned') then
    raise exception 'Assignment is closed for submissions' using errcode = '22023';
  end if;
  if statement_timestamp() > selected.due_at and not selected.accepts_late then
    raise exception 'Submission deadline has passed' using errcode = '22023';
  end if;
  if (selected.submission_type = 'link' and new.link_url is null)
    or (selected.submission_type = 'file' and new.file_path is null)
    or (selected.submission_type = 'text' and coalesce(length(btrim(new.body)), 0) = 0) then
    raise exception 'Submission does not match the required type' using errcode = '22023';
  end if;
  if selected.submission_type <> 'file' and new.file_path is not null then raise exception 'This assignment does not accept file submissions' using errcode = '22023'; end if;
  if new.file_path is not null and (new.file_path not like new.assignment_id::text || '/' || new.student_id::text || '/%'
    or new.file_mime not in ('application/pdf', 'image/png', 'image/jpeg', 'text/plain')
    or new.file_size_bytes is null or new.file_size_bytes not between 1 and 10485760
    or not private.assignment_storage_object_matches(new.file_path, new.file_mime, new.file_size_bytes)) then
    raise exception 'File must be a private uploaded object owned by the assigned student' using errcode = '22023';
  end if;
  new.is_late := statement_timestamp() > selected.due_at;
  new.submitted_at := statement_timestamp();
  new.attempt_no := coalesce((select max(attempt_no) from public.assignment_submissions where assignment_id = new.assignment_id), 0) + 1;
  return new;
end;
$$;

create function public.close_assignment_submissions(assignment uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare selected public.assignments; closed_at timestamptz;
begin
  select * into selected from public.assignments where id = assignment for update;
  if not found or not private.owns_tutor(selected.tutor_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if selected.status not in ('assigned', 'submitted', 'returned') then raise exception 'Assignment cannot be closed for submission' using errcode = '22023'; end if;
  update public.assignments set submissions_closed_at = coalesce(submissions_closed_at, statement_timestamp())
    where id = assignment returning submissions_closed_at into closed_at;
  return closed_at;
end;
$$;

-- Structured study goal snapshots and explicit typed links. Older revisions remain readable as legacy snapshots.
create function private.valid_structured_study_goals(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare goal jsonb; milestone jsonb; link jsonb; goal_pos integer; milestone_pos integer; total integer := 0;
begin
  if not private.valid_study_goals(value) then return false; end if;
  for goal, goal_pos in select rows.value, rows.ordinality::integer from jsonb_array_elements(value) with ordinality as rows(value, ordinality) loop
    if jsonb_typeof(goal -> 'position') <> 'number' or (goal ->> 'position')::integer <> goal_pos
      or nullif(btrim(goal ->> 'topic'), '') is null or length(goal ->> 'topic') > 200
      or coalesce(goal ->> 'targetDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or nullif(btrim(goal ->> 'baseline'), '') is null or length(goal ->> 'baseline') > 2000
      or nullif(btrim(goal ->> 'schedule'), '') is null or length(goal ->> 'schedule') > 500
      or nullif(btrim(goal ->> 'successCriterion'), '') is null or length(goal ->> 'successCriterion') > 1000 then return false; end if;
    for milestone, milestone_pos in select rows.value, rows.ordinality::integer
      from jsonb_array_elements(goal -> 'milestones') with ordinality as rows(value, ordinality) loop
      total := total + 1;
      if jsonb_typeof(milestone -> 'position') <> 'number' or (milestone ->> 'position')::integer <> milestone_pos
        or coalesce(milestone ->> 'status', '') not in ('planned','in_progress','completed','blocked')
        or (milestone ? 'targetDate' and milestone -> 'targetDate' <> 'null'::jsonb
          and coalesce(milestone ->> 'targetDate','') !~ '^\d{4}-\d{2}-\d{2}$')
        or jsonb_typeof(milestone -> 'links') is distinct from 'array'
        or jsonb_array_length(milestone -> 'links') > 20 then return false; end if;
      for link in select value from jsonb_array_elements(milestone -> 'links') loop
        if coalesce(link ->> 'kind','') not in ('resource','assignment','assessment')
          or coalesce(link ->> 'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false; end if;
      end loop;
    end loop;
  end loop;
  return total <= 100;
exception when others then return false;
end;
$$;

create table public.study_plan_milestone_links (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  revision_no integer not null,
  goal_id uuid not null,
  milestone_id uuid not null,
  position smallint not null check (position between 1 and 20),
  link_kind text not null check (link_kind in ('resource','assignment','assessment')),
  resource_id uuid references public.resources(id) on delete restrict,
  assignment_id uuid references public.assignments(id) on delete restrict,
  assessment_id uuid references public.assessments(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (plan_id, revision_no) references public.study_plan_revisions(plan_id,revision_no) on delete restrict,
  check ((link_kind = 'resource' and resource_id is not null and assignment_id is null and assessment_id is null)
    or (link_kind = 'assignment' and resource_id is null and assignment_id is not null and assessment_id is null)
    or (link_kind = 'assessment' and resource_id is null and assignment_id is null and assessment_id is not null)),
  unique (plan_id,revision_no,milestone_id,position)
);
create index study_plan_milestone_links_lookup_idx on public.study_plan_milestone_links(plan_id,revision_no,milestone_id);

create function private.guard_study_plan_link() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; plan_subject uuid;
begin
  if tg_op <> 'INSERT' then raise exception 'Milestone links are immutable' using errcode = '22023'; end if;
  select * into selected from public.study_plans where id = new.plan_id;
  if not found then raise exception 'Unknown study plan' using errcode = '22023'; end if;
  plan_subject := selected.subject_id;
  if plan_subject is null and selected.booking_id is not null then select subject_id into plan_subject from public.bookings where id = selected.booking_id; end if;
  if new.link_kind = 'resource' and not exists (select 1 from public.resources as resources where resources.id = new.resource_id
      and resources.active and (resources.subject_id is null or plan_subject is null or resources.subject_id = plan_subject)) then
    raise exception 'Resource must be active and match the plan subject' using errcode = '22023';
  elsif new.link_kind = 'assignment' and not exists (select 1 from public.assignments as assignments where assignments.id = new.assignment_id
      and assignments.tutor_id = selected.tutor_id and assignments.student_id = selected.student_id and assignments.status <> 'draft'
      and (plan_subject is null or (assignments.booking_id is not null and exists (select 1 from public.bookings
        where id = assignments.booking_id and subject_id = plan_subject)))) then
    raise exception 'Assignment link must belong to the plan participants and subject' using errcode = '22023';
  elsif new.link_kind = 'assessment' and not exists (select 1 from public.assessments as assessments where assessments.id = new.assessment_id
      and assessments.tutor_id = selected.tutor_id and assessments.student_id = selected.student_id
      and (plan_subject is null or assessments.subject_id = plan_subject) and assessments.status <> 'draft') then
    raise exception 'Assessment link must belong to the plan participants and subject' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger study_plan_milestone_links_guard before insert or update or delete on public.study_plan_milestone_links
for each row execute function private.guard_study_plan_link();

create function private.populate_study_plan_links() returns trigger
language plpgsql security definer set search_path = '' as $$
declare goal jsonb; milestone jsonb; link jsonb; goal_position integer; milestone_position integer; link_position integer;
begin
  if not private.valid_structured_study_goals(new.goals) then raise exception 'Structured study goals are required' using errcode = '22023'; end if;
  for goal, goal_position in select rows.value, rows.ordinality::integer from jsonb_array_elements(new.goals) with ordinality as rows(value, ordinality) loop
    for milestone, milestone_position in select rows.value, rows.ordinality::integer from jsonb_array_elements(goal -> 'milestones') with ordinality as rows(value, ordinality) loop
      for link, link_position in select rows.value, rows.ordinality::integer from jsonb_array_elements(milestone -> 'links') with ordinality as rows(value, ordinality) loop
        insert into public.study_plan_milestone_links(plan_id,revision_no,goal_id,milestone_id,position,link_kind,resource_id,assignment_id,assessment_id)
        values (new.plan_id,new.revision_no,(goal ->> 'id')::uuid,(milestone ->> 'id')::uuid,link_position,link ->> 'kind',
          case when link ->> 'kind' = 'resource' then (link ->> 'id')::uuid end,
          case when link ->> 'kind' = 'assignment' then (link ->> 'id')::uuid end,
          case when link ->> 'kind' = 'assessment' then (link ->> 'id')::uuid end);
      end loop;
    end loop;
  end loop;
  return new;
end;
$$;
create trigger study_plan_milestone_links_populate after insert on public.study_plan_revisions
for each row execute function private.populate_study_plan_links();

create table public.study_plan_proposals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.study_plans(id) on delete restrict,
  milestone_id uuid not null,
  proposed_target_date date not null,
  summary text not null check (length(btrim(summary)) between 1 and 1000),
  proposed_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  decided_by uuid references public.profiles(id) on delete restrict,
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or length(btrim(decision_reason)) between 1 and 500),
  created_at timestamptz not null default statement_timestamp(),
  check ((status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null and decision_reason is not null))
);
create unique index study_plan_one_pending_proposal on public.study_plan_proposals(plan_id,milestone_id) where status = 'pending';

create table public.study_plan_replanning_history (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.study_plans(id) on delete restrict,
  milestone_id uuid not null,
  revision_no integer not null,
  from_target_date date,
  to_target_date date not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  authored_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (plan_id,revision_no) references public.study_plan_revisions(plan_id,revision_no) on delete restrict
);
create index study_plan_replanning_history_idx on public.study_plan_replanning_history(plan_id,created_at desc);

create function private.guard_study_plan_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans;
begin
  if tg_op <> 'INSERT' then raise exception 'Study plan revisions are immutable' using errcode = '22023'; end if;
  select * into selected from public.study_plans where id = new.plan_id;
  if not found or new.authored_by <> auth.uid() or new.revision_no <> selected.current_revision
    or not private.valid_structured_study_goals(new.goals)
    or not (private.owns_tutor(selected.tutor_id) or (private.has_role('student') and selected.student_id = auth.uid())) then
    raise exception 'Invalid revision provenance' using errcode = '42501';
  end if;
  new.title := private.require_text(new.title,200,true);
  new.description := private.require_text(new.description,4000,false);
  new.created_at := statement_timestamp();
  return new;
end;
$$;
drop trigger study_plan_revisions_guard on public.study_plan_revisions;
create trigger study_plan_revisions_guard before insert or update or delete on public.study_plan_revisions
for each row execute function private.guard_study_plan_revision();

create or replace function private.guard_study_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not private.owns_tutor(new.tutor_id) or not private.eligible_learning_student(new.student_id)
      or not private.tutor_student_related(new.tutor_id,new.student_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
    perform private.check_learning_link(new.tutor_id,new.student_id,new.booking_id);
    if new.booking_id is not null and new.subject_id is not null and not exists (select 1 from public.bookings where id=new.booking_id and subject_id=new.subject_id) then
      raise exception 'Subject must match the linked booking' using errcode = '22023'; end if;
  else
    if (new.id,new.tutor_id,new.student_id,new.subject_id,new.booking_id,new.created_at,new.status)
      is distinct from (old.id,old.tutor_id,old.student_id,old.subject_id,old.booking_id,old.created_at,old.status)
      or new.current_revision <> old.current_revision + 1 then raise exception 'Study plan identity is immutable and revisions must advance once' using errcode = '22023'; end if;
    if not (private.owns_tutor(new.tutor_id) or (private.has_role('student') and new.student_id = auth.uid())) then
      raise exception 'Not authorized' using errcode = '42501'; end if;
    perform private.check_learning_link(new.tutor_id,new.student_id,new.booking_id);
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create function private.reject_learning_history_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Learning history is immutable' using errcode = '22023'; end;
$$;
create trigger study_plan_replanning_immutable before update or delete on public.study_plan_replanning_history
for each row execute function private.reject_learning_history_mutation();
create function private.guard_study_proposal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans;
begin
  if tg_op = 'INSERT' then
    select * into selected from public.study_plans where id = new.plan_id;
    if not found or not private.owns_tutor(selected.tutor_id) or new.proposed_by <> auth.uid()
      or not exists (select 1 from public.study_plan_revisions as revisions,
        jsonb_array_elements(revisions.goals) as goals(goal), jsonb_array_elements(goals.goal -> 'milestones') as milestones(milestone)
        where revisions.plan_id = selected.id and revisions.revision_no = selected.current_revision
          and milestones.milestone ->> 'id' = new.milestone_id::text) then raise exception 'Invalid milestone proposal' using errcode = '42501'; end if;
    new.created_at := statement_timestamp();
  else
    if (new.id,new.plan_id,new.milestone_id,new.proposed_target_date,new.summary,new.proposed_by,new.created_at)
      is distinct from (old.id,old.plan_id,old.milestone_id,old.proposed_target_date,old.summary,old.proposed_by,old.created_at)
      or old.status <> 'pending' or new.status not in ('accepted','dismissed') or new.decided_by <> auth.uid() then
      raise exception 'Invalid or immutable proposal transition' using errcode = '22023'; end if;
    select * into selected from public.study_plans where id = new.plan_id;
    if not found or not (private.owns_tutor(selected.tutor_id) or (private.has_role('student') and selected.student_id = auth.uid())) then
      raise exception 'Not authorized' using errcode = '42501'; end if;
    new.decided_at := statement_timestamp();
    new.decision_reason := private.require_text(new.decision_reason,500,true);
  end if;
  return new;
end;
$$;
create trigger study_plan_proposals_guard before insert or update or delete on public.study_plan_proposals
for each row execute function private.guard_study_proposal();
create trigger study_plan_proposals_no_delete before delete on public.study_plan_proposals
for each row execute function private.reject_learning_history_mutation();

create function public.create_study_plan_proposal(study_plan uuid,milestone uuid,target_date date,summary text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; created uuid;
begin
  select * into selected from public.study_plans where id = study_plan;
  if not found or not private.owns_tutor(selected.tutor_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if selected.status <> 'active' or target_date is null or not exists (select 1 from public.study_plan_revisions as revisions,
      jsonb_array_elements(revisions.goals) as goals(goal), jsonb_array_elements(goals.goal -> 'milestones') as milestones(milestone)
      where revisions.plan_id = selected.id and revisions.revision_no = selected.current_revision and milestones.milestone ->> 'id' = milestone::text) then
    raise exception 'Milestone is not in the active plan' using errcode = '22023'; end if;
  insert into public.study_plan_proposals(plan_id,milestone_id,proposed_target_date,summary,proposed_by)
  values (study_plan,milestone,target_date,private.require_text(summary,1000,true),auth.uid()) returning id into created;
  return created;
end;
$$;

create function public.reschedule_study_milestone(study_plan uuid,milestone uuid,expected_revision integer,target_date date,reason text,proposal uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; old_date date; new_goals jsonb; next_revision integer; proposal_row public.study_plan_proposals;
begin
  select * into selected from public.study_plans where id = study_plan for update;
  if not found or not (private.owns_tutor(selected.tutor_id) or (private.has_role('student') and selected.student_id = auth.uid())) then
    raise exception 'Not authorized' using errcode = '42501'; end if;
  if selected.status <> 'active' or selected.current_revision <> expected_revision or target_date is null then
    raise exception 'Study plan changed; refresh before replanning' using errcode = '23505'; end if;
  if private.has_role('student') and selected.student_id = auth.uid() then
    if proposal is null then raise exception 'Student confirmation requires a tutor proposal' using errcode = '42501'; end if;
    select * into proposal_row from public.study_plan_proposals where id = proposal and plan_id = study_plan
      and milestone_id = reschedule_study_milestone.milestone and status = 'pending' for update;
    if not found or proposal_row.proposed_target_date <> target_date then raise exception 'Proposal does not match the requested date' using errcode = '22023'; end if;
  elsif proposal is not null then raise exception 'Tutor replanning does not consume a student proposal' using errcode = '22023'; end if;
  select (milestones.milestone ->> 'targetDate')::date into old_date
    from public.study_plan_revisions as revisions, jsonb_array_elements(revisions.goals) as goals(goal),
      jsonb_array_elements(goals.goal -> 'milestones') as milestones(milestone)
    where revisions.plan_id = study_plan and revisions.revision_no = selected.current_revision
      and milestones.milestone ->> 'id' = reschedule_study_milestone.milestone::text;
  if not found then raise exception 'Milestone is not in the current plan' using errcode = '22023'; end if;
  select jsonb_agg(jsonb_set(goals.goal,'{milestones}',milestones.updated_milestones) order by goals.ordinality)
    into new_goals from jsonb_array_elements((select goals from public.study_plan_revisions where plan_id=study_plan and revision_no=selected.current_revision))
      with ordinality as goals(goal,ordinality)
    cross join lateral (select jsonb_agg(case when milestone.value ->> 'id' = reschedule_study_milestone.milestone::text
      then jsonb_set(milestone.value,'{targetDate}',to_jsonb(target_date::text),true) else milestone.value end order by milestone.ordinality) as updated_milestones
      from jsonb_array_elements(goals.goal -> 'milestones') with ordinality as milestone(value,ordinality)) as milestones;
  next_revision := selected.current_revision + 1;
  update public.study_plans set current_revision = next_revision where id = study_plan;
  insert into public.study_plan_revisions(plan_id,revision_no,title,description,goals,authored_by)
    select study_plan,next_revision,title,description,new_goals,auth.uid() from public.study_plan_revisions
    where plan_id=study_plan and revision_no=selected.current_revision;
  insert into public.study_plan_replanning_history(plan_id,milestone_id,revision_no,from_target_date,to_target_date,reason,authored_by)
  values (study_plan,milestone,next_revision,old_date,target_date,private.require_text(reason,500,true),auth.uid());
  if proposal is not null then update public.study_plan_proposals set status='accepted',decided_by=auth.uid(),decision_reason=private.require_text(reason,500,true) where id=proposal; end if;
  return next_revision;
end;
$$;

create function public.respond_study_plan_proposal(proposal uuid,response text,reason text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare proposal_row public.study_plan_proposals; selected public.study_plans;
begin
  if response not in ('accept','dismiss') then raise exception 'Invalid proposal decision' using errcode = '22023'; end if;
  select * into proposal_row from public.study_plan_proposals where id=proposal for update;
  if not found then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into selected from public.study_plans where id=proposal_row.plan_id;
  if not found or not private.has_role('student') or selected.student_id <> auth.uid() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if proposal_row.status <> 'pending' then raise exception 'Proposal already decided' using errcode = '22023'; end if;
  if response = 'accept' then
    return public.reschedule_study_milestone(selected.id,proposal_row.milestone_id,selected.current_revision,
      proposal_row.proposed_target_date,reason,proposal_row.id);
  end if;
  update public.study_plan_proposals set status='dismissed',decided_by=auth.uid(),decision_reason=private.require_text(reason,500,true) where id=proposal;
  return selected.current_revision;
end;
$$;

-- Tutor-authored, dated labels are observations tied to verified evidence; no score is converted into mastery.
create table public.topic_mastery_observations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete restrict,
  tutor_id uuid not null references public.tutor_profiles(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  topic text not null check (length(btrim(topic)) between 1 and 200),
  label text not null check (label in ('needs_work','improving','confident')),
  source_kind text not null check (source_kind in ('assessment_attempt','assignment_submission','session_recap')),
  source_id uuid not null,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  observed_at timestamptz not null,
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default statement_timestamp()
);
create index topic_mastery_student_subject_idx on public.topic_mastery_observations(student_id,subject_id,observed_at desc);
create function private.guard_topic_mastery() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then raise exception 'Mastery observations are immutable' using errcode = '22023'; end if;
  if new.recorded_by <> auth.uid() or not private.owns_tutor(new.tutor_id)
    or not private.eligible_learning_student(new.student_id) or not private.tutor_student_related(new.tutor_id,new.student_id)
    or new.observed_at > statement_timestamp() then raise exception 'Not authorized to record mastery' using errcode = '42501'; end if;
  if new.source_kind = 'assessment_attempt' and not exists (select 1 from public.assessment_attempts as attempts
    join public.assessments as assessments on assessments.id=attempts.assessment_id where attempts.id=new.source_id
      and attempts.status='scored' and assessments.tutor_id=new.tutor_id and assessments.student_id=new.student_id and assessments.subject_id=new.subject_id) then
    raise exception 'Mastery source is not a scored related assessment' using errcode = '22023';
  elsif new.source_kind = 'assignment_submission' and not exists (select 1 from public.assignment_submissions as submissions
    join public.assignments as assignments on assignments.id=submissions.assignment_id
    join public.bookings as bookings on bookings.id=assignments.booking_id
    join public.assignment_feedback as feedback on feedback.submission_id=submissions.id
    where submissions.id=new.source_id and assignments.tutor_id=new.tutor_id and assignments.student_id=new.student_id
      and assignments.status <> 'draft' and bookings.subject_id=new.subject_id and feedback.tutor_id=new.tutor_id) then
    raise exception 'Mastery source is not a reviewed related assignment' using errcode = '22023';
  elsif new.source_kind = 'session_recap' and not exists (select 1 from public.session_recaps as recaps
    join public.bookings as bookings on bookings.id=recaps.booking_id where bookings.id=new.source_id
      and recaps.tutor_id=new.tutor_id and bookings.student_id=new.student_id and bookings.subject_id=new.subject_id and bookings.status='completed') then
    raise exception 'Mastery source is not a completed related session' using errcode = '22023';
  end if;
  new.topic := private.require_text(new.topic,200,true);
  new.note := private.require_text(new.note,1000,false);
  new.created_at := statement_timestamp();
  return new;
end;
$$;
create trigger topic_mastery_guard before insert or update or delete on public.topic_mastery_observations
for each row execute function private.guard_topic_mastery();

create function public.set_topic_mastery(student uuid,subject uuid,topic text,label text,source_kind text,source_id uuid,observed_at timestamptz,note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tutor uuid; created uuid;
begin
  select tutors.id into tutor from public.tutor_profiles as tutors where tutors.user_id=auth.uid() and private.has_role('tutor');
  if tutor is null then raise exception 'Not authorized' using errcode='42501'; end if;
  if label not in ('needs_work','improving','confident') or source_kind not in ('assessment_attempt','assignment_submission','session_recap') then
    raise exception 'Invalid mastery observation' using errcode='22023'; end if;
  insert into public.topic_mastery_observations(student_id,tutor_id,subject_id,topic,label,source_kind,source_id,recorded_by,observed_at,note)
  values (student,tutor,subject,topic,label,source_kind,source_id,auth.uid(),observed_at,note) returning id into created;
  return created;
end;
$$;

create function public.list_topic_evidence_candidates(student uuid,subject uuid)
returns table(source_kind text,source_id uuid,label text,occurred_at timestamptz,source_path text)
language plpgsql stable security definer set search_path = '' as $$
declare tutor uuid;
begin
  select tutors.id into tutor from public.tutor_profiles as tutors where tutors.user_id=auth.uid() and private.has_role('tutor');
  if tutor is null or not private.eligible_learning_student(student) or not private.tutor_student_related(tutor,student)
    or not exists(select 1 from public.tutor_subjects where tutor_id=tutor and subject_id=subject) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  return query
    select 'assessment_attempt'::text,attempts.id,'Assessment: '||assessments.title||' · attempt '||attempts.attempt_no::text,
      attempts.scored_at,'/assessments/'||assessments.id::text
    from public.assessment_attempts as attempts join public.assessments as assessments on assessments.id=attempts.assessment_id
    where attempts.status='scored' and assessments.tutor_id=tutor and assessments.student_id=student and assessments.subject_id=subject
    union all
    select 'assignment_submission'::text,submissions.id,'Assignment: '||assignments.title||' · submission '||submissions.attempt_no::text,
      submissions.submitted_at,'/assignments/'||assignments.id::text
    from public.assignment_submissions as submissions join public.assignments as assignments on assignments.id=submissions.assignment_id
      join public.assignment_feedback as feedback on feedback.submission_id=submissions.id
    where assignments.tutor_id=tutor and assignments.student_id=student and assignments.status<>'draft'
      and feedback.tutor_id=tutor and assignments.booking_id is not null
      and exists(select 1 from public.bookings where id=assignments.booking_id and subject_id=subject)
    union all
    select 'session_recap'::text,bookings.id,'Session recap',recaps.published_at,'/sessions/'||bookings.id::text
    from public.session_recaps as recaps join public.bookings as bookings on bookings.id=recaps.booking_id
    where recaps.tutor_id=tutor and bookings.student_id=student and bookings.subject_id=subject and bookings.status='completed'
    order by 4 desc;
end;
$$;

create table public.learning_progress_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete restrict,
  tutor_id uuid not null references public.tutor_profiles(id) on delete restrict,
  subject_id uuid references public.subjects(id) on delete restrict,
  event_type text not null check (event_type in ('assessment_scored','assignment_completed')),
  source_kind text not null check (source_kind in ('assessment_attempt','assignment_submission')),
  source_id uuid not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (event_type,source_kind,source_id)
);
create index learning_progress_events_student_idx on public.learning_progress_events(student_id,occurred_at desc);
create function private.reject_progress_event_mutation() returns trigger
language plpgsql set search_path = '' as $$ begin raise exception 'Progress events are immutable' using errcode='22023'; end; $$;
create trigger learning_progress_events_immutable before update or delete on public.learning_progress_events
for each row execute function private.reject_progress_event_mutation();
create function private.record_learning_progress_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='assessment_attempts' then
    if new.status='scored' and (tg_op='INSERT' or old.status is distinct from 'scored') then
      insert into public.learning_progress_events(student_id,tutor_id,subject_id,event_type,source_kind,source_id,occurred_at)
      select assessments.student_id,assessments.tutor_id,assessments.subject_id,'assessment_scored','assessment_attempt',new.id,coalesce(new.scored_at,statement_timestamp())
        from public.assessments as assessments where assessments.id=new.assessment_id on conflict do nothing;
    end if;
  elsif tg_table_name='assignment_feedback' and new.outcome='completed' then
    insert into public.learning_progress_events(student_id,tutor_id,subject_id,event_type,source_kind,source_id,occurred_at)
    select assignments.student_id,assignments.tutor_id,
      (select bookings.subject_id from public.bookings where bookings.id=assignments.booking_id),
      'assignment_completed','assignment_submission',new.submission_id,new.created_at
    from public.assignment_submissions as submissions join public.assignments as assignments on assignments.id=submissions.assignment_id
    where submissions.id=new.submission_id on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger assessment_scored_progress_event after insert or update of status on public.assessment_attempts
for each row execute function private.record_learning_progress_event();
create trigger assignment_completed_progress_event after insert on public.assignment_feedback
for each row execute function private.record_learning_progress_event();

create function public.delete_session_reflection(booking uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare deleted_count integer;
begin
  if not private.booking_student(booking) then raise exception 'Not authorized' using errcode='42501'; end if;
  delete from public.session_reflections where booking_id=booking and student_id=auth.uid();
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;

alter table public.study_plan_milestone_links enable row level security;
alter table public.study_plan_proposals enable row level security;
alter table public.study_plan_replanning_history enable row level security;
alter table public.topic_mastery_observations enable row level security;
alter table public.learning_progress_events enable row level security;
revoke all on public.study_plan_milestone_links,public.study_plan_proposals,public.study_plan_replanning_history,
  public.topic_mastery_observations,public.learning_progress_events from public,anon,authenticated,service_role;
grant select on public.study_plan_milestone_links,public.study_plan_proposals,public.study_plan_replanning_history,
  public.topic_mastery_observations,public.learning_progress_events to authenticated;
create policy study_plan_milestone_links_participant_read on public.study_plan_milestone_links for select to authenticated using (private.learning_plan_reader(plan_id));
create policy study_plan_proposals_participant_read on public.study_plan_proposals for select to authenticated using (private.learning_plan_reader(plan_id));
create policy study_plan_replanning_participant_read on public.study_plan_replanning_history for select to authenticated using (private.learning_plan_reader(plan_id));
create policy topic_mastery_participant_read on public.topic_mastery_observations for select to authenticated using (
  (private.has_role('student') and student_id=auth.uid()) or private.owns_tutor(tutor_id));
create policy learning_progress_participant_read on public.learning_progress_events for select to authenticated using (
  (private.has_role('student') and student_id=auth.uid()) or private.owns_tutor(tutor_id));

create or replace function private.guard_study_plan_evidence() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; revision public.study_plan_revisions; source_booking uuid;
begin
  if tg_op <> 'INSERT' then raise exception 'Learning evidence is immutable' using errcode='22023'; end if;
  select * into selected from public.study_plans where id=new.plan_id for update;
  if not found or not private.owns_tutor(selected.tutor_id) or new.recorded_by<>auth.uid()
    or selected.status<>'active' or new.revision_no<>selected.current_revision then raise exception 'Not authorized to record evidence' using errcode='42501'; end if;
  select * into revision from public.study_plan_revisions where plan_id=new.plan_id and revision_no=new.revision_no;
  if not exists (select 1 from jsonb_array_elements(revision.goals) as goals(goal),jsonb_array_elements(goals.goal->'milestones') as milestones(milestone)
    where milestones.milestone->>'id'=new.milestone_id::text) then raise exception 'Milestone is not part of current revision' using errcode='22023'; end if;
  if new.source_kind='assessment_attempt' and not exists (select 1 from public.assessment_attempts as attempts join public.assessments as assessments on assessments.id=attempts.assessment_id
    where attempts.id=new.source_id and attempts.status='scored' and assessments.tutor_id=selected.tutor_id and assessments.student_id=selected.student_id
      and (selected.subject_id is null or assessments.subject_id=selected.subject_id)) then raise exception 'Assessment evidence is not eligible' using errcode='22023';
  elsif new.source_kind='assignment_submission' and not exists (select 1 from public.assignment_submissions as submissions join public.assignments as assignments on assignments.id=submissions.assignment_id
    where submissions.id=new.source_id and assignments.tutor_id=selected.tutor_id and assignments.student_id=selected.student_id and assignments.status<>'draft'
      and (selected.subject_id is null or (assignments.booking_id is not null and exists(select 1 from public.bookings where id=assignments.booking_id and subject_id=selected.subject_id)))) then
      raise exception 'Assignment evidence is not eligible' using errcode='22023';
  elsif new.source_kind='session_recap' then
    source_booking:=new.source_id;
    if not exists(select 1 from public.session_recaps as recaps join public.bookings as bookings on bookings.id=recaps.booking_id
      where bookings.id=source_booking and recaps.tutor_id=selected.tutor_id and bookings.student_id=selected.student_id and bookings.status='completed'
        and (selected.subject_id is null or bookings.subject_id=selected.subject_id)) then raise exception 'Session recap evidence is not eligible' using errcode='22023'; end if;
  else raise exception 'Unsupported evidence kind' using errcode='22023'; end if;
  new.created_at:=statement_timestamp();
  return new;
end;
$$;
drop trigger study_plan_evidence_guard on public.study_plan_evidence;
create trigger study_plan_evidence_guard before insert or update or delete on public.study_plan_evidence for each row execute function private.guard_study_plan_evidence();

create or replace function public.record_study_evidence(study_plan uuid,milestone uuid,source_kind text,source_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; created uuid;
begin
  select * into selected from public.study_plans where id=study_plan for update;
  if not found or not private.owns_tutor(selected.tutor_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  insert into public.study_plan_evidence(plan_id,revision_no,milestone_id,source_kind,source_id,recorded_by)
  values(study_plan,selected.current_revision,milestone,source_kind,source_id,auth.uid()) returning id into created;
  return created;
end;
$$;

revoke all on function public.close_assignment_submissions(uuid),public.create_study_plan_proposal(uuid,uuid,date,text),
  public.reschedule_study_milestone(uuid,uuid,integer,date,text,uuid),public.respond_study_plan_proposal(uuid,text,text),
  public.set_topic_mastery(uuid,uuid,text,text,text,uuid,timestamptz,text),public.list_topic_evidence_candidates(uuid,uuid),
  public.delete_session_reflection(uuid) from public,anon,authenticated;
grant execute on function public.close_assignment_submissions(uuid),public.create_study_plan_proposal(uuid,uuid,date,text),
  public.reschedule_study_milestone(uuid,uuid,integer,date,text,uuid),public.respond_study_plan_proposal(uuid,text,text),
  public.set_topic_mastery(uuid,uuid,text,text,text,uuid,timestamptz,text),public.list_topic_evidence_candidates(uuid,uuid),
  public.delete_session_reflection(uuid) to authenticated;
revoke all on function private.valid_structured_study_goals(jsonb),private.guard_study_plan_link(),private.populate_study_plan_links(),
  private.guard_study_plan_revision(),private.guard_study_proposal(),private.guard_topic_mastery(),private.reject_learning_history_mutation(),
  private.record_learning_progress_event(),private.reject_progress_event_mutation(),private.guard_study_plan_evidence() from public,anon,authenticated;
grant execute on function private.valid_structured_study_goals(jsonb),private.learning_plan_reader(uuid) to authenticated;

commit;
