\set ON_ERROR_STOP on
-- Sprint 4 learning completion behavior. All fixture rows are disposable and rolled back at the end.
begin;
set local timezone = 'UTC';

create function pg_temp.assert_true(condition boolean, label text) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end;
$$;
create function pg_temp.expect_state(command text, expected_state text, label text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin
    execute command;
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
    if actual_state = expected_state then raise notice 'PASS: %', label; return; end if;
    raise exception 'FAIL: % expected SQLSTATE %, received %: %', label, expected_state, actual_state, sqlerrm;
  end;
  raise exception 'FAIL: % unexpectedly succeeded', label;
end;
$$;
create function pg_temp.actor(n integer) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '86100000-0000-4000-8000-00000000000' || n,
    'session_id', '86200000-0000-4000-8000-00000000000' || n,
    'role', 'authenticated')::text, true);
$$;

-- 1 = Student S1, 2 = Tutor T1, 3 = unrelated Student S2, 4 = unrelated Tutor T2.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('86100000-0000-4000-8000-000000000001','learning6-s1@example.invalid',now(),'{"display_name":"Learning S1","adult_attested":true,"role":"student"}'),
 ('86100000-0000-4000-8000-000000000002','learning6-t1@example.invalid',now(),'{"display_name":"Learning T1","adult_attested":true,"role":"tutor"}'),
 ('86100000-0000-4000-8000-000000000003','learning6-s2@example.invalid',now(),'{"display_name":"Learning S2","adult_attested":true,"role":"student"}'),
 ('86100000-0000-4000-8000-000000000004','learning6-t2@example.invalid',now(),'{"display_name":"Learning T2","adult_attested":true,"role":"tutor"}');
insert into auth.sessions(id,user_id,created_at,updated_at)
select ('86200000-0000-4000-8000-00000000000'||n)::uuid,
       ('86100000-0000-4000-8000-00000000000'||n)::uuid,statement_timestamp()-interval '1 hour',statement_timestamp()
from generate_series(1,4) as rows(n);
insert into public.subjects(id,name,slug) values
 ('86400000-0000-4000-8000-000000000001','Learning6 Algebra','learning6-algebra'),
 ('86400000-0000-4000-8000-000000000002','Learning6 Geometry','learning6-geometry');

create temporary table learning6_ids (
  tutor_one uuid not null, tutor_two uuid not null, student_one uuid not null, student_two uuid not null,
  subject_one uuid not null, subject_two uuid not null, booking_one uuid not null, booking_two uuid not null,
  resource_one uuid not null, resource_two uuid not null,
  assessment_one uuid, attempt_one uuid, attempt_two uuid, assignment_one uuid, assignment_closed uuid,
  submission_one uuid, plan_one uuid, milestone_one uuid, proposal_one uuid, plan_personal uuid,
  assessment_two uuid, assignment_two uuid, plan_assignment uuid, progress_event_at timestamptz, assignment_cancel uuid
);
insert into learning6_ids values (
 '86300000-0000-4000-8000-000000000001','86300000-0000-4000-8000-000000000002',
 '86100000-0000-4000-8000-000000000001','86100000-0000-4000-8000-000000000003',
 '86400000-0000-4000-8000-000000000001','86400000-0000-4000-8000-000000000002',
 '86500000-0000-4000-8000-000000000001','86500000-0000-4000-8000-000000000002',
 '86600000-0000-4000-8000-000000000001','86600000-0000-4000-8000-000000000002',
 null,null,null,null,null,null,null,'86700000-0000-4000-8000-000000000001',null,null,null,null,null,null,null
);
grant select,update on learning6_ids to authenticated,service_role;

-- S1 starts a structured personal goal before any tutor relationship or booking exists.
set local role authenticated;
select pg_temp.actor(1);
update learning6_ids set plan_personal=public.create_personal_study_plan(subject_one,'Before-booking goal','Personal learning target',
  jsonb_build_array(jsonb_build_object('id','86700000-0000-4000-8000-000000000040','position',1,'title','Fractions','topic','Fractions',
    'targetDate',current_date+14,'baseline','Cannot compare unlike denominators','schedule','Practice twice each week',
    'successCriterion','Correctly compare 8 of 10 sets','description',null,'milestones',jsonb_build_array(
      jsonb_build_object('id','86700000-0000-4000-8000-000000000041','position',1,'title','Find common denominators',
        'description',null,'status','planned','targetDate',current_date+7,'links','[]'::jsonb)))));
select pg_temp.assert_true((select tutor_id is null and booking_id is null and student_id='86100000-0000-4000-8000-000000000001'
  and current_revision=1 from public.study_plans where id=(select plan_personal from learning6_ids)),
  'Sprint4 7.3 C01: student creates a private structured plan before a booking');
select public.reschedule_study_milestone(plan_personal,'86700000-0000-4000-8000-000000000041',1,current_date+9,
  'Student adjusted the personal schedule',null) from learning6_ids;
