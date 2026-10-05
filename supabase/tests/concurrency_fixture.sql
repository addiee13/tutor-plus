\set ON_ERROR_STOP on
begin;
insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values
('71000000-0000-4000-8000-000000000001', 'parallel-one@example.invalid', now(), '{"display_name":"Parallel student one","adult_attested":true,"role":"student"}'),
('71000000-0000-4000-8000-000000000002', 'parallel-two@example.invalid', now(), '{"display_name":"Parallel student two","adult_attested":true,"role":"student"}'),
('71000000-0000-4000-8000-000000000003', 'parallel-tutor@example.invalid', now(), '{"display_name":"Parallel tutor","adult_attested":true,"role":"tutor"}');
insert into auth.sessions(id, user_id, created_at, updated_at) select
  ('72000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  ('71000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  now(), now() from generate_series(1, 3) as sequence;
insert into public.tutor_profiles(id, user_id, public_display_name, headline, bio, hourly_rate_minor)
values ('74000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000003', 'Parallel tutor', 'Concurrency fixture', 'Not an Auth API test', 6000);
insert into public.tutor_subjects(tutor_id, subject_id)
values ('74000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001');
insert into public.availability_rules(tutor_id, weekday, local_start, local_end, timezone, valid_from)
select '74000000-0000-4000-8000-000000000001', weekday, '08:00', '20:00', 'UTC', current_date
from generate_series(0, 6) as weekday;
update public.tutor_profiles set publication_state = 'published' where id = '74000000-0000-4000-8000-000000000001';
commit;
