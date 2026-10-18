begin;
set local search_path = public, extensions, pg_catalog;

-- Sprint 3: UC-05 Diagnostic Assessment and UC-08 Practice Tasks and Assignment Management (schema, invariants,
-- RLS and RPCs). The Sprint 3 user interface covers UC-09 and UC-07; these tables are database-complete for the
-- next sprint's screens.

-- A tutor may only assess or assign work to a student they have a confirmed, ongoing or completed booking with.
create function private.tutor_student_related(tutor uuid, student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bookings where tutor_id = tutor and student_id = student
      and status in ('confirmed', 'in_progress', 'completed')
  );
$$;

create function private.check_learning_link(tutor uuid, student uuid, booking uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.tutor_student_related(tutor, student) then
    raise exception 'Tutor and student need a confirmed booking relationship' using errcode = '22023';
  end if;
  if booking is not null and not exists (
    select 1 from public.bookings where id = booking and tutor_id = tutor and student_id = student) then
    raise exception 'Linked booking must belong to the same tutor and student' using errcode = '22023';
  end if;
end;
$$;

-- UC-05 ------------------------------------------------------------------------------------------------------------

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 200),
  instructions text check (length(instructions) <= 4000),
  purpose text not null default 'diagnostic' check (purpose in ('diagnostic', 'pre_session', 'post_session', 'milestone')),
  status text not null default 'draft' check (status in ('draft', 'assigned', 'submitted', 'scored')),
  due_at timestamptz check (isfinite(due_at)),
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tutor_id, subject_id) references public.tutor_subjects(tutor_id, subject_id) on delete restrict,
  check ((status = 'draft') = (assigned_at is null))
);
create index assessments_tutor_idx on public.assessments(tutor_id, status);
create index assessments_student_idx on public.assessments(student_id, status);
create index assessments_subject_idx on public.assessments(subject_id);
create index assessments_tutor_subject_idx on public.assessments(tutor_id, subject_id);
create index assessments_booking_idx on public.assessments(booking_id);

create table public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  position smallint not null check (position between 1 and 100),
  prompt text not null check (length(btrim(prompt)) between 1 and 2000),
  kind text not null check (kind in ('single_choice', 'short_answer')),
  choices jsonb,
  points smallint not null default 1 check (points between 1 and 100),
  created_at timestamptz not null default now(),
  unique (assessment_id, position),
  check ((kind = 'single_choice' and jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 2 and 10)
    or (kind = 'short_answer' and choices is null))
);

-- Answer keys live in their own table so no student-facing grant or policy can ever expose them.
create table public.assessment_answer_keys (
  question_id uuid primary key references public.assessment_questions(id) on delete cascade,
  correct_choice text not null check (length(btrim(correct_choice)) between 1 and 500),
  created_at timestamptz not null default now()
);

create table public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 65536),
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'scored')),
  auto_score integer check (auto_score >= 0),
  tutor_score integer check (tutor_score >= 0),
  score integer,
  max_score integer check (max_score > 0),
  tutor_feedback text check (length(tutor_feedback) <= 4000),
  submitted_at timestamptz,
  scored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id),
  check ((status = 'in_progress') = (submitted_at is null)),
  check ((status = 'scored') = (score is not null and scored_at is not null)),
  check (score is null or (max_score is not null and score between 0 and max_score))
);
create index assessment_attempts_student_idx on public.assessment_attempts(student_id);

create function private.guard_assessment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.check_learning_link(new.tutor_id, new.student_id, new.booking_id);
    if new.status <> 'draft' then raise exception 'Assessments start as drafts' using errcode = '22023'; end if;
  else
    if (new.id, new.tutor_id, new.student_id, new.created_at) is distinct from
      (old.id, old.tutor_id, old.student_id, old.created_at) then
      raise exception 'Immutable assessment ownership' using errcode = '22023';
    end if;
    if old.status <> 'draft' and (new.title, new.instructions, new.subject_id, new.booking_id, new.purpose)
      is distinct from (old.title, old.instructions, old.subject_id, old.booking_id, old.purpose) then
      raise exception 'Assigned assessments are frozen' using errcode = '22023';
    end if;
    if new.booking_id is distinct from old.booking_id then
      perform private.check_learning_link(new.tutor_id, new.student_id, new.booking_id);
    end if;
    if new.status <> old.status then
      if old.status = 'draft' and new.status = 'assigned' then
        if not exists (select 1 from public.assessment_questions where assessment_id = new.id) or exists (
          select 1 from public.assessment_questions as questions
          left join public.assessment_answer_keys as keys on keys.question_id = questions.id
          where questions.assessment_id = new.id and questions.kind = 'single_choice' and keys.question_id is null) then
          raise exception 'Assign requires questions and an answer key for every choice question' using errcode = '22023';
        end if;
        new.assigned_at := statement_timestamp();
      elsif old.status = 'assigned' and new.status = 'submitted' then
        if not exists (select 1 from public.assessment_attempts where assessment_id = new.id and status <> 'in_progress') then
          raise exception 'Submission requires a finalized attempt' using errcode = '22023';
        end if;
      elsif old.status = 'submitted' and new.status = 'scored' then
        if not exists (select 1 from public.assessment_attempts where assessment_id = new.id and status = 'scored') then
          raise exception 'Scoring requires a scored attempt' using errcode = '22023';
        end if;
      else
        raise exception 'Invalid assessment transition' using errcode = '22023';
      end if;
    end if;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger assessments_guard before insert or update on public.assessments