select pg_temp.assert_true((select count(*)=1 and min(from_target_date)=current_date+7 and min(to_target_date)=current_date+9
  and min(reason)='Student adjusted the personal schedule' and bool_and(authored_by='86100000-0000-4000-8000-000000000001')
  from public.study_plan_replanning_history where plan_id=(select plan_personal from learning6_ids)),
  'Sprint4 13.2 C06: owner records a dated personal replan with reason and provenance');
select pg_temp.actor(3);
select pg_temp.assert_true((select count(*)=0 from public.study_plans where id=(select plan_personal from learning6_ids)),
  'Sprint4 7.3 C02: another student cannot read a personal plan');
select pg_temp.expect_state($q$select public.revise_owned_study_plan(plan_personal,2,'Other student',null,
  (select goals from public.study_plan_revisions where plan_id=(select plan_personal from learning6_ids) and revision_no=2))
  from learning6_ids$q$,'42501','Sprint4 7.3 C03: another student cannot revise a personal plan');
reset role;

-- Minimal published tutor listings establish real, separate S1/T1 and S2/T2 booking relationships.
set local role authenticated;
select pg_temp.actor(2);
insert into public.tutor_profiles(id,user_id,public_display_name,headline,bio,hourly_rate_minor)
values ('86300000-0000-4000-8000-000000000001',auth.uid(),'Learning6 T1','Algebra','Fixture tutor biography',4000);
insert into public.tutor_subjects(tutor_id,subject_id) values
 ('86300000-0000-4000-8000-000000000001','86400000-0000-4000-8000-000000000001'),
 ('86300000-0000-4000-8000-000000000001','86400000-0000-4000-8000-000000000002');
insert into public.availability_rules(tutor_id,weekday,local_start,local_end,timezone,valid_from)
select '86300000-0000-4000-8000-000000000001',weekday,'00:00','23:59','UTC',current_date-30 from generate_series(0,6) as rows(weekday);
update public.tutor_profiles set publication_state='published' where id='86300000-0000-4000-8000-000000000001';
select pg_temp.actor(4);
insert into public.tutor_profiles(id,user_id,public_display_name,headline,bio,hourly_rate_minor)
values ('86300000-0000-4000-8000-000000000002',auth.uid(),'Learning6 T2','Algebra','Other fixture tutor biography',4000);
insert into public.tutor_subjects(tutor_id,subject_id) values ('86300000-0000-4000-8000-000000000002','86400000-0000-4000-8000-000000000001');
insert into public.availability_rules(tutor_id,weekday,local_start,local_end,timezone,valid_from)
select '86300000-0000-4000-8000-000000000002',weekday,'00:00','23:59','UTC',current_date-30 from generate_series(0,6) as rows(weekday);
update public.tutor_profiles set publication_state='published' where id='86300000-0000-4000-8000-000000000002';
reset role;

insert into public.resources(id,subject_id,title,description,url,resource_type,active) values
 ('86600000-0000-4000-8000-000000000001','86400000-0000-4000-8000-000000000001','Algebra practice','Fixture resource','https://example.invalid/algebra','practice',true),
 ('86600000-0000-4000-8000-000000000002','86400000-0000-4000-8000-000000000002','Geometry practice','Fixture resource','https://example.invalid/geometry','practice',true);

-- The rows below are explicit disposable payment fixtures, not a provider integration or charge test.
insert into public.bookings(id,student_id,tutor_id,subject_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
  mode,price_minor,platform_fee_minor,currency,status,hold_expires_at,policy_snapshot,request_key)
select '86500000-0000-4000-8000-000000000001'::uuid,'86100000-0000-4000-8000-000000000001'::uuid,
  '86300000-0000-4000-8000-000000000001'::uuid,'86400000-0000-4000-8000-000000000001'::uuid,
  date_trunc('day',statement_timestamp())-interval '1 day 12 hours',date_trunc('day',statement_timestamp())-interval '1 day 11 hours',
  date_trunc('day',statement_timestamp())-interval '1 day 12 hours 10 minutes',date_trunc('day',statement_timestamp())-interval '1 day 10 hours 50 minutes',
  'virtual',4000,0,'USD','payment_pending',statement_timestamp()+interval '10 minutes','{"fixture":"learning6"}'::jsonb,'learning6-ended-s1-t1'
union all
select '86500000-0000-4000-8000-000000000002'::uuid,'86100000-0000-4000-8000-000000000003'::uuid,
  '86300000-0000-4000-8000-000000000002'::uuid,'86400000-0000-4000-8000-000000000001'::uuid,
  date_trunc('day',statement_timestamp())+interval '1 day 14 hours',date_trunc('day',statement_timestamp())+interval '1 day 15 hours',
  date_trunc('day',statement_timestamp())+interval '1 day 13 hours 50 minutes',date_trunc('day',statement_timestamp())+interval '1 day 15 hours 10 minutes',
  'virtual',4000,0,'USD','payment_pending',statement_timestamp()+interval '10 minutes','{"fixture":"learning6"}'::jsonb,'learning6-ended-s2-t2';
