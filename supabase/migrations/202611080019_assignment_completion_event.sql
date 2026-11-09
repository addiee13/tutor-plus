begin;
set local search_path = public, extensions, pg_catalog;

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
  elsif tg_table_name='assignment_feedback'
    and new.outcome='completed'
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

commit;
