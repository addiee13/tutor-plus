begin;
-- Keep direct RPC writes consistent with the planner's end-time boundary and preserve objective scores.

create or replace function public.save_session_goals(booking uuid, goals text, questions text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare saved_at timestamptz;
begin
  if not private.booking_student(booking) then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform 1 from public.bookings where id = booking and status in ('confirmed', 'in_progress')
    and ends_at > statement_timestamp() for update;
  if not found then raise exception 'Planner is closed for this booking' using errcode = '22023'; end if;
  insert into public.session_plans(booking_id, student_goals, student_questions, student_updated_at)
  values (booking, private.require_text(goals, 2000, true), private.require_text(questions, 2000, false), statement_timestamp())
  on conflict (booking_id) do update set student_goals = excluded.student_goals,
    student_questions = excluded.student_questions, student_updated_at = excluded.student_updated_at
  returning student_updated_at into saved_at;
  return saved_at;
end;
$$;

create or replace function public.save_session_agenda(booking uuid, agenda text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare saved_at timestamptz;
begin
  if not private.booking_tutor(booking) then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform 1 from public.bookings where id = booking and status in ('confirmed', 'in_progress')
    and ends_at > statement_timestamp() for update;
  if not found then raise exception 'Planner is closed for this booking' using errcode = '22023'; end if;
  insert into public.session_plans(booking_id, tutor_agenda, tutor_updated_at)
  values (booking, private.require_text(agenda, 4000, true), statement_timestamp())
  on conflict (booking_id) do update set tutor_agenda = excluded.tutor_agenda, tutor_updated_at = excluded.tutor_updated_at
  returning tutor_updated_at into saved_at;
  return saved_at;
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
  update public.assessments set status = 'scored' where id = parent.id;
end;
$$;

commit;