insert into public.booking_private_details(booking_id,meeting_url) values
 ('86500000-0000-4000-8000-000000000001','https://meet.example.invalid/learning6-s1'),
 ('86500000-0000-4000-8000-000000000002','https://meet.example.invalid/learning6-s2');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.apply_verified_payment_event(public.prepare_booking_payment('86500000-0000-4000-8000-000000000001','learning6-pay-s1'),
  'learning6-event-s1','paid',statement_timestamp(),'learning6-provider-s1');
select public.apply_verified_payment_event(public.prepare_booking_payment('86500000-0000-4000-8000-000000000002','learning6-pay-s2'),
  'learning6-event-s2','paid',statement_timestamp(),'learning6-provider-s2');
reset role;
set local role authenticated;
select pg_temp.actor(1);
select pg_temp.expect_state($q$select public.share_personal_study_plan(plan_personal,booking_two) from learning6_ids$q$,
  '22023','Sprint4 7.3 C04: personal plan cannot be shared with another learner booking');
select public.share_personal_study_plan(plan_personal,booking_one) from learning6_ids;
select pg_temp.assert_true((select tutor_id='86300000-0000-4000-8000-000000000001' and booking_id='86500000-0000-4000-8000-000000000001'
  and current_revision=2 from public.study_plans where id=(select plan_personal from learning6_ids)),
  'Sprint4 7.3 C05: student can explicitly share the plan with the tutor on a matching booking');
select pg_temp.actor(4);
select pg_temp.assert_true((select count(*)=0 from public.study_plans where id=(select plan_personal from learning6_ids)),
  'Sprint4 7.3 C06: unrelated tutor cannot read a shared personal plan');
select pg_temp.actor(2);
select pg_temp.assert_true((select count(*)=1 from public.study_plans where id=(select plan_personal from learning6_ids)),
  'Sprint4 7.3 C07: explicitly selected tutor can read the shared plan');

-- Student preparation is tagged and editable only while the scheduled session is still open.
select pg_temp.actor(3);
select public.save_session_preparation(booking_two,'Review fractions','How do I compare them?',array['Fractions','Fractions','Practice'])
  from learning6_ids;
select public.save_session_preparation(booking_two,'Review fraction models','Which model is clearest?',array['Geometry','Practice'])
  from learning6_ids;
select pg_temp.assert_true((select student_goals='Review fraction models' and priority_topics=array['Geometry','Practice']
  from public.session_plans where booking_id=(select booking_two from learning6_ids)),
  'Sprint4 9.6 C04: student priorities are explicit, deduplicated and safely replaceable');
reset role;
set local role authenticated;
select pg_temp.actor(2);
select public.mark_session_completed('86500000-0000-4000-8000-000000000001');
select public.publish_session_recap('86500000-0000-4000-8000-000000000001','Completed algebra session','Reviewed fractions','Next practice set');
select pg_temp.assert_true((select count(*)=1 from public.learning_progress_events
  where event_type='session_recap_published' and source_kind='session_recap' and source_id='86500000-0000-4000-8000-000000000001'),
  'Sprint4 9.6 C01: first recap publication creates one dated progress event');
select public.publish_structured_session_recap_v2('86500000-0000-4000-8000-000000000001','Completed algebra session',
  array['Fractions'],'Optional mastery notes','Clear fraction comparison','Practice common denominators','Next practice set',array['86600000-0000-4000-8000-000000000001']::uuid[]);
select public.publish_structured_session_recap_v2('86500000-0000-4000-8000-000000000001','Completed algebra session',
  array['Fractions'],'Optional mastery notes','Clear fraction comparison','Practice common denominators','Next practice set',array['86600000-0000-4000-8000-000000000001']::uuid[]);
select pg_temp.assert_true((select count(*)=1 and min(revision)=3 and min(mastery_notes)='Optional mastery notes'
    and min(strengths)='Clear fraction comparison' and min(practice_areas)='Practice common denominators'
    and min(published_at)=max(published_at)
  from public.session_recaps where booking_id='86500000-0000-4000-8000-000000000001'),
  'Sprint4 9.6 C02: mastery notes, strengths, practice areas and first publication time remain distinct on repeat save');
select public.publish_structured_session_recap('86500000-0000-4000-8000-000000000001','Compatibility recap',
  array['Fractions'],'Legacy strength note','Legacy practice area','Next practice set',array['86600000-0000-4000-8000-000000000001']::uuid[]);
select pg_temp.assert_true((select mastery_notes='Legacy strength note' and strengths='Legacy strength note'
  from public.session_recaps where booking_id='86500000-0000-4000-8000-000000000001'),
  'Sprint4 9.6 C03: legacy seven-argument structured recap contract remains available');
select public.publish_structured_session_recap_v2('86500000-0000-4000-8000-000000000001','Completed algebra session',
  array['Fractions'],'Optional mastery notes','Clear fraction comparison','Practice common denominators','Next practice set',array['86600000-0000-4000-8000-000000000001']::uuid[]);
select pg_temp.assert_true((select count(*)=1 from public.session_recap_resources
    where booking_id='86500000-0000-4000-8000-000000000001' and resource_id='86600000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.learning_progress_events
    where event_type='session_recap_published' and source_id='86500000-0000-4000-8000-000000000001'),
  'Sprint4 9.6 C04: resource snapshot replacement and recap progress event are duplicate-safe');

