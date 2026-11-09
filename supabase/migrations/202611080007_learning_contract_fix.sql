begin;
set local search_path = public, extensions, pg_catalog;

-- Follow-up to the already applied learning completion migration. NOT VALID preserves any decision rows
-- written by a running UI before this migration; new transitions are checked by the trigger below.
alter table public.study_plan_proposals add column if not exists decision_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.study_plan_proposals'::regclass
    and conname='study_plan_proposals_decision_reason_check') then
    alter table public.study_plan_proposals add constraint study_plan_proposals_decision_reason_check
      check ((status='pending' and decision_reason is null)
        or (status<>'pending' and decision_reason is not null and length(btrim(decision_reason)) between 1 and 500)) not valid;
  end if;
end;
$$;

create or replace function private.guard_study_proposal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans;
begin
  if tg_op='INSERT' then
    select * into selected from public.study_plans where id=new.plan_id;
    if not found or not private.owns_tutor(selected.tutor_id) or new.proposed_by<>auth.uid()
      or not exists (select 1 from public.study_plan_revisions as revisions,
        jsonb_array_elements(revisions.goals) as goals(goal),jsonb_array_elements(goals.goal->'milestones') as milestones(milestone)
        where revisions.plan_id=selected.id and revisions.revision_no=selected.current_revision
          and milestones.milestone->>'id'=new.milestone_id::text) then
      raise exception 'Invalid milestone proposal' using errcode='42501';
    end if;
    if new.status<>'pending' or new.decided_by is not null or new.decided_at is not null or new.decision_reason is not null then
      raise exception 'New proposals must be pending' using errcode='22023';
    end if;
    new.created_at:=statement_timestamp();
  else
    if (new.id,new.plan_id,new.milestone_id,new.proposed_target_date,new.summary,new.proposed_by,new.created_at)
      is distinct from (old.id,old.plan_id,old.milestone_id,old.proposed_target_date,old.summary,old.proposed_by,old.created_at)
      or old.status<>'pending' or new.status not in ('accepted','dismissed') or new.decided_by<>auth.uid() then
      raise exception 'Invalid or immutable proposal transition' using errcode='22023';
    end if;
    select * into selected from public.study_plans where id=new.plan_id;
    if not found or not (private.owns_tutor(selected.tutor_id) or (private.has_role('student') and selected.student_id=auth.uid())) then
      raise exception 'Not authorized' using errcode='42501';
    end if;
    new.decision_reason:=private.require_text(new.decision_reason,500,true);
    new.decided_at:=statement_timestamp();
  end if;
  return new;
end;
$$;

