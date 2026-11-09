\set ON_ERROR_STOP on
begin;
set local timezone = 'UTC';
create function pg_temp.check_platform(condition boolean, label text) returns void language plpgsql as $$
begin
 if condition is distinct from true then raise exception 'FAIL: %', label; end if;
 raise notice 'PASS: %', label;
end;
$$;
create function pg_temp.deny_platform(command text, label text) returns void language plpgsql as $$
begin
 begin execute command;
 exception when insufficient_privilege then raise notice 'PASS: %', label; return; end;
 raise exception 'FAIL: % unexpectedly succeeded', label;
end;
$$;
create function pg_temp.invalid_platform(command text, label text) returns void language plpgsql as $$
begin
 begin execute command;
 exception when invalid_parameter_value then raise notice 'PASS: %', label; return; end;
 raise exception 'FAIL: % unexpectedly succeeded', label;
end;
$$;
create function pg_temp.platform_actor(n integer) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','81000000-0000-4000-8000-00000000000'||n,
 'session_id','82000000-0000-4000-8000-00000000000'||n,'role','authenticated')::text,true);
$$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('81000000-0000-4000-8000-000000000001','platform-owner@example.invalid',now(),'{"display_name":"Platform Owner","adult_attested":true,"role":"student"}'),
 ('81000000-0000-4000-8000-000000000002','platform-other@example.invalid',now(),'{"display_name":"Platform Other","adult_attested":true,"role":"student"}'),
 ('81000000-0000-4000-8000-000000000003','platform-admin@example.invalid',now(),'{"display_name":"Platform Admin","adult_attested":true,"role":"student"}');
insert into auth.sessions(id,user_id,created_at,updated_at)
 select ('82000000-0000-4000-8000-00000000000'||n)::uuid,('81000000-0000-4000-8000-00000000000'||n)::uuid,
 now()-interval '1 hour',now() from generate_series(1,3) n;
insert into public.user_roles(user_id,role) values('81000000-0000-4000-8000-000000000003','administrator');

select private.enqueue_notification('s4-platform-dedup','81000000-0000-4000-8000-000000000001','assignment',
 'Practice assigned','Your practice task is ready.','/assignments');
select private.enqueue_notification('s4-platform-dedup','81000000-0000-4000-8000-000000000001','assignment',
 'Practice assigned','Your practice task is ready.','/assignments');
select pg_temp.check_platform((select count(*)=1 from private.notification_outbox where dedup_key='s4-platform-dedup'),
 'Sprint4 10.1: repeated domain event creates one outbox intent');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select * from public.claim_notification_outbox(100);
reset role;
select pg_temp.check_platform((select count(*)=1 from public.notifications where recipient_id='81000000-0000-4000-8000-000000000001'),
 'Sprint4 10.1: one recipient feed record persists before provider acknowledgement');
create temporary table platform_notice as select id from public.notifications where recipient_id='81000000-0000-4000-8000-000000000001';
grant select on platform_notice to authenticated;
set local role authenticated;
select pg_temp.platform_actor(1);
select public.save_notification_preference('assignment',false);
select pg_temp.check_platform((select email_enabled is false from public.notification_preferences where user_id=auth.uid() and category='assignment'),
 'Sprint4 10.1: optional email preference persists');
select public.save_notification_preference('system',false);
select pg_temp.check_platform((select email_enabled is true from public.notification_preferences where user_id=auth.uid() and category='system'),
 'Sprint4 10.1: required security category cannot be disabled');
select public.mark_notification_read(id) from platform_notice;
select pg_temp.check_platform((select read_at is not null from public.notifications),
 'Sprint4 10.1: owner can mark their notice read');
select pg_temp.platform_actor(2);
select pg_temp.check_platform((select count(*)=0 from public.notifications),
 'Sprint4 10.1: unrelated student cannot read another recipient feed');