-- A1/T1 and A2/T2 are both real scored relationship records; A2 is used to test cross-plan link rejection.
select pg_temp.actor(2);
update learning6_ids set assessment_one=public.create_tagged_learning_assessment(tutor_one,student_one,subject_one,booking_one,
  '{"title":"Learning6 diagnostic","purpose":"milestone","questions":[{"prompt":"2+2?","kind":"single_choice","choices":["4","5"],"points":2,"correct_choice":"4","topic":"Fractions"}]}'::jsonb);
update public.assessments set status='assigned' where id=(select assessment_one from learning6_ids);
select pg_temp.actor(4);
update learning6_ids set assessment_two=public.create_tagged_learning_assessment(tutor_two,student_two,subject_one,booking_two,
  '{"title":"Other learner diagnostic","purpose":"diagnostic","questions":[{"prompt":"3+3?","kind":"single_choice","choices":["6","7"],"points":1,"correct_choice":"6","topic":"Fractions"}]}'::jsonb);
select public.assign_learning_assessment(assessment_two) from learning6_ids;
update learning6_ids set assignment_two=public.create_tagged_learning_assignment(tutor_two,student_two,booking_two,
  'Other learner practice','Submit a short response','text',statement_timestamp()+interval '2 days',true,'Fractions',null,null);
select public.assign_learning_assignment(assignment_two) from learning6_ids;
select public.save_session_agenda_learning_links(booking_two,jsonb_build_array(
  jsonb_build_object('kind','resource','id',resource_one::text),
  jsonb_build_object('kind','assessment','id',assessment_two::text),
  jsonb_build_object('kind','assignment','id',assignment_two::text))) from learning6_ids;
select public.save_session_agenda_learning_links(booking_two,jsonb_build_array(
  jsonb_build_object('kind','resource','id',resource_one::text),
  jsonb_build_object('kind','assessment','id',assessment_two::text),
  jsonb_build_object('kind','assignment','id',assignment_two::text))) from learning6_ids;
select pg_temp.assert_true((select count(*)=3 and count(distinct position)=3
    and count(*) filter(where resource_id=(select resource_one from learning6_ids))=1
    and count(*) filter(where assessment_id=(select assessment_two from learning6_ids))=1
    and count(*) filter(where assignment_id=(select assignment_two from learning6_ids))=1
  from public.session_plan_learning_links where booking_id=(select booking_two from learning6_ids)),
  'Sprint4 9.6 C05: repeated agenda saves replace validated links without duplicates');
select pg_temp.actor(1);
select pg_temp.assert_true((select count(*)=0 from public.session_plan_learning_links
  where booking_id=(select booking_two from learning6_ids)),
  'Sprint4 9.6 C06: unrelated learner cannot read another booking agenda links');

select pg_temp.actor(1);
update learning6_ids set attempt_one=public.submit_assessment_attempt(assessment_one,
  (select jsonb_object_agg(questions.id::text,'4') from public.assessment_questions as questions where questions.assessment_id=learning6_ids.assessment_one),true);
select pg_temp.assert_true((select count(*)=0 from public.assessment_answer_keys),
  'Sprint4 5.1 C01: student cannot read the private answer key');
select pg_temp.expect_state($q$select private.assessment_definition_snapshot(assessment_one) from learning6_ids$q$,
  '42501','Sprint4 5.2 C03: student cannot execute the answer-key-bearing definition snapshot helper');
select pg_temp.assert_true((select score=2 and status='scored' from public.assessment_attempts where id=(select attempt_one from learning6_ids)),
  'Sprint4 5.1 C02: objective score is computed from the stored key');
select pg_temp.assert_true((select count(*)=1 and min(topic)='Fractions' and min(points_earned)=2 and min(points_possible)=2
  from public.assessment_topic_evidence where attempt_id=(select attempt_one from learning6_ids)),
  'Sprint4 6.10 C01: scored tagged question produces dated topic-level points evidence');
select pg_temp.assert_true((select definition_version=1 from public.assessment_attempts where id=(select attempt_one from learning6_ids))
  and (select count(*)=0 from public.assessment_definition_versions),
  'Sprint4 5.2 C02: retake source definition is pinned and private from the student');
update learning6_ids set attempt_two=public.submit_assessment_attempt(assessment_one,
  (select jsonb_object_agg(questions.id::text,'4') from public.assessment_questions as questions where questions.assessment_id=learning6_ids.assessment_one),true);
select pg_temp.assert_true((select attempt_one=attempt_two and count(*)=1 from learning6_ids,public.assessment_attempts
  where assessment_id=learning6_ids.assessment_one group by attempt_one,attempt_two),
  'Sprint4 5.1 C03: exact finalized retry returns the existing attempt');
select pg_temp.expect_state($q$select public.submit_assessment_attempt(assessment_one,
  (select jsonb_object_agg(questions.id::text,'5') from public.assessment_questions as questions where questions.assessment_id=learning6_ids.assessment_one),true)
  from learning6_ids$q$,'22023','Sprint4 5.1 C04: conflicting finalized retry is refused');
