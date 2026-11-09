begin;
set local search_path = public, extensions, pg_catalog;

-- Students may start a private plan before selecting a tutor or booking a session.
alter table public.study_plans alter column tutor_id drop not null;

create or replace function private.guard_study_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected_booking public.bookings;
begin
  if tg_op='INSERT' then
    if new.tutor_id is null then
      if not private.has_role('student') or new.student_id<>auth.uid() or new.booking_id is not null
        or new.subject_id is null or not exists(select 1 from public.subjects where id=new.subject_id and active) then
        raise exception 'Personal plan must belong to an active student and active subject' using errcode='42501';
      end if;
    else
      if not private.owns_tutor(new.tutor_id) or not private.eligible_learning_student(new.student_id)
        or not private.tutor_student_related(new.tutor_id,new.student_id) then raise exception 'Not authorized' using errcode='42501'; end if;
      perform private.check_learning_link(new.tutor_id,new.student_id,new.booking_id);
      if new.booking_id is not null and new.subject_id is not null and not exists(select 1 from public.bookings where id=new.booking_id and subject_id=new.subject_id) then
        raise exception 'Subject must match the linked booking' using errcode='22023'; end if;
    end if;
  else
    if (new.id,new.student_id,new.subject_id,new.created_at,new.status)
      is distinct from (old.id,old.student_id,old.subject_id,old.created_at,old.status) then
      raise exception 'Study plan identity is immutable' using errcode='22023';
    end if;
    if old.tutor_id is null and new.tutor_id is not null then
      if old.booking_id is not null or new.booking_id is null or new.current_revision<>old.current_revision
        or not private.has_role('student') or new.student_id<>auth.uid() then raise exception 'Invalid personal plan sharing' using errcode='42501'; end if;
      select * into selected_booking from public.bookings where id=new.booking_id;
      if not found or selected_booking.student_id<>new.student_id or selected_booking.tutor_id<>new.tutor_id
        or selected_booking.status not in ('confirmed','in_progress','completed')
        or (new.subject_id is not null and selected_booking.subject_id<>new.subject_id) then
        raise exception 'Share requires a matching student booking and subject' using errcode='22023'; end if;
      perform private.check_learning_link(new.tutor_id,new.student_id,new.booking_id);
    elsif new.tutor_id is distinct from old.tutor_id or new.booking_id is distinct from old.booking_id then
      raise exception 'A shared tutor and booking are immutable' using errcode='22023';
    elsif new.current_revision=old.current_revision+1 then
      if new.tutor_id is null then
        if not private.has_role('student') or new.student_id<>auth.uid() then raise exception 'Not authorized' using errcode='42501'; end if;
      else
        if not (private.owns_tutor(new.tutor_id) or (private.has_role('student') and new.student_id=auth.uid())) then
          raise exception 'Not authorized' using errcode='42501'; end if;
        perform private.check_learning_link(new.tutor_id,new.student_id,new.booking_id);
      end if;
    elsif new.current_revision<>old.current_revision then
      raise exception 'Study plan revisions must advance once' using errcode='22023';
    else
      raise exception 'Study plan update is not authorized' using errcode='42501';
    end if;
  end if;
  new.updated_at:=statement_timestamp();
  return new;
end;
$$;

create or replace function private.learning_plan_reader(plan uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.study_plans as plans where plans.id=plan and (
    (private.has_role('student') and plans.student_id=auth.uid())
    or (plans.tutor_id is not null and private.owns_tutor(plans.tutor_id)
      and private.tutor_student_related(plans.tutor_id,plans.student_id)
      and (plans.booking_id is null or exists(select 1 from public.bookings as bookings where bookings.id=plans.booking_id
        and bookings.student_id=plans.student_id and bookings.tutor_id=plans.tutor_id
        and (plans.subject_id is null or bookings.subject_id=plans.subject_id))))
  ));
$$;