create or replace function public.reschedule_study_milestone(
  study_plan uuid,milestone uuid,expected_revision integer,target_date date,reason text,proposal uuid default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; old_date date; new_goals jsonb; next_revision integer; proposal_row public.study_plan_proposals;
begin
  select * into selected from public.study_plans where id=study_plan for update;
  if not found or not (private.owns_tutor(selected.tutor_id) or (private.has_role('student') and selected.student_id=auth.uid())) then
    raise exception 'Not authorized' using errcode='42501'; end if;
  if selected.status<>'active' or selected.current_revision<>expected_revision or target_date is null then
    raise exception 'Study plan changed; refresh before replanning' using errcode='23505'; end if;
  if private.has_role('student') and selected.student_id=auth.uid() then
    if proposal is null then raise exception 'Student confirmation requires a tutor proposal' using errcode='42501'; end if;
    select * into proposal_row from public.study_plan_proposals where id=proposal and plan_id=study_plan
      and milestone_id=reschedule_study_milestone.milestone and status='pending' for update;
    if not found or proposal_row.proposed_target_date<>target_date then raise exception 'Proposal does not match the requested date' using errcode='22023'; end if;
  elsif proposal is not null then raise exception 'Tutor replanning does not consume a student proposal' using errcode='22023'; end if;
  select (milestones.milestone->>'targetDate')::date into old_date
    from public.study_plan_revisions as revisions,jsonb_array_elements(revisions.goals) as goals(goal),
      jsonb_array_elements(goals.goal->'milestones') as milestones(milestone)
    where revisions.plan_id=study_plan and revisions.revision_no=selected.current_revision
      and milestones.milestone->>'id'=reschedule_study_milestone.milestone::text;
  if not found then raise exception 'Milestone is not in the current plan' using errcode='22023'; end if;
  select jsonb_agg(jsonb_set(goals.goal,'{milestones}',milestones.updated_milestones) order by goals.ordinality)
    into new_goals from jsonb_array_elements((select goals from public.study_plan_revisions where plan_id=study_plan and revision_no=selected.current_revision))
      with ordinality as goals(goal,ordinality)
    cross join lateral (select jsonb_agg(case when milestone.value->>'id'=reschedule_study_milestone.milestone::text
      then jsonb_set(milestone.value,'{targetDate}',to_jsonb(target_date::text),true) else milestone.value end order by milestone.ordinality) as updated_milestones
      from jsonb_array_elements(goals.goal->'milestones') with ordinality as milestone(value,ordinality)) as milestones;
  next_revision:=selected.current_revision+1;
  update public.study_plans set current_revision=next_revision where id=study_plan;
  insert into public.study_plan_revisions(plan_id,revision_no,title,description,goals,authored_by)
    select study_plan,next_revision,title,description,new_goals,auth.uid() from public.study_plan_revisions
      where plan_id=study_plan and revision_no=selected.current_revision;
  insert into public.study_plan_replanning_history(plan_id,milestone_id,revision_no,from_target_date,to_target_date,reason,authored_by)
  values(study_plan,milestone,next_revision,old_date,target_date,private.require_text(reason,500,true),auth.uid());
  if proposal is not null then
    update public.study_plan_proposals set status='accepted',decided_by=auth.uid(),decision_reason=private.require_text(reason,500,true) where id=proposal;
  end if;
  return next_revision;
end;
$$;

create or replace function public.respond_study_plan_proposal(proposal uuid,response text,reason text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare proposal_row public.study_plan_proposals; selected public.study_plans;
begin
  if response not in ('accept','dismiss') then raise exception 'Invalid proposal decision' using errcode='22023'; end if;
  select * into proposal_row from public.study_plan_proposals where id=proposal for update;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into selected from public.study_plans where id=proposal_row.plan_id;
  if not found or not private.has_role('student') or selected.student_id<>auth.uid() then raise exception 'Not authorized' using errcode='42501'; end if;
  if proposal_row.status<>'pending' then raise exception 'Proposal already decided' using errcode='22023'; end if;
  if response='accept' then
    return public.reschedule_study_milestone(selected.id,proposal_row.milestone_id,selected.current_revision,
      proposal_row.proposed_target_date,reason,proposal_row.id);
  end if;
  update public.study_plan_proposals set status='dismissed',decided_by=auth.uid(),decision_reason=private.require_text(reason,500,true)
    where id=proposal;
  return selected.current_revision;
end;
$$;

-- A mastery label may only cite evidence that belongs to the selected subject. Assignments have no subject column,
-- so only a booking-linked assignment with the same subject is eligible.
create or replace function private.guard_topic_mastery() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op<>'INSERT' then raise exception 'Mastery observations are immutable' using errcode='22023'; end if;
  if new.recorded_by<>auth.uid() or not private.owns_tutor(new.tutor_id)
    or not private.eligible_learning_student(new.student_id) or not private.tutor_student_related(new.tutor_id,new.student_id)
    or new.observed_at>statement_timestamp() then raise exception 'Not authorized to record mastery' using errcode='42501'; end if;
  if new.source_kind='assessment_attempt' and not exists (select 1 from public.assessment_attempts as attempts
    join public.assessments as assessments on assessments.id=attempts.assessment_id where attempts.id=new.source_id
      and attempts.status='scored' and assessments.tutor_id=new.tutor_id and assessments.student_id=new.student_id and assessments.subject_id=new.subject_id) then
    raise exception 'Mastery source is not a scored related assessment' using errcode='22023';
  elsif new.source_kind='assignment_submission' and not exists (select 1 from public.assignment_submissions as submissions
    join public.assignments as assignments on assignments.id=submissions.assignment_id
    join public.bookings as bookings on bookings.id=assignments.booking_id
    join public.assignment_feedback as feedback on feedback.submission_id=submissions.id
    where submissions.id=new.source_id and assignments.tutor_id=new.tutor_id and assignments.student_id=new.student_id
      and assignments.status<>'draft' and bookings.subject_id=new.subject_id and feedback.tutor_id=new.tutor_id) then
    raise exception 'Mastery source is not a reviewed, subject-linked assignment' using errcode='22023';
  elsif new.source_kind='session_recap' and not exists (select 1 from public.session_recaps as recaps
    join public.bookings as bookings on bookings.id=recaps.booking_id where bookings.id=new.source_id
      and recaps.tutor_id=new.tutor_id and bookings.student_id=new.student_id and bookings.subject_id=new.subject_id and bookings.status='completed') then
    raise exception 'Mastery source is not a completed related session' using errcode='22023';
  end if;
  new.topic:=private.require_text(new.topic,200,true);
  new.note:=private.require_text(new.note,1000,false);
  new.created_at:=statement_timestamp();
  return new;
end;
$$;

create or replace function public.list_topic_evidence_candidates(student uuid,subject uuid)
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

commit;