select pg_temp.actor(2);
select public.authorize_assessment_retake(assessment_one) from learning6_ids;
select pg_temp.actor(1);
update learning6_ids set attempt_two=public.submit_assessment_attempt(assessment_one,
  (select jsonb_object_agg(questions.id::text,'5') from public.assessment_questions as questions where questions.assessment_id=learning6_ids.assessment_one),true);
select pg_temp.assert_true((select count(*)=2 and min(attempt_no)=1 and max(attempt_no)=2
  and count(distinct definition_version)=1 and min(definition_version)=1
  and max(score)=2 and min(score)=0 and bool_and(attempts.answers->>(select questions.id::text from public.assessment_questions as questions
    where questions.assessment_id=attempts.assessment_id) in ('4','5'))
  from public.assessment_attempts as attempts where attempts.assessment_id=(select assessment_one from learning6_ids)),
  'Sprint4 5.2 C01: tutor-authorized retake preserves numbered original score and answer history');

-- Accepted late work is flagged while open; closing is an explicit tutor action and blocks any later insert.
select pg_temp.actor(2);
update learning6_ids as ids set plan_assignment=public.create_study_plan(ids.tutor_one,ids.student_one,ids.subject_one,ids.booking_one,'Assignment milestone plan',null,
  jsonb_build_array(jsonb_build_object('id','86700000-0000-4000-8000-000000000050','position',1,'title','Fractions','topic','Fractions',
    'targetDate',current_date+10,'baseline','Needs practice','schedule','Twice weekly','successCriterion','8 of 10','description',null,
    'milestones',jsonb_build_array(jsonb_build_object('id',ids.milestone_one::text,'position',1,'title','Compare fractions',
      'description',null,'status','planned','targetDate',current_date+8,'links','[]'::jsonb)))))
  ;
update learning6_ids set assignment_one=public.create_tagged_learning_assignment(tutor_one,student_one,booking_one,
  'Late allowed','Submit a short response','text',statement_timestamp()-interval '1 second',true,'Fractions',plan_assignment,milestone_one);
select public.update_tagged_learning_assignment(assignment_one,'Late allowed','Submit a short response','text',
  statement_timestamp()-interval '1 second',true,'Fractions',plan_assignment,milestone_one) from learning6_ids;
select pg_temp.assert_true((select assignments.topic='Fractions' and assignments.subject_id=learning6_ids.subject_one
    and assignments.study_plan_id=learning6_ids.plan_assignment and assignments.plan_revision_no=1
    and assignments.milestone_id=learning6_ids.milestone_one
  from public.assignments as assignments cross join learning6_ids where assignments.id=learning6_ids.assignment_one),
  'Sprint4 8.1 C01: assignment stores a subject topic and pinned matching plan milestone');
select public.assign_learning_assignment(assignment_one) from learning6_ids;
update learning6_ids set assignment_closed=public.create_learning_assignment(tutor_one,student_one,booking_one,
  'Closed practice','Submit a short response','text',statement_timestamp()-interval '1 second',true);
select public.assign_learning_assignment(assignment_closed) from learning6_ids;
select public.close_assignment_submissions(assignment_closed) from learning6_ids;
select pg_temp.actor(1);
select public.save_assignment_submission_draft(assignment_one,'Draft work in progress',null) from learning6_ids;
select pg_temp.assert_true((select count(*)=1 and min(body)='Draft work in progress'
  from public.assignment_submission_drafts where assignment_id=(select assignment_one from learning6_ids))
  and (select count(*)=0 from public.assignment_submissions where assignment_id=(select assignment_one from learning6_ids)),
  'Sprint4 8.1 C02: student draft persists without forcing a submission');
select pg_temp.actor(3);
select pg_temp.expect_state($q$select public.save_assignment_submission_draft(assignment_one,'Forged draft',null) from learning6_ids$q$,
  '42501','Sprint4 8.1 C03: unrelated learner cannot save another student draft');
select pg_temp.actor(2);
select pg_temp.assert_true((select count(*)=0 from public.assignment_submission_drafts
  where assignment_id=(select assignment_one from learning6_ids)),
  'Sprint4 8.1 C04: tutor cannot read private student draft contents');
select pg_temp.actor(1);
update learning6_ids set submission_one=public.submit_assignment_submission_draft(assignment_one);
select pg_temp.assert_true((select count(*)=0 from public.assignment_submission_drafts
  where assignment_id=(select assignment_one from learning6_ids)),
  'Sprint4 8.1 C05: draft is removed only after explicit submission');
select pg_temp.assert_true((select is_late and submitted_at>assignments.due_at
  from public.assignment_submissions as submissions join public.assignments on assignments.id=submissions.assignment_id
  where submissions.id=(select submission_one from learning6_ids)),
  'Sprint4 8.2 C01: allowed late submission is retained and visibly marked late');
select pg_temp.expect_state($q$select public.submit_assignment_with_file(assignment_closed,'After close',null,null,null,null)
  from learning6_ids$q$,'22023','Sprint4 8.2 C02: explicit close rejects further submissions');
