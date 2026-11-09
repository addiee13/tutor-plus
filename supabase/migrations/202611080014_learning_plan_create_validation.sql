begin;
set local search_path = public, extensions, pg_catalog;

create or replace function public.create_study_plan(
  tutor uuid, student uuid, subject uuid, booking uuid, title text, description text, goals jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare created uuid;
begin
  if not private.owns_tutor(tutor) or not private.eligible_learning_student(student)
    or not private.tutor_student_related(tutor,student) then raise exception 'Not authorized' using errcode='42501'; end if;
  perform private.check_learning_link(tutor,student,booking);
  if subject is null and booking is null then raise exception 'A subject or session is required' using errcode='22023'; end if;
  if subject is not null and not exists(select 1 from public.tutor_subjects where tutor_id=tutor and subject_id=subject) then
    raise exception 'Subject is not offered by this tutor' using errcode='22023'; end if;
  if booking is not null and subject is not null and not exists(select 1 from public.bookings where id=booking and subject_id=subject) then
    raise exception 'Subject must match the linked booking' using errcode='22023'; end if;
  if not private.valid_structured_study_goals(goals) then raise exception 'Complete every required goal and milestone field' using errcode='22023'; end if;
  insert into public.study_plans(tutor_id,student_id,subject_id,booking_id)
  values(tutor,student,subject,booking) returning id into created;
  insert into public.study_plan_revisions(plan_id,revision_no,title,description,goals,authored_by)
  values(created,1,private.require_text(title,200,true),private.require_text(description,4000,false),goals,auth.uid());
  return created;
end;
$$;

commit;
