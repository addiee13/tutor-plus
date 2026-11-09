begin;
set local search_path = public, extensions, pg_catalog;

-- Extend the existing assessment contract without changing its privacy boundary. Attempts are append-only,
-- numbered per learner/assessment, and reopening is an explicit tutor action.
alter table public.assessment_attempts
  drop constraint assessment_attempts_assessment_id_student_id_key;
alter table public.assessment_attempts
  add column attempt_no smallint not null default 1 check (attempt_no between 1 and 20);
create unique index assessment_attempts_number_uq
  on public.assessment_attempts(assessment_id, student_id, attempt_no);
create unique index assessment_attempts_one_open_uq
  on public.assessment_attempts(assessment_id, student_id) where status = 'in_progress';

create or replace function private.touch_attempt() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.id, new.assessment_id, new.student_id, new.attempt_no, new.created_at)
    is distinct from (old.id, old.assessment_id, old.student_id, old.attempt_no, old.created_at) then
    raise exception 'Immutable attempt provenance' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.status = 'submitted' and new.status = 'scored'
    and new.answers is not distinct from old.answers then
    -- The scoring RPC is the only authenticated writer and advances this one permitted state transition.
    null;
  elsif tg_op = 'UPDATE' and old.status <> 'in_progress' then
    raise exception 'Finalized attempts are immutable' using errcode = '22023';
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create function private.reject_attempt_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Assessment attempt history is immutable' using errcode = '22023';
end;
$$;
create trigger assessment_attempts_append_only_delete before delete on public.assessment_attempts
for each row execute function private.reject_attempt_delete();

create function private.eligible_learning_student(student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles as profiles
    join auth.users as users on users.id = profiles.id
    join public.user_roles as roles on roles.user_id = profiles.id and roles.role = 'student'
    where profiles.id = student and profiles.status = 'active' and profiles.adult_attested
      and users.email_confirmed_at is not null
  );
$$;

create or replace function private.guard_assessment() returns trigger
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
    if old.status <> 'draft' and (new.title, new.instructions, new.subject_id, new.booking_id, new.purpose, new.due_at)
      is distinct from (old.title, old.instructions, old.subject_id, old.booking_id, old.purpose, old.due_at) then
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
          raise exception 'Assign requires questions and keys for every choice question' using errcode = '22023';
        end if;
        new.assigned_at := statement_timestamp();
      elsif old.status = 'assigned' and new.status in ('submitted', 'scored') then
        if not exists (select 1 from public.assessment_attempts as attempts where attempts.assessment_id = new.id
          and attempts.status = new.status and attempts.attempt_no = (
            select max(latest.attempt_no) from public.assessment_attempts as latest where latest.assessment_id = new.id)) then
          raise exception 'Assessment state must match its latest attempt' using errcode = '22023';
        end if;
      elsif old.status = 'submitted' and new.status = 'scored' then
        if not exists (select 1 from public.assessment_attempts as attempts where attempts.assessment_id = new.id
          and attempts.status = 'scored' and attempts.attempt_no = (
            select max(latest.attempt_no) from public.assessment_attempts as latest where latest.assessment_id = new.id)) then
          raise exception 'Scoring requires a scored latest attempt' using errcode = '22023';
        end if;
      elsif old.status = 'scored' and new.status = 'assigned' then
        if (select count(*) from public.assessment_attempts where assessment_id = new.id) >= 20
          or exists (select 1 from public.assessment_attempts where assessment_id = new.id and status <> 'scored') then
          raise exception 'A retake requires a scored attempt and an available attempt slot' using errcode = '22023';
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