select pg_temp.actor(2);
select public.give_assignment_feedback(submission_one,'Needs one more explanation',80,'returned') from learning6_ids;
select pg_temp.assert_true((select count(*)=0 from public.learning_progress_events
  where event_type='assignment_completed' and source_id=(select submission_one from learning6_ids)),
  'Sprint4 8.2 C03: returned feedback does not emit a completion event');
select public.give_assignment_feedback(submission_one,'Completed with clear working',100,'completed') from learning6_ids;
update learning6_ids set progress_event_at=(select occurred_at from public.learning_progress_events
  where event_type='assignment_completed' and source_id=learning6_ids.submission_one);
select pg_temp.assert_true((select count(*)=1 and min(occurred_at)=min(feedback.updated_at)
  from public.learning_progress_events as events join public.assignment_feedback as feedback
    on feedback.submission_id=events.source_id
  where events.event_type='assignment_completed' and events.source_kind='assignment_submission'
    and events.source_id=(select submission_one from learning6_ids)),
  'Sprint4 8.2 C04: returned-to-completed edit emits one event at the completion edit time');
select public.give_assignment_feedback(submission_one,'Small wording edit after completion',95,'completed') from learning6_ids;
select pg_temp.assert_true((select count(*)=1 from public.learning_progress_events
  where event_type='assignment_completed' and source_kind='assignment_submission'
    and source_id=(select submission_one from learning6_ids)),
  'Sprint4 8.2 C05: repeated completed-feedback edits retain exactly one event');
select pg_temp.assert_true((select events.occurred_at=learning6_ids.progress_event_at
  from public.learning_progress_events as events cross join learning6_ids
  where events.event_type='assignment_completed' and events.source_id=learning6_ids.submission_one),
  'Sprint4 8.2 C06: later feedback edits do not rewrite completion history');

-- Cancellation records a tutor reason while preserving already returned student work and feedback.
update learning6_ids set assignment_cancel=public.create_learning_assignment(tutor_one,student_one,booking_one,
  'Cancellation history','Submit a short response','text',statement_timestamp()+interval '2 days',false);
select public.assign_learning_assignment(assignment_cancel) from learning6_ids;
select pg_temp.actor(1);
select public.submit_assignment(assignment_cancel,'Work retained after task withdrawal',null) from learning6_ids;
select pg_temp.actor(2);
select public.give_assignment_feedback((select id from public.assignment_submissions where assignment_id=(select assignment_cancel from learning6_ids)),
  'Returned before cancellation',75,'returned');
select public.cancel_learning_assignment(assignment_cancel,'Learner schedule changed') from learning6_ids;
select pg_temp.assert_true((select assignments.status='cancelled' and assignments.cancellation_reason='Learner schedule changed'
    and (select count(*) from public.assignment_submissions where assignment_id=assignments.id)=1
    and (select count(*) from public.assignment_feedback join public.assignment_submissions as submissions
      on submissions.id=assignment_feedback.submission_id where submissions.assignment_id=assignments.id)=1
  from public.assignments where id=(select assignment_cancel from learning6_ids)),
  'Sprint4 8.1 C06: tutor cancellation persists a reason and retains submitted work and feedback');
select public.cancel_learning_assignment(assignment_cancel,'Replacement reason must not overwrite audit') from learning6_ids;
select pg_temp.assert_true((select status='cancelled' and cancellation_reason='Learner schedule changed'
  from public.assignments where id=(select assignment_cancel from learning6_ids)),
  'Sprint4 8.1 C07: repeated cancellation is idempotent and preserves the original reason');
select pg_temp.expect_state($q$select public.cancel_learning_assignment(assignment_cancel,'') from learning6_ids$q$,
  '22023','Sprint4 8.1 C08: blank cancellation reason is refused');
select pg_temp.expect_state($q$select public.cancel_learning_assignment(assignment_cancel,repeat('x',501)) from learning6_ids$q$,
  '22023','Sprint4 8.1 C09: oversized cancellation reason is refused');
select pg_temp.actor(4);
select pg_temp.expect_state($q$select public.cancel_learning_assignment(assignment_cancel,'Unrelated tutor') from learning6_ids$q$,
  '42501','Sprint4 8.1 C10: unrelated tutor cannot cancel the task');
select pg_temp.actor(1);
select pg_temp.expect_state($q$select public.cancel_learning_assignment(assignment_cancel,'Student') from learning6_ids$q$,
  '42501','Sprint4 8.1 C11: student cannot cancel the task');
select pg_temp.actor(2);
select pg_temp.expect_state($q$select public.cancel_learning_assignment(assignment_one,'Completed task') from learning6_ids$q$,
  '22023','Sprint4 8.1 C12: completed work cannot be cancelled');

-- New plans must be structured; source/resource links are normalized through validated FKs.
select pg_temp.expect_state($q$select public.create_study_plan(tutor_one,student_one,subject_one,booking_one,'Incomplete plan',null,
  '[{"id":"86700000-0000-4000-8000-000000000010","position":1,"title":"Fractions","topic":"Fractions","targetDate":"2026-12-01","schedule":"Twice weekly","successCriterion":"8 of 10","milestones":[{"id":"86700000-0000-4000-8000-000000000011","position":1,"title":"Compare","status":"planned","targetDate":null,"links":[]}]}]'::jsonb)
  from learning6_ids$q$,'22023','Sprint4 13.1 C01: new goal without baseline is rejected');
