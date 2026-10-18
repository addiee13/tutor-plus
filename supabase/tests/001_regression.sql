\set ON_ERROR_STOP on
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

insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values
('10000000-0000-4000-8000-000000000001', 'student-fixture@example.invalid', now(), '{"display_name":"Student","adult_attested":true,"role":"student"}'),
('10000000-0000-4000-8000-000000000002', 'tutor-fixture@example.invalid', now(), '{"display_name":"Private Tutor Name","adult_attested":true,"role":"tutor"}'),
('10000000-0000-4000-8000-000000000003', 'admin-fixture@example.invalid', now(), '{"display_name":"Admin","adult_attested":true,"role":"student"}'),
('10000000-0000-4000-8000-000000000004', 'other-fixture@example.invalid', now(), '{"display_name":"Other","adult_attested":true,"role":"student"}'),
('10000000-0000-4000-8000-000000000005', 'unverified-fixture@example.invalid', null, '{"display_name":"Unverified","adult_attested":true}'),
('10000000-0000-4000-8000-000000000006', 'no-adult-fixture@example.invalid', now(), '{"display_name":"No attestation"}');
insert into auth.sessions(id, user_id, created_at, updated_at) select
  ('20000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  ('10000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  statement_timestamp() - interval '1 hour', statement_timestamp()
from generate_series(1, 6) as sequence;
do $$
begin
  if exists (select 1 from private.admin_bootstrap_guard) or exists (select 1 from public.user_roles where role = 'administrator') then
    insert into public.user_roles(user_id, role) values ('10000000-0000-4000-8000-000000000003', 'administrator');
    raise notice 'SKIP: bootstrap positive path already established by real API fixture';
  else
    perform public.bootstrap_initial_admin('10000000-0000-4000-8000-000000000003');
    raise notice 'PASS: initial administrator bootstrap';
  end if;
end;
$$;
set local role service_role;
select pg_temp.expect_error('select public.bootstrap_initial_admin(''10000000-0000-4000-8000-000000000004'')', '22023', 'administrator bootstrap exactly once');
reset role;
insert into public.subjects(id, name, slug) values ('30000000-0000-4000-8000-000000000001', 'Mathematics', 'math-fixture');

select pg_temp.expect_error($command$
  insert into auth.users(id, raw_user_meta_data) values ('10000000-0000-4000-8000-000000000009', '{"role":"administrator"}')
$command$, '22023', 'signup cannot grant administrator');
select pg_temp.check_true(not exists (select 1 from public.profiles where id = '10000000-0000-4000-8000-000000000009'), 'failed signup rolls back provisioning');
select pg_temp.check_true((select count(*) = 6 from public.profiles where id::text like '10000000-%'), 'managed signup trigger provisions all profiles');
select pg_temp.check_true((select bool_and(relrowsecurity) from pg_class
  where oid in ('public.profiles'::regclass, 'public.user_roles'::regclass, 'public.audit_logs'::regclass,
  'public.tutor_profiles'::regclass, 'public.tutor_subjects'::regclass, 'public.subjects'::regclass,
  'public.public_tutor_snapshots'::regclass, 'public.availability_rules'::regclass, 'public.availability_exceptions'::regclass,
  'public.bookings'::regclass, 'public.booking_private_details'::regclass, 'public.booking_events'::regclass,
  'public.payments'::regclass, 'public.payment_events'::regclass, 'public.refunds'::regclass, 'public.payout_refs'::regclass)), 'every domain table has RLS');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"20000000-0000-4000-8000-000000000001"}', true);
