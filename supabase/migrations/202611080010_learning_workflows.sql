begin;
set local search_path = public, extensions, pg_catalog;

-- Explicit topic tags are stored on new questions. Historical questions remain NULL (unknown).
alter table public.assessment_questions add column if not exists topic text;
alter table public.assessment_questions add constraint assessment_questions_topic_length
  check (topic is null or length(btrim(topic)) between 1 and 200) not valid;

create table public.assessment_topic_evidence (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.assessment_attempts(id) on delete restrict,
  question_id uuid not null references public.assessment_questions(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  tutor_id uuid not null references public.tutor_profiles(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  topic text not null check (length(btrim(topic)) between 1 and 200),
  points_earned smallint not null check (points_earned >= 0),
  points_possible smallint not null check (points_possible between 1 and 100),
  occurred_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (attempt_id,question_id),
  check (points_earned <= points_possible)
);
create index assessment_topic_evidence_student_topic_idx on public.assessment_topic_evidence(student_id,subject_id,topic,occurred_at desc);

create function private.record_assessment_topic_evidence() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status='scored' and (tg_op='INSERT' or old.status is distinct from 'scored') then
    insert into public.assessment_topic_evidence(attempt_id,question_id,student_id,tutor_id,subject_id,topic,points_earned,points_possible,occurred_at)
    select new.id,questions.id,assessments.student_id,assessments.tutor_id,assessments.subject_id,questions.topic,
      case when answer_keys.correct_choice = new.answers->>questions.id::text then questions.points else 0 end,
      questions.points,coalesce(new.scored_at,statement_timestamp())
    from public.assessment_questions as questions
    join public.assessments as assessments on assessments.id=questions.assessment_id
    join public.assessment_answer_keys as answer_keys on answer_keys.question_id=questions.id
    where assessments.id=new.assessment_id and questions.kind='single_choice' and questions.topic is not null
    on conflict (attempt_id,question_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger assessment_topic_evidence_capture after insert or update of status on public.assessment_attempts
for each row execute function private.record_assessment_topic_evidence();
alter table public.assessment_topic_evidence enable row level security;
revoke all on public.assessment_topic_evidence from public,anon,authenticated,service_role;
grant select on public.assessment_topic_evidence to authenticated;
create policy assessment_topic_evidence_participant_read on public.assessment_topic_evidence for select to authenticated using (
  (private.has_role('student') and student_id=auth.uid()) or private.owns_tutor(tutor_id));

create function public.create_tagged_learning_assessment(
  tutor uuid,student uuid,subject uuid,booking uuid,payload jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare created uuid; item jsonb; position_no integer:=0;
begin
  if payload is null or jsonb_typeof(payload->'questions') is distinct from 'array' then
    raise exception 'Assessment topics are required' using errcode='22023';
  end if;
  for item in select rows.entry from jsonb_array_elements(payload->'questions') as rows(entry) loop
    if nullif(btrim(item->>'topic'),'') is null or length(item->>'topic')>200 then
      raise exception 'Add a topic to every assessment question' using errcode='22023';
    end if;
  end loop;
  created:=public.create_learning_assessment(tutor,student,subject,booking,payload);
  for item in select rows.entry from jsonb_array_elements(payload->'questions') with ordinality as rows(entry,ordinality) order by rows.ordinality loop
    position_no:=position_no+1;
    update public.assessment_questions set topic=private.require_text(item->>'topic',200,true)
      where assessment_id=created and position=position_no;
  end loop;
  return created;
end;
$$;

create function public.update_tagged_learning_assessment(assessment uuid,payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare item jsonb; position_no integer:=0;
begin
  if payload is null or jsonb_typeof(payload->'questions') is distinct from 'array' then
    raise exception 'Assessment topics are required' using errcode='22023';
  end if;
  for item in select rows.entry from jsonb_array_elements(payload->'questions') as rows(entry) loop
    if nullif(btrim(item->>'topic'),'') is null or length(item->>'topic')>200 then
      raise exception 'Add a topic to every assessment question' using errcode='22023';
    end if;
  end loop;
  perform public.update_learning_assessment(assessment,payload);
  for item in select rows.entry from jsonb_array_elements(payload->'questions') with ordinality as rows(entry,ordinality) order by rows.ordinality loop
    position_no:=position_no+1;
    update public.assessment_questions set topic=private.require_text(item->>'topic',200,true)
      where assessment_id=assessment and position=position_no;
  end loop;
end;
$$;

-- Link new tasks to an explicit topic and, where selected, a pinned plan revision/milestone.
alter table public.assignments add column if not exists subject_id uuid references public.subjects(id) on delete restrict;
alter table public.assignments add column if not exists topic text;
alter table public.assignments add column if not exists study_plan_id uuid references public.study_plans(id) on delete restrict;
alter table public.assignments add column if not exists plan_revision_no integer;
alter table public.assignments add column if not exists milestone_id uuid;
update public.assignments as assignments set subject_id=bookings.subject_id
from public.bookings as bookings where bookings.id=assignments.booking_id and assignments.subject_id is null;
alter table public.assignments add constraint assignments_plan_revision_fk
  foreign key (study_plan_id,plan_revision_no) references public.study_plan_revisions(plan_id,revision_no) on delete restrict;
alter table public.assignments add constraint assignments_milestone_link_pair
  check ((study_plan_id is null and plan_revision_no is null and milestone_id is null)
    or (study_plan_id is not null and plan_revision_no is not null and milestone_id is not null)) not valid;
alter table public.assignments add constraint assignments_topic_length
  check (topic is null or length(btrim(topic)) between 1 and 200) not valid;

create function private.guard_assignment_learning_context() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected_booking public.bookings; selected_plan public.study_plans; target_topic text;
begin
  if new.booking_id is not null then
    select * into selected_booking from public.bookings where id=new.booking_id;
    if not found then raise exception 'Unknown assignment booking' using errcode='22023'; end if;
    if new.subject_id is not null and new.subject_id<>selected_booking.subject_id then
      raise exception 'Assignment subject must match its booking' using errcode='22023'; end if;
    new.subject_id:=selected_booking.subject_id;
  end if;
  if new.topic is not null then new.topic:=private.require_text(new.topic,200,true); end if;
  if tg_op='UPDATE' and old.status<>'draft'
    and (new.subject_id,new.topic,new.study_plan_id,new.plan_revision_no,new.milestone_id)
      is distinct from (old.subject_id,old.topic,old.study_plan_id,old.plan_revision_no,old.milestone_id) then
    raise exception 'Assigned learning context is immutable' using errcode='22023';
  end if;
  if new.study_plan_id is null then return new; end if;
  select * into selected_plan from public.study_plans where id=new.study_plan_id;
  if not found or selected_plan.tutor_id is distinct from new.tutor_id or selected_plan.student_id<>new.student_id
    or selected_plan.subject_id is distinct from new.subject_id or selected_plan.booking_id is distinct from new.booking_id then
    raise exception 'Milestone plan must match assignment participants, subject and booking' using errcode='22023';
  end if;
  select goals.goal->>'topic' into target_topic
  from public.study_plan_revisions as revisions,jsonb_array_elements(revisions.goals) as goals(goal),
    jsonb_array_elements(goals.goal->'milestones') as milestones(item)
  where revisions.plan_id=new.study_plan_id and revisions.revision_no=new.plan_revision_no
    and milestones.item->>'id'=new.milestone_id::text;
  if not found or new.topic is null or lower(btrim(target_topic))<>lower(btrim(new.topic)) then
    raise exception 'Choose a milestone from the same learning topic' using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger assignments_learning_context_guard before insert or update on public.assignments
for each row execute function private.guard_assignment_learning_context();

create function public.create_tagged_learning_assignment(
  tutor uuid,student uuid,booking uuid,title text,instructions text,submission_type text,due_at timestamptz,
  accepts_late boolean,topic text,study_plan uuid,milestone uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare created uuid; selected_booking public.bookings; selected_plan public.study_plans;
begin
  if booking is null or not private.owns_tutor(tutor) or not private.eligible_learning_student(student)
    or not private.tutor_student_related(tutor,student) then raise exception 'Not authorized' using errcode='42501'; end if;
  perform private.check_learning_link(tutor,student,booking);
  select * into selected_booking from public.bookings where id=booking and tutor_id=tutor and student_id=student;
  if not found then raise exception 'Choose a real learning relationship' using errcode='42501'; end if;
  if not exists(select 1 from public.subjects where id=selected_booking.subject_id and active) then
    raise exception 'The assignment subject is not active' using errcode='22023'; end if;
  if nullif(btrim(topic),'') is null or length(topic)>200 then raise exception 'Choose a topic' using errcode='22023'; end if;
  if study_plan is not null or milestone is not null then
    if study_plan is null or milestone is null then raise exception 'Choose both a plan and milestone' using errcode='22023'; end if;
    select * into selected_plan from public.study_plans where id=study_plan for share;
    if not found or selected_plan.tutor_id is distinct from tutor or selected_plan.student_id<>student
      or selected_plan.subject_id<>selected_booking.subject_id or selected_plan.booking_id<>booking then
      raise exception 'Plan must match this relationship' using errcode='22023'; end if;
    created:=public.create_learning_assignment(tutor,student,booking,title,instructions,submission_type,due_at,accepts_late);
    update public.assignments set topic=private.require_text(create_tagged_learning_assignment.topic,200,true),study_plan_id=study_plan,
      plan_revision_no=selected_plan.current_revision,milestone_id=milestone where id=created;
  else
    created:=public.create_learning_assignment(tutor,student,booking,title,instructions,submission_type,due_at,accepts_late);
    update public.assignments set topic=private.require_text(create_tagged_learning_assignment.topic,200,true) where id=created;
  end if;
  return created;
end;
$$;

create function public.update_tagged_learning_assignment(
  assignment uuid,title text,instructions text,submission_type text,due_at timestamptz,
  accepts_late boolean,topic text,study_plan uuid,milestone uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare selected public.assignments; plan_row public.study_plans;
begin
  select * into selected from public.assignments where id=assignment for update;
  if not found or not private.owns_tutor(selected.tutor_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  if selected.status<>'draft' then raise exception 'Only drafts can be edited' using errcode='22023'; end if;
  if nullif(btrim(topic),'') is null or length(topic)>200 then raise exception 'Choose a topic' using errcode='22023'; end if;
  if (study_plan is null)<>(milestone is null) then raise exception 'Choose both a plan and milestone' using errcode='22023'; end if;
  if study_plan is not null then
    select * into plan_row from public.study_plans where id=study_plan for share;
    if not found or plan_row.tutor_id is distinct from selected.tutor_id or plan_row.student_id<>selected.student_id
      or plan_row.subject_id is distinct from selected.subject_id or plan_row.booking_id is distinct from selected.booking_id then
      raise exception 'Plan must match this assignment relationship' using errcode='22023'; end if;
  end if;
  perform public.update_learning_assignment(assignment,title,instructions,submission_type,due_at,accepts_late);
  update public.assignments set topic=private.require_text(update_tagged_learning_assignment.topic,200,true),study_plan_id=study_plan,
    plan_revision_no=case when study_plan is null then null else plan_row.current_revision end,milestone_id=milestone
    where id=assignment;
end;
$$;

create table public.assignment_submission_drafts (
  assignment_id uuid primary key references public.assignments(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  body text check (body is null or length(body)<=8000),
  link_url text check (link_url is null or (length(link_url)<=1000 and link_url ~ '^https://')),
  updated_at timestamptz not null default statement_timestamp(),
  check (coalesce(length(btrim(body)),0)>0 or link_url is not null),
  check (body is null or link_url is null)
);
create index assignment_submission_drafts_student_idx on public.assignment_submission_drafts(student_id,updated_at desc);
create function private.guard_assignment_submission_draft() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected public.assignments;
begin
  if tg_op='DELETE' then
    if not private.has_role('student') or old.student_id<>auth.uid() then raise exception 'Not authorized' using errcode='42501'; end if;
    return old;
  end if;
  select * into selected from public.assignments where id=new.assignment_id for update;
  if not found or not private.has_role('student') or new.student_id<>auth.uid() or selected.student_id<>auth.uid() then
    raise exception 'Not authorized' using errcode='42501'; end if;
  if selected.submissions_closed_at is not null or selected.status not in ('assigned','returned')
    or (statement_timestamp()>selected.due_at and not selected.accepts_late) then
    raise exception 'Assignment is closed for drafts' using errcode='22023'; end if;
  if (selected.submission_type='text' and (new.body is null or new.link_url is not null))
    or (selected.submission_type='link' and (new.link_url is null or new.body is not null))
    or selected.submission_type='file' then raise exception 'Draft must match a text or link assignment' using errcode='22023'; end if;
  new.body:=private.require_text(new.body,8000,false);
  if new.link_url is not null then new.link_url:=private.require_text(new.link_url,1000,true); end if;
  if tg_op='UPDATE' then new.updated_at:=statement_timestamp(); else new.updated_at:=statement_timestamp(); end if;
  return new;
end;
$$;
create trigger assignment_submission_drafts_guard before insert or update or delete on public.assignment_submission_drafts
for each row execute function private.guard_assignment_submission_draft();
alter table public.assignment_submission_drafts enable row level security;
revoke all on public.assignment_submission_drafts from public,anon,authenticated,service_role;
grant select on public.assignment_submission_drafts to authenticated;
create policy assignment_submission_drafts_student_read on public.assignment_submission_drafts for select to authenticated
  using (student_id=auth.uid() and private.has_role('student'));

create function public.save_assignment_submission_draft(assignment uuid,body text,link_url text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare saved timestamptz;
begin
  if not private.has_role('student') then raise exception 'Not authorized' using errcode='42501'; end if;
  insert into public.assignment_submission_drafts(assignment_id,student_id,body,link_url)
  values(assignment,auth.uid(),nullif(btrim(body),''),nullif(btrim(link_url),''))
  on conflict (assignment_id) do update set body=excluded.body,link_url=excluded.link_url
  returning updated_at into saved;
  return saved;
end;
$$;

create function public.submit_assignment_submission_draft(assignment uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected public.assignment_submission_drafts; created uuid;
begin
  if not private.has_role('student') then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into selected from public.assignment_submission_drafts as drafts
    where drafts.assignment_id=submit_assignment_submission_draft.assignment and drafts.student_id=auth.uid() for update;
  if not found then raise exception 'No saved draft exists' using errcode='22023'; end if;
  created:=public.submit_assignment_with_file(assignment,selected.body,selected.link_url,null,null,null);
  delete from public.assignment_submission_drafts where assignment_id=assignment and student_id=auth.uid();
  return created;
end;
$$;

-- Tutor feedback is editable with an explicit timestamp; the first publication time remains unchanged.
alter table public.assignment_feedback add column updated_at timestamptz;
update public.assignment_feedback set updated_at=created_at where updated_at is null;
alter table public.assignment_feedback alter column updated_at set not null;
alter table public.assignment_feedback alter column updated_at set default statement_timestamp();
create or replace function private.guard_feedback() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected_submission public.assignment_submissions; selected_assignment public.assignments;
begin
  select * into selected_submission from public.assignment_submissions where id=new.submission_id;
  select * into selected_assignment from public.assignments where id=selected_submission.assignment_id for update;
  if not found or new.tutor_id<>selected_assignment.tutor_id or not private.owns_tutor(selected_assignment.tutor_id) then
    raise exception 'Feedback author must be the assigning tutor' using errcode='42501'; end if;
  if selected_submission.attempt_no<>(select max(attempt_no) from public.assignment_submissions where assignment_id=selected_assignment.id) then
    raise exception 'Feedback applies to the latest submission' using errcode='22023'; end if;
  if tg_op='UPDATE' then
    if (new.id,new.submission_id,new.tutor_id,new.created_at) is distinct from (old.id,old.submission_id,old.tutor_id,old.created_at) then
      raise exception 'Feedback identity and first publication time are immutable' using errcode='22023'; end if;
  else
    new.created_at:=statement_timestamp();
  end if;
  new.feedback:=private.require_text(new.feedback,4000,true);
  if new.score is not null and new.score not between 0 and 100 then raise exception 'Invalid feedback score' using errcode='22023'; end if;
  new.updated_at:=statement_timestamp();
  return new;
end;
$$;
drop trigger assignment_feedback_guard on public.assignment_feedback;
create trigger assignment_feedback_guard before insert or update on public.assignment_feedback
for each row execute function private.guard_feedback();
drop trigger assignment_feedback_append_only on public.assignment_feedback;
create trigger assignment_feedback_no_delete before delete on public.assignment_feedback
for each row execute function private.prevent_history_mutation();
create or replace function private.after_feedback() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.assignments set status=new.outcome
    where id=(select submissions.assignment_id from public.assignment_submissions as submissions where submissions.id=new.submission_id);
  return null;
end;
$$;
drop trigger assignment_feedback_state on public.assignment_feedback;
create trigger assignment_feedback_state after insert or update of outcome on public.assignment_feedback
for each row execute function private.after_feedback();
create or replace function public.give_assignment_feedback(submission uuid,feedback text,score integer,outcome text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected_tutor uuid; created uuid;
begin
  select assignments.tutor_id into selected_tutor from public.assignment_submissions as submissions
    join public.assignments as assignments on assignments.id=submissions.assignment_id where submissions.id=submission;
  if selected_tutor is null or not private.owns_tutor(selected_tutor) then raise exception 'Not authorized' using errcode='42501'; end if;
  if outcome is null or outcome not in ('returned','completed') or (score is not null and score not between 0 and 100) then
    raise exception 'Invalid feedback' using errcode='22023'; end if;
  insert into public.assignment_feedback(submission_id,tutor_id,feedback,score,outcome)
    values(submission,selected_tutor,private.require_text(feedback,4000,true),score,outcome)
    on conflict (submission_id) do update set feedback=excluded.feedback,score=excluded.score,outcome=excluded.outcome
    returning id into created;
  return created;
end;
$$;

-- Session preparation has explicit priority tags; recaps retain tagged structured content and approved resources.
alter table public.session_plans add column priority_topics text[];
alter table public.session_recaps add column topics text[];
alter table public.session_recaps add column strengths text;
alter table public.session_recaps add column practice_areas text;

create table public.session_plan_learning_links (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  position smallint not null check(position between 1 and 20),
  link_kind text not null check(link_kind in ('resource','assignment','assessment','milestone')),
  resource_id uuid references public.resources(id) on delete restrict,
  assignment_id uuid references public.assignments(id) on delete restrict,
  assessment_id uuid references public.assessments(id) on delete restrict,
  study_plan_id uuid references public.study_plans(id) on delete restrict,
  plan_revision_no integer,
  milestone_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (study_plan_id,plan_revision_no) references public.study_plan_revisions(plan_id,revision_no) on delete restrict,
  check ((link_kind='resource' and resource_id is not null and assignment_id is null and assessment_id is null and study_plan_id is null and plan_revision_no is null and milestone_id is null)
    or (link_kind='assignment' and resource_id is null and assignment_id is not null and assessment_id is null and study_plan_id is null and plan_revision_no is null and milestone_id is null)
    or (link_kind='assessment' and resource_id is null and assignment_id is null and assessment_id is not null and study_plan_id is null and plan_revision_no is null and milestone_id is null)
    or (link_kind='milestone' and resource_id is null and assignment_id is null and assessment_id is null and study_plan_id is not null and plan_revision_no is not null and milestone_id is not null)),
  unique(booking_id,position)
);
create function private.guard_session_plan_learning_link() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected_booking public.bookings; selected_assignment public.assignments; selected_assessment public.assessments;
  selected_plan public.study_plans; valid_link boolean;
begin
  if tg_op='DELETE' then
    if not private.booking_tutor(old.booking_id) then raise exception 'Not authorized' using errcode='42501'; end if;
    return old;
  end if;
  if tg_op<>'INSERT' then raise exception 'Agenda links must be replaced through the tutor planner action' using errcode='42501'; end if;
  select * into selected_booking from public.bookings where id=new.booking_id;
  if not found or not private.booking_tutor(new.booking_id) or selected_booking.status not in ('confirmed','in_progress')
    or selected_booking.ends_at<=statement_timestamp() then raise exception 'Agenda is closed' using errcode='22023'; end if;
  if new.link_kind='resource' then
    if not exists(select 1 from public.resources where id=new.resource_id and active
      and (subject_id is null or subject_id=selected_booking.subject_id)) then raise exception 'Resource is not approved for this subject' using errcode='22023'; end if;
  elsif new.link_kind='assignment' then
    select * into selected_assignment from public.assignments where id=new.assignment_id;
    if not found or selected_assignment.tutor_id<>selected_booking.tutor_id or selected_assignment.student_id<>selected_booking.student_id
      or selected_assignment.subject_id is distinct from selected_booking.subject_id or selected_assignment.status='draft' then
      raise exception 'Assignment does not match this session' using errcode='22023'; end if;
  elsif new.link_kind='assessment' then
    select * into selected_assessment from public.assessments where id=new.assessment_id;
    if not found or selected_assessment.tutor_id<>selected_booking.tutor_id or selected_assessment.student_id<>selected_booking.student_id
      or selected_assessment.subject_id<>selected_booking.subject_id or selected_assessment.status='draft' then
      raise exception 'Assessment does not match this session' using errcode='22023'; end if;
  elsif new.link_kind='milestone' then
    select * into selected_plan from public.study_plans where id=new.study_plan_id;
    if not found or selected_plan.tutor_id is distinct from selected_booking.tutor_id or selected_plan.student_id<>selected_booking.student_id
      or selected_plan.subject_id<>selected_booking.subject_id or selected_plan.booking_id<>new.booking_id then
      raise exception 'Milestone plan does not match this session' using errcode='22023'; end if;
    select exists(select 1 from public.study_plan_revisions as revisions,jsonb_array_elements(revisions.goals) as goals(goal),
      jsonb_array_elements(goals.goal->'milestones') as milestones(item)
      where revisions.plan_id=new.study_plan_id and revisions.revision_no=new.plan_revision_no
        and revisions.revision_no=selected_plan.current_revision and milestones.item->>'id'=new.milestone_id::text) into valid_link;
    if not valid_link then raise exception 'Milestone is not in the current plan revision' using errcode='22023'; end if;
  end if;
  return new;
end;
$$;
create trigger session_plan_learning_links_guard before insert or update or delete on public.session_plan_learning_links
for each row execute function private.guard_session_plan_learning_link();
alter table public.session_plan_learning_links enable row level security;
revoke all on public.session_plan_learning_links from public,anon,authenticated,service_role;
grant select on public.session_plan_learning_links to authenticated;
create policy session_plan_learning_links_participant_read on public.session_plan_learning_links for select to authenticated
  using(private.booking_participant(booking_id));

create table public.session_recap_resources (
  booking_id uuid not null references public.session_recaps(booking_id) on delete restrict,
  position smallint not null check(position between 1 and 20),
  resource_id uuid not null references public.resources(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  primary key(booking_id,position),
  unique(booking_id,resource_id)
);
create function private.guard_session_recap_resource() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected_booking public.bookings;
begin
  if tg_op='DELETE' then
    if not private.booking_tutor(old.booking_id) then raise exception 'Not authorized' using errcode='42501'; end if;
    return old;
  end if;
  if tg_op<>'INSERT' then raise exception 'Recap resource snapshots are replaced through the tutor recap action' using errcode='42501'; end if;
  select * into selected_booking from public.bookings where id=new.booking_id;
  if not found or not private.booking_tutor(new.booking_id) or not private.session_has_ended(new.booking_id)
    or not exists(select 1 from public.resources where id=new.resource_id and active
    and (subject_id is null or subject_id=selected_booking.subject_id)) then
    raise exception 'Resource must be active and match the recap subject' using errcode='22023'; end if;
  return new;
end;
$$;
create trigger session_recap_resources_guard before insert or update or delete on public.session_recap_resources
for each row execute function private.guard_session_recap_resource();
alter table public.session_recap_resources enable row level security;
revoke all on public.session_recap_resources from public,anon,authenticated,service_role;
grant select on public.session_recap_resources to authenticated;
create policy session_recap_resources_participant_read on public.session_recap_resources for select to authenticated
  using(private.booking_participant(booking_id));

create function public.save_session_preparation(booking uuid,goals text,questions text,priority_topics text[]) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare saved timestamptz; item text; normalized text[]:=array[]::text[];
begin
  if not private.booking_student(booking) then raise exception 'Not authorized' using errcode='42501'; end if;
  if not exists(select 1 from public.bookings where id=booking and status in ('confirmed','in_progress')
    and ends_at>statement_timestamp()) then
    raise exception 'Planner is closed for this booking' using errcode='22023'; end if;
  if priority_topics is null or cardinality(priority_topics)>10 then raise exception 'Choose up to ten priority topics' using errcode='22023'; end if;
  foreach item in array priority_topics loop
    item:=private.require_text(item,200,true);
    if not item=any(normalized) then normalized:=array_append(normalized,item); end if;
  end loop;
  insert into public.session_plans(booking_id,student_goals,student_questions,priority_topics,student_updated_at)
  values(booking,private.require_text(goals,2000,true),private.require_text(questions,2000,false),normalized,statement_timestamp())
  on conflict(booking_id) do update set student_goals=excluded.student_goals,student_questions=excluded.student_questions,
    priority_topics=excluded.priority_topics,student_updated_at=excluded.student_updated_at
  returning student_updated_at into saved;
  return saved;
end;
$$;

create function public.save_session_agenda_learning_links(booking uuid,links jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare item jsonb; kind text; link_id uuid; plan_id uuid; milestone uuid; position_no integer:=0; plan_row public.study_plans;
begin
  if not private.booking_tutor(booking) then raise exception 'Not authorized' using errcode='42501'; end if;
  if not exists(select 1 from public.bookings where id=booking and status in ('confirmed','in_progress')
    and ends_at>statement_timestamp()) then
    raise exception 'Agenda is closed' using errcode='22023'; end if;
  if links is null or jsonb_typeof(links) is distinct from 'array' or jsonb_array_length(links)>20 then
    raise exception 'Choose up to twenty agenda links' using errcode='22023'; end if;
  delete from public.session_plan_learning_links where booking_id=booking;
  for item in select rows.entry from jsonb_array_elements(links) with ordinality as rows(entry,ordinality) order by rows.ordinality loop
    position_no:=position_no+1;
    kind:=item->>'kind';
    if kind in ('resource','assignment','assessment') then
      link_id:=(item->>'id')::uuid;
      insert into public.session_plan_learning_links(booking_id,position,link_kind,resource_id,assignment_id,assessment_id)
      values(booking,position_no,kind,case when kind='resource' then link_id end,
        case when kind='assignment' then link_id end,case when kind='assessment' then link_id end);
    elsif kind='milestone' then
      plan_id:=(item->>'studyPlanId')::uuid; milestone:=(item->>'milestoneId')::uuid;
      select * into plan_row from public.study_plans where id=plan_id;
      if not found then raise exception 'Unknown study plan' using errcode='22023'; end if;
      insert into public.session_plan_learning_links(booking_id,position,link_kind,study_plan_id,plan_revision_no,milestone_id)
      values(booking,position_no,kind,plan_id,plan_row.current_revision,milestone);
    else raise exception 'Unsupported agenda link kind' using errcode='22023'; end if;
  end loop;
  return position_no;
end;
$$;

create function public.publish_structured_session_recap(
  booking uuid,summary text,topics text[],strengths text,practice_areas text,next_steps text,resource_ids uuid[]
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare tutor uuid; saved timestamptz; item text; normalized text[]:=array[]::text[]; resource_id uuid; position_no integer:=0;
begin
  if not private.booking_tutor(booking) then raise exception 'Not authorized' using errcode='42501'; end if;
  if not private.session_has_ended(booking) then raise exception 'Recap cannot be published before the session ends' using errcode='22023'; end if;
  if topics is null or cardinality(topics) not between 1 and 20 then raise exception 'Add one to twenty covered topics' using errcode='22023'; end if;
  foreach item in array topics loop
    item:=private.require_text(item,200,true);
    if not item=any(normalized) then normalized:=array_append(normalized,item); end if;
  end loop;
  if resource_ids is null or cardinality(resource_ids)>20 then raise exception 'Choose up to twenty approved resources' using errcode='22023'; end if;
  select tutor_id into tutor from public.bookings where id=booking;
  insert into public.session_recaps(booking_id,tutor_id,summary,mastery_notes,next_steps,topics,strengths,practice_areas)
  values(booking,tutor,private.require_text(summary,4000,true),private.require_text(strengths,2000,true),
    private.require_text(next_steps,2000,false),normalized,private.require_text(strengths,2000,true),
    private.require_text(practice_areas,2000,true))
  on conflict(booking_id) do update set summary=excluded.summary,mastery_notes=excluded.mastery_notes,next_steps=excluded.next_steps,
    topics=excluded.topics,strengths=excluded.strengths,practice_areas=excluded.practice_areas
  returning updated_at into saved;
  delete from public.session_recap_resources where booking_id=booking;
  foreach resource_id in array resource_ids loop
    position_no:=position_no+1;
    insert into public.session_recap_resources(booking_id,position,resource_id) values(booking,position_no,resource_id);
  end loop;
  return saved;
end;
$$;

-- Dated recap publication joins learning progress without inventing topic mastery.
alter table public.learning_progress_events drop constraint if exists learning_progress_events_event_type_check;
alter table public.learning_progress_events drop constraint if exists learning_progress_events_source_kind_check;
alter table public.learning_progress_events add constraint learning_progress_events_event_type_check
  check(event_type in ('assessment_scored','assignment_completed','session_recap_published'));
alter table public.learning_progress_events add constraint learning_progress_events_source_kind_check
  check(source_kind in ('assessment_attempt','assignment_submission','session_recap'));
insert into public.learning_progress_events(student_id,tutor_id,subject_id,event_type,source_kind,source_id,occurred_at)
select bookings.student_id,recaps.tutor_id,bookings.subject_id,'session_recap_published','session_recap',bookings.id,recaps.published_at
from public.session_recaps as recaps join public.bookings as bookings on bookings.id=recaps.booking_id
on conflict(event_type,source_kind,source_id) do nothing;
create function private.record_session_recap_progress_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.learning_progress_events(student_id,tutor_id,subject_id,event_type,source_kind,source_id,occurred_at)
  select bookings.student_id,new.tutor_id,bookings.subject_id,'session_recap_published','session_recap',new.booking_id,new.published_at
  from public.bookings as bookings where bookings.id=new.booking_id on conflict(event_type,source_kind,source_id) do nothing;
  return new;
end;
$$;
create trigger session_recap_progress_event after insert on public.session_recaps
for each row execute function private.record_session_recap_progress_event();

-- Editable feedback creates one event on the first transition to completed, using the transition time.
create or replace function private.record_learning_progress_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='assessment_attempts' then
    if new.status='scored' and (tg_op='INSERT' or old.status is distinct from 'scored') then
      insert into public.learning_progress_events(student_id,tutor_id,subject_id,event_type,source_kind,source_id,occurred_at)
      select assessments.student_id,assessments.tutor_id,assessments.subject_id,'assessment_scored','assessment_attempt',new.id,
        coalesce(new.scored_at,statement_timestamp())
      from public.assessments as assessments where assessments.id=new.assessment_id on conflict do nothing;
    end if;
  elsif tg_table_name='assignment_feedback' and new.outcome='completed'
    and (tg_op='INSERT' or old.outcome is distinct from 'completed') then
    insert into public.learning_progress_events(student_id,tutor_id,subject_id,event_type,source_kind,source_id,occurred_at)
    select assignments.student_id,assignments.tutor_id,
      coalesce(assignments.subject_id,(select bookings.subject_id from public.bookings as bookings where bookings.id=assignments.booking_id)),
      'assignment_completed','assignment_submission',new.submission_id,coalesce(new.updated_at,new.created_at,statement_timestamp())
    from public.assignment_submissions as submissions
    join public.assignments as assignments on assignments.id=submissions.assignment_id
    where submissions.id=new.submission_id
    on conflict (event_type,source_kind,source_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger assignment_completed_progress_event on public.assignment_feedback;
create trigger assignment_completed_progress_event after insert or update of outcome on public.assignment_feedback
for each row execute function private.record_learning_progress_event();

-- Private, tutor-reviewed files attached to session preparation. Storage objects are checked at final registration.
create table public.session_plan_attachments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  uploader_id uuid not null references public.profiles(id) on delete restrict,
  storage_path text not null unique check(length(storage_path)<=500),
  file_mime text not null check(file_mime in ('application/pdf','image/png','image/jpeg','text/plain')),
  file_size_bytes integer not null check(file_size_bytes between 1 and 10485760),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  review_reason text check(review_reason is null or length(btrim(review_reason)) between 1 and 500),
  created_at timestamptz not null default statement_timestamp(),
  check((status='pending' and reviewed_by is null and reviewed_at is null and review_reason is null)
    or (status<>'pending' and reviewed_by is not null and reviewed_at is not null))
);
create index session_plan_attachments_booking_idx on public.session_plan_attachments(booking_id,created_at desc);
create function private.session_attachment_uploadable(path text,require_open boolean default true) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare booking_text text; selected public.bookings;
begin
  if path !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg|txt)$' then return false; end if;
  booking_text:=split_part(path,'/',1);
  if split_part(path,'/',2)<>auth.uid()::text or not private.booking_student(booking_text::uuid) then return false; end if;
  select * into selected from public.bookings where id=booking_text::uuid;
  return found and (not require_open or (selected.status in ('confirmed','in_progress') and selected.ends_at>statement_timestamp()));
exception when others then return false;
end;
$$;
create function private.session_attachment_storage_object_matches(path text,mime text,bytes integer) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare object_exists boolean:=false;
begin
  if to_regclass('storage.objects') is null or path is null then return false; end if;
  execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2 and owner_id=$3 '
    || 'and metadata->>''mimetype''=$4 and (metadata->>''size'') ~ ''^[0-9]+$'' and (metadata->>''size'')::bigint=$5)'
    into object_exists using 'session-plan-attachments',path,auth.uid()::text,mime,bytes;
  return object_exists;
exception when others then return false;
end;
$$;
create function private.session_attachment_reader(path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.session_plan_attachments as attachments
    where attachments.storage_path=path and ((attachments.uploader_id=auth.uid() and private.active_actor() and private.has_role('student'))
      or (attachments.status='approved' and private.booking_tutor(attachments.booking_id))));
$$;
create function private.session_attachment_orphan_owner(path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.session_attachment_uploadable(path,false) and not exists(select 1 from public.session_plan_attachments where storage_path=path);
$$;
create function private.guard_session_plan_attachment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected_booking public.bookings;
begin
  if tg_op='INSERT' then
    select * into selected_booking from public.bookings where id=new.booking_id;
    if not found or not private.booking_student(new.booking_id) or new.uploader_id<>auth.uid()
      or selected_booking.status not in ('confirmed','in_progress') or selected_booking.ends_at<=statement_timestamp() then
      raise exception 'Not authorized' using errcode='42501'; end if;
    if new.storage_path not like new.booking_id::text||'/'||new.uploader_id::text||'/%'
      or not private.session_attachment_storage_object_matches(new.storage_path,new.file_mime,new.file_size_bytes) then
      raise exception 'Attachment must be the student''s private uploaded object' using errcode='22023'; end if;
  else
    if tg_op='DELETE' then raise exception 'Session attachment review history is retained' using errcode='22023'; end if;
    if (new.id,new.booking_id,new.uploader_id,new.storage_path,new.file_mime,new.file_size_bytes,new.created_at)
      is distinct from (old.id,old.booking_id,old.uploader_id,old.storage_path,old.file_mime,old.file_size_bytes,old.created_at)
      or old.status<>'pending' or new.status not in ('approved','rejected') or new.reviewed_by<>auth.uid()
      or not private.booking_tutor(old.booking_id) then raise exception 'Invalid attachment review' using errcode='42501'; end if;
    new.reviewed_at:=statement_timestamp();
    if new.status='rejected' then new.review_reason:=private.require_text(new.review_reason,500,true);
    else new.review_reason:=private.require_text(new.review_reason,500,false); end if;
  end if;
  return new;
end;
$$;
create trigger session_plan_attachments_guard before insert or update or delete on public.session_plan_attachments
for each row execute function private.guard_session_plan_attachment();
alter table public.session_plan_attachments enable row level security;
revoke all on public.session_plan_attachments from public,anon,authenticated,service_role;
grant select on public.session_plan_attachments to authenticated;
create policy session_plan_attachments_participant_read on public.session_plan_attachments for select to authenticated
  using((uploader_id=auth.uid() and private.active_actor() and private.has_role('student'))
    or (private.booking_tutor(booking_id) and private.booking_participant(booking_id)));
create function public.register_session_plan_attachment(booking uuid,path text,mime text,bytes integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare created uuid;
begin
  if not private.booking_student(booking) or not private.session_attachment_uploadable(path) then raise exception 'Not authorized' using errcode='42501'; end if;
  if mime not in ('application/pdf','image/png','image/jpeg','text/plain') or bytes not between 1 and 10485760
    or split_part(path,'/',1)<>booking::text or split_part(path,'/',2)<>auth.uid()::text
    or not private.session_attachment_storage_object_matches(path,mime,bytes) then
    raise exception 'Attachment must be a verified private upload no larger than 10 MiB' using errcode='22023'; end if;
  insert into public.session_plan_attachments(booking_id,uploader_id,storage_path,file_mime,file_size_bytes)
  values(booking,auth.uid(),path,mime,bytes) returning id into created;
  return created;
end;
$$;
create function public.review_session_plan_attachment(attachment uuid,decision text,reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare selected public.session_plan_attachments;
begin
  select * into selected from public.session_plan_attachments where id=attachment for update;
  if not found or not private.booking_tutor(selected.booking_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  if decision not in ('approved','rejected') then raise exception 'Choose approval or rejection' using errcode='22023'; end if;
  update public.session_plan_attachments set status=decision,reviewed_by=auth.uid(),review_reason=reason where id=attachment;
end;
$$;

do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    execute $bucket$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('session-plan-attachments','session-plan-attachments',false,10485760,array['application/pdf','image/png','image/jpeg','text/plain'])
      on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types$bucket$;
    -- Managed Storage already enables RLS; its table owner is Supabase, not the migration role.
    execute 'drop policy if exists session_plan_attachments_upload on storage.objects';
    execute 'drop policy if exists session_plan_attachments_read on storage.objects';
    execute 'drop policy if exists session_plan_attachments_orphan_cleanup on storage.objects';
    execute $policy$create policy session_plan_attachments_upload on storage.objects for insert to authenticated
      with check(bucket_id='session-plan-attachments' and private.session_attachment_uploadable(name)
        and metadata->>'mimetype' in ('application/pdf','image/png','image/jpeg','text/plain')
        and case when metadata?'size' then (metadata->>'size')~'^[0-9]+$' and (metadata->>'size')::bigint between 1 and 10485760
          else (metadata->>'contentLength')~'^[0-9]+$' and (metadata->>'contentLength')::bigint between 1 and 12582912 end)$policy$;
    execute $policy$create policy session_plan_attachments_read on storage.objects for select to authenticated
      using(bucket_id='session-plan-attachments' and private.session_attachment_reader(name))$policy$;
    execute $policy$create policy session_plan_attachments_orphan_cleanup on storage.objects for delete to authenticated
      using(bucket_id='session-plan-attachments' and private.session_attachment_orphan_owner(name))$policy$;
  end if;
end;
$$;

revoke all on function public.create_tagged_learning_assessment(uuid,uuid,uuid,uuid,jsonb),
  public.update_tagged_learning_assessment(uuid,jsonb),
  public.create_tagged_learning_assignment(uuid,uuid,uuid,text,text,text,timestamptz,boolean,text,uuid,uuid),
  public.update_tagged_learning_assignment(uuid,text,text,text,timestamptz,boolean,text,uuid,uuid),
  public.save_assignment_submission_draft(uuid,text,text),public.submit_assignment_submission_draft(uuid),
  public.save_session_preparation(uuid,text,text,text[]),public.save_session_agenda_learning_links(uuid,jsonb),
  public.publish_structured_session_recap(uuid,text,text[],text,text,text,uuid[]),
  public.register_session_plan_attachment(uuid,text,text,integer),public.review_session_plan_attachment(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.create_tagged_learning_assessment(uuid,uuid,uuid,uuid,jsonb),
  public.update_tagged_learning_assessment(uuid,jsonb),
  public.create_tagged_learning_assignment(uuid,uuid,uuid,text,text,text,timestamptz,boolean,text,uuid,uuid),
  public.update_tagged_learning_assignment(uuid,text,text,text,timestamptz,boolean,text,uuid,uuid),
  public.save_assignment_submission_draft(uuid,text,text),public.submit_assignment_submission_draft(uuid),
  public.save_session_preparation(uuid,text,text,text[]),public.save_session_agenda_learning_links(uuid,jsonb),
  public.publish_structured_session_recap(uuid,text,text[],text,text,text,uuid[]),
  public.register_session_plan_attachment(uuid,text,text,integer),public.review_session_plan_attachment(uuid,text,text)
  to authenticated;
revoke all on function private.record_assessment_topic_evidence(),private.guard_assignment_learning_context(),
  private.guard_assignment_submission_draft(),private.guard_feedback(),private.after_feedback(),
  private.guard_session_plan_learning_link(),private.guard_session_recap_resource(),private.record_session_recap_progress_event(),
  private.session_attachment_uploadable(text,boolean),private.session_attachment_storage_object_matches(text,text,integer),
  private.session_attachment_reader(text),private.session_attachment_orphan_owner(text),private.guard_session_plan_attachment()
  from public,anon,authenticated;
revoke all on function private.guard_assignment_learning_context(),private.guard_assignment_submission_draft(),
  private.guard_feedback(),private.after_feedback(),private.guard_session_plan_learning_link(),private.guard_session_recap_resource(),
  private.record_session_recap_progress_event(),private.guard_session_plan_attachment() from public,anon,authenticated;
grant execute on function private.session_attachment_uploadable(text,boolean),private.session_attachment_storage_object_matches(text,text,integer),
  private.session_attachment_reader(text),private.session_attachment_orphan_owner(text) to authenticated;

commit;
