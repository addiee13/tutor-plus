\set ON_ERROR_STOP on
-- Behavioral authorization checks; disposable fixture transaction only.
begin;
set local timezone = 'UTC';
create function pg_temp.assert_true(condition boolean, label text) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end;
$$;
create function pg_temp.assert_denied(command text, label text) returns void language plpgsql as $$
begin
  begin
    execute command;
  exception when insufficient_privilege then
    raise notice 'PASS: %', label;
    return;
  end;
  raise exception 'FAIL: % unexpectedly succeeded', label;
end;
$$;
create function pg_temp.assert_invalid(command text, label text) returns void language plpgsql as $$
begin
  begin
    execute command;
  exception when invalid_parameter_value then
    raise notice 'PASS: %', label;
    return;
  end;
  raise exception 'FAIL: % unexpectedly succeeded', label;
end;
$$;
create function pg_temp.assert_bad_duration(command text, label text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when invalid_parameter_value or check_violation then
    raise notice 'PASS: %', label; return;
  end;
  raise exception 'FAIL: % unexpectedly succeeded', label;
end;
$$;
create function pg_temp.assert_conflict(command text, label text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when exclusion_violation then raise notice 'PASS: %', label; return; end;
  raise exception 'FAIL: % unexpectedly succeeded', label;
end;
$$;
create function pg_temp.actor(n integer) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '61000000-0000-4000-8000-00000000000' || n,
    'session_id', '62000000-0000-4000-8000-00000000000' || n,
    'role', 'authenticated')::text, true);
$$;
insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values
 ('61000000-0000-4000-8000-000000000001', 'remaining-student@example.invalid', now(), '{"display_name":"Remaining Student","adult_attested":true,"role":"student"}'),
 ('61000000-0000-4000-8000-000000000002', 'remaining-tutor@example.invalid', now(), '{"display_name":"Remaining Tutor","adult_attested":true,"role":"tutor"}'),
 ('61000000-0000-4000-8000-000000000003', 'remaining-other@example.invalid', now(), '{"display_name":"Remaining Other","adult_attested":true,"role":"tutor"}'),
 ('61000000-0000-4000-8000-000000000004', 'remaining-third@example.invalid', now(), '{"display_name":"Remaining Third","adult_attested":true,"role":"tutor"}'),
 ('61000000-0000-4000-8000-000000000005', 'remaining-other-student@example.invalid', now(), '{"display_name":"Other Student","adult_attested":true,"role":"student"}');
insert into auth.sessions(id, user_id, created_at, updated_at)
 select ('62000000-0000-4000-8000-00000000000' || n)::uuid,
 ('61000000-0000-4000-8000-00000000000' || n)::uuid, now() - interval '1 hour', now()
 from generate_series(1, 5) n;
insert into public.subjects(id, name, slug)
 values ('63000000-0000-4000-8000-000000000001', 'Remaining Algebra', 'remaining-algebra');

-- Checks are extended as each new RPC contract lands. This existing-schema boundary
-- ensures new grants never accidentally expose private identities or authority.
set local role anon;
select pg_temp.assert_denied('select * from public.profiles', 'anonymous cannot inspect private profiles after module expansion');
select pg_temp.assert_denied('select * from public.user_roles', 'anonymous cannot inspect role authority after module expansion');
reset role;
set local role authenticated;
select pg_temp.actor(1);
select pg_temp.assert_true((select count(*) = 1 from public.profiles), 'student profile isolation survives new migrations');
select pg_temp.assert_denied($c$select public.grant_user_role('61000000-0000-4000-8000-000000000001', 'administrator')$c$,
 'learning and marketplace access never grants administrator authority');

-- Marketplace services must enforce capabilities at the database boundary too.
select pg_temp.assert_denied($c$select public.save_tutor_listing(
 null, 'Student cannot publish', null, 'Algebra help', 'Not a tutor', null,
 1, 4000, 'USD', true, false, null, null, null, null,
 '[{"subject_id":"63000000-0000-4000-8000-000000000001"}]'::jsonb)$c$,
 'student cannot bypass service checks to create tutor listing');