for each row execute function private.guard_assessment();

create function private.guard_assessment_content() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parent uuid; question public.assessment_questions;
begin
  if tg_table_name = 'assessment_answer_keys' then
    select * into question from public.assessment_questions
    where id = case when tg_op = 'DELETE' then old.question_id else new.question_id end;
    parent := question.assessment_id;
    if tg_op <> 'DELETE' and (question.kind <> 'single_choice' or not (question.choices ? new.correct_choice)) then
      raise exception 'Answer key must be one of the question choices' using errcode = '22023';
    end if;
  else
    parent := case when tg_op = 'DELETE' then old.assessment_id else new.assessment_id end;
    if tg_op = 'UPDATE' and new.assessment_id <> old.assessment_id then
      raise exception 'Immutable question owner' using errcode = '22023';
    end if;
  end if;
  -- A cascading delete of a draft assessment removes its content; assigned content is frozen.
  if exists (select 1 from public.assessments where id = parent and status <> 'draft') then
    raise exception 'Assigned assessment content is frozen' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger assessment_questions_guard before insert or update or delete on public.assessment_questions
for each row execute function private.guard_assessment_content();
create trigger assessment_answer_keys_guard before insert or update or delete on public.assessment_answer_keys
for each row execute function private.guard_assessment_content();

create function private.prevent_assigned_assessment_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'draft' then raise exception 'Only draft assessments can be deleted' using errcode = '22023'; end if;
  return old;
end;
$$;
create trigger assessments_delete_guard before delete on public.assessments
for each row execute function private.prevent_assigned_assessment_delete();

create function private.touch_attempt() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.id, new.assessment_id, new.student_id, new.created_at)
    is distinct from (old.id, old.assessment_id, old.student_id, old.created_at) then
    raise exception 'Immutable attempt ownership' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'in_progress' and new.answers is distinct from old.answers then
    raise exception 'Finalized answers are immutable' using errcode = '22023';
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger assessment_attempts_touch before insert or update on public.assessment_attempts
for each row execute function private.touch_attempt();

