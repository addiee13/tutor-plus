begin;
-- Published tutors' weekly availability and dated exceptions are public booking information, but the source tables
-- stay owner-only under RLS. These read-only DTO functions expose just the scheduling fields of published tutors so
-- students see real availability instead of "no scheduling details are readable".

create function public.list_public_tutor_availability(tutor uuid)
returns table(weekday smallint, local_start time, local_end time, timezone text, valid_from date, valid_until date)
language sql stable security definer set search_path = '' as $$
  select rules.weekday, rules.local_start, rules.local_end, rules.timezone, rules.valid_from, rules.valid_until
  from public.availability_rules as rules
  where rules.tutor_id = tutor and rules.active and private.tutor_is_public(tutor)
    and (rules.valid_until is null or rules.valid_until >= current_date)
  order by rules.weekday, rules.local_start
  limit 200;
$$;

create function public.list_public_tutor_exceptions(tutor uuid, from_date date, to_date date)
returns table(local_date date, local_start time, local_end time, timezone text, exception_type text)
language sql stable security definer set search_path = '' as $$
  select exceptions.local_date, exceptions.local_start, exceptions.local_end, exceptions.timezone, exceptions.exception_type
  from public.availability_exceptions as exceptions
  where exceptions.tutor_id = tutor and private.tutor_is_public(tutor)
    and exceptions.local_date between from_date and to_date and to_date - from_date between 0 and 31
  order by exceptions.local_date, exceptions.local_start
  limit 200;
$$;

revoke all on function public.list_public_tutor_availability(uuid), public.list_public_tutor_exceptions(uuid, date, date)
from public, anon, authenticated;
grant execute on function public.list_public_tutor_availability(uuid), public.list_public_tutor_exceptions(uuid, date, date)
to anon, authenticated;

commit;