create function private.study_milestone_dates_preserved(old_goals jsonb,new_goals jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select not exists(
    select 1 from jsonb_array_elements(old_goals) as goals(goal),jsonb_array_elements(goals.goal->'milestones') as milestones(milestone)
    where not exists(
      select 1 from jsonb_array_elements(new_goals) as new_rows(goal),jsonb_array_elements(new_rows.goal->'milestones') as new_milestones(milestone)
      where new_milestones.milestone->>'id'=milestones.milestone->>'id'
        and new_milestones.milestone->'targetDate' is not distinct from milestones.milestone->'targetDate'
    )
  );
$$;

create or replace function public.create_personal_study_plan(subject uuid,title text,description text,goals jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare created uuid;
begin
  if not private.has_role('student') or not private.eligible_learning_student(auth.uid()) then raise exception 'Not authorized' using errcode='42501'; end if;
  if subject is null or not exists(select 1 from public.subjects where id=subject and active) then raise exception 'Choose an active subject' using errcode='22023'; end if;
  if not private.valid_structured_study_goals(goals) then raise exception 'Complete every required goal and milestone field' using errcode='22023'; end if;
  insert into public.study_plans(tutor_id,student_id,subject_id,booking_id) values(null,auth.uid(),subject,null) returning id into created;
  insert into public.study_plan_revisions(plan_id,revision_no,title,description,goals,authored_by)
    values(created,1,private.require_text(title,200,true),private.require_text(description,4000,false),goals,auth.uid());
  return created;
end;
$$;

create or replace function public.revise_study_plan(study_plan uuid,expected_revision integer,title text,description text,goals jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; old_goals jsonb; next_revision integer;
begin
  select * into selected from public.study_plans where id=study_plan for update;
  if not found or selected.tutor_id is null or not private.owns_tutor(selected.tutor_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  if selected.status<>'active' or selected.current_revision<>expected_revision then raise exception 'Study plan changed; refresh before revising' using errcode='23505'; end if;
  if not private.valid_structured_study_goals(goals) then raise exception 'Complete every required goal and milestone field' using errcode='22023'; end if;
  select revisions.goals into old_goals from public.study_plan_revisions as revisions where revisions.plan_id=study_plan and revisions.revision_no=selected.current_revision;
  if not private.study_milestone_dates_preserved(old_goals,goals) then raise exception 'Use the dated replan action to change or remove an existing milestone date' using errcode='22023'; end if;
  next_revision:=selected.current_revision+1;
  update public.study_plans set current_revision=next_revision where id=study_plan;
  insert into public.study_plan_revisions(plan_id,revision_no,title,description,goals,authored_by)
    values(study_plan,next_revision,private.require_text(title,200,true),private.require_text(description,4000,false),goals,auth.uid());
  return next_revision;
end;
$$;

create function public.revise_owned_study_plan(study_plan uuid,expected_revision integer,title text,description text,goals jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; old_goals jsonb; next_revision integer;
begin
  select * into selected from public.study_plans where id=study_plan for update;
  if not found or not private.has_role('student') or selected.student_id<>auth.uid() then raise exception 'Not authorized' using errcode='42501'; end if;
  if selected.status<>'active' or selected.current_revision<>expected_revision then raise exception 'Study plan changed; refresh before revising' using errcode='23505'; end if;
  if not private.valid_structured_study_goals(goals) then raise exception 'Complete every required goal and milestone field' using errcode='22023'; end if;
  select revisions.goals into old_goals from public.study_plan_revisions as revisions where revisions.plan_id=study_plan and revisions.revision_no=selected.current_revision;
  if not private.study_milestone_dates_preserved(old_goals,goals) then raise exception 'Use the dated replan action to change or remove an existing milestone date' using errcode='22023'; end if;
  next_revision:=selected.current_revision+1;
  update public.study_plans set current_revision=next_revision where id=study_plan;
  insert into public.study_plan_revisions(plan_id,revision_no,title,description,goals,authored_by)
    values(study_plan,next_revision,private.require_text(title,200,true),private.require_text(description,4000,false),goals,auth.uid());
  return next_revision;
end;
$$;

create function public.share_personal_study_plan(study_plan uuid,booking uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; selected_booking public.bookings;
begin
  select * into selected from public.study_plans where id=study_plan for update;
  if not found or not private.has_role('student') or selected.student_id<>auth.uid() then raise exception 'Not authorized' using errcode='42501'; end if;
  if selected.tutor_id is not null then
    if selected.booking_id=booking then return selected.id; end if;
    raise exception 'Plan is already shared with another tutor' using errcode='22023';
  end if;
  select * into selected_booking from public.bookings where id=booking;
  if not found or selected_booking.student_id<>auth.uid() or selected_booking.status not in ('confirmed','in_progress','completed')
    or (selected.subject_id is not null and selected.subject_id<>selected_booking.subject_id) then
    raise exception 'Choose a confirmed booking for this student and subject' using errcode='22023'; end if;
  perform private.check_learning_link(selected_booking.tutor_id,selected.student_id,booking);
  update public.study_plans set tutor_id=selected_booking.tutor_id,booking_id=booking where id=study_plan;
  return study_plan;
end;
$$;

create or replace function public.reschedule_study_milestone(
  study_plan uuid,milestone uuid,expected_revision integer,target_date date,reason text,proposal uuid default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; old_date date; new_goals jsonb; next_revision integer; proposal_row public.study_plan_proposals;
begin
  select * into selected from public.study_plans where id=study_plan for update;
  if not found or not (private.owns_tutor(selected.tutor_id) or (private.has_role('student') and selected.student_id=auth.uid())) then
    raise exception 'Not authorized' using errcode='42501'; end if;
  if selected.status<>'active' or selected.current_revision<>expected_revision or target_date is null then
    raise exception 'Study plan changed; refresh before replanning' using errcode='23505'; end if;
  if private.has_role('student') and selected.student_id=auth.uid() then
    if selected.tutor_id is null then
      if proposal is not null then raise exception 'Personal plan cannot consume a tutor proposal' using errcode='22023'; end if;
    else
      if proposal is null then raise exception 'Student confirmation requires a tutor proposal' using errcode='42501'; end if;
      select * into proposal_row from public.study_plan_proposals where id=proposal and plan_id=study_plan
        and milestone_id=reschedule_study_milestone.milestone and status='pending' for update;
      if not found or proposal_row.proposed_target_date<>target_date then raise exception 'Proposal does not match the requested date' using errcode='22023'; end if;
    end if;
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

create or replace function public.create_study_plan_proposal(study_plan uuid,milestone uuid,target_date date,summary text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected public.study_plans; created uuid;
begin
  select * into selected from public.study_plans where id=study_plan;
  if not found or selected.tutor_id is null or not private.owns_tutor(selected.tutor_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  perform private.check_learning_link(selected.tutor_id,selected.student_id,selected.booking_id);
  if selected.status<>'active' or target_date is null or not exists(select 1 from public.study_plan_revisions as revisions,
      jsonb_array_elements(revisions.goals) as goals(goal),jsonb_array_elements(goals.goal->'milestones') as milestones(milestone)
      where revisions.plan_id=selected.id and revisions.revision_no=selected.current_revision and milestones.milestone->>'id'=milestone::text) then
    raise exception 'Milestone is not in the active shared plan' using errcode='22023'; end if;
  insert into public.study_plan_proposals(plan_id,milestone_id,proposed_target_date,summary,proposed_by)
    values(study_plan,milestone,target_date,private.require_text(summary,1000,true),auth.uid()) returning id into created;
  return created;
end;
$$;

revoke all on function public.create_personal_study_plan(uuid,text,text,jsonb),public.revise_owned_study_plan(uuid,integer,text,text,jsonb),
  public.share_personal_study_plan(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_personal_study_plan(uuid,text,text,jsonb),public.revise_owned_study_plan(uuid,integer,text,text,jsonb),
  public.share_personal_study_plan(uuid,uuid) to authenticated;
revoke all on function private.study_milestone_dates_preserved(jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.learning_plan_reader(uuid),private.study_milestone_dates_preserved(jsonb,jsonb) to authenticated;

commit;