select pg_temp.deny_platform('select public.mark_notification_read(id) from platform_notice',
 'Sprint4 10.1: unrelated student cannot mark a known notice read');
select pg_temp.deny_platform('select * from public.admin_search_users(null,25,0)',
 'Sprint4 12.1: non-administrator cannot search private user accounts');
select pg_temp.platform_actor(3);
select pg_temp.check_platform((select count(*)=1 from public.admin_search_users('Platform Owner',25,0)),
 'Sprint4 12.1: verified administrator can search the intended user');
select pg_temp.platform_actor(1);
select pg_temp.invalid_platform(
 $$select public.start_assistant_request(repeat('a',64),101,'{"resourceIds":[]}'::jsonb,'isolated-test-model',100,2)$$,
 'Sprint4 11.1: oversized prompt is refused before a request is recorded');
create temporary table platform_assistant_request as
 select public.start_assistant_request(repeat('b',64),100,'{"resourceIds":[]}'::jsonb,'isolated-test-model',100,2) as id;
grant select on platform_assistant_request to authenticated;
select public.finish_assistant_request(id,'failed',null,null) from platform_assistant_request;
select pg_temp.deny_platform(
 'select public.finish_assistant_request(id,''succeeded'',''fabricated-retry'',10) from platform_assistant_request',
 'Sprint4 11.2: failed assistant request cannot later be rewritten as success');
select public.start_assistant_request(repeat('c',64),1,'{"resourceIds":[]}'::jsonb,'isolated-test-model',100,2);
select pg_temp.invalid_platform(
 $$select public.start_assistant_request(repeat('d',64),1,'{"resourceIds":[]}'::jsonb,'isolated-test-model',100,2)$$,
 'Sprint4 11.1: third request exceeds quota two, including an earlier failed attempt');
select pg_temp.platform_actor(2);
select pg_temp.deny_platform(
 'select public.finish_assistant_request(id,''succeeded'',''unrelated-response'',10) from platform_assistant_request',
 'Sprint4 11.2: unrelated student cannot finish another learner assistant request');
reset role;
select pg_temp.check_platform((select count(*)=2 from private.assistant_requests
 where user_id='81000000-0000-4000-8000-000000000001'),
 'Sprint4 11.1: rejected limit variants leave only two canonical request records');
select pg_temp.check_platform((select state='failed' and provider_response_id is null from private.assistant_requests
 where id=(select id from platform_assistant_request)),
 'Sprint4 11.2: failed provider outcome remains distinct without a fabricated response');
update private.notification_outbox set provider_email_id='platform-test-provider',email_state='accepted'
 where dedup_key='s4-platform-dedup';
set local role authenticated;
select pg_temp.platform_actor(1);
select pg_temp.deny_platform(
 $$select * from public.record_resend_delivery_event('platform-forged','platform-test-provider','email.delivered',now())$$,
 'Sprint4 10.2: ordinary account cannot fabricate provider delivery events');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.check_platform((select not duplicate and matched and delivery_state='delivered'
 from public.record_resend_delivery_event('platform-delivered','platform-test-provider','email.delivered',now())),
 'Sprint4 10.2: verified delivery boundary records a matching delivered event');
select pg_temp.check_platform((select duplicate and matched and delivery_state='delivered'
 from public.record_resend_delivery_event('platform-delivered','platform-test-provider','email.delivered',now())),
 'Sprint4 10.2: repeated provider event returns the canonical delivery state');
select pg_temp.check_platform((select not duplicate and matched and delivery_state='delivered'
 from public.record_resend_delivery_event('platform-delayed-sent','platform-test-provider','email.sent',now()-interval '1 minute')),
 'Sprint4 10.2: stale sent event cannot regress observed delivery');
reset role;
select pg_temp.check_platform((select count(*)=1 from private.notification_delivery_events where event_id='platform-delivered'),
 'Sprint4 10.2: repeated webhook identity retains one canonical event');