-- Saves or finalizes the caller's attempt; objective items are scored from the private key on the server.
create function public.submit_assessment_attempt(assessment uuid, answers jsonb, finalize boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  selected public.assessments;
  existing public.assessment_attempts;
  attempt uuid;
  objective integer;
  maximum integer;
  has_subjective boolean;
begin
  if not private.has_role('student') then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into selected from public.assessments where id = assessment for update;
  if not found or selected.student_id <> auth.uid() or selected.status = 'draft' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if selected.status <> 'assigned' or (selected.due_at is not null and selected.due_at < statement_timestamp()) then
    raise exception 'Assessment is closed' using errcode = '22023';
  end if;
  if answers is null or jsonb_typeof(answers) <> 'object' or finalize is null then
    raise exception 'Invalid answers' using errcode = '22023';
  end if;
  select * into existing from public.assessment_attempts where assessment_id = assessment and student_id = auth.uid() for update;
  if found and existing.status <> 'in_progress' then
    raise exception 'Attempt already submitted' using errcode = '23505';
  end if;
  insert into public.assessment_attempts(assessment_id, student_id, answers)
  values (assessment, auth.uid(), submit_assessment_attempt.answers)
  on conflict (assessment_id, student_id) do update set answers = excluded.answers
  returning id into attempt;
  if finalize then
    select coalesce(sum(questions.points) filter (where keys.correct_choice = submit_assessment_attempt.answers ->> questions.id::text), 0),
      sum(questions.points), bool_or(questions.kind = 'short_answer')
    into objective, maximum, has_subjective
    from public.assessment_questions as questions
    left join public.assessment_answer_keys as keys on keys.question_id = questions.id
    where questions.assessment_id = assessment;
    update public.assessment_attempts set status = case when has_subjective then 'submitted' else 'scored' end,
      auto_score = objective, max_score = maximum, submitted_at = statement_timestamp(),
      score = case when has_subjective then null else objective end,
      scored_at = case when has_subjective then null else statement_timestamp() end
    where id = attempt;
    update public.assessments set status = 'submitted' where id = assessment;
    if not has_subjective then update public.assessments set status = 'scored' where id = assessment; end if;
  end if;
  return attempt;
end;
$$;

create function public.score_assessment_attempt(attempt uuid, tutor_points integer, feedback text) returns void
language plpgsql security definer set search_path = '' as $$
declare selected public.assessment_attempts; parent public.assessments;
begin
  select * into selected from public.assessment_attempts where id = attempt for update;
  if not found then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into parent from public.assessments where id = selected.assessment_id for update;
  if not private.owns_tutor(parent.tutor_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if selected.status <> 'submitted' then raise exception 'Attempt is not awaiting tutor scoring' using errcode = '22023'; end if;
  if tutor_points is null or tutor_points < 0 or selected.auto_score + tutor_points > selected.max_score then
    raise exception 'Score out of range' using errcode = '22023';
  end if;
  update public.assessment_attempts set status = 'scored', tutor_score = tutor_points,
    score = selected.auto_score + tutor_points, tutor_feedback = private.require_text(feedback, 4000, false),
    scored_at = statement_timestamp() where id = attempt;
  update public.assessments set status = 'scored' where id = parent.id;
end;
$$;

-- UC-08 ------------------------------------------------------------------------------------------------------------

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 200),
  instructions text not null check (length(btrim(instructions)) between 1 and 4000),
  submission_type text not null default 'text' check (submission_type in ('text', 'link', 'file')),
  due_at timestamptz not null check (isfinite(due_at)),
  accepts_late boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'assigned', 'submitted', 'returned', 'completed', 'cancelled')),
  cancellation_reason text check (length(cancellation_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'cancelled') = (cancellation_reason is not null))
);
create index assignments_tutor_idx on public.assignments(tutor_id, status);
create index assignments_student_idx on public.assignments(student_id, status, due_at);
create index assignments_booking_idx on public.assignments(booking_id);

create table public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  attempt_no smallint not null check (attempt_no between 1 and 20),
  body text check (length(body) <= 8000),
  link_url text check (length(link_url) <= 1000 and link_url ~ '^https://'),
  file_path text check (length(file_path) <= 500),
  file_mime text check (file_mime in ('application/pdf', 'image/png', 'image/jpeg', 'text/plain')),
  file_size_bytes integer check (file_size_bytes between 1 and 10485760),
  is_late boolean not null default false,
  submitted_at timestamptz not null default now(),
  unique (assignment_id, attempt_no),
  check (coalesce(length(btrim(body)), 0) > 0 or link_url is not null or file_path is not null),
  check ((file_path is null) = (file_mime is null) and (file_path is null) = (file_size_bytes is null))
);
create index assignment_submissions_student_idx on public.assignment_submissions(student_id);

create table public.assignment_feedback (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.assignment_submissions(id) on delete restrict,
  tutor_id uuid not null references public.tutor_profiles(id) on delete restrict,
  feedback text not null check (length(btrim(feedback)) between 1 and 4000),
  score smallint check (score between 0 and 100),
  outcome text not null check (outcome in ('returned', 'completed')),
  created_at timestamptz not null default now()
);
create index assignment_feedback_tutor_idx on public.assignment_feedback(tutor_id);

create function private.guard_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.check_learning_link(new.tutor_id, new.student_id, new.booking_id);
    if new.status not in ('draft', 'assigned') then
      raise exception 'Assignments start as draft or assigned' using errcode = '22023';
    end if;
  else
    if (new.id, new.tutor_id, new.student_id, new.booking_id, new.created_at) is distinct from
      (old.id, old.tutor_id, old.student_id, old.booking_id, old.created_at) then
      raise exception 'Immutable assignment ownership' using errcode = '22023';
    end if;
    if new.status <> old.status and not (
      (old.status = 'draft' and new.status in ('assigned', 'cancelled')) or
      (old.status = 'assigned' and new.status in ('submitted', 'cancelled')) or
      (old.status = 'submitted' and new.status in ('returned', 'completed')) or
      (old.status = 'returned' and new.status in ('submitted', 'completed', 'cancelled'))) then
      raise exception 'Invalid assignment transition' using errcode = '22023';
    end if;
    if new.status = 'submitted' and old.status <> 'submitted' and not exists (
      select 1 from public.assignment_submissions as submissions where submissions.assignment_id = new.id
        and not exists (select 1 from public.assignment_feedback where submission_id = submissions.id)) then
      raise exception 'Submitted state requires an unreviewed submission' using errcode = '22023';
    end if;
    if new.status in ('returned', 'completed') and old.status = 'submitted' and exists (
      select 1 from public.assignment_submissions as submissions where submissions.assignment_id = new.id
        and not exists (select 1 from public.assignment_feedback where submission_id = submissions.id)) then
      raise exception 'Feedback is required before returning or completing work' using errcode = '22023';
    end if;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger assignments_guard before insert or update on public.assignments