create or replace function private.valid_assessment_payload(payload jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb; choice text; selected text; points integer;
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
      if jsonb_typeof(item -> 'choices') <> 'array' or jsonb_array_length(item -> 'choices') not between 2 and 10
        or nullif(item ->> 'correct_choice', '') is null then return false; end if;
      selected := item ->> 'correct_choice';
      if not exists (select 1 from jsonb_array_elements_text(item -> 'choices') as values(choice)
        where choice = selected and length(choice) between 1 and 500) then return false; end if;
      if exists (select 1 from jsonb_array_elements_text(item -> 'choices') as values(choice)
        where length(choice) not between 1 and 500) then return false; end if;
      if (select count(distinct choice) from jsonb_array_elements_text(item -> 'choices') as values(choice))
        <> jsonb_array_length(item -> 'choices') then return false; end if;
    elsif item -> 'choices' is distinct from 'null'::jsonb or item ? 'correct_choice' and item -> 'correct_choice' <> 'null'::jsonb then
      return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create function public.create_learning_assessment(
  tutor uuid, student uuid, subject uuid, booking uuid, payload jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare assessment_id uuid; item jsonb; question_id uuid; choices jsonb; key_text text;
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
  returning id into assessment_id;
  for item in select value from jsonb_array_elements(payload -> 'questions') with ordinality as entries(value, ord) order by ord loop
    choices := case when item -> 'choices' is null or item -> 'choices' = 'null'::jsonb then null else item -> 'choices' end;
    insert into public.assessment_questions(assessment_id, position, prompt, kind, choices, points)
    values (assessment_id, (select count(*) + 1 from public.assessment_questions where assessment_id = create_learning_assessment.assessment_id),
      private.require_text(item ->> 'prompt', 2000, true), item ->> 'kind', choices, (item ->> 'points')::smallint)
    returning id into question_id;
    key_text := nullif(item ->> 'correct_choice', '');
    if key_text is not null then
      insert into public.assessment_answer_keys(question_id, correct_choice) values (question_id, key_text);
    end if;
  end loop;
  return assessment_id;
end;
$$;

create function public.update_learning_assessment(assessment uuid, payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare selected public.assessments; item jsonb; question_id uuid; choices jsonb; key_text text; position_no smallint := 0;
begin
  select * into selected from public.assessments where id = assessment for update;
  if not found or not private.owns_tutor(selected.tutor_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if selected.status <> 'draft' then raise exception 'Only drafts can be edited' using errcode = '22023'; end if;
  if not private.valid_assessment_payload(payload) then raise exception 'Invalid assessment draft' using errcode = '22023'; end if;
  update public.assessments set title = private.require_text(payload ->> 'title', 200, true),
    instructions = private.require_text(payload ->> 'instructions', 4000, false), purpose = payload ->> 'purpose',
    due_at = nullif(payload ->> 'due_at', '')::timestamptz where id = assessment;
  delete from public.assessment_questions where assessment_id = assessment;
  for item in select value from jsonb_array_elements(payload -> 'questions') loop
    position_no := position_no + 1;
    choices := case when item -> 'choices' is null or item -> 'choices' = 'null'::jsonb then null else item -> 'choices' end;
    insert into public.assessment_questions(assessment_id, position, prompt, kind, choices, points)
    values (assessment, position_no, private.require_text(item ->> 'prompt', 2000, true), item ->> 'kind', choices,
      (item ->> 'points')::smallint) returning id into question_id;
    key_text := nullif(item ->> 'correct_choice', '');
    if key_text is not null then
      insert into public.assessment_answer_keys(question_id, correct_choice) values (question_id, key_text);
    end if;
  end loop;
end;
$$;

create function public.assign_learning_assessment(assessment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare selected_tutor uuid;
begin
  select assessments.tutor_id into selected_tutor from public.assessments where id = assessment for update;
  if selected_tutor is null or not private.owns_tutor(selected_tutor) then raise exception 'Not authorized' using errcode = '42501'; end if;
  update public.assessments set status = 'assigned' where id = assessment;
end;
$$;

create function public.authorize_assessment_retake(assessment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare selected public.assessments;
begin
  select * into selected from public.assessments where id = assessment for update;
  if not found or not private.owns_tutor(selected.tutor_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if selected.status <> 'scored' then raise exception 'Only a scored assessment can be reopened' using errcode = '22023'; end if;
  if (select count(*) from public.assessment_attempts where assessment_id = assessment) >= 20 then
    raise exception 'Retake limit reached' using errcode = '22023';
  end if;
  if exists (select 1 from public.assessment_attempts where assessment_id = assessment and status <> 'scored') then
    raise exception 'Every earlier attempt must be scored first' using errcode = '22023';
  end if;
  update public.assessments set status = 'assigned' where id = assessment;
end;
$$;

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
  select * into selected from public.assessments where id = assessment for update;
  if not found or selected.student_id <> auth.uid() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if selected.status <> 'assigned' then raise exception 'Assessment is not open for an attempt' using errcode = '22023'; end if;
  if selected.due_at is not null and selected.due_at < statement_timestamp() then
    raise exception 'Assessment is closed' using errcode = '22023';
  end if;
  if answers is null or jsonb_typeof(answers) <> 'object' or octet_length(answers::text) > 65536 or finalize is null then
    raise exception 'Invalid answers' using errcode = '22023';
  end if;
  for entry in select key, value from jsonb_each(answers) loop
    if entry.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Invalid question answer' using errcode = '22023';
    end if;
    select * into question from public.assessment_questions where id = entry.key::uuid and assessment_id = assessment;
    if not found or jsonb_typeof(entry.value) <> 'string' or length(entry.value #>> '{}') > 4000 then
      raise exception 'Invalid question answer' using errcode = '22023';
    end if;
    if question.kind = 'single_choice' and entry.value #>> '{}' <> ''
      and not (question.choices ? (entry.value #>> '{}')) then
      raise exception 'Answer is not one of the available choices' using errcode = '22023';
    end if;
  end loop;
  select * into existing from public.assessment_attempts where assessment_id = assessment
    and student_id = auth.uid() and status = 'in_progress' for update;
  if found then
    update public.assessment_attempts set answers = submit_assessment_attempt.answers where id = existing.id returning id into attempt_id;
  else
    if (select count(*) from public.assessment_attempts where assessment_id = assessment and student_id = auth.uid()) >= 20
      or exists (select 1 from public.assessment_attempts where assessment_id = assessment and status <> 'scored') then
      raise exception 'A tutor must authorize each new retake after the previous attempt is scored' using errcode = '22023';
    end if;
    select coalesce(max(attempt_no), 0) + 1 into next_no from public.assessment_attempts
      where assessment_id = assessment and student_id = auth.uid();
    insert into public.assessment_attempts(assessment_id, student_id, attempt_no, answers)
    values (assessment, auth.uid(), next_no, submit_assessment_attempt.answers) returning id into attempt_id;
  end if;
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
    where id = attempt_id;
    update public.assessments set status = case when has_subjective then 'submitted' else 'scored' end where id = assessment;
  end if;
  return attempt_id;
end;
$$;

create or replace function public.score_assessment_attempt(attempt uuid, tutor_points integer, feedback text) returns void
language plpgsql security definer set search_path = '' as $$
declare selected public.assessment_attempts; parent public.assessments; subjective_maximum integer;
begin
  select * into selected from public.assessment_attempts where id = attempt for update;
  if not found then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into parent from public.assessments where id = selected.assessment_id for update;
  if not private.owns_tutor(parent.tutor_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if selected.status <> 'submitted' then raise exception 'Attempt is not awaiting tutor scoring' using errcode = '22023'; end if;
  select coalesce(sum(points), 0) into subjective_maximum from public.assessment_questions
    where assessment_id = parent.id and kind = 'short_answer';
  if tutor_points is null or tutor_points < 0 or tutor_points > subjective_maximum
    or selected.auto_score + tutor_points > selected.max_score then
    raise exception 'Score out of range' using errcode = '22023';
  end if;
  update public.assessment_attempts set status = 'scored', tutor_score = tutor_points,
    score = selected.auto_score + tutor_points, tutor_feedback = private.require_text(feedback, 4000, false),
    scored_at = statement_timestamp() where id = attempt;
  update public.assessments set status = 'scored' where id = parent.id and status = 'submitted';
end;
$$;

-- Reusable, relationship-scoped picker data. It exposes only display names and booking/subject metadata.
create function public.list_learning_relationships()
returns table(booking_id uuid, tutor_id uuid, student_id uuid, subject_id uuid, subject_name text,
  ends_at timestamptz, student_name text, tutor_name text)
language sql stable security definer set search_path = '' as $$
  select bookings.id, bookings.tutor_id, bookings.student_id, bookings.subject_id, subjects.name,
    bookings.ends_at, student_profile.display_name, tutors.public_display_name
  from public.bookings as bookings
  join public.tutor_profiles as tutors on tutors.id = bookings.tutor_id
  join public.profiles as student_profile on student_profile.id = bookings.student_id
  join public.subjects as subjects on subjects.id = bookings.subject_id
  where private.booking_participant(bookings.id)
    and bookings.status in ('confirmed', 'in_progress', 'completed')
    and (private.booking_student(bookings.id) or private.booking_tutor(bookings.id))
  order by bookings.ends_at desc;
$$;

-- Assignment authoring remains a single transaction and stores the tutor listing, never a browser-supplied author.
create function public.create_learning_assignment(
  tutor uuid, student uuid, booking uuid, title text, instructions text, submission_type text,
  due_at timestamptz, accepts_late boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare created uuid;
begin
  if not private.owns_tutor(tutor) or not private.eligible_learning_student(student)
    or not private.tutor_student_related(tutor, student) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform private.check_learning_link(tutor, student, booking);
  if submission_type is null or submission_type not in ('text', 'link', 'file') or due_at is null or accepts_late is null then
    raise exception 'Invalid assignment details' using errcode = '22023';
  end if;
  insert into public.assignments(tutor_id, student_id, booking_id, title, instructions, submission_type, due_at, accepts_late)
  values (tutor, student, booking, private.require_text(title, 200, true),
    private.require_text(instructions, 4000, true), submission_type, due_at, accepts_late)
  returning id into created;
  return created;
end;
$$;

create function public.update_learning_assignment(
  assignment uuid, title text, instructions text, submission_type text, due_at timestamptz, accepts_late boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare selected public.assignments;
begin
  select * into selected from public.assignments where id = assignment for update;
  if not found or not private.owns_tutor(selected.tutor_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if selected.status <> 'draft' then raise exception 'Only drafts can be edited' using errcode = '22023'; end if;
  if submission_type is null or submission_type not in ('text', 'link', 'file') or due_at is null or accepts_late is null then
    raise exception 'Invalid assignment details' using errcode = '22023';
  end if;
  update public.assignments set title = private.require_text(title, 200, true),
    instructions = private.require_text(instructions, 4000, true), submission_type = update_learning_assignment.submission_type,
    due_at = update_learning_assignment.due_at, accepts_late = update_learning_assignment.accepts_late
  where id = assignment;
end;
$$;

create function public.assign_learning_assignment(assignment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare selected_tutor uuid;
begin
  select assignments.tutor_id into selected_tutor from public.assignments where id = assignment for update;
  if selected_tutor is null or not private.owns_tutor(selected_tutor) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.assignments set status = 'assigned' where id = assignment;
end;
$$;

create function private.assignment_file_uploadable(path text, require_open boolean default true) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare assignment_text text; student_text text; selected public.assignments;
begin
  if path !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg|txt)$' then
    return false;
  end if;
  assignment_text := split_part(path, '/', 1);
  student_text := split_part(path, '/', 2);
  if student_text <> auth.uid()::text or not private.has_role('student') then return false; end if;
  select * into selected from public.assignments where id = assignment_text::uuid;
  if not found or selected.student_id <> auth.uid() or selected.submission_type <> 'file' then return false; end if;
  if require_open and (selected.status not in ('assigned', 'returned')
    or (statement_timestamp() > selected.due_at and not selected.accepts_late)) then return false; end if;
  return true;
end;
$$;

create function private.assignment_storage_object_matches(path text, mime text, bytes integer) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare object_exists boolean := false;
begin
  if to_regclass('storage.objects') is null or path is null then return false; end if;
  execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2 '
    || 'and owner_id = $3 and metadata ->> ''mimetype'' = $4 '
    || 'and (metadata ->> ''size'') ~ ''^[0-9]+$'' and (metadata ->> ''size'')::bigint = $5)'
    into object_exists using 'assignment-submissions', path, auth.uid()::text, mime, bytes;
  return object_exists;
exception when others then
  return false;
end;
$$;

create or replace function private.guard_submission() returns trigger
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
  if selected.submission_type <> 'file' and new.file_path is not null then
    raise exception 'This assignment does not accept file submissions' using errcode = '22023';
  end if;
  if new.file_path is not null and (new.file_path not like new.assignment_id::text || '/' || new.student_id::text || '/%'
    or new.file_mime not in ('application/pdf', 'image/png', 'image/jpeg', 'text/plain')
    or new.file_size_bytes is null or new.file_size_bytes > 10485760
    or not private.assignment_storage_object_matches(new.file_path, new.file_mime, new.file_size_bytes)) then
    raise exception 'File must be a private uploaded object owned by the assigned student' using errcode = '22023';
  end if;
  new.is_late := statement_timestamp() > selected.due_at;
  new.submitted_at := statement_timestamp();
  new.attempt_no := coalesce((select max(attempt_no) from public.assignment_submissions where assignment_id = new.assignment_id), 0) + 1;
  return new;
end;
$$;

create function private.freeze_assigned_assignment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'draft' and (new.title, new.instructions, new.submission_type, new.due_at, new.accepts_late)
    is distinct from (old.title, old.instructions, old.submission_type, old.due_at, old.accepts_late) then
    raise exception 'Assigned assignment content is frozen' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger assignments_freeze_content before update on public.assignments
for each row execute function private.freeze_assigned_assignment();

create function public.submit_assignment_with_file(
  assignment uuid, body text, link_url text, file_path text, file_mime text, file_size_bytes integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected public.assignments; created uuid;
begin
  if not private.has_role('student') then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into selected from public.assignments where id = assignment for update;
  if not found or selected.student_id <> auth.uid() or selected.status not in ('assigned', 'returned') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  insert into public.assignment_submissions(assignment_id, student_id, attempt_no, body, link_url, file_path, file_mime, file_size_bytes)
  values (assignment, auth.uid(), 1, private.require_text(body, 8000, false),
    nullif(btrim(link_url), ''), nullif(btrim(file_path), ''), nullif(file_mime, ''), file_size_bytes)
  returning id into created;
  return created;
end;
$$;

create function private.assignment_file_reader(path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assignment_submissions as submissions
    join public.assignments as assignments on assignments.id = submissions.assignment_id
    where submissions.file_path = path and private.assignment_reader(assignments.id)
  );
$$;

create function private.assignment_file_orphan_owner(path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.assignment_file_uploadable(path, false) and not exists (
    select 1 from public.assignment_submissions where file_path = path
  );
$$;

-- Study plans use immutable revision snapshots. Stable goal/milestone IDs let evidence survive a later revision
-- when the same milestone is retained; progress counts evidence only and makes no mastery inference.
create function private.valid_study_goals(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare goal jsonb; milestone jsonb; ids uuid[] := array[]::uuid[]; item_id uuid; goal_total integer;
begin
  if value is null or jsonb_typeof(value) is distinct from 'array' then return false; end if;
  goal_total := jsonb_array_length(value);
  if goal_total not between 1 and 20 or octet_length(value::text) > 65536 then return false; end if;
  for goal in select element from jsonb_array_elements(value) as items(element) loop
    if jsonb_typeof(goal) <> 'object' or coalesce(goal ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(goal -> 'title') is distinct from 'string' or nullif(btrim(goal ->> 'title'), '') is null
      or length(goal ->> 'title') > 200
      or (goal ? 'description' and jsonb_typeof(goal -> 'description') not in ('string', 'null'))
      or (jsonb_typeof(goal -> 'description') = 'string' and length(goal ->> 'description') > 2000)
      or jsonb_typeof(goal -> 'milestones') is distinct from 'array'
      or jsonb_array_length(goal -> 'milestones') not between 1 and 20 then
      return false;
    end if;
    item_id := (goal ->> 'id')::uuid;
    if item_id = any(ids) then return false; end if;
    ids := array_append(ids, item_id);
    for milestone in select element from jsonb_array_elements(goal -> 'milestones') as items(element) loop
      if jsonb_typeof(milestone) <> 'object' or coalesce(milestone ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or jsonb_typeof(milestone -> 'title') is distinct from 'string'
        or nullif(btrim(milestone ->> 'title'), '') is null or length(milestone ->> 'title') > 200
        or (milestone ? 'description' and jsonb_typeof(milestone -> 'description') not in ('string', 'null'))
        or (jsonb_typeof(milestone -> 'description') = 'string' and length(milestone ->> 'description') > 2000) then
        return false;
      end if;
      item_id := (milestone ->> 'id')::uuid;
      if item_id = any(ids) then return false; end if;
      ids := array_append(ids, item_id);
      if cardinality(ids) > 120 then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create table public.study_plans (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  subject_id uuid references public.subjects(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  current_revision integer not null default 1 check (current_revision between 1 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (subject_id is not null or booking_id is not null)
);
create index study_plans_tutor_idx on public.study_plans(tutor_id, status, updated_at desc);
create index study_plans_student_idx on public.study_plans(student_id, status, updated_at desc);
create index study_plans_booking_idx on public.study_plans(booking_id);

create table public.study_plan_revisions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.study_plans(id) on delete restrict,
  revision_no integer not null check (revision_no between 1 and 100000),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (length(description) <= 4000),
  goals jsonb not null check (private.valid_study_goals(goals)),
  authored_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (plan_id, revision_no)
);
create index study_plan_revisions_plan_idx on public.study_plan_revisions(plan_id, revision_no desc);

create table public.study_plan_evidence (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.study_plans(id) on delete restrict,
  revision_no integer not null,
  milestone_id uuid not null,
  source_kind text not null check (source_kind in ('assessment_attempt', 'assignment_submission', 'session_recap')),
  source_id uuid not null,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (plan_id, milestone_id, source_kind, source_id),
  foreign key (plan_id, revision_no) references public.study_plan_revisions(plan_id, revision_no) on delete restrict
);
create index study_plan_evidence_plan_idx on public.study_plan_evidence(plan_id, created_at desc);
create index study_plan_evidence_milestone_idx on public.study_plan_evidence(plan_id, milestone_id);

create function private.learning_plan_reader(plan uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.study_plans as plans
    where plans.id = plan and (
      (private.has_role('student') and plans.student_id = auth.uid())
      or (private.has_role('tutor') and exists (select 1 from public.tutor_profiles as tutors
        where tutors.id = plans.tutor_id and tutors.user_id = auth.uid()))
    ));
$$;

create function private.guard_study_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not private.owns_tutor(new.tutor_id) or not private.eligible_learning_student(new.student_id)
      or not private.tutor_student_related(new.tutor_id, new.student_id) then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
    perform private.check_learning_link(new.tutor_id, new.student_id, new.booking_id);
    if new.booking_id is not null and new.subject_id is not null and not exists (
      select 1 from public.bookings where id = new.booking_id and subject_id = new.subject_id) then
      raise exception 'Subject must match the linked booking' using errcode = '22023';
    end if;
  else
    if (new.id, new.tutor_id, new.student_id, new.subject_id, new.booking_id, new.created_at, new.status)
      is distinct from (old.id, old.tutor_id, old.student_id, old.subject_id, old.booking_id, old.created_at, old.status)
      or new.current_revision <> old.current_revision + 1 then
      raise exception 'Study plan identity is immutable and revisions must advance once' using errcode = '22023';
    end if;
    if not private.owns_tutor(new.tutor_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
    perform private.check_learning_link(new.tutor_id, new.student_id, new.booking_id);
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger study_plans_guard before insert or update on public.study_plans
for each row execute function private.guard_study_plan();

create function private.guard_study_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans;
begin
  if tg_op <> 'INSERT' then raise exception 'Study plan revisions are immutable' using errcode = '22023'; end if;
  select * into selected from public.study_plans where id = new.plan_id;
  if not found or not private.owns_tutor(selected.tutor_id) or new.authored_by <> auth.uid()
    or new.revision_no <> selected.current_revision or not private.valid_study_goals(new.goals) then
    raise exception 'Invalid revision provenance' using errcode = '42501';
  end if;
  new.title := private.require_text(new.title, 200, true);
  new.description := private.require_text(new.description, 4000, false);
  new.created_at := statement_timestamp();
  return new;
end;
$$;
create trigger study_plan_revisions_guard before insert or update or delete on public.study_plan_revisions
for each row execute function private.guard_study_revision();

create function private.guard_study_evidence() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; revision public.study_plan_revisions; source_booking uuid;
begin
  if tg_op <> 'INSERT' then raise exception 'Learning evidence is immutable' using errcode = '22023'; end if;
  select * into selected from public.study_plans where id = new.plan_id for update;
  if not found or not private.owns_tutor(selected.tutor_id) or new.recorded_by <> auth.uid()
    or selected.status <> 'active' or new.revision_no <> selected.current_revision then
    raise exception 'Not authorized to record evidence' using errcode = '42501';
  end if;
  perform private.check_learning_link(selected.tutor_id, selected.student_id, selected.booking_id);
  select * into revision from public.study_plan_revisions where plan_id = new.plan_id and revision_no = new.revision_no;
  if not exists (select 1 from jsonb_array_elements(revision.goals) as goals(goal),
    jsonb_array_elements(goals.goal -> 'milestones') as milestones(milestone)
    where milestones.milestone ->> 'id' = new.milestone_id::text) then
    raise exception 'Milestone is not part of the current revision' using errcode = '22023';
  end if;
  if new.source_kind = 'assessment_attempt' then
    if not exists (select 1 from public.assessment_attempts as attempts join public.assessments as assessments
      on assessments.id = attempts.assessment_id where attempts.id = new.source_id and attempts.status = 'scored'
        and assessments.tutor_id = selected.tutor_id and assessments.student_id = selected.student_id
        and (selected.subject_id is null or assessments.subject_id = selected.subject_id)) then
      raise exception 'Assessment attempt is not eligible evidence for this plan' using errcode = '22023';
    end if;
  elsif new.source_kind = 'assignment_submission' then
    if not exists (select 1 from public.assignment_submissions as submissions join public.assignments as assignments
      on assignments.id = submissions.assignment_id where submissions.id = new.source_id
        and assignments.tutor_id = selected.tutor_id and assignments.student_id = selected.student_id
        and assignments.status <> 'draft'
        and (selected.subject_id is null or exists (select 1 from public.bookings
          where bookings.id = assignments.booking_id and bookings.subject_id = selected.subject_id))) then
      raise exception 'Assignment submission is not eligible evidence for this plan' using errcode = '22023';
    end if;
  elsif new.source_kind = 'session_recap' then
    source_booking := new.source_id;
    if not exists (select 1 from public.session_recaps as recaps join public.bookings as bookings
      on bookings.id = recaps.booking_id where recaps.booking_id = source_booking
        and recaps.tutor_id = selected.tutor_id and bookings.student_id = selected.student_id
        and bookings.status = 'completed'
        and (selected.subject_id is null or bookings.subject_id = selected.subject_id)) then
      raise exception 'Session recap is not eligible evidence for this plan' using errcode = '22023';
    end if;
  else
    raise exception 'Unsupported learning evidence type' using errcode = '22023';
  end if;
  new.created_at := statement_timestamp();
  return new;
end;
$$;
create trigger study_plan_evidence_guard before insert or update or delete on public.study_plan_evidence
for each row execute function private.guard_study_evidence();

create function public.create_study_plan(
  tutor uuid, student uuid, subject uuid, booking uuid, title text, description text, goals jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare created uuid;
begin
  if not private.owns_tutor(tutor) or not private.eligible_learning_student(student)
    or not private.tutor_student_related(tutor, student) then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform private.check_learning_link(tutor, student, booking);
  if subject is null and booking is null then raise exception 'A subject or session is required' using errcode = '22023'; end if;
  if subject is not null and not exists (select 1 from public.tutor_subjects where tutor_id = tutor and subject_id = subject) then
    raise exception 'Subject is not offered by this tutor' using errcode = '22023';
  end if;
  if booking is not null and subject is not null and not exists (select 1 from public.bookings where id = booking and subject_id = subject) then
    raise exception 'Subject must match the linked booking' using errcode = '22023';
  end if;
  if not private.valid_study_goals(goals) then raise exception 'Invalid study plan goals' using errcode = '22023'; end if;
  insert into public.study_plans(tutor_id, student_id, subject_id, booking_id)
  values (tutor, student, subject, booking) returning id into created;
  insert into public.study_plan_revisions(plan_id, revision_no, title, description, goals, authored_by)
  values (created, 1, private.require_text(title, 200, true), private.require_text(description, 4000, false), goals, auth.uid());
  return created;
end;
$$;

create function public.revise_study_plan(
  study_plan uuid, expected_revision integer, title text, description text, goals jsonb
) returns integer
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; next_revision integer;
begin
  select * into selected from public.study_plans where id = study_plan for update;
  if not found or not private.owns_tutor(selected.tutor_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if selected.status <> 'active' or expected_revision is null or selected.current_revision <> expected_revision then
    raise exception 'Study plan changed; refresh before revising' using errcode = '23505';
  end if;
  if not private.valid_study_goals(goals) then raise exception 'Invalid study plan goals' using errcode = '22023'; end if;
  next_revision := selected.current_revision + 1;
  update public.study_plans set current_revision = next_revision where id = study_plan;
  insert into public.study_plan_revisions(plan_id, revision_no, title, description, goals, authored_by)
  values (study_plan, next_revision, private.require_text(title, 200, true),
    private.require_text(description, 4000, false), goals, auth.uid());
  return next_revision;
end;
$$;

create function public.record_study_evidence(
  study_plan uuid, milestone uuid, source_kind text, source_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; created uuid;
begin
  select * into selected from public.study_plans where id = study_plan for update;
  if not found or not private.owns_tutor(selected.tutor_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
  insert into public.study_plan_evidence(plan_id, revision_no, milestone_id, source_kind, source_id, recorded_by)
  values (study_plan, selected.current_revision, milestone, source_kind, source_id, auth.uid()) returning id into created;
  return created;
end;
$$;

create function public.list_study_evidence_candidates(study_plan uuid)
returns table(source_kind text, source_id uuid, label text, occurred_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare selected public.study_plans;
begin
  select * into selected from public.study_plans where id = study_plan;
  if not found or not private.owns_tutor(selected.tutor_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
  return query
    select 'assessment_attempt'::text, attempts.id,
      'Assessment: ' || assessments.title || ' · attempt ' || attempts.attempt_no::text, attempts.scored_at
    from public.assessment_attempts as attempts join public.assessments as assessments on assessments.id = attempts.assessment_id
    where attempts.status = 'scored' and assessments.tutor_id = selected.tutor_id
      and assessments.student_id = selected.student_id
      and (selected.subject_id is null or assessments.subject_id = selected.subject_id)
    union all
    select 'assignment_submission'::text, submissions.id,
      'Assignment: ' || assignments.title || ' · submission ' || submissions.attempt_no::text, submissions.submitted_at
    from public.assignment_submissions as submissions join public.assignments as assignments on assignments.id = submissions.assignment_id
    where assignments.tutor_id = selected.tutor_id and assignments.student_id = selected.student_id
      and assignments.status <> 'draft'
      and (selected.subject_id is null or exists (select 1 from public.bookings
        where bookings.id = assignments.booking_id and bookings.subject_id = selected.subject_id))
    union all
    select 'session_recap'::text, bookings.id, 'Session recap', recaps.published_at
    from public.session_recaps as recaps join public.bookings as bookings on bookings.id = recaps.booking_id
    where recaps.tutor_id = selected.tutor_id and bookings.student_id = selected.student_id and bookings.status = 'completed'
      and (selected.subject_id is null or bookings.subject_id = selected.subject_id)
    order by 4 desc;
end;
$$;

-- No table-level mutation bypasses the invariant-preserving functions above.
revoke all on public.assessments, public.assessment_questions, public.assessment_answer_keys,
  public.assessment_attempts, public.assignments, public.assignment_submissions, public.assignment_feedback
  from public, anon, authenticated, service_role;
grant select on public.assessments, public.assessment_questions, public.assessment_answer_keys,
  public.assessment_attempts, public.assignments, public.assignment_submissions, public.assignment_feedback
  to authenticated;
-- Preserve the original RLS- and trigger-guarded authoring interface for existing clients and SQL regressions.
grant insert, delete on public.assessments, public.assessment_questions, public.assessment_answer_keys to authenticated;
grant update(title, instructions, subject_id, booking_id, purpose, status, due_at) on public.assessments to authenticated;
grant update(position, prompt, kind, choices, points) on public.assessment_questions to authenticated;
grant update(correct_choice) on public.assessment_answer_keys to authenticated;
grant insert on public.assignments to authenticated;
grant update(title, instructions, submission_type, due_at, accepts_late, status, cancellation_reason)
  on public.assignments to authenticated;

alter table public.study_plans enable row level security;
alter table public.study_plan_revisions enable row level security;
alter table public.study_plan_evidence enable row level security;
revoke all on public.study_plans, public.study_plan_revisions, public.study_plan_evidence
  from public, anon, authenticated, service_role;
grant select on public.study_plans, public.study_plan_revisions, public.study_plan_evidence to authenticated;
create policy study_plans_participant_read on public.study_plans for select to authenticated
  using (private.learning_plan_reader(id));
create policy study_revisions_participant_read on public.study_plan_revisions for select to authenticated
  using (private.learning_plan_reader(plan_id));
create policy study_evidence_participant_read on public.study_plan_evidence for select to authenticated
  using (private.learning_plan_reader(plan_id));

-- Private Supabase Storage bucket. A standard Supabase project has these tables; native/local replay fixtures may
-- omit them, so storage setup is conditional while the database still rejects unverified file submissions.
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    execute $bucket$
      insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      values ('assignment-submissions', 'assignment-submissions', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'text/plain']::text[])
      on conflict (id) do update set public = false, file_size_limit = 10485760,
        allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'text/plain']::text[]
    $bucket$;
    execute 'alter table storage.objects enable row level security';
    execute 'drop policy if exists assignment_submissions_upload on storage.objects';
    execute 'drop policy if exists assignment_submissions_read on storage.objects';
    execute 'drop policy if exists assignment_submissions_orphan_cleanup on storage.objects';
    execute $policy$
      create policy assignment_submissions_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'assignment-submissions' and private.assignment_file_uploadable(name)
        and metadata ->> 'mimetype' in ('application/pdf', 'image/png', 'image/jpeg', 'text/plain')
        and case when coalesce(metadata ->> 'size', '') ~ '^[0-9]+$'
          then (metadata ->> 'size')::bigint between 1 and 10485760 else false end)
    $policy$;
    execute $policy$
      create policy assignment_submissions_read on storage.objects for select to authenticated
      using (bucket_id = 'assignment-submissions' and private.assignment_file_reader(name))
    $policy$;
    execute $policy$
      create policy assignment_submissions_orphan_cleanup on storage.objects for delete to authenticated
      using (bucket_id = 'assignment-submissions' and private.assignment_file_orphan_owner(name))
    $policy$;
  end if;
end;
$$;

revoke all on function public.list_learning_relationships(),
  public.create_learning_assessment(uuid, uuid, uuid, uuid, jsonb),
  public.update_learning_assessment(uuid, jsonb), public.assign_learning_assessment(uuid),
  public.authorize_assessment_retake(uuid), public.submit_assessment_attempt(uuid, jsonb, boolean),
  public.score_assessment_attempt(uuid, integer, text),
  public.create_learning_assignment(uuid, uuid, uuid, text, text, text, timestamptz, boolean),
  public.update_learning_assignment(uuid, text, text, text, timestamptz, boolean),
  public.assign_learning_assignment(uuid),
  public.submit_assignment_with_file(uuid, text, text, text, text, integer),
  public.give_assignment_feedback(uuid, text, integer, text), public.create_study_plan(uuid, uuid, uuid, uuid, text, text, jsonb),
  public.revise_study_plan(uuid, integer, text, text, jsonb), public.record_study_evidence(uuid, uuid, text, uuid),
  public.list_study_evidence_candidates(uuid)
  from public, anon, authenticated;
grant execute on function public.list_learning_relationships(),
  public.create_learning_assessment(uuid, uuid, uuid, uuid, jsonb),
  public.update_learning_assessment(uuid, jsonb), public.assign_learning_assessment(uuid),
  public.authorize_assessment_retake(uuid), public.submit_assessment_attempt(uuid, jsonb, boolean),
  public.score_assessment_attempt(uuid, integer, text),
  public.create_learning_assignment(uuid, uuid, uuid, text, text, text, timestamptz, boolean),
  public.update_learning_assignment(uuid, text, text, text, timestamptz, boolean),
  public.assign_learning_assignment(uuid),
  public.submit_assignment_with_file(uuid, text, text, text, text, integer),
  public.give_assignment_feedback(uuid, text, integer, text), public.create_study_plan(uuid, uuid, uuid, uuid, text, text, jsonb),
  public.revise_study_plan(uuid, integer, text, text, jsonb), public.record_study_evidence(uuid, uuid, text, uuid),
  public.list_study_evidence_candidates(uuid) to authenticated;

revoke all on function private.valid_assessment_payload(jsonb), private.valid_study_goals(jsonb),
  private.eligible_learning_student(uuid),
  private.assignment_file_uploadable(text, boolean), private.assignment_storage_object_matches(text, text, integer),
  private.assignment_file_reader(text), private.assignment_file_orphan_owner(text), private.learning_plan_reader(uuid)
  from public, anon, authenticated;
grant execute on function private.assignment_file_uploadable(text, boolean), private.assignment_file_reader(text),
  private.assignment_file_orphan_owner(text), private.learning_plan_reader(uuid) to authenticated;

commit;



