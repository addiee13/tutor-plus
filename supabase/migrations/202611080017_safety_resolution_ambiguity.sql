begin;
set local search_path = public, extensions, pg_catalog;

-- The report itself has a reason column. Qualify the input so PostgreSQL never resolves
-- a moderator's resolution reason against that column during the UPDATE.
create or replace function public.resolve_safety_report(report uuid,requested_state text,reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.assert_administrator();
begin
  if resolve_safety_report.requested_state is null
    or resolve_safety_report.requested_state not in ('reviewing','resolved','dismissed')
    or resolve_safety_report.reason is null
    or length(btrim(resolve_safety_report.reason)) not between 1 and 500 then
    raise exception 'Invalid report resolution' using errcode = '22023';
  end if;
  update public.safety_reports as reports
  set state = resolve_safety_report.requested_state,
    resolved_by = case when resolve_safety_report.requested_state in ('resolved','dismissed') then actor else null end,
    resolution_reason = btrim(resolve_safety_report.reason),
    resolved_at = case when resolve_safety_report.requested_state in ('resolved','dismissed') then statement_timestamp() else null end
  where reports.id = resolve_safety_report.report;
  if not found then raise exception 'Unknown report' using errcode = '22023'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,reason,safe_metadata)
  values(actor,'safety.report_resolved','safety_reports',resolve_safety_report.report,
    btrim(resolve_safety_report.reason),jsonb_build_object('state',resolve_safety_report.requested_state));
end;
$$;

commit;
