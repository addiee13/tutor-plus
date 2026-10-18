\set ON_ERROR_STOP on
-- Sprint 3 regression: UC-09 planner/recap/reflection, UC-07 reviews/ratings, UC-05 assessments, UC-08 assignments.
-- Runs inside one transaction and rolls back, so it leaves no data behind.
begin;

create function pg_temp.check_true(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end;
$$;
create function pg_temp.expect_error(command text, expected_state text, label text) returns void
language plpgsql as $$
declare actual_state text;
begin
  begin
    execute command;
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
    if actual_state = expected_state then raise notice 'PASS: %', label; return; end if;
    raise exception 'FAIL: % expected %, received %: %', label, expected_state, actual_state, sqlerrm;
  end;
  raise exception 'FAIL: % unexpectedly succeeded', label;
end;
$$;
create function pg_temp.act_as(account integer) returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '51000000-0000-4000-8000-00000000000' || account,
    'role', 'authenticated', 'session_id', '52000000-0000-4000-8000-00000000000' || account)::text, true);
$$;

-- 1 = student, 2 = tutor, 3 = unrelated student
insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values
('51000000-0000-4000-8000-000000000001', 's3-student@example.invalid', now(), '{"display_name":"S3 Student","adult_attested":true,"role":"student"}'),
('51000000-0000-4000-8000-000000000002', 's3-tutor@example.invalid', now(), '{"display_name":"S3 Tutor","adult_attested":true,"role":"tutor"}'),
('51000000-0000-4000-8000-000000000003', 's3-other@example.invalid', now(), '{"display_name":"S3 Other","adult_attested":true,"role":"student"}');
insert into auth.sessions(id, user_id, created_at, updated_at) select
  ('52000000-0000-4000-8000-00000000000' || n)::uuid, ('51000000-0000-4000-8000-00000000000' || n)::uuid,
  statement_timestamp() - interval '1 hour', statement_timestamp()
from generate_series(1, 3) as n;
insert into public.subjects(id, name, slug) values ('53000000-0000-4000-8000-000000000001', 'S3 Algebra', 's3-algebra-fixture');

set local role authenticated;
select pg_temp.act_as(2);
insert into public.tutor_profiles(id, user_id, public_display_name, headline, bio, hourly_rate_minor)
values ('54000000-0000-4000-8000-000000000001', auth.uid(), 'S3 Public Tutor', 'Algebra', 'Fixture biography', 4000);
insert into public.tutor_subjects(tutor_id, subject_id) values ('54000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001');
insert into public.availability_rules(tutor_id, weekday, local_start, local_end, timezone, valid_from)
select '54000000-0000-4000-8000-000000000001', weekday, '00:00', '23:59', 'UTC', current_date - 7 from generate_series(0, 6) as weekday;
update public.tutor_profiles set publication_state = 'published';

-- Upcoming booking through the real student RPC; ended booking inserted by the privileged fixture owner.
-- Both are anchored to midday UTC so the buffered blocking window never crosses the 23:59-00:00 availability gap.
select pg_temp.act_as(1);
select public.create_booking('54000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001',
  date_trunc('day', now()) + interval '2 days 12 hours', date_trunc('day', now()) + interval '2 days 13 hours', 'virtual', 's3-upcoming');
reset role;
create temporary table fixture_ids as select
  (select id from public.bookings where request_key = 's3-upcoming') as upcoming,
  '55000000-0000-4000-8000-000000000001'::uuid as ended;
grant select on fixture_ids to authenticated, service_role;
insert into public.bookings(id, student_id, tutor_id, subject_id, starts_at, ends_at, blocking_starts_at, blocking_ends_at,
  mode, price_minor, platform_fee_minor, currency, status, hold_expires_at, policy_snapshot, request_key)
values ('55000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000001', date_trunc('day', now()) - interval '1 day 12 hours', date_trunc('day', now()) - interval '1 day 11 hours',
  date_trunc('day', now()) - interval '1 day 12 hours 10 minutes', date_trunc('day', now()) - interval '1 day 10 hours 50 minutes',
  'virtual', 4000, 0, 'USD', 'payment_pending', now() + interval '15 minutes', '{"fixture":true}', 's3-ended');
