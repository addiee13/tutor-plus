begin;
-- Students pick from real bookable start times instead of typing a UTC instant and hoping it is free. This read-only
-- function applies the same rules create_booking and guard_booking enforce (policy limits, lead time, advance window,
-- buffered availability and unavailable exceptions) and labels each candidate start. It exposes only busy/free state
-- for a published tutor, never who holds a conflicting booking. create_booking still rechecks atomically on submit.

create function public.list_tutor_bookable_slots(tutor uuid, from_time timestamptz, to_time timestamptz,
  duration_minutes integer)
returns table(slot_start timestamptz, slot_end timestamptz, slot_status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  configuration private.booking_policy;
  buffer interval;
  duration interval;
  step_seconds constant integer := 1800;
begin
  if actor is null or not private.active_actor() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if tutor is null or from_time is null or to_time is null or duration_minutes is null
    or not isfinite(from_time) or not isfinite(to_time) or to_time <= from_time
    or to_time - from_time > interval '16 days' then
    raise exception 'Invalid slot window' using errcode = '22023';
  end if;
  select * into configuration from private.booking_policy where singleton;
  if duration_minutes < configuration.minimum_minutes or duration_minutes > configuration.maximum_minutes then
    raise exception 'Invalid slot duration' using errcode = '22023';
  end if;
  if not private.tutor_is_public(tutor) then return; end if;
  buffer := make_interval(mins => configuration.buffer_minutes);
  duration := make_interval(mins => duration_minutes);

  return query
  select candidate.start_time, candidate.start_time + duration,
    case
      when candidate.start_time < statement_timestamp() + make_interval(mins => configuration.lead_minutes)
        then 'too_soon'
      when exists (
        select 1 from public.bookings as bookings
        where bookings.tutor_id = tutor
          and (bookings.status in ('confirmed', 'in_progress')
            or (bookings.status = 'payment_pending' and bookings.hold_expires_at > statement_timestamp()))
          and bookings.blocking_range && tstzrange(candidate.start_time - buffer, candidate.start_time + duration + buffer, '[)')
      ) then 'booked'
      when exists (
        select 1 from public.bookings as bookings
        where bookings.student_id = actor
          and (bookings.status in ('confirmed', 'in_progress')
            or (bookings.status = 'payment_pending' and bookings.hold_expires_at > statement_timestamp()))
          and bookings.blocking_range && tstzrange(candidate.start_time - buffer, candidate.start_time + duration + buffer, '[)')
      ) then 'student_busy'
      else 'open'
    end
  from generate_series(
    to_timestamp(ceil(extract(epoch from from_time) / step_seconds) * step_seconds),
    to_time - duration,
    make_interval(secs => step_seconds)
  ) as candidate(start_time)
  where candidate.start_time <= statement_timestamp() + make_interval(days => configuration.advance_days)
    and private.slot_is_available(tutor, candidate.start_time - buffer, candidate.start_time + duration + buffer)
  order by candidate.start_time;
end;
$$;

revoke all on function public.list_tutor_bookable_slots(uuid, timestamptz, timestamptz, integer)
from public, anon, authenticated;
grant execute on function public.list_tutor_bookable_slots(uuid, timestamptz, timestamptz, integer) to authenticated;

commit;