for each row execute function private.guard_assignment();

-- Submissions are append-only and refused after the due time unless the tutor allowed late work.
create function private.guard_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected public.assignments;
begin
  select * into selected from public.assignments where id = new.assignment_id for update;
  if not found or new.student_id <> selected.student_id then
    raise exception 'Submission must come from the assigned student' using errcode = '22023';
  end if;
  if selected.status not in ('assigned', 'returned') then
    raise exception 'Assignment is not open for submission' using errcode = '22023';
  end if;
  if statement_timestamp() > selected.due_at and not selected.accepts_late then
    raise exception 'Submission deadline has passed' using errcode = '22023';
  end if;
  if (selected.submission_type = 'link' and new.link_url is null)
    or (selected.submission_type = 'file' and new.file_path is null)
    or (selected.submission_type = 'text' and coalesce(length(btrim(new.body)), 0) = 0) then
    raise exception 'Submission does not match the required type' using errcode = '22023';
  end if;
  new.is_late := statement_timestamp() > selected.due_at;
  new.submitted_at := statement_timestamp();
  new.attempt_no := coalesce((select max(attempt_no) from public.assignment_submissions where assignment_id = new.assignment_id), 0) + 1;
  return new;
end;
$$;
create trigger assignment_submissions_guard before insert on public.assignment_submissions
for each row execute function private.guard_submission();
create trigger assignment_submissions_append_only before update or delete on public.assignment_submissions
for each row execute function private.prevent_history_mutation();

create function private.after_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.assignments set status = 'submitted' where id = new.assignment_id;
  return null;
end;
$$;
create trigger assignment_submissions_state after insert on public.assignment_submissions
for each row execute function private.after_submission();

create function private.guard_feedback() returns trigger
language plpgsql security definer set search_path = '' as $$
declare submission public.assignment_submissions; selected public.assignments;
begin
  select * into submission from public.assignment_submissions where id = new.submission_id;
  select * into selected from public.assignments where id = submission.assignment_id for update;
  if new.tutor_id <> selected.tutor_id then
    raise exception 'Feedback author must be the assigning tutor' using errcode = '22023';
  end if;
  if submission.attempt_no <> (select max(attempt_no) from public.assignment_submissions where assignment_id = selected.id) then
    raise exception 'Feedback applies to the latest submission' using errcode = '22023';
  end if;
  new.created_at := statement_timestamp();
  return new;
end;
$$;
create trigger assignment_feedback_guard before insert on public.assignment_feedback
for each row execute function private.guard_feedback();
create trigger assignment_feedback_append_only before update or delete on public.assignment_feedback
for each row execute function private.prevent_history_mutation();

create function private.after_feedback() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.assignments set status = new.outcome
  where id = (select assignment_id from public.assignment_submissions where id = new.submission_id);
  return null;
end;
$$;
create trigger assignment_feedback_state after insert on public.assignment_feedback
for each row execute function private.after_feedback();

