begin;
set local search_path = public, extensions, pg_catalog;

create or replace function public.create_tagged_learning_assignment(
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

create or replace function public.update_tagged_learning_assignment(
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

commit;