select pg_temp.actor(2);
select public.save_tutor_listing(null, 'Public Remaining Tutor', null, 'Algebra support', 'Evidence fixture biography', null,
 3, 4000, 'USD', true, false, null, null, null, null,
 '[{"subject_id":"63000000-0000-4000-8000-000000000001","expertise":"Algebra"}]'::jsonb);
select pg_temp.assert_true((select count(*) = 1 from public.tutor_profiles where user_id = auth.uid()),
 'tutor listing transaction creates one owned listing');
select pg_temp.assert_invalid($c$update public.tutor_profiles set publication_state = 'published' where user_id = auth.uid()$c$,
 'new listing cannot publish without availability');
insert into public.availability_rules(tutor_id, weekday, local_start, local_end, timezone, valid_from)
 select t.id, n, '08:00', '20:00', 'UTC', current_date
 from public.tutor_profiles t cross join generate_series(0,6) n where t.user_id = auth.uid();
update public.tutor_profiles set publication_state = 'published' where user_id = auth.uid();
select public.save_tutor_languages(id,version,array['en','es']) from public.tutor_profiles where user_id=auth.uid();
select pg_temp.assert_true((select count(*) = 1 from public.public_tutor_snapshots where public_display_name = 'Public Remaining Tutor'),
 'ready published listing appears in safe public projection');
select pg_temp.actor(3);
select pg_temp.assert_denied($c$select public.save_tutor_listing(
 (select id from public.public_tutor_snapshots where public_display_name = 'Public Remaining Tutor'),
 'Hijacked', null, 'Hijacked', 'Hijacked biography', null, 3, 1, 'USD', true, false,
 null, null, null, null, '[]'::jsonb, 1)$c$,
 'another tutor cannot take ownership of an existing listing');
select public.save_tutor_listing(null,'Remaining Boundary Tutor Two',null,'Algebra support','Boundary fixture biography',null,
 3,3000,'USD',true,false,null,null,null,null,
 '[{"subject_id":"63000000-0000-4000-8000-000000000001"}]'::jsonb);
insert into public.availability_rules(tutor_id,weekday,local_start,local_end,timezone,valid_from)
 select id,1,'08:00','20:00','UTC',current_date from public.tutor_profiles where user_id=auth.uid();
update public.tutor_profiles set publication_state='published' where user_id=auth.uid();
select pg_temp.actor(4);
select public.save_tutor_listing(null,'Remaining Boundary Tutor Three',null,'Algebra support','Boundary fixture biography',null,
 3,3500,'USD',true,false,null,null,null,null,
 '[{"subject_id":"63000000-0000-4000-8000-000000000001"}]'::jsonb);
insert into public.availability_rules(tutor_id,weekday,local_start,local_end,timezone,valid_from)
 select id,1,'08:00','20:00','UTC',current_date from public.tutor_profiles where user_id=auth.uid();
update public.tutor_profiles set publication_state='published' where user_id=auth.uid();
reset role;
-- Synthetic aggregate fixtures isolate inclusive discovery bounds. Review computation is
-- independently exercised by the original review regression suite; no reviews are invented here.
insert into public.tutor_rating_summaries(tutor_id,rating_count,rating_sum,rating_avg)
 select id,100,case public_display_name when 'Public Remaining Tutor' then 400
 when 'Remaining Boundary Tutor Two' then 399 else 410 end,
 case public_display_name when 'Public Remaining Tutor' then 4.00
 when 'Remaining Boundary Tutor Two' then 3.99 else 4.10 end
 from public.tutor_profiles where user_id in (
 '61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000004');
set local role anon;
select pg_temp.assert_true((select count(*) = 1 from public.list_public_tutors(
 'Public Remaining Tutor', '63000000-0000-4000-8000-000000000001', 'virtual', null, 4000,
 null, null, null, null, null, null, 'name', 12, 0)),
 'anonymous discovery returns eligible published tutor through public DTO');