select pg_temp.expect_state($q$select public.create_study_plan(tutor_one,student_one,subject_one,booking_one,'Wrong subject link',null,
  jsonb_build_array(jsonb_build_object('id','86700000-0000-4000-8000-000000000020','position',1,'title','Fractions','topic','Fractions',
    'targetDate',current_date+10,'baseline','Needs practice','schedule','Twice weekly','successCriterion','8 of 10','description',null,
    'milestones',jsonb_build_array(jsonb_build_object('id','86700000-0000-4000-8000-000000000021','position',1,'title','Compare',
      'description',null,'status','planned','targetDate',null,'links',jsonb_build_array(jsonb_build_object('kind','resource','id',resource_two::text)))))))
  from learning6_ids$q$,'22023','Sprint4 13.1 C02: resource link for another subject is rejected');
select pg_temp.expect_state($q$select public.create_study_plan(tutor_one,student_one,subject_one,booking_one,'Cross learner link',null,
  jsonb_build_array(jsonb_build_object('id','86700000-0000-4000-8000-000000000030','position',1,'title','Fractions','topic','Fractions',
    'targetDate',current_date+10,'baseline','Needs practice','schedule','Twice weekly','successCriterion','8 of 10','description',null,
    'milestones',jsonb_build_array(jsonb_build_object('id','86700000-0000-4000-8000-000000000031','position',1,'title','Compare',
      'description',null,'status','planned','targetDate',null,'links',jsonb_build_array(jsonb_build_object('kind','assessment','id',
        (select assessments.id from public.assessments where assessments.student_id=learning6_ids.student_two)::text)))))))
  from learning6_ids$q$,'22023','Sprint4 13.1 C03: link to another learner assessment is rejected');

update learning6_ids set plan_one=public.create_study_plan(tutor_one,student_one,subject_one,booking_one,'Fractions plan','Structured fixture',
  jsonb_build_array(jsonb_build_object('id','86700000-0000-4000-8000-000000000010','position',1,'title','Fractions','topic','Fractions',
    'targetDate',current_date+20,'baseline','Cannot order unlike denominators','schedule','Two 30 minute sessions weekly',
    'successCriterion','Order 8 of 10 sets correctly','description','Learning6 regression plan','milestones',jsonb_build_array(
      jsonb_build_object('id','86700000-0000-4000-8000-000000000001','position',1,'title','Compare denominators','description',null,
        'status','planned','targetDate',current_date-1,'links',jsonb_build_array(
          jsonb_build_object('kind','resource','id',resource_one::text),
          jsonb_build_object('kind','assignment','id',assignment_one::text),
          jsonb_build_object('kind','assessment','id',assessment_one::text))),
      jsonb_build_object('id','86700000-0000-4000-8000-000000000002','position',2,'title','Order fraction sets','description',null,
        'status','planned','targetDate',current_date+10,'links','[]'::jsonb)))));
select pg_temp.assert_true((select count(*)=3 from public.study_plan_milestone_links
  where plan_id=(select plan_one from learning6_ids) and revision_no=1 and milestone_id=(select milestone_one from learning6_ids)),
  'Sprint4 13.1 C04: ordered milestone stores validated resource, assignment and assessment links');
select pg_temp.assert_true((select array_agg((milestone->>'position')::int order by (milestone->>'position')::int)=array[1,2]
  and array_agg(milestone->>'status' order by (milestone->>'position')::int)=array['planned','planned']
  from public.study_plan_revisions as revisions,
    jsonb_array_elements(revisions.goals) as goals(goal),jsonb_array_elements(goals.goal->'milestones') as milestones(milestone)
  where revisions.plan_id=(select plan_one from learning6_ids) and revisions.revision_no=1),
  'Sprint4 13.1 C05: milestone order and state are persisted');

-- Proposals are drafts; only S1 confirmation changes the canonical date and appends dated provenance.
select pg_temp.actor(2);
update learning6_ids set proposal_one=public.create_study_plan_proposal(plan_one,milestone_one,current_date+5,'Move after review');
select pg_temp.assert_true((select revision.goals #>> '{0,milestones,0,targetDate}'=to_char(current_date-1,'YYYY-MM-DD')
  from public.study_plans as plans join public.study_plan_revisions as revision
    on revision.plan_id=plans.id and revision.revision_no=plans.current_revision
  where plans.id=(select plan_one from learning6_ids)),
  'Sprint4 13.2 C01: unconfirmed tutor proposal leaves the missed canonical date unchanged');
select pg_temp.actor(1);
select pg_temp.expect_state($q$select public.reschedule_study_milestone(plan_one,milestone_one,1,current_date+5,'Direct student change',null)
  from learning6_ids$q$,'42501','Sprint4 13.2 C02: student cannot reschedule without confirming a tutor proposal');