select pg_temp.check_true(public.current_session_started_at() is not null, 'authoritative live session read');
select pg_temp.check_true((select count(*) = 1 from public.profiles), 'student only sees own profile');
update public.profiles set display_name = 'Persisted Student', timezone = 'America/New_York' where id = auth.uid();
select pg_temp.check_true((select display_name = 'Persisted Student' from public.profiles where id = auth.uid()), 'permitted profile edits persist');
select pg_temp.expect_error('update public.profiles set status = ''inactive'' where id = auth.uid()', '42501', 'owner cannot change status');
select pg_temp.expect_error('update public.profiles set adult_attested = false where id = auth.uid()', '42501', 'owner cannot change adult eligibility');
select pg_temp.expect_error('update public.profiles set adult_attested_at = now() where id = auth.uid()', '42501', 'owner cannot rewrite adult attestation time');
select pg_temp.expect_error('update public.profiles set timezone = ''Not/AZone'' where id = auth.uid()', '23514', 'invalid timezone rejected');
select pg_temp.expect_error('insert into public.user_roles(user_id, role) values (auth.uid(), ''administrator'')', '42501', 'role table not browser-writable');
select pg_temp.expect_error('select public.grant_user_role(auth.uid(), ''administrator'')', '42501', 'student cannot grant administrator');
select pg_temp.expect_error('select * from auth.sessions', '42501', 'Auth sessions are not exposed');
select pg_temp.expect_error('select * from public.payment_events', '42501', 'provider events are not exposed');
select pg_temp.expect_error('select public.prepare_booking_payment(gen_random_uuid(), ''forge'')', '42501', 'payment provider RPC not browser executable');
select pg_temp.expect_error('insert into public.tutor_profiles(user_id, public_display_name, headline, bio, hourly_rate_minor) values (auth.uid(), ''Impostor'', ''Headline'', ''Bio'', 1000)', '42501', 'student cannot create tutor profile');

reset role;
update auth.users set raw_user_meta_data = '{"role":"administrator","adult_attested":true}' where id = '10000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.check_true(not private.has_role('administrator'), 'editable metadata does not authorize');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"not-a-uuid"}', true);
select pg_temp.check_true(public.current_session_started_at() is null and not private.active_actor(), 'malformed session claim denies safely');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"20000000-0000-4000-8000-000000000002"}', true);
select pg_temp.check_true(public.current_session_started_at() is null, 'foreign session rejected');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select pg_temp.check_true(public.current_session_started_at() is null, 'missing session rejected');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","session_id":"20000000-0000-4000-8000-000000000005"}', true);
select pg_temp.check_true(not private.active_actor() and (select count(*) = 0 from public.profiles), 'unverified user denied');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated","session_id":"20000000-0000-4000-8000-000000000006"}', true);
select pg_temp.check_true(not private.active_actor(), 'adult attestation missing denies');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"20000000-0000-4000-8000-000000000003"}', true);
select public.grant_user_role('10000000-0000-4000-8000-000000000001', 'tutor');
select pg_temp.check_true((select count(*) = 2 from public.user_roles where user_id = '10000000-0000-4000-8000-000000000001'), 'student and tutor coexist');
select pg_temp.check_true(exists (select 1 from public.audit_logs where action = 'role.granted' and entity_id = '10000000-0000-4000-8000-000000000001'), 'role grant audited');
select public.revoke_user_role('10000000-0000-4000-8000-000000000001', 'tutor');
select pg_temp.check_true(exists (select 1 from public.audit_logs where action = 'role.revoked'), 'role revocation audited');
select public.set_user_status('10000000-0000-4000-8000-000000000004', 'inactive', 'Regression denial');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"20000000-0000-4000-8000-000000000004"}', true);
select pg_temp.check_true(not private.active_actor(), 'inactive status checked from database');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"20000000-0000-4000-8000-000000000003"}', true);
select public.set_user_status('10000000-0000-4000-8000-000000000004', 'active', 'Restore valid unrelated fixture');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"20000000-0000-4000-8000-000000000002"}', true);
insert into public.tutor_profiles(id, user_id, public_display_name, headline, bio, hourly_rate_minor)
values ('40000000-0000-4000-8000-000000000001', auth.uid(), 'Public Tutor Name', 'Math support', 'Public approved biography', 6000)
returning id as inserted_tutor_id \gset
select pg_temp.check_true(:'inserted_tutor_id'::uuid = '40000000-0000-4000-8000-000000000001', 'authenticated tutor insert RETURNING succeeds without source self-lookup');
select pg_temp.expect_error('update public.tutor_profiles set publication_state = ''published''', '22023', 'publication requires readiness');
insert into public.tutor_subjects(tutor_id, subject_id) values ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001');
insert into public.availability_rules(tutor_id, weekday, local_start, local_end, timezone, valid_from)
select '40000000-0000-4000-8000-000000000001', weekday, '08:00', '20:00', 'UTC', current_date
from generate_series(0, 6) as weekday;
select pg_temp.expect_error($command$insert into public.availability_rules(tutor_id, weekday, local_start, local_end, timezone, valid_from)
  values ('40000000-0000-4000-8000-000000000001', 0, '09:00', '10:00', 'UTC', current_date)$command$, '23P01', 'overlapping recurrence rules rejected');