insert into public.booking_private_details(booking_id, meeting_url) values ('55000000-0000-4000-8000-000000000001', 'https://meet.example.invalid/s3');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.apply_verified_payment_event(public.prepare_booking_payment(upcoming, 's3-pay-upcoming'), 's3-evt-upcoming', 'paid', now(), 's3-pi-upcoming') from fixture_ids;
select public.apply_verified_payment_event(public.prepare_booking_payment(ended, 's3-pay-ended'), 's3-evt-ended', 'paid', now(), 's3-pi-ended') from fixture_ids;
reset role;
select pg_temp.check_true((select count(*) = 2 from public.bookings where tutor_id = '54000000-0000-4000-8000-000000000001' and status = 'confirmed'), 'fixture bookings confirmed by verified payment events');

-- UC-09 planner
set local role authenticated;
select pg_temp.act_as(1);
select pg_temp.check_true((select public.save_session_goals(upcoming, 'Factor quadratics', 'When do I complete the square?') is not null from fixture_ids), 'student saves goals');
select pg_temp.expect_error('select public.save_session_goals(ended, ''Late goals'', null) from fixture_ids', '22023', 'ended confirmed planner refuses student goals');
select pg_temp.expect_error('select public.save_session_agenda(upcoming, ''Student forging agenda'') from fixture_ids', '42501', 'student cannot write tutor agenda');
select pg_temp.expect_error('insert into public.session_plans(booking_id, student_goals) select upcoming, ''x'' from fixture_ids', '42501', 'plans are not directly writable');
select pg_temp.expect_error('select public.save_session_reflection(upcoming, ''too early'') from fixture_ids', '22023', 'reflection refused before the session ends');
select pg_temp.expect_error('select public.submit_review(ended, 5, null) from fixture_ids', '22023', 'review refused before completion');
select pg_temp.act_as(2);
select pg_temp.check_true((select student_goals = 'Factor quadratics' from public.session_plans, fixture_ids where booking_id = upcoming), 'tutor reads student goals');
select pg_temp.check_true((select public.save_session_agenda(upcoming, '1. Warm-up 2. Factoring') is not null from fixture_ids), 'tutor saves agenda');
select pg_temp.check_true((select student_goals = 'Factor quadratics' and tutor_agenda like '1. Warm-up%' from public.session_plans, fixture_ids where booking_id = upcoming), 'agenda save preserves student goals');
select pg_temp.expect_error('select public.publish_session_recap(upcoming, ''Early'', null, null) from fixture_ids', '22023', 'recap refused before the session ends');
select pg_temp.expect_error('select public.mark_session_completed(upcoming) from fixture_ids', '22023', 'future session cannot be completed');
select pg_temp.expect_error('select public.save_session_agenda(ended, ''Late agenda'') from fixture_ids', '22023', 'ended confirmed planner refuses tutor agenda');
select pg_temp.check_true((select public.mark_session_completed(ended) = 'completed' from fixture_ids), 'tutor completes ended session');
select pg_temp.check_true((select public.mark_session_completed(ended) = 'completed' from fixture_ids), 'completion retry idempotent');
select pg_temp.check_true((select public.publish_session_recap(ended, 'Covered factoring', 'Confident with GCF', 'Practice set B') is not null from fixture_ids), 'tutor publishes recap after session');
select pg_temp.check_true((select public.publish_session_recap(ended, 'Covered factoring and roots', 'Confident with GCF', 'Practice set B') is not null from fixture_ids), 'tutor edits recap');
select pg_temp.check_true((select revision = 2 and published_at <= updated_at from public.session_recaps, fixture_ids where booking_id = ended), 'recap edit keeps first publication time and counts revision');
select pg_temp.act_as(3);
select pg_temp.check_true((select count(*) = 0 from public.session_plans) and (select count(*) = 0 from public.session_recaps), 'unrelated student sees no plan or recap');
select pg_temp.expect_error('select public.save_session_goals(upcoming, ''intrude'', null) from fixture_ids', '42501', 'unrelated student cannot write plan');
select pg_temp.act_as(1);
select pg_temp.expect_error('select public.save_session_goals(ended, ''late goals'', null) from fixture_ids', '22023', 'planner closed after completion');
select pg_temp.check_true((select summary = 'Covered factoring and roots' from public.session_recaps, fixture_ids where booking_id = ended), 'student reads published recap');
select pg_temp.check_true((select public.save_session_reflection(ended, 'Private: I still rush the signs.') is not null from fixture_ids), 'student saves private reflection');
select pg_temp.check_true((select count(*) = 1 from public.session_reflections), 'student reads own reflection');
select pg_temp.act_as(2);
select pg_temp.check_true((select count(*) = 0 from public.session_reflections), 'tutor never sees student reflection');

