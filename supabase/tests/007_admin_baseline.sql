\set ON_ERROR_STOP on
begin;
set local timezone='UTC';
create function pg_temp.assert_baseline(condition boolean,label text) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end;
$$;
create function pg_temp.expect_baseline_state(command text,expected_state text,label text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin execute command;
  exception when others then
    get stacked diagnostics actual_state=returned_sqlstate;
    if actual_state=expected_state then raise notice 'PASS: %',label; return; end if;
    raise exception 'FAIL: % expected %, got %: %',label,expected_state,actual_state,sqlerrm;
  end;
  raise exception 'FAIL: % unexpectedly succeeded',label;
end;
$$;
create function pg_temp.actor(n integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object(
    'sub','89100000-0000-4000-8000-00000000000'||n,
    'session_id','89200000-0000-4000-8000-00000000000'||n,
    'role','authenticated')::text,true);
$$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('89100000-0000-4000-8000-000000000001','baseline-student@example.invalid',now(),'{"display_name":"Baseline Student","adult_attested":true,"role":"student"}'),
 ('89100000-0000-4000-8000-000000000002','baseline-tutor@example.invalid',now(),'{"display_name":"Baseline Tutor","adult_attested":true,"role":"tutor"}'),
 ('89100000-0000-4000-8000-000000000003','baseline-admin@example.invalid',now(),'{"display_name":"Baseline Admin","adult_attested":true,"role":"student"}'),
 ('89100000-0000-4000-8000-000000000004','baseline-other@example.invalid',now(),'{"display_name":"Baseline Other","adult_attested":true,"role":"student"}');
insert into auth.sessions(id,user_id,created_at,updated_at)
 select ('89200000-0000-4000-8000-00000000000'||n)::uuid,('89100000-0000-4000-8000-00000000000'||n)::uuid,
   now()-interval '1 hour',now() from generate_series(1,4) as rows(n);
insert into public.user_roles(user_id,role) values('89100000-0000-4000-8000-000000000003','administrator');
insert into public.subjects(id,name,slug) values('89300000-0000-4000-8000-000000000001','Baseline Algebra','baseline-algebra');
create temporary table baseline_ids(
 tutor_id uuid,booking_id uuid,payment_id uuid,template_id uuid,assessment_id uuid,
 assistant_request_id uuid,assistant_report_id uuid,notice_id uuid
);
insert into baseline_ids default values;
grant select,insert,update on baseline_ids to anon,authenticated,service_role;

-- A current public tutor and a selected booking establish the canonical tutor/subject/learner relationship.
set local role authenticated;
select pg_temp.actor(2);
select public.save_tutor_listing(null,'Baseline Tutor',null,'Step-by-step math','Uses worked examples, not demographic claims.',null,
  3,4000,'USD',true,false,null,null,null,null,
  '[{"subject_id":"89300000-0000-4000-8000-000000000001","expertise":"Algebra"}]'::jsonb,null);
insert into public.availability_rules(tutor_id,weekday,local_start,local_end,timezone,valid_from)
 select id,weekday,'08:00','20:00','UTC',current_date from public.tutor_profiles cross join generate_series(0,6) as weekdays(weekday)
 where user_id=auth.uid();
update public.tutor_profiles set publication_state='published' where user_id=auth.uid();
update baseline_ids set tutor_id=(select id from public.tutor_profiles where user_id=auth.uid());
select pg_temp.actor(1);
update baseline_ids set booking_id=public.create_booking(tutor_id,'89300000-0000-4000-8000-000000000001',
   date_trunc('day',now())+interval '5 days 10 hours',date_trunc('day',now())+interval '5 days 11 hours',
   'virtual','baseline-template-booking');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update baseline_ids set payment_id=public.prepare_booking_payment(booking_id,'baseline-template-payment');
select pg_temp.assert_baseline(public.apply_verified_payment_event(
 (select payment_id from baseline_ids),'baseline-template-paid','paid',statement_timestamp(),'baseline-provider-payment'),
 'fixture payment boundary creates an eligible confirmed tutoring relationship');
reset role;

-- Administrator authoring is confirmed, validated, versioned and audited.
set local role authenticated;
select pg_temp.actor(3);
update baseline_ids set template_id=(select template_id from public.save_assessment_template(
 null,null,'Fraction Check','A short fractions diagnostic','89300000-0000-4000-8000-000000000001','diagnostic',
 '[{"prompt":"Which fraction is larger?","kind":"single_choice","choices":["1/2","1/3"],"points":2,"correct_choice":"1/2","topic":"Fractions"}]'::jsonb,
 true,true,'Initial approved template'));
select pg_temp.assert_baseline((select count(*)=1 from public.audit_logs
 where action='assessment.template_version_saved' and entity_id=(select template_id from baseline_ids)
 and reason='Initial approved template'),
 'template creation retains admin actor/action/reason audit');
select pg_temp.expect_baseline_state($q$select * from public.save_assessment_template(
 null,null,'Invalid template','Missing answer key','89300000-0000-4000-8000-000000000001','diagnostic',
 '[{"prompt":"Question","kind":"single_choice","choices":["A","B"],"points":1,"correct_choice":"C","topic":"Fractions"}]'::jsonb,
 true,true,'Bad key')$q$,'22023','template validator refuses answer keys outside listed choices');
select pg_temp.actor(1);
select pg_temp.expect_baseline_state($q$select * from public.admin_read_assessment_templates()$q$,'42501',
 'Student cannot use admin template reader or access answer keys');
select pg_temp.expect_baseline_state($q$select * from private.assessment_template_versions$q$,'42501',
 'Student cannot read the restricted template source table');
select pg_temp.actor(2);
select pg_temp.assert_baseline((select count(*)=1 and max(questions->0->>'correct_choice')='1/2'
 from public.tutor_read_assessment_templates((select booking_id from baseline_ids))),
 'booking-owning Tutor reads the approved template and key for reuse');
select pg_temp.expect_baseline_state($q$select * from public.tutor_read_assessment_templates(
 '89400000-0000-4000-8000-000000000099')$q$,'42501','Tutor cannot inspect templates through an unrelated booking');
select pg_temp.actor(1);
select pg_temp.expect_baseline_state($q$select * from public.tutor_read_assessment_templates(
 (select booking_id from baseline_ids))$q$,'42501','Student cannot invoke the Tutor answer-key reader');
select pg_temp.actor(3);
select * from public.save_assessment_template(
 (select template_id from baseline_ids),1,'Fraction Check v2','Revised metadata','89300000-0000-4000-8000-000000000001','diagnostic',
 '[{"prompt":"Select one half.","kind":"single_choice","choices":["1/2","1/4"],"points":2,"correct_choice":"1/2","topic":"Fractions"}]'::jsonb,
 true,true,'Revised approved template');
select pg_temp.expect_baseline_state($q$select * from public.save_assessment_template(
 (select template_id from baseline_ids),1,'Stale','Stale','89300000-0000-4000-8000-000000000001','diagnostic',
 '[{"prompt":"Select one half.","kind":"single_choice","choices":["1/2","1/4"],"points":2,"correct_choice":"1/2","topic":"Fractions"}]'::jsonb,
 true,true,'Stale edit')$q$,'40001','stale admin template edits are rejected');
select pg_temp.actor(2);
update baseline_ids set assessment_id=public.create_assessment_from_template(template_id,booking_id);
select pg_temp.assert_baseline((select template_id=(select baseline_ids.template_id from baseline_ids)
 and template_version=2 and status='draft' from public.assessments where id=(select assessment_id from baseline_ids)),
 'Tutor creates a draft with server-derived relationship and pinned template version');
select pg_temp.actor(3);
select * from public.save_assessment_template(
 (select template_id from baseline_ids),2,'Fraction Check v3','Later template edit','89300000-0000-4000-8000-000000000001','diagnostic',
 '[{"prompt":"Choose one quarter.","kind":"single_choice","choices":["1/4","1/2"],"points":3,"correct_choice":"1/4","topic":"Fractions"}]'::jsonb,
 true,true,'Later approved template');
select pg_temp.actor(2);
select pg_temp.assert_baseline((select template_version=2 and questions.prompt='Select one half.'
 and keys.correct_choice='1/2'
 from public.assessments assessments
 join public.assessment_questions questions on questions.assessment_id=assessments.id
 join public.assessment_answer_keys keys on keys.question_id=questions.id
 where assessments.id=(select assessment_id from baseline_ids)),
 'later template edits do not mutate an existing assessment copy');
select pg_temp.expect_baseline_state($q$update public.assessments set template_version=3
 where id=(select assessment_id from baseline_ids)$q$,'42501','assessment template provenance cannot be rewritten');
select pg_temp.actor(2);
select public.assign_learning_assessment((select assessment_id from baseline_ids));
select pg_temp.assert_baseline((select versions.version_no=1 and versions.definition->'questions'->0->>'correct_choice'='1/2'
 from public.assessment_definition_versions versions where versions.assessment_id=(select assessment_id from baseline_ids)),
 'assigned assessment definition snapshot pins the exact copied answer key');

-- Badge policy stores only allow-listed facts, bounded thresholds and audited confirmed versions.
select pg_temp.actor(3);
select * from public.save_badge_policy(1,
 '[{"fact":"completed_sessions","threshold":1,"label":"Completed sessions"},
   {"fact":"visible_reviews","threshold":4,"label":"Four visible reviews"},
   {"fact":"rating_average","threshold":4.5,"label":"4.5 average"},
   {"fact":"recommendations","threshold":3,"label":"Three recommendations"}]'::jsonb,true,'Published bounded badge rules');
select pg_temp.expect_baseline_state($q$select public.save_badge_policy(2,
 '[{"fact":"protected_attribute","threshold":1,"label":"Unsafe"}]'::jsonb,true,'Unsafe')$q$,'22023',
 'badge policy rejects facts outside the public reputation whitelist');
select pg_temp.expect_baseline_state($q$select public.save_badge_policy(1,
 '[{"fact":"completed_sessions","threshold":1,"label":"Completed sessions"}]'::jsonb,true,'stale')$q$,'40001',
 'stale badge policy revisions are rejected');
select pg_temp.assert_baseline((select version=2 and jsonb_array_length(thresholds)=4 from public.admin_read_badge_policy()),
 'current badge policy exposes its version and supported facts only');
select pg_temp.actor(2);
select pg_temp.assert_baseline((select policy_version=2 and completed_sessions=0 and visible_reviews=0
 from public.read_own_tutor_badge_progress()),
 'Tutor progress reads canonical counters and the published policy version');
reset role;
set local role anon;
select pg_temp.assert_baseline((select policy_version=2 and jsonb_array_length(badges)=0
 from public.list_public_tutor_badges(array[(select tutor_id from baseline_ids)])),
 'public badge DTO has current policy version and no unsupported badge when thresholds are unmet');
select pg_temp.assert_baseline((select count(*)=1 and bool_and(tutor_id=(select baseline_ids.tutor_id from baseline_ids)
 and subject_id='89300000-0000-4000-8000-000000000001' and hourly_rate_minor=4000)
 from public.list_public_tutor_subjects_batch(array[(select tutor_id from baseline_ids)])),
 'public saved-tutor cards can fetch only bounded public subject/rate fields in one batch');
select pg_temp.expect_baseline_state($q$select * from public.list_public_tutor_subjects_batch(
 array(select gen_random_uuid() from generate_series(1,51)))$q$,'22023',
 'public batch offering read refuses more than fifty tutor IDs');
reset role;

-- Saved tutor bookmarks are owner-only, idempotent and limited to currently public tutors.
set local role authenticated;
select pg_temp.actor(1);
select public.save_public_tutor((select tutor_id from baseline_ids));
select public.save_public_tutor((select tutor_id from baseline_ids));
select pg_temp.assert_baseline((select count(*)=1 from public.saved_tutors where user_id=auth.uid()),
 'Student saves a current listing idempotently');
select pg_temp.actor(4);
select pg_temp.assert_baseline((select count(*)=0 from public.saved_tutors),
 'unrelated Student cannot read another account saved tutors');
reset role;
insert into public.user_roles(user_id,role) values('89100000-0000-4000-8000-000000000002','student') on conflict do nothing;
set local role authenticated;
select pg_temp.actor(2);
select pg_temp.expect_baseline_state($q$select public.save_public_tutor((select tutor_id from baseline_ids))$q$,'22023',
 'Tutor cannot save their own public listing even with Student capability');
reset role;
delete from public.user_roles where user_id='89100000-0000-4000-8000-000000000003' and role='student';
set local role authenticated;
select pg_temp.actor(3);
select pg_temp.expect_baseline_state($q$select public.save_public_tutor((select tutor_id from baseline_ids))$q$,'42501',
 'Administrator without Student role cannot write saved tutor state');

-- AI reports are owner-verified and retain only request metadata, never prompts or generated output.
select pg_temp.actor(1);
update baseline_ids set assistant_request_id=public.start_assistant_request(repeat('a',64),80,'{"bookingId":"selected-only"}'::jsonb,'test-model',100,5);
select public.finish_assistant_request((select assistant_request_id from baseline_ids),'succeeded','provider-id-fixture',120);
update baseline_ids set assistant_report_id=public.report_assistant_response(assistant_request_id,'The cited explanation did not answer my selected question.');
select pg_temp.actor(4);
select pg_temp.expect_baseline_state($q$select public.report_assistant_response(
 (select assistant_request_id from baseline_ids),'Unrelated account')$q$,'42501',
 'unrelated Student cannot report a known assistant request');
select pg_temp.expect_baseline_state($q$select * from public.admin_read_assistant_response_reports()$q$,'42501',
 'Student cannot read the admin assistant-report queue');
select pg_temp.actor(3);
select pg_temp.assert_baseline((select count(*)=1 and bool_and(request_id=(select assistant_request_id from baseline_ids))
 from public.admin_read_assistant_response_reports()),
 'Admin reads a bounded report DTO linked only to request identity and report metadata');
select public.resolve_assistant_response_report((select assistant_report_id from baseline_ids),'resolved',true,'Reviewed the selected report');
select pg_temp.assert_baseline((select count(*)=1 and bool_and(state='resolved' and resolution_reason='Reviewed the selected report' and resolved_by=auth.uid())
 from public.admin_read_assistant_response_reports() where id=(select assistant_report_id from baseline_ids)),
 'Admin report resolution is confirmed and attributed');
select pg_temp.assert_baseline(not exists(select 1 from pg_attribute where attrelid='private.assistant_response_reports'::regclass
 and attname in ('prompt','question','selected_context','answer','output')),
 'assistant report storage has no prompt, selected-context or answer columns');
select pg_temp.assert_baseline((select count(*)=1 from public.audit_logs
 where action='assistant.response_report_resolved' and entity_id=(select assistant_report_id from baseline_ids)
 and reason='Reviewed the selected report'),
 'assistant report moderation retains reason and actor audit');

-- Operational event inputs are allow-listed and only aggregate health is available to Administrators.
select pg_temp.actor(1);
select public.record_operational_event('89500000-0000-4000-8000-000000000001','assistant.response','assistant',50,'success');
select pg_temp.expect_baseline_state($q$select public.record_operational_event(
 '89500000-0000-4000-8000-000000000002','assistant.response','assistant',120001,'success')$q$,'22023',
 'operational event rejects an out-of-range duration');
select pg_temp.expect_baseline_state($q$select * from public.admin_read_operational_health()$q$,'42501',
 'Student cannot read operational aggregates');
select pg_temp.actor(3);
select pg_temp.assert_baseline((select count(*)>=1 from public.admin_read_operational_health()
 where metric_key='operations_succeeded' and metric_value>=1 and window_start is not null),
 'Admin health read returns privacy-safe 24-hour aggregate counts');
select pg_temp.assert_baseline((select count(*)=1 from public.admin_read_operational_health()
 where metric_key='assessment_scoring_backlog' and window_start is null),
 'current backlog metric is not mislabeled as a 24-hour count');

-- Fifth retry is a terminal failure in the worker result, not another retrying state.
reset role;
update baseline_ids set notice_id=private.enqueue_notification('baseline-final-retry','89100000-0000-4000-8000-000000000001',
 'system','Retry fixture','No provider request is sent by SQL tests.','/notifications');
update private.notification_outbox set scheduled_at=statement_timestamp()-interval '1 day',
 next_attempt_at=statement_timestamp()-interval '1 second' where dedup_key='baseline-final-retry';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $retry$
declare notice uuid; attempt integer; claimed boolean; completion record;
begin
 select notice_id into notice from baseline_ids;
 for attempt in 1..5 loop
   select exists(select 1 from public.claim_notification_outbox(100) where id=notice) into claimed;
   if not claimed then raise exception 'FAIL: retry fixture not claimed at attempt %',attempt; end if;
   select * into completion from public.complete_notification_outbox_v2(notice,'retry','provider_unavailable',null);
   if attempt<5 and (completion.state<>'pending' or completion.email_state<>'retrying' or completion.attempt_count<>attempt) then
     raise exception 'FAIL: retry completion did not expose pending attempt %',attempt; end if;
   if attempt=5 and (completion.state<>'failed' or completion.email_state<>'failed' or completion.attempt_count<>5) then
     raise exception 'FAIL: fifth completion was not terminal'; end if;
   raise notice 'PASS: outbox completion v2 reports canonical attempt % state %/%',attempt,completion.state,completion.email_state;
   if attempt<5 then
     execute 'reset role';
     update private.notification_outbox set next_attempt_at=statement_timestamp()-interval '1 second' where id=notice;
     execute 'set local role service_role';
   end if;
 end loop;
end;
$retry$;
reset role;
select pg_temp.assert_baseline((select count(*)=1 from public.notifications notices
 join private.notification_outbox outbox on outbox.id=notices.outbox_id
 where outbox.dedup_key='baseline-final-retry' and notices.delivery_state='failed'),
 'fifth provider retry exhaustion preserves the in-app notice and reports truthful failed delivery');
rollback;