select public.respond_study_plan_proposal(proposal_one,'accept','Student S1 confirms the new date') from learning6_ids;
select pg_temp.assert_true((select proposals.status='accepted' and proposals.decided_by='86100000-0000-4000-8000-000000000001'
    and proposals.decision_reason='Student S1 confirms the new date'
    and history.from_target_date=current_date-1 and history.to_target_date=current_date+5
    and history.reason='Student S1 confirms the new date' and history.authored_by='86100000-0000-4000-8000-000000000001'
    and history.created_at<=statement_timestamp()
  from public.study_plan_proposals as proposals join public.study_plan_replanning_history as history
    on history.plan_id=proposals.plan_id and history.milestone_id=proposals.milestone_id
  where proposals.id=(select proposal_one from learning6_ids)),
  'Sprint4 13.2 C03: student confirmation preserves old/new dates, reason, author and time');
select pg_temp.assert_true((select current_revision=2 and authored_by='86100000-0000-4000-8000-000000000001'
    and goals #>> '{0,milestones,0,targetDate}'=to_char(current_date+5,'YYYY-MM-DD')
  from public.study_plans as plans join public.study_plan_revisions as revisions
    on revisions.plan_id=plans.id and revisions.revision_no=plans.current_revision
  where plans.id=(select plan_one from learning6_ids)),
  'Sprint4 13.2 C04: confirmed reschedule creates a student-authored current revision');
select pg_temp.actor(2);
select pg_temp.expect_state($q$select public.reschedule_study_milestone(plan_one,milestone_one,1,current_date+8,'Stale tutor date',null)
  from learning6_ids$q$,'23505','Sprint4 13.2 C05: stale plan revision is rejected');

-- Explicit dated topic mastery uses a verified source; an unrelated tutor cannot enumerate or create it.
select pg_temp.actor(2);
select pg_temp.assert_true((select count(*)>=4 from learning6_ids,
  lateral public.list_topic_evidence_candidates(learning6_ids.student_one,learning6_ids.subject_one)),
  'Sprint4 14.1 C01: tutor receives dated evidence candidates for the selected relationship');
update learning6_ids set attempt_two=(select attempts.id from public.assessment_attempts as attempts
  where attempts.assessment_id=learning6_ids.assessment_one order by attempt_no desc limit 1);
select public.set_topic_mastery(student_one,subject_one,'Fractions','improving','assessment_attempt',attempt_two,
  statement_timestamp()-interval '1 minute','Tutor observed progress on comparison') from learning6_ids;
select pg_temp.assert_true((select count(*)=1 and min(label)='improving' and min(observed_at)<statement_timestamp()
    and bool_and(recorded_by='86100000-0000-4000-8000-000000000002')
  from public.topic_mastery_observations where student_id='86100000-0000-4000-8000-000000000001'
    and topic='Fractions' and source_kind='assessment_attempt'),
  'Sprint4 5.2/14.1 C02: human mastery label retains explicit date, author and scored source');
select pg_temp.actor(4);
select pg_temp.expect_state($q$select candidates.* from learning6_ids,
  lateral public.list_topic_evidence_candidates(learning6_ids.student_one,learning6_ids.subject_one) as candidates$q$,
  '42501','Sprint4 14.1 C03: unrelated tutor cannot enumerate learner evidence');
select pg_temp.expect_state($q$select public.set_topic_mastery(student_one,subject_one,'Fractions','confident','assessment_attempt',attempt_two,
  statement_timestamp(),'Unrelated tutor label') from learning6_ids$q$,'42501','Sprint4 14.1 C04: unrelated tutor cannot author mastery');

-- Delete only S1's optional reflection; assessment, payment and audit evidence must remain.
select pg_temp.actor(1);
select public.save_session_reflection(booking_one,'Optional learner reflection') from learning6_ids;
select pg_temp.assert_true((select count(*)=1 from learning6_ids join public.session_reflections
  on public.session_reflections.booking_id=learning6_ids.booking_one),
  'Sprint4 14.2 C01: owner has one optional reflection before deletion');
select pg_temp.assert_true((select public.delete_session_reflection(booking_one) from learning6_ids),
  'Sprint4 14.2 C02: only the reflection owner can delete the optional reflection');
reset role;
select pg_temp.assert_true((select count(*)=0 from public.session_reflections where booking_id='86500000-0000-4000-8000-000000000001'),
  'Sprint4 14.2 C03: deleted reflection is removed');
select pg_temp.assert_true((select count(*)=1 from public.assessment_attempts where id=(select attempt_one from learning6_ids))
  and (select count(*)=1 from public.payments where booking_id='86500000-0000-4000-8000-000000000001' and state='paid')
  and (select count(*)=1 from public.payment_events where provider_event_id='learning6-event-s1')
  and (select count(*)>=1 from public.booking_events where booking_id='86500000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.audit_logs where actor_id='86100000-0000-4000-8000-000000000001' and action='account.provisioned'),
  'Sprint4 14.2 C04: assessment, payment, booking and audit evidence remain after optional reflection deletion');

reset role;
rollback;