-- UC-07 reviews and ratings
select pg_temp.expect_error('select public.submit_review(ended, 5, ''Tutor self-review'') from fixture_ids', '42501', 'tutor cannot review own session');
select pg_temp.act_as(3);
select pg_temp.expect_error('select public.submit_review(ended, 5, ''Not my session'') from fixture_ids', '42501', 'wrong student cannot review');
select pg_temp.act_as(1);
select pg_temp.expect_error('select public.submit_review(ended, 6, null) from fixture_ids', '22023', 'rating above 5 rejected');
select pg_temp.expect_error('select public.submit_review(upcoming, 4, null) from fixture_ids', '22023', 'incomplete booking cannot be reviewed');
select pg_temp.check_true((select public.submit_review(ended, 5, 'Clear and patient.') is not null from fixture_ids), 'student reviews completed session');
select pg_temp.expect_error('select public.submit_review(ended, 4, ''again'') from fixture_ids', '23505', 'duplicate review rejected');
select pg_temp.expect_error('update public.reviews set rating = 1', '42501', 'review not directly editable');
select pg_temp.expect_error('update public.tutor_rating_summaries set rating_avg = 5', '42501', 'aggregate not client writable');
set local role anon;
select pg_temp.check_true((select rating_count = 1 and rating_avg = 5.00 from public.tutor_rating_summaries where tutor_id = '54000000-0000-4000-8000-000000000001'), 'public aggregate derived server-side');
select pg_temp.check_true((select count(*) = 1 from public.list_public_tutor_reviews('54000000-0000-4000-8000-000000000001')), 'public review DTO lists visible review');
select pg_temp.expect_error('select * from public.reviews', '42501', 'anonymous cannot read review rows');
set local role authenticated;
select pg_temp.act_as(2);
select pg_temp.check_true((select count(*) = 1 from public.reviews), 'tutor reads visible review about them');
reset role;
select pg_temp.expect_error('update public.reviews set comment = ''rewritten''', '22023', 'review content immutable even to privileged update');
select pg_temp.expect_error('delete from public.reviews', '22023', 'reviews are not deletable');
update public.reviews set status = 'hidden', moderation_reason = 'Regression moderation';
select pg_temp.check_true((select rating_count = 0 and rating_avg is null from public.tutor_rating_summaries where tutor_id = '54000000-0000-4000-8000-000000000001'), 'hidden review leaves aggregate');
update public.reviews set status = 'visible';
select pg_temp.check_true((select rating_count = 1 from public.tutor_rating_summaries where tutor_id = '54000000-0000-4000-8000-000000000001'), 'restored review re-enters aggregate');

-- UC-05 assessments
set local role authenticated;
select pg_temp.act_as(2);
insert into public.assessments(id, tutor_id, student_id, subject_id, booking_id, title)
values ('56000000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000001', 'Algebra diagnostic');
select pg_temp.expect_error($c$insert into public.assessments(tutor_id, student_id, subject_id, title) values ('54000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000003', '53000000-0000-4000-8000-000000000001', 'No relationship')$c$, '22023', 'assessment requires tutor-student booking relationship');
insert into public.assessment_questions(id, assessment_id, position, prompt, kind, choices, points) values
('57000000-0000-4000-8000-000000000001', '56000000-0000-4000-8000-000000000001', 1, 'x^2 - 9 = ?', 'single_choice', '["(x-3)(x+3)","(x-9)(x+1)"]', 2),
('57000000-0000-4000-8000-000000000002', '56000000-0000-4000-8000-000000000001', 2, 'Explain completing the square', 'short_answer', null, 3);
select pg_temp.expect_error($c$update public.assessments set status = 'assigned' where id = '56000000-0000-4000-8000-000000000001'$c$, '22023', 'assign requires answer keys');
select pg_temp.expect_error($c$insert into public.assessment_answer_keys(question_id, correct_choice) values ('57000000-0000-4000-8000-000000000001', 'x')$c$, '22023', 'answer key must be a listed choice');
insert into public.assessment_answer_keys(question_id, correct_choice) values ('57000000-0000-4000-8000-000000000001', '(x-3)(x+3)');
update public.assessments set status = 'assigned' where id = '56000000-0000-4000-8000-000000000001';
select pg_temp.expect_error($c$update public.assessment_questions set points = 50 where id = '57000000-0000-4000-8000-000000000001'$c$, '22023', 'assigned content frozen');
select pg_temp.act_as(1);
select pg_temp.check_true((select count(*) = 2 from public.assessment_questions), 'student reads assigned questions');
select pg_temp.check_true((select count(*) = 0 from public.assessment_answer_keys), 'student cannot read answer keys');
select public.submit_assessment_attempt('56000000-0000-4000-8000-000000000001',
  '{"57000000-0000-4000-8000-000000000001":"(x-9)(x+1)","57000000-0000-4000-8000-000000000002":"Halve b, square it"}', true);