update public.tutor_profiles set publication_state = 'published';
set local role anon;
select pg_temp.check_true((select count(*) = 1 from public.public_tutor_snapshots where public_display_name = 'Public Tutor Name'), 'anonymous sees approved public snapshot');
select pg_temp.check_true((select count(*) = 1 and min(hourly_rate_minor) = 6000 from public.list_public_tutor_subjects('40000000-0000-4000-8000-000000000001')), 'public subject DTO omits private source fields');
select pg_temp.expect_error('select * from public.profiles', '42501', 'anonymous cannot read private profile');
select pg_temp.expect_error('select * from public.tutor_profiles', '42501', 'anonymous cannot read tutor source');
select pg_temp.expect_error('select public.current_session_started_at()', '42501', 'anonymous cannot inspect session');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"20000000-0000-4000-8000-000000000001"}', true);
select public.create_booking('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  date_trunc('day', now()) + interval '2 days 10 hours', date_trunc('day', now()) + interval '2 days 11 hours', 'virtual', 'booking-fixture') as booking_id \gset
select pg_temp.check_true((select price_minor = 6000 and platform_fee_minor = 0 and currency = 'USD'
  and upper_inc(blocking_range) = false from public.bookings where id = :'booking_id'), 'price and half-open buffered snapshot');
select pg_temp.check_true(public.create_booking('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  date_trunc('day', now()) + interval '2 days 10 hours', date_trunc('day', now()) + interval '2 days 11 hours', 'virtual', 'booking-fixture') = :'booking_id'::uuid, 'booking retry idempotent');
select pg_temp.expect_error($command$select public.create_booking('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  date_trunc('day', now()) + interval '2 days 10 hours', date_trunc('day', now()) + interval '2 days 11 hours', 'virtual', 'overlap')$command$, '23P01', 'active tutor/student conflict rejected');
select pg_temp.expect_error($command$select public.create_booking('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  date_trunc('day', now()) + interval '2 days 22 hours', date_trunc('day', now()) + interval '2 days 23 hours', 'virtual', 'outside')$command$, '22023', 'outside availability rejected');
select pg_temp.expect_error('update public.bookings set price_minor = 1', '42501', 'browser cannot forge booking price');
select pg_temp.expect_error('select public.bootstrap_initial_admin(auth.uid())', '42501', 'bootstrap not browser executable');
select pg_temp.expect_error('insert into public.payments(booking_id) values (gen_random_uuid())', '42501', 'browser cannot mutate payments');
select pg_temp.expect_error('select provider_payment_id from public.payments', '42501', 'provider identifiers hidden');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"20000000-0000-4000-8000-000000000002"}', true);
select pg_temp.check_true((select count(*) = 1 from public.bookings), 'tutor participant sees booking');
select pg_temp.expect_error('update public.availability_rules set active = false', '22023', 'schedule cannot invalidate active booking');
update public.tutor_profiles set hourly_rate_minor = 9000;
select pg_temp.check_true((select price_minor = 6000 from public.bookings), 'price snapshot survives tutor rate edit');

reset role;
select pg_temp.expect_error(format('update public.bookings set price_minor = 1 where id = %L', :'booking_id'), '22023', 'snapshot immutable even to privileged update');
select pg_temp.expect_error(format('update public.bookings set status = ''confirmed'' where id = %L', :'booking_id'), '22023', 'confirmation cannot precede captured payment');
select pg_temp.expect_error('delete from public.audit_logs', '22023', 'audit history append-only');
select pg_temp.expect_error('delete from public.booking_events', '22023', 'booking history append-only');
insert into public.booking_private_details(booking_id, meeting_url) values (:'booking_id', 'https://meeting.example.invalid/private');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"20000000-0000-4000-8000-000000000004"}', true);
select pg_temp.check_true((select count(*) = 0 from public.bookings) and (select count(*) = 0 from public.booking_private_details), 'unrelated account cannot read booking/meeting');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.prepare_booking_payment(:'booking_id', 'payment-fixture') as payment_id \gset
select pg_temp.check_true(public.prepare_booking_payment(:'booking_id', 'payment-fixture') = :'payment_id'::uuid, 'canonical payment retry idempotent');
select pg_temp.check_true(public.apply_verified_payment_event(:'payment_id', 'provider-paid-fixture', 'paid', transaction_timestamp(), 'pi-fixture'), 'verified provider boundary applies paid');
select pg_temp.check_true(not public.apply_verified_payment_event(:'payment_id', 'provider-paid-fixture', 'paid', transaction_timestamp(), 'pi-fixture'), 'provider event deduplicated');
select pg_temp.check_true(not public.apply_verified_payment_event(:'payment_id', 'provider-stale-fixture', 'processing', transaction_timestamp() - interval '1 minute', 'pi-fixture'), 'stale event cannot regress paid');
select pg_temp.check_true((select state = 'paid' from public.payments where id = :'payment_id')
  and (select status = 'confirmed' from public.bookings where id = :'booking_id'), 'authoritative state confirms booking');
select public.reserve_refund(:'payment_id', 'refund-fixture', 3000, 'Test partial refund') as refund_id \gset
select pg_temp.check_true(public.reserve_refund(:'payment_id', 'refund-fixture', 3000, 'Test partial refund') = :'refund_id'::uuid, 'refund request idempotent');
select pg_temp.expect_error(format('select public.reserve_refund(%L, ''excess-fixture'', 4000, ''Overrefund'')', :'payment_id'), '22023', 'reserved refunds cannot exceed capture');
select pg_temp.check_true(public.apply_verified_refund_event(:'refund_id', 'refund-event-fixture', 'succeeded', transaction_timestamp(), 're-fixture'), 'verified refund boundary applies success');
select pg_temp.check_true(not public.apply_verified_refund_event(:'refund_id', 'refund-event-fixture', 'succeeded', transaction_timestamp(), 're-fixture'), 'refund event deduplicated');
select pg_temp.check_true((select state = 'partially_refunded' from public.payments where id = :'payment_id'), 'partial refund state projection');
select pg_temp.expect_error('update public.payments set state = ''paid''', '42501', 'service role also limited to financial RPCs');

reset role;
update auth.sessions set created_at = statement_timestamp() - interval '24 hours 1 second', updated_at = statement_timestamp()
where id = '20000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"20000000-0000-4000-8000-000000000003"}', true);
select pg_temp.check_true(public.current_session_started_at() is null, '24h expiry cannot slide on refresh');
select pg_temp.expect_error('select public.grant_user_role(''10000000-0000-4000-8000-000000000004'', ''tutor'')', '42501', 'expired admin denied');
reset role;
update auth.sessions set not_after = statement_timestamp() - interval '1 second' where id = '20000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"20000000-0000-4000-8000-000000000001"}', true);
select pg_temp.check_true(public.current_session_started_at() is null and (select count(*) = 0 from public.profiles), 'provider session deadline denies RLS');
reset role;
delete from auth.sessions where id = '20000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"20000000-0000-4000-8000-000000000002"}', true);
select pg_temp.check_true(public.current_session_started_at() is null and (select count(*) = 0 from public.tutor_profiles), 'revoked session row denies replayed JWT');

reset role;
rollback;
