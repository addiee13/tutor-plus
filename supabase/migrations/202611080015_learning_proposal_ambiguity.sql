begin;
set local search_path = public, extensions, pg_catalog;

create or replace function public.create_study_plan_proposal(
  study_plan uuid,milestone uuid,target_date date,summary text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; created uuid;
begin
  select * into selected from public.study_plans where id=study_plan;
  if not found or selected.tutor_id is null or not private.owns_tutor(selected.tutor_id) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  perform private.check_learning_link(selected.tutor_id,selected.student_id,selected.booking_id);
  if selected.status<>'active' or target_date is null or not exists(
    select 1 from public.study_plan_revisions as revisions,
      jsonb_array_elements(revisions.goals) as goals(goal),
      jsonb_array_elements(goals.goal->'milestones') as milestone_rows(item)
    where revisions.plan_id=selected.id and revisions.revision_no=selected.current_revision
      and milestone_rows.item->>'id'=create_study_plan_proposal.milestone::text
  ) then
    raise exception 'Milestone is not in the active shared plan' using errcode='22023';
  end if;
  insert into public.study_plan_proposals(plan_id,milestone_id,proposed_target_date,summary,proposed_by)
  values(study_plan,milestone,target_date,private.require_text(summary,1000,true),auth.uid()) returning id into created;
  return created;
end;
$$;

commit;