select pg_temp.assert_true((select count(*) = 0 from public.list_public_tutors(
 'Public Remaining Tutor', null, 'virtual', null, 3999,
 null, null, null, null, null, null, 'name', 12, 0)),
 'discovery enforces maximum price before pagination');
select pg_temp.assert_true((select count(*) = 0 from public.list_public_tutors(
 'Public Remaining Tutor', null, 'in_person', null, null,
 null, null, null, null, null, null, 'name', 12, 0)),
 'discovery enforces requested teaching mode');
select pg_temp.assert_invalid($c$select * from public.list_public_tutors(
 null, null, null, null, null, null, 40, null, 25, null, null, 'name', 12, 0)$c$,
 'incomplete distance constraint is rejected instead of silently ignored');
select pg_temp.assert_invalid($c$select * from public.list_public_tutors(
 null, null, null, null, null, null, 'NaN'::float8, 0, 25, null, null, 'name', 12, 0)$c$,
 'nonfinite geographic coordinates rejected at database boundary');
select pg_temp.assert_true((select count(*)=1 from public.list_public_tutors_v2(
 'Public Remaining Tutor',null,'virtual',null,null,null,array['fr','es'],null,null,null,null,null,'name',12,0)),
 'Tutor language eligibility accepts at least one explicitly requested language');
select pg_temp.assert_true((select count(*)=0 from public.list_public_tutors_v2(
 'Public Remaining Tutor',null,'virtual',null,null,null,array['fr'],null,null,null,null,null,'name',12,0)),
 'Tutor language hard filter excludes incompatible listings before pagination');
select pg_temp.assert_invalid($c$select * from public.list_public_tutors_v2(
 null,null,null,null,null,null,array['en',null],null,null,null,null,null,'name',12,0)$c$,
 'Tutor language search refuses null entries rather than dropping constraints');
select pg_temp.assert_true((select count(*)=3 from public.list_public_tutors_v2(
 'Remaining','63000000-0000-4000-8000-000000000001','virtual',3000,4000,null,null,null,null,null,null,null,'name',12,0)),
 'Sprint4 3.2: price bounds include exact 3000 and 4000 minor-unit listings');
select pg_temp.assert_true((select count(*)=2 and min(rating_average)=4.00
 from public.list_public_tutors_v2(
 'Remaining','63000000-0000-4000-8000-000000000001','virtual',3000,4000,4.00,null,null,null,null,null,null,'name',12,0)),
 'Sprint4 3.2: rating threshold includes 4.00 and excludes 3.99');
with first_page as (select id from public.list_public_tutors_v2(
 'Remaining','63000000-0000-4000-8000-000000000001','virtual',3000,4000,null,null,null,null,null,null,null,'name',2,0)),
 second_page as (select id from public.list_public_tutors_v2(
 'Remaining','63000000-0000-4000-8000-000000000001','virtual',3000,4000,null,null,null,null,null,null,null,'name',2,2))
select pg_temp.assert_true((select count(*)=2 from first_page) and (select count(*)=1 from second_page)
 and not exists(select 1 from first_page join second_page using(id)),
 'Sprint4 3.7: three hard-eligible tutors paginate two plus one with no repeated IDs');
select pg_temp.assert_true((select count(*)=0 from public.list_public_tutors_v2(
 'Remaining','63000000-0000-4000-8000-000000000001','in_person',3000,4000,null,null,null,null,null,null,null,'name',2,2)),
 'Sprint4 3.7: later page retains incompatible mode exclusion instead of broadening results');
reset role;
select pg_temp.actor(2);
update public.tutor_profiles set hourly_rate_minor=4001 where user_id=auth.uid();
select pg_temp.actor(3);
update public.tutor_profiles set hourly_rate_minor=2999 where user_id=auth.uid();
set local role anon;
select pg_temp.assert_true((select count(*)=1 and min(hourly_rate_minor)=3500 from public.list_public_tutors_v2(
 'Remaining','63000000-0000-4000-8000-000000000001','virtual',3000,4000,null,null,null,null,null,null,null,'name',12,0)),
 'Sprint4 3.2: price bounds exclude 2999 and 4001 without weakening other filters');
