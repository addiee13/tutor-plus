\set ON_ERROR_STOP on
\set VERBOSITY verbose
begin;
set local role authenticated;
set local timezone = 'UTC';
select set_config('request.jwt.claims', jsonb_build_object('sub', :'student', 'role', 'authenticated', 'session_id', :'session')::text, true);
select public.create_booking('74000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
  date_trunc('day', now()) + interval '2 days 10 hours', date_trunc('day', now()) + interval '2 days 11 hours', 'virtual', :'request');
select pg_sleep(2);
commit;