create function public.submit_assignment(assignment uuid, body text, link_url text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare submission uuid;
begin
  if not private.has_role('student') or not exists (
    select 1 from public.assignments where id = assignment and student_id = auth.uid() and status <> 'draft') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  insert into public.assignment_submissions(assignment_id, student_id, attempt_no, body, link_url)
  values (assignment, auth.uid(), 1, private.require_text(body, 8000, false), private.require_text(link_url, 1000, false))
  returning id into submission;
  return submission;
end;
$$;

create function public.give_assignment_feedback(submission uuid, feedback text, score integer, outcome text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tutor uuid; created uuid;
begin
  select assignments.tutor_id into tutor from public.assignment_submissions as submissions
  join public.assignments as assignments on assignments.id = submissions.assignment_id where submissions.id = submission;
  if tutor is null or not private.owns_tutor(tutor) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if outcome is null or outcome not in ('returned', 'completed') or (score is not null and score not between 0 and 100) then
    raise exception 'Invalid feedback' using errcode = '22023';
  end if;
  insert into public.assignment_feedback(submission_id, tutor_id, feedback, score, outcome)
  values (submission, tutor, private.require_text(feedback, 4000, true), score, outcome)
  returning id into created;
  return created;
end;
$$;

-- RLS and grants -----------------------------------------------------------------------------------------------------

create function private.owns_assessment(assessment uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.assessments where id = assessment and private.owns_tutor(tutor_id));
$$;
create function private.assigned_assessment(assessment uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('student') and exists (
    select 1 from public.assessments where id = assessment and student_id = auth.uid() and status <> 'draft');
$$;
create function private.assignment_reader(assignment uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.assignments where id = assignment and (private.owns_tutor(tutor_id)
    or (student_id = auth.uid() and status <> 'draft' and private.has_role('student'))));
$$;
create function private.submission_reader(submission uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.assignment_submissions where id = submission and private.assignment_reader(assignment_id));
$$;

alter table public.assessments enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.assessment_answer_keys enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.assignment_feedback enable row level security;
revoke all on public.assessments, public.assessment_questions, public.assessment_answer_keys, public.assessment_attempts,
public.assignments, public.assignment_submissions, public.assignment_feedback from public, anon, authenticated, service_role;
grant select on public.assessments, public.assessment_questions, public.assessment_answer_keys, public.assessment_attempts,
public.assignments, public.assignment_submissions, public.assignment_feedback to authenticated;
grant insert, delete on public.assessments, public.assessment_questions, public.assessment_answer_keys to authenticated;
grant update(title, instructions, subject_id, booking_id, purpose, status, due_at) on public.assessments to authenticated;
grant update(position, prompt, kind, choices, points) on public.assessment_questions to authenticated;
grant update(correct_choice) on public.assessment_answer_keys to authenticated;
grant insert on public.assignments to authenticated;
grant update(title, instructions, submission_type, due_at, accepts_late, status, cancellation_reason)
on public.assignments to authenticated;

create policy assessments_tutor on public.assessments for all to authenticated
using (private.owns_tutor(tutor_id)) with check (private.owns_tutor(tutor_id));
create policy assessments_student_read on public.assessments for select to authenticated
using (student_id = auth.uid() and status <> 'draft' and private.has_role('student'));
create policy assessment_questions_tutor on public.assessment_questions for all to authenticated
using (private.owns_assessment(assessment_id)) with check (private.owns_assessment(assessment_id));
create policy assessment_questions_student_read on public.assessment_questions for select to authenticated
using (private.assigned_assessment(assessment_id));
-- Tutor-only: there is deliberately no student policy on answer keys.
create policy assessment_answer_keys_tutor on public.assessment_answer_keys for all to authenticated
using (exists (select 1 from public.assessment_questions as questions where questions.id = question_id
  and private.owns_assessment(questions.assessment_id)))
with check (exists (select 1 from public.assessment_questions as questions where questions.id = question_id
  and private.owns_assessment(questions.assessment_id)));
create policy assessment_attempts_read on public.assessment_attempts for select to authenticated
using ((student_id = auth.uid() and private.has_role('student')) or private.owns_assessment(assessment_id));
create policy assignments_tutor on public.assignments for all to authenticated
using (private.owns_tutor(tutor_id)) with check (private.owns_tutor(tutor_id));
create policy assignments_student_read on public.assignments for select to authenticated
using (student_id = auth.uid() and status <> 'draft' and private.has_role('student'));
create policy assignment_submissions_read on public.assignment_submissions for select to authenticated
using (private.assignment_reader(assignment_id));
create policy assignment_feedback_read on public.assignment_feedback for select to authenticated
using (private.submission_reader(submission_id));

revoke all on function public.submit_assessment_attempt(uuid, jsonb, boolean), public.score_assessment_attempt(uuid, integer, text),
public.submit_assignment(uuid, text, text), public.give_assignment_feedback(uuid, text, integer, text)
from public, anon, authenticated;
grant execute on function public.submit_assessment_attempt(uuid, jsonb, boolean), public.score_assessment_attempt(uuid, integer, text),
public.submit_assignment(uuid, text, text), public.give_assignment_feedback(uuid, text, integer, text) to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.tutor_is_public(uuid) to anon, authenticated;
grant execute on function private.valid_timezone(text), private.active_actor(), private.has_role(text), private.owns_tutor(uuid),
private.booking_participant(uuid), private.payment_participant(uuid), private.owns_assessment(uuid),
private.assigned_assessment(uuid), private.assignment_reader(uuid), private.submission_reader(uuid) to authenticated;

commit;