reset role;
select pg_temp.actor(2);
update public.tutor_profiles set hourly_rate_minor=4000 where user_id=auth.uid();
select pg_temp.actor(3);
update public.tutor_profiles set hourly_rate_minor=3000 where user_id=auth.uid();
reset role;
create temporary table remaining_booking_ids(original uuid, replacement uuid, notes_booking uuid);
grant select, insert, update on remaining_booking_ids to authenticated;
set local role authenticated;
select pg_temp.actor(1);
select pg_temp.assert_bad_duration($c$select public.create_booking(
 (select id from public.public_tutor_snapshots where public_display_name = 'Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',
 date_trunc('day', now()) + interval '2 days 12 hours',
 date_trunc('day', now()) + interval '2 days 12 hours 15 minutes 30 seconds', 'virtual', 'remaining-fractional')$c$,
 'Sprint4 4.2: direct RPC rejects fractional-minute duration');
select pg_temp.assert_bad_duration($c$select public.create_booking(
 (select id from public.public_tutor_snapshots where public_display_name='Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',date_trunc('day',now())+interval '5 days 10 hours',
 date_trunc('day',now())+interval '5 days 10 hours 14 minutes','virtual','remaining-duration-14')$c$,
 'Sprint4 4.2: direct RPC refuses 14 whole minutes');
select pg_temp.assert_bad_duration($c$select public.create_booking(
 (select id from public.public_tutor_snapshots where public_display_name='Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',date_trunc('day',now())+interval '5 days 10 hours',
 date_trunc('day',now())+interval '5 days 13 hours 1 minute','virtual','remaining-duration-181')$c$,
 'Sprint4 4.2: direct RPC refuses 181 whole minutes');
select public.create_booking(
 (select id from public.public_tutor_snapshots where public_display_name='Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',date_trunc('day',now())+interval '5 days 8 hours 30 minutes',
 date_trunc('day',now())+interval '5 days 8 hours 45 minutes','virtual','remaining-duration-15');
select public.create_booking(
 (select id from public.public_tutor_snapshots where public_display_name='Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',date_trunc('day',now())+interval '5 days 10 hours',
 date_trunc('day',now())+interval '5 days 13 hours','virtual','remaining-duration-180');
select pg_temp.assert_true((select count(*)=2 and min(extract(epoch from ends_at-starts_at)/60)=15
 and max(extract(epoch from ends_at-starts_at)/60)=180 and bool_and(status='payment_pending')
 from public.bookings where request_key in ('remaining-duration-15','remaining-duration-180')),
 'Sprint4 4.2: exact 15 and 180 whole-minute bounds create eligible unpaid reservations');
insert into remaining_booking_ids(original)
 select public.create_booking(
 (select id from public.public_tutor_snapshots where public_display_name = 'Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',
 date_trunc('day', now()) + interval '2 days 10 hours',
 date_trunc('day', now()) + interval '2 days 11 hours', 'virtual', 'remaining-original');
select pg_temp.assert_invalid($c$select public.create_booking(
 (select id from public.public_tutor_snapshots where public_display_name='Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',date_trunc('day',now())+interval '2 days 12 hours',
 date_trunc('day',now())+interval '2 days 13 hours','virtual','remaining-original')$c$,
 'Sprint4 4.8: reusing an existing request key with a different interval is refused');
select pg_temp.assert_true((select starts_at=date_trunc('day',now())+interval '2 days 10 hours'
 from public.bookings where id=(select original from remaining_booking_ids)),
 'Sprint4 4.8: conflicting key reuse leaves the original interval unchanged');
select pg_temp.actor(5);
select pg_temp.assert_true((select count(*)=0 from public.bookings where id=(select original from remaining_booking_ids)),
 'Sprint4 4.8: another Student cannot retrieve the original reservation by known identity');
select pg_temp.assert_true(public.create_booking(
 (select id from public.public_tutor_snapshots where public_display_name='Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',date_trunc('day',now())+interval '2 days 13 hours',
 date_trunc('day',now())+interval '2 days 14 hours','virtual','remaining-original')<>(select original from remaining_booking_ids),
 'Sprint4 4.8: same text request key is scoped to the authenticated Student and never returns another identity');
select pg_temp.actor(1);
select pg_temp.assert_denied($c$insert into public.booking_private_details(booking_id, meeting_url)
 select original, 'https://meet.example.invalid/unapproved' from remaining_booking_ids$c$,
 'student cannot overwrite tutor meeting details');
select pg_temp.actor(2);
select public.save_booking_private_details(original, 'https://meet.example.invalid/remaining', null)
 from remaining_booking_ids;
select pg_temp.actor(3);
select pg_temp.assert_true((select count(*) = 0 from public.booking_private_details),
 'unrelated tutor cannot read private meeting link');
select pg_temp.actor(1);
select pg_temp.assert_true((select meeting_url = 'https://meet.example.invalid/remaining' from public.booking_private_details),
 'booked student can read meeting details');
select pg_temp.assert_invalid($c$select public.reschedule_booking(
 (select original from remaining_booking_ids),
 (select id from public.public_tutor_snapshots where public_display_name = 'Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',
 date_trunc('day', now()) + interval '3 days 5 hours',
 date_trunc('day', now()) + interval '3 days 6 hours', 'virtual', 'remaining-invalid-reschedule')$c$,
 'reschedule cannot reserve outside tutor availability');
select pg_temp.assert_true((select b.status = 'payment_pending' from public.bookings b join remaining_booking_ids f on b.id = f.original),
 'failed replacement transaction preserves original reservation');
update remaining_booking_ids set replacement = public.reschedule_booking(original,
 (select id from public.public_tutor_snapshots where public_display_name = 'Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',
 date_trunc('day', now()) + interval '3 days 10 hours',
 date_trunc('day', now()) + interval '3 days 11 hours', 'virtual', 'remaining-rescheduled');
select pg_temp.assert_true((select old.status = 'cancelled' and new.status = 'payment_pending'
 from remaining_booking_ids f join public.bookings old on old.id = f.original join public.bookings new on new.id = f.replacement),
 'unpaid reschedule cancels original and saves replacement without fabricated confirmation');
select pg_temp.assert_true((select replacement = public.reschedule_booking(original,
 (select id from public.public_tutor_snapshots where public_display_name = 'Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',
 date_trunc('day', now()) + interval '3 days 10 hours',
 date_trunc('day', now()) + interval '3 days 11 hours', 'virtual', 'remaining-rescheduled') from remaining_booking_ids),
 'retry returns same replacement without another cancellation or reservation');
update remaining_booking_ids set notes_booking=public.create_booking_with_notes(
 (select id from public.public_tutor_snapshots where public_display_name='Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',
 date_trunc('day',now())+interval '4 days 10 hours',date_trunc('day',now())+interval '4 days 11 hours',
 'virtual','remaining-notes',
 '{"learningGoal":"Practice factoring","topics":["Algebra"],"questions":"Which method?","privateNote":"Student private reminder","shareWithTutor":false}'::jsonb);
select pg_temp.assert_true((select private_note='Student private reminder' and learning_goal='Practice factoring'
 from public.booking_student_notes where booking_id=(select notes_booking from remaining_booking_ids)),
 'Booking and valid structured Student notes persist atomically');
select pg_temp.actor(2);
select pg_temp.assert_true((select count(*)=0 from public.read_tutor_booking_notes((select notes_booking from remaining_booking_ids))),
 'Booked Tutor cannot read unshared Student notes');
select pg_temp.actor(1);
select public.save_booking_student_notes(notes_booking,
 '{"learningGoal":"Practice factoring","topics":["Algebra","Quadratics"],"questions":"Which method?","privateNote":"Student private reminder","shareWithTutor":true}'::jsonb)
 from remaining_booking_ids;
select pg_temp.actor(2);
select pg_temp.assert_true((select count(*)=0 from public.booking_student_notes),
 'Tutor cannot query raw Student note rows containing private notes');
select pg_temp.assert_true((select learning_goal='Practice factoring' and cardinality(topics)=2
 and not (to_jsonb(shared)?'private_note') and not (to_jsonb(shared)?'student_id')
 from public.read_tutor_booking_notes((select notes_booking from remaining_booking_ids)) as shared),
 'Booked Tutor sees only explicitly shared goal topics questions without private note or Student ID');
select pg_temp.actor(3);
select pg_temp.assert_denied('select * from public.read_tutor_booking_notes((select notes_booking from remaining_booking_ids))',
 'Unrelated Tutor cannot read shared booking notes through the projection RPC');
select pg_temp.actor(1);
select pg_temp.assert_invalid($c$select public.cancel_booking(notes_booking,'') from remaining_booking_ids$c$,
 'Sprint4 4.10: empty cancellation reason is refused');
select pg_temp.assert_invalid($c$select public.cancel_booking(notes_booking,repeat('x',501)) from remaining_booking_ids$c$,
 'Sprint4 4.10: 501-character cancellation reason is refused');
select pg_temp.assert_true((select status='payment_pending' from public.bookings where id=(select notes_booking from remaining_booking_ids)),
 'Sprint4 4.10: invalid cancellation reasons preserve the existing hold');
select public.cancel_booking(notes_booking,repeat('x',500)) from remaining_booking_ids;
select public.cancel_booking(notes_booking,repeat('x',500)) from remaining_booking_ids;
select pg_temp.assert_true((select status='cancelled' and length(cancellation_reason)=500 and version=2
 from public.bookings where id=(select notes_booking from remaining_booking_ids)),
 'Sprint4 4.10: exact 500-character cancellation persists once despite retry');
update remaining_booking_ids set notes_booking=public.create_booking(
 (select id from public.public_tutor_snapshots where public_display_name='Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',date_trunc('day',now())+interval '4 days 10 hours',
 date_trunc('day',now())+interval '4 days 11 hours','virtual','remaining-released-slot');
select public.cancel_booking(notes_booking,'x') from remaining_booking_ids;
select pg_temp.assert_true((select status='cancelled' and cancellation_reason='x' from public.bookings
 where id=(select notes_booking from remaining_booking_ids)),
 'Sprint4 4.10: cancellation releases the slot for a new hold and a one-character reason is accepted');
reset role;

-- An explicitly expired hold fixture exercises cleanup without waiting or changing a live hold's
-- immutable expiration. No payment record/event is created by this fixture or the replacement.
select pg_temp.actor(1);
insert into public.bookings(id,student_id,tutor_id,subject_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
 mode,price_minor,platform_fee_minor,currency,status,hold_expires_at,policy_snapshot,request_key,created_at)
 select '64000000-0000-4000-8000-000000000001',student_id,tutor_id,subject_id,starts_at+interval '8 days',
 ends_at+interval '8 days',blocking_starts_at+interval '8 days',blocking_ends_at+interval '8 days',
 mode,price_minor,platform_fee_minor,currency,'payment_pending',statement_timestamp()-interval '1 second',
 policy_snapshot,'remaining-expired-hold',statement_timestamp()-interval '1 hour'
 from public.bookings where id=(select original from remaining_booking_ids);
set local role authenticated;
select public.create_booking(
 (select id from public.public_tutor_snapshots where public_display_name='Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',date_trunc('day',now())+interval '10 days 10 hours',
 date_trunc('day',now())+interval '10 days 11 hours','virtual','remaining-expired-replacement');
select pg_temp.assert_true((select status='cancelled' and cancellation_reason='Payment hold expired'
 from public.bookings where id='64000000-0000-4000-8000-000000000001'),
 'Sprint4 4.11: expired hold is canonically cancelled before the new reservation commits');
select pg_temp.assert_conflict($c$select public.create_booking(
 (select id from public.public_tutor_snapshots where public_display_name='Public Remaining Tutor'),
 '63000000-0000-4000-8000-000000000001',date_trunc('day',now())+interval '10 days 10 hours',
 date_trunc('day',now())+interval '10 days 11 hours','virtual','remaining-unexpired-conflict')$c$,
 'Sprint4 4.11: unexpired replacement hold still excludes another reservation');
select pg_temp.assert_true((select count(*)=1 and bool_and(status='payment_pending') from public.bookings
 where starts_at=date_trunc('day',now())+interval '10 days 10 hours' and status<>'cancelled'),
 'Sprint4 4.11: exactly one active unpaid hold remains without manufactured confirmation');
reset role;
select pg_temp.assert_true((select count(*)=0 from public.payments where booking_id in (
 select id from public.bookings where request_key in ('remaining-expired-hold','remaining-expired-replacement'))),
 'Sprint4 4.11: hold expiry and retry do not fabricate a payment record');

-- Explicit fixture confirmation unlocks learning relationships. This is not a charge/provider test.
alter table remaining_booking_ids add column assessment uuid;
grant select on remaining_booking_ids to service_role;
set local role service_role;
select public.apply_verified_payment_event(
 public.prepare_booking_payment(replacement, 'remaining-learning-fixture'),
 'remaining-explicit-fixture-no-provider', 'paid', statement_timestamp(), 'fixture-no-charge')
 from remaining_booking_ids;
reset role;
set local role authenticated;
select pg_temp.actor(2);
update remaining_booking_ids set assessment = public.create_learning_assessment(
 (select id from public.public_tutor_snapshots where public_display_name = 'Public Remaining Tutor'),
 '61000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001', replacement,
 '{"title":"Retake boundary","purpose":"diagnostic","questions":[{"prompt":"2+2?","kind":"single_choice","choices":["4","5"],"points":2,"correct_choice":"4"}]}'::jsonb);
select public.assign_learning_assessment(assessment) from remaining_booking_ids;
select pg_temp.actor(1);
select pg_temp.assert_true((select count(*) = 0 from public.assessment_answer_keys),
 'Sprint4 5.1: student answer DTO cannot expose private scoring keys');
select public.submit_assessment_attempt(assessment,
 (select jsonb_object_agg(id::text, '4') from public.assessment_questions where assessment_id = remaining_booking_ids.assessment), true)
 from remaining_booking_ids;
select pg_temp.assert_true((select score = 2 and attempt_no = 1 from public.assessment_attempts where assessment_id = (select assessment from remaining_booking_ids)),
 'Sprint4 5.1: objective score comes from stored keys, not submitted totals');
select pg_temp.assert_denied('select public.authorize_assessment_retake(assessment) from remaining_booking_ids',
 'Sprint4 5.2: student cannot self-authorize another assessment attempt');
select pg_temp.actor(3);
select pg_temp.assert_denied('select public.authorize_assessment_retake(assessment) from remaining_booking_ids',
 'Sprint4 5.2: unrelated tutor cannot authorize retake');
select pg_temp.actor(2);
select public.authorize_assessment_retake(assessment) from remaining_booking_ids;
select pg_temp.actor(1);
select public.submit_assessment_attempt(assessment,
 (select jsonb_object_agg(id::text, '5') from public.assessment_questions where assessment_id = remaining_booking_ids.assessment), true)
 from remaining_booking_ids;
select pg_temp.assert_true((select count(*) = 2 and min(attempt_no) = 1 and max(attempt_no) = 2
 and max(score) = 2 and min(score) = 0 from public.assessment_attempts where assessment_id = (select assessment from remaining_booking_ids)),
 'Sprint4 5.2: authorized retake appends numbered history and preserves original score');
select pg_temp.assert_denied('delete from public.assessment_attempts where assessment_id = (select assessment from remaining_booking_ids)',
 'Sprint4 5.2: student cannot erase recorded attempt history');
reset role;
rollback;
