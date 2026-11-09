begin;
set local search_path = public, extensions, pg_catalog;

-- The original learning API supports an authorized tutor transition by updating a draft
-- directly. Preserve that contract while pinning the exact immutable assigned definition.
create or replace function private.guard_assessment_definition_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' then
    if new.status<>'draft' or new.definition_version<>0 then
      raise exception 'New assessments start without an assigned definition' using errcode='22023';
    end if;
    return new;
  end if;

  if old.status='draft' and new.status='assigned' then
    if new.definition_version=old.definition_version then
      if not private.owns_tutor(old.tutor_id) then
        raise exception 'Not authorized to assign this assessment' using errcode='42501';
      end if;
      new.definition_version:=old.definition_version+1;
      insert into public.assessment_definition_versions(assessment_id,version_no,definition,created_by)
      values(new.id,new.definition_version,private.assessment_definition_snapshot(old.id),auth.uid());
    elsif new.definition_version<>old.definition_version+1 or not exists (
      select 1 from public.assessment_definition_versions as versions
      where versions.assessment_id=new.id and versions.version_no=new.definition_version
    ) then
      raise exception 'Assignment requires an immutable definition snapshot' using errcode='22023';
    end if;
  elsif new.definition_version is distinct from old.definition_version then
    raise exception 'Assigned assessment definition version is immutable' using errcode='22023';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_assessment_definition_version() from public,anon,authenticated;

commit;