select pg_temp.check_true((select status = 'submitted' and auto_score = 0 and max_score = 5 and score is null from public.assessment_attempts), 'objective score computed server-side; subjective awaits tutor');
select pg_temp.expect_error($c$select public.submit_assessment_attempt('56000000-0000-4000-8000-000000000001', '{}', true)$c$, '22023', 'finalized assessment closed to resubmission');
select pg_temp.act_as(3);
select pg_temp.check_true((select count(*) = 0 from public.assessments) and (select count(*) = 0 from public.assessment_attempts), 'unrelated student sees no assessment');
select pg_temp.act_as(2);
select pg_temp.expect_error('select public.score_assessment_attempt(id, 4, null) from public.assessment_attempts', '22023', 'tutor score cannot replace missed objective points');
select public.score_assessment_attempt(id, 3, 'Good reasoning') from public.assessment_attempts;
select pg_temp.check_true((select a.status = 'scored' and t.score = 3 from public.assessments a join public.assessment_attempts t on t.assessment_id = a.id), 'tutor finalizes subjective score');

-- UC-08 assignments
insert into public.assignments(id, tutor_id, student_id, booking_id, title, instructions, due_at, status) values
('58000000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001',
  '55000000-0000-4000-8000-000000000001', 'Overdue set', 'Factor five expressions', now() - interval '1 hour', 'assigned'),
('58000000-0000-4000-8000-000000000002', '54000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001',
  null, 'Practice set B', 'Solve by completing the square', now() + interval '3 days', 'assigned');
select pg_temp.expect_error($c$update public.assignments set status = 'submitted' where id = '58000000-0000-4000-8000-000000000002'$c$, '22023', 'submitted state requires a real submission');
select pg_temp.act_as(1);
select pg_temp.expect_error($c$select public.submit_assignment('58000000-0000-4000-8000-000000000001', 'late answer', null)$c$, '22023', 'submission refused after due date');
select public.submit_assignment('58000000-0000-4000-8000-000000000002', 'x = 1 or x = -5', null);
select pg_temp.check_true((select status = 'submitted' from public.assignments where id = '58000000-0000-4000-8000-000000000002'), 'submission moves assignment to submitted');
select pg_temp.expect_error($c$select public.submit_assignment('58000000-0000-4000-8000-000000000002', 'second try', null)$c$, '22023', 'no resubmission until returned');
select pg_temp.expect_error('update public.assignment_submissions set body = ''edited''', '42501', 'submissions not directly editable');
select pg_temp.act_as(2);
select public.give_assignment_feedback(id, 'Check the sign on the second root', 70, 'returned') from public.assignment_submissions;
select pg_temp.check_true((select status = 'returned' from public.assignments where id = '58000000-0000-4000-8000-000000000002'), 'feedback returns work');
select pg_temp.act_as(1);
select public.submit_assignment('58000000-0000-4000-8000-000000000002', 'x = 1 or x = -5 (signs checked)', null);
select pg_temp.check_true((select max(attempt_no) = 2 from public.assignment_submissions), 'returned work accepts a numbered resubmission');
select pg_temp.check_true((select count(*) = 1 from public.assignment_feedback), 'student reads tutor feedback');
select pg_temp.act_as(3);
select pg_temp.check_true((select count(*) = 0 from public.assignments) and (select count(*) = 0 from public.assignment_submissions), 'unrelated student sees no assignment work');

reset role;
select pg_temp.check_true((select bool_and(relrowsecurity) from pg_class where oid in ('public.session_plans'::regclass,
  'public.session_recaps'::regclass, 'public.session_reflections'::regclass, 'public.reviews'::regclass,
  'public.tutor_rating_summaries'::regclass, 'public.assessments'::regclass, 'public.assessment_questions'::regclass,
  'public.assessment_answer_keys'::regclass, 'public.assessment_attempts'::regclass, 'public.assignments'::regclass,
  'public.assignment_submissions'::regclass, 'public.assignment_feedback'::regclass)), 'every Sprint 3 table has RLS');
select pg_temp.check_true(not has_table_privilege('anon', 'public.session_plans', 'select')
  and not has_table_privilege('anon', 'public.reviews', 'select')
  and not has_table_privilege('authenticated', 'public.session_reflections', 'insert')
  and not has_table_privilege('service_role', 'public.session_reflections', 'select'), 'least-privilege grants');

rollback;
