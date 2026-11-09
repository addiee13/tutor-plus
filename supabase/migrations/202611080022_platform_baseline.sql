begin;
set local search_path = public, extensions, pg_catalog;

-- Student-owned bookmarks store a tutor ID only; the service rechecks its current public DTO on read.
create table public.saved_tutors (
  user_id uuid not null references public.profiles(id) on delete cascade,
  tutor_profile_id uuid not null references public.tutor_profiles(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  primary key(user_id,tutor_profile_id)
);
create index saved_tutors_user_time_idx on public.saved_tutors(user_id,created_at desc);
alter table public.saved_tutors enable row level security;
revoke all on public.saved_tutors from public,anon,authenticated,service_role;
grant select on public.saved_tutors to authenticated;
create policy saved_tutors_owner_read on public.saved_tutors for select to authenticated
  using(private.active_actor() and private.has_role('student') and user_id=auth.uid());

create function public.save_public_tutor(tutor uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.active_actor() or not private.has_role('student') then raise exception 'Not authorized' using errcode='42501'; end if;
  if tutor is null or exists(select 1 from public.tutor_profiles as profiles where profiles.id=tutor and profiles.user_id=auth.uid())
    or not private.tutor_is_public(tutor) then raise exception 'Tutor unavailable' using errcode='22023'; end if;
  insert into public.saved_tutors(user_id,tutor_profile_id) values(auth.uid(),tutor) on conflict(user_id,tutor_profile_id) do nothing;
end;
$$;

create function public.unsave_tutor(tutor uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.active_actor() or not private.has_role('student') then raise exception 'Not authorized' using errcode='42501'; end if;
  delete from public.saved_tutors as saved where saved.user_id=auth.uid() and saved.tutor_profile_id=tutor;
end;
$$;

-- One bounded read returns the public subject/rate projection for saved-tutor cards without per-tutor RPC fanout.
create function public.list_public_tutor_subjects_batch(tutors uuid[])
returns table(tutor_id uuid,subject_id uuid,name text,slug text,hourly_rate_minor bigint,currency char(3))
language plpgsql stable security definer set search_path = '' as $$
begin
  if cardinality(coalesce(tutors,'{}'::uuid[]))>50 then raise exception 'Too many tutors' using errcode='22023'; end if;
  return query select links.tutor_id,subjects.id,subjects.name,subjects.slug,
    coalesce(links.rate_override_minor,profiles.hourly_rate_minor),profiles.currency
  from public.tutor_subjects as links
  join public.subjects as subjects on subjects.id=links.subject_id and subjects.active
  join public.tutor_profiles as profiles on profiles.id=links.tutor_id
  where links.tutor_id=any(coalesce(tutors,'{}'::uuid[])) and private.tutor_is_public(links.tutor_id)
  order by links.tutor_id,subjects.sort_order,subjects.name;
end;
$$;

-- Reports reference only opaque assistant-request metadata, never stored prompts, selected content or answers.
create table private.assistant_response_reports (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references private.assistant_requests(id) on delete restrict,
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check(length(btrim(reason)) between 1 and 1000),
  state text not null default 'open' check(state in ('open','reviewing','resolved','dismissed')),
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolution_reason text check(resolution_reason is null or length(btrim(resolution_reason)) between 1 and 500),
  created_at timestamptz not null default statement_timestamp(),
  resolved_at timestamptz,
  unique(request_id,reporter_id)
);
create index assistant_response_reports_state_idx on private.assistant_response_reports(state,created_at desc);
revoke all on private.assistant_response_reports from public,anon,authenticated,service_role;

create function public.report_assistant_response(request uuid,report_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); result uuid;
begin
  if actor is null or not private.active_actor() or not private.has_role('student') then
    raise exception 'Not authorized' using errcode='42501'; end if;
  if report_reason is null or length(btrim(report_reason)) not between 1 and 1000 then
    raise exception 'Invalid report reason' using errcode='22023'; end if;
  if not exists(select 1 from private.assistant_requests as requests where requests.id=request
    and requests.user_id=actor and requests.state<>'started') then
    raise exception 'Assistant response unavailable' using errcode='42501'; end if;
  insert into private.assistant_response_reports(request_id,reporter_id,reason)
    values(request,actor,btrim(report_reason)) on conflict(request_id,reporter_id) do nothing returning id into result;
  if result is null then select reports.id into result from private.assistant_response_reports as reports
    where reports.request_id=request and reports.reporter_id=actor; end if;
  return result;
end;
$$;

create function public.admin_read_assistant_response_reports(page_size integer default 100,page_offset integer default 0)
returns table(id uuid,reporter_id uuid,request_id uuid,reason text,state text,resolved_by uuid,resolution_reason text,
  created_at timestamptz,resolved_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_administrator();
  return query select reports.id,reports.reporter_id,reports.request_id,reports.reason,reports.state,reports.resolved_by,
    reports.resolution_reason,reports.created_at,reports.resolved_at from private.assistant_response_reports as reports
    order by reports.created_at desc,reports.id limit greatest(1,least(coalesce(page_size,100),200))
    offset greatest(0,least(coalesce(page_offset,0),100000));
end;
$$;

create function public.resolve_assistant_response_report(report uuid,requested_state text,confirmed boolean,reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.assert_administrator();
begin
  if confirmed is not true or requested_state not in ('reviewing','resolved','dismissed')
    or reason is null or length(btrim(reason)) not between 1 and 500 then
    raise exception 'Invalid assistant report resolution' using errcode='22023'; end if;
  update private.assistant_response_reports as reports set state=requested_state,
    resolved_by=case when requested_state in ('resolved','dismissed') then actor else null end,
    resolution_reason=btrim(resolve_assistant_response_report.reason),
    resolved_at=case when requested_state in ('resolved','dismissed') then statement_timestamp() else null end
    where reports.id=report;
  if not found then raise exception 'Unknown assistant response report' using errcode='22023'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,reason,safe_metadata)
    values(actor,'assistant.response_report_resolved','assistant_response_reports',report,btrim(reason),jsonb_build_object('state',requested_state));
end;
$$;

-- Events contain only a UUID correlation token, allow-listed action/category, duration and outcome.
create table private.operational_events (
  id bigint generated always as identity primary key,
  correlation_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check(action in ('assistant.response','assessment.template','badge.policy','booking.read','admin.report')),
  category text not null check(category in ('assistant','assessment','reputation','booking','safety','platform')),
  duration_ms integer not null check(duration_ms between 0 and 120000),
  outcome text not null check(outcome in ('success','failure','denied','rate_limited')),
  created_at timestamptz not null default statement_timestamp()
);
create index operational_events_time_idx on private.operational_events(created_at desc,category,outcome);
revoke all on private.operational_events from public,anon,authenticated,service_role;

create function public.record_operational_event(correlation uuid,action_name text,event_category text,duration integer,event_outcome text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.active_actor() or correlation is null
    or action_name not in ('assistant.response','assessment.template','badge.policy','booking.read','admin.report')
    or event_category not in ('assistant','assessment','reputation','booking','safety','platform')
    or duration not between 0 and 120000 or event_outcome not in ('success','failure','denied','rate_limited') then
    raise exception 'Invalid operational event' using errcode='22023'; end if;
  insert into private.operational_events(correlation_id,user_id,action,category,duration_ms,outcome)
    values(correlation,auth.uid(),action_name,event_category,duration,event_outcome);
end;
$$;

create function public.admin_read_operational_health()
returns table(metric_key text,metric_value bigint,window_start timestamptz)
language plpgsql security definer set search_path = '' as $$
declare cutoff timestamptz:=statement_timestamp()-interval '24 hours';
begin
  perform private.assert_administrator();
  return query
    select 'assessment_scoring_backlog'::text,count(*)::bigint,null::timestamptz from public.assessments where status='submitted'
    union all select 'overdue_assignments',count(*)::bigint,null::timestamptz from public.assignments where status='assigned' and due_at<statement_timestamp()
    union all select 'assistant_requests_failed',count(*)::bigint,cutoff from private.assistant_requests where created_at>=cutoff and state='failed'
    union all select 'assistant_requests_refused',count(*)::bigint,cutoff from private.assistant_requests where created_at>=cutoff and state='refused'
    union all select 'authorization_denials',count(*)::bigint,cutoff from private.operational_events where created_at>=cutoff and outcome='denied'
    union all select 'operations_succeeded',count(*)::bigint,cutoff from private.operational_events where created_at>=cutoff and outcome='success'
    union all select 'operations_failed',count(*)::bigint,cutoff from private.operational_events where created_at>=cutoff and outcome in ('failure','rate_limited');
end;
$$;

-- The legacy completion RPC remains compatible. Workers use this versioned result to distinguish
-- a retriable failure from the terminal fifth attempt after the canonical transition is committed.
create function public.complete_notification_outbox_v2(p_notice uuid,p_outcome text,p_error_code text,p_provider_id text)
returns table(state text,email_state text,attempt_count integer)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.complete_notification_outbox(p_notice,p_outcome,p_error_code,p_provider_id);
  return query select notices.state,notices.email_state,notices.attempt_count::integer
    from private.notification_outbox as notices where notices.id=p_notice;
end;
$$;

revoke all on function public.save_public_tutor(uuid),public.unsave_tutor(uuid),public.report_assistant_response(uuid,text),
  public.admin_read_assistant_response_reports(integer,integer),public.resolve_assistant_response_report(uuid,text,boolean,text),
  public.record_operational_event(uuid,text,text,integer,text),public.admin_read_operational_health(),
  public.complete_notification_outbox_v2(uuid,text,text,text),public.list_public_tutor_subjects_batch(uuid[])
from public,anon,authenticated;
grant execute on function public.list_public_tutor_subjects_batch(uuid[]) to anon,authenticated;
grant execute on function public.save_public_tutor(uuid),public.unsave_tutor(uuid),public.report_assistant_response(uuid,text),
  public.resolve_assistant_response_report(uuid,text,boolean,text),public.record_operational_event(uuid,text,text,integer,text),
  public.admin_read_operational_health() to authenticated;
grant execute on function public.admin_read_assistant_response_reports(integer,integer) to authenticated;
revoke all on function public.complete_notification_outbox_v2(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.complete_notification_outbox_v2(uuid,text,text,text) to service_role;

commit;