select pg_temp.check_platform((select delivery_state='delivered' from public.notifications where id=(select id from platform_notice)),
 'Sprint4 10.2: delivery projection updates the existing recipient notice');
insert into public.safety_reports(id,reporter_id,target_user_id,reason)
 values('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',
 '81000000-0000-4000-8000-000000000002','Original reporter explanation');
set local role authenticated;
select pg_temp.platform_actor(1);
select pg_temp.deny_platform(
 $$select public.resolve_safety_report('83000000-0000-4000-8000-000000000001','resolved','Unauthorized resolution')$$,
 'Sprint4 12.1: reporter cannot resolve a report without administrator authority');
select pg_temp.platform_actor(3);
select pg_temp.invalid_platform(
 $$select public.resolve_safety_report('83000000-0000-4000-8000-000000000001','resolved',' ')$$,
 'Sprint4 12.1: moderation resolution requires a nonempty reason');
select public.resolve_safety_report('83000000-0000-4000-8000-000000000001','resolved','Confirmed moderator explanation');
select pg_temp.check_platform((select state='resolved' and reason='Original reporter explanation'
 and resolution_reason='Confirmed moderator explanation' and resolved_by=auth.uid() and resolved_at is not null
 from public.safety_reports where id='83000000-0000-4000-8000-000000000001'),
 'Sprint4 12.1: moderator resolution retains original report and attributed decision');
reset role;
select pg_temp.check_platform((select count(*)=1 from public.audit_logs
 where entity_id='83000000-0000-4000-8000-000000000001' and action='safety.report_resolved'
 and actor_id='81000000-0000-4000-8000-000000000003' and reason='Confirmed moderator explanation'),
 'Sprint4 12.1: accepted moderation resolution retains actor target action time and reason in audit');
-- Deterministic provider-unavailable outcomes exercise the real claim/completion RPCs.
-- Only this transaction's fixture clock is advanced; no provider request is sent.
do $retry_fixture$
declare notice uuid; attempt integer; claimed boolean;
begin
  notice:=private.enqueue_notification('s4-platform-retry','81000000-0000-4000-8000-000000000001',
    'system','Local retry fixture','No provider email is sent by this SQL test.','/notifications');
  update private.notification_outbox set scheduled_at=statement_timestamp()-interval '100 days',
    next_attempt_at=statement_timestamp()-interval '1 second' where id=notice;
  for attempt in 1..5 loop
    perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    execute 'set local role service_role';
    select exists(select 1 from public.claim_notification_outbox(1) as work where work.id=notice) into claimed;
    perform public.complete_notification_outbox(notice,'retry','provider_unavailable',null);
    execute 'reset role';
    perform pg_temp.check_platform(claimed,'Sprint4 10.2: due retry is claimed at attempt '||attempt);
    perform pg_temp.check_platform((select attempt_count=attempt
      and state=case when attempt<5 then 'pending' else 'failed' end
      and email_state=case when attempt<5 then 'retrying' else 'failed' end
      and (attempt=5 or next_attempt_at>=statement_timestamp()+make_interval(secs=>30*(2^(attempt-1))::integer))
      from private.notification_outbox where id=notice),
      'Sprint4 10.2: failed provider attempt '||attempt||' retains bounded backoff or terminal failure');
    if attempt<5 then
      update private.notification_outbox set next_attempt_at=statement_timestamp()-interval '1 second' where id=notice;
    end if;
  end loop;
  perform pg_temp.check_platform((select count(*)=1 and bool_and(delivery_state='failed')
    from public.notifications where outbox_id=notice),
    'Sprint4 10.2: exhausted retries preserve one in-app notice with truthful failed delivery state');
  execute 'set local role service_role';
  select exists(select 1 from public.claim_notification_outbox(100) as work where work.id=notice) into claimed;
  execute 'reset role';
  perform pg_temp.check_platform(not claimed,'Sprint4 10.2: exhausted notice is not claimed a sixth time');
end;
$retry_fixture$;
rollback;
