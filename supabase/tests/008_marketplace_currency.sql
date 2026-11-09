\set ON_ERROR_STOP on
begin;
set local timezone='UTC';
create function pg_temp.assert_currency(condition boolean,label text) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'FAIL: %',label; end if;
  raise notice 'PASS: %',label;
end;
$$;
create function pg_temp.actor(n integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object(
    'sub','64100000-0000-4000-8000-00000000000'||n,
    'session_id','64200000-0000-4000-8000-00000000000'||n,
    'role','authenticated')::text,true);
$$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('64100000-0000-4000-8000-000000000001','currency-usd@example.invalid',now(),'{"display_name":"Currency USD Tutor","adult_attested":true,"initial_role":"tutor"}'),
 ('64100000-0000-4000-8000-000000000002','currency-eur@example.invalid',now(),'{"display_name":"Currency EUR Tutor","adult_attested":true,"initial_role":"tutor"}');
insert into auth.sessions(id,user_id,created_at,updated_at)
 select ('64200000-0000-4000-8000-00000000000'||n)::uuid,
   ('64100000-0000-4000-8000-00000000000'||n)::uuid,now()-interval '1 hour',now()
 from generate_series(1,2) as users(n);
insert into public.subjects(id,name,slug)
 values('64300000-0000-4000-8000-000000000001','Currency Algebra','currency-algebra');
set local role authenticated;
select pg_temp.actor(1);
select public.save_tutor_listing(null,'Currency USD Tutor',null,'Algebra','USD currency fixture',null,
  3,3000,'USD',true,false,null,null,null,null,
  '[{"subject_id":"64300000-0000-4000-8000-000000000001"}]'::jsonb,null);
insert into public.availability_rules(tutor_id,weekday,local_start,local_end,timezone,valid_from)
 select id,weekday,'08:00','20:00','UTC',current_date from public.tutor_profiles cross join generate_series(0,6) as days(weekday)
 where user_id=auth.uid();
update public.tutor_profiles set publication_state='published' where user_id=auth.uid();
select pg_temp.actor(2);
select public.save_tutor_listing(null,'Currency EUR Tutor',null,'Algebra','EUR currency fixture',null,
  3,3000,'EUR',true,false,null,null,null,null,
  '[{"subject_id":"64300000-0000-4000-8000-000000000001"}]'::jsonb,null);
insert into public.availability_rules(tutor_id,weekday,local_start,local_end,timezone,valid_from)
 select id,weekday,'08:00','20:00','UTC',current_date from public.tutor_profiles cross join generate_series(0,6) as days(weekday)
 where user_id=auth.uid();
update public.tutor_profiles set publication_state='published' where user_id=auth.uid();
reset role;
set local role anon;
select pg_temp.assert_currency((
  select count(*)=1 and bool_and(currency='USD') from public.list_public_tutors_v3(
    null,'64300000-0000-4000-8000-000000000001','virtual',3000,3000,null,null,null,null,null,null,null,
    'name',20,0,'USD')
 ),'USD 3000 budget selects the USD 3000 tutor and excludes the equal-minor-unit EUR listing before pagination');
select pg_temp.assert_currency((
  select count(*)=1 and bool_and(currency='EUR') from public.list_public_tutors_v3(
    null,'64300000-0000-4000-8000-000000000001','virtual',3000,3000,null,null,null,null,null,null,null,
    'name',20,0,'EUR')
 ),'an explicitly EUR-denominated budget compares only EUR minor units');
select pg_temp.assert_currency((
  select count(*)=2 and count(*) filter(where currency='EUR')=1
    from public.list_public_tutors_v3(
      null,'64300000-0000-4000-8000-000000000001','virtual',null,null,null,null,null,null,null,null,null,
      'name',20,0,'USD')
 ),'unpriced discovery still returns the EUR listing with its currency label');
select pg_temp.assert_currency((
  select count(*)=1 and bool_and(currency='USD') from public.list_public_tutors_v2(
    null,'64300000-0000-4000-8000-000000000001','virtual',3000,3000,null,null,null,null,null,null,null,
    'name',20,0)
 ),'legacy v2 rate-bound calls retain an explicit USD interpretation');
reset role;
rollback;
