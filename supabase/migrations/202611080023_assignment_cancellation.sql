begin;
set local search_path = public, extensions, pg_catalog;

-- Keep the legacy draft update callable through the tagged wrapper after PL/pgSQL column
-- ambiguity checks; every input is explicitly qualified and status remains unchanged.
create or replace function public.update_learning_assignment(
  assignment uuid, title text, instructions text, submission_type text, due_at timestamptz, accepts_late boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare selected public.assignments;
begin
  select * into selected from public.assignments as assignments
  where assignments.id = update_learning_assignment.assignment for update;
  if not found or not private.owns_tutor(selected.tutor_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if selected.status <> 'draft' then raise exception 'Only drafts can be edited' using errcode = '22023'; end if;
  if update_learning_assignment.submission_type is null
    or update_learning_assignment.submission_type not in ('text', 'link', 'file')
    or update_learning_assignment.due_at is null or update_learning_assignment.accepts_late is null then
    raise exception 'Invalid assignment details' using errcode = '22023';
  end if;
  update public.assignments as assignments
  set title = private.require_text(update_learning_assignment.title, 200, true),
      instructions = private.require_text(update_learning_assignment.instructions, 4000, true),
      submission_type = update_learning_assignment.submission_type,
      due_at = update_learning_assignment.due_at,
      accepts_late = update_learning_assignment.accepts_late
  where assignments.id = update_learning_assignment.assignment;
end;
$$;

-- A tutor may withdraw an assignment only before it is completed or has a pending submission.
-- The original submission and feedback rows remain append-only audit history.
create function public.cancel_learning_assignment(assignment uuid, reason text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected public.assignments; normalized_reason text;
begin
  select * into selected
  from public.assignments as assignments
  where assignments.id = cancel_learning_assignment.assignment
  for update;
  if not found or not private.owns_tutor(selected.tutor_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  normalized_reason := private.require_text(cancel_learning_assignment.reason, 500, true);
  if selected.status = 'cancelled' then
    return selected.id;
  end if;
  if selected.status not in ('draft', 'assigned', 'returned') then
    raise exception 'Only draft, assigned or returned assignments can be cancelled' using errcode = '22023';
  end if;

  update public.assignments as assignments
  set status = 'cancelled', cancellation_reason = normalized_reason
  where assignments.id = selected.id;
  return selected.id;
end;
$$;

revoke all on function public.cancel_learning_assignment(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_learning_assignment(uuid, text) to authenticated;

commit;
