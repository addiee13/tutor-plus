begin;

create function private.revalidate_schedule() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tutor uuid := case when tg_op = 'DELETE' then old.tutor_id else new.tutor_id end;
begin
  if exists (select 1 from public.bookings where tutor_id = tutor
    and status in ('payment_pending', 'confirmed', 'in_progress') and ends_at > statement_timestamp()
    and not private.slot_is_available(tutor, blocking_starts_at, blocking_ends_at)) then
    raise exception 'Schedule change invalidates an active reservation' using errcode = '22023';
  end if;
  return null;
end;
$$;
create trigger availability_rules_revalidate after insert or update or delete on public.availability_rules
for each row execute function private.revalidate_schedule();
create trigger availability_exceptions_revalidate after insert or update or delete on public.availability_exceptions
for each row execute function private.revalidate_schedule();

create function public.prepare_booking_payment(booking uuid, request_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected_booking public.bookings; existing public.payments; payment uuid;
begin
  select * into selected_booking from public.bookings where id = booking for update;
  if not found or selected_booking.status <> 'payment_pending' or selected_booking.hold_expires_at <= statement_timestamp() then
    raise exception 'Booking not payable' using errcode = '22023';
  end if;
  select * into existing from public.payments where booking_id = booking;
  if found then
    if existing.idempotency_key <> request_key then
      raise exception 'Payment key mismatch' using errcode = '22023';
    end if;
    return existing.id;
  end if;
  insert into public.payments(booking_id, idempotency_key, amount_minor, fee_minor, currency)
  values (booking, request_key, selected_booking.price_minor, selected_booking.platform_fee_minor, selected_booking.currency)
  returning id into payment;
  return payment;
end;
$$;

create function public.apply_verified_payment_event(payment uuid, event_id text, requested_state text,
  occurred_at timestamptz, provider_payment_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare selected_payment public.payments; selected_booking public.bookings; prior public.payment_events; tutor uuid;
begin
  if requested_state is null or requested_state not in ('requires_action', 'processing', 'paid', 'failed')
    or occurred_at is null or not isfinite(occurred_at) or occurred_at > statement_timestamp() + interval '5 minutes'
    or event_id is null or length(event_id) not between 1 and 200
    or provider_payment_id is null or length(provider_payment_id) not between 1 and 200 then
    raise exception 'Invalid verified event' using errcode = '22023';
  end if;
  select bookings.tutor_id into tutor from public.bookings as bookings join public.payments as payments
    on payments.booking_id = bookings.id where payments.id = payment;
  perform 1 from public.tutor_profiles where id = tutor for update;
  select bookings.* into selected_booking from public.bookings as bookings join public.payments as payments
    on payments.booking_id = bookings.id where payments.id = payment for update of bookings;
  select * into selected_payment from public.payments where id = payment for update;
  if not found then raise exception 'Unknown payment' using errcode = '22023'; end if;
  insert into public.payment_events(payment_id, provider_event_id, event_type, safe_state_snapshot, provider_occurred_at)
  values (payment, event_id, requested_state, jsonb_build_object('state', requested_state), occurred_at)
  on conflict (provider_event_id) do nothing;
  if not found then
    select * into prior from public.payment_events where provider_event_id = event_id;
    if (prior.payment_id, prior.event_type, prior.provider_occurred_at) is distinct from (payment, requested_state, occurred_at) then
      raise exception 'Provider event identity mismatch' using errcode = '22023';
    end if;
    return false;
  end if;
  if selected_payment.provider_payment_id is not null and selected_payment.provider_payment_id <> apply_verified_payment_event.provider_payment_id then
    raise exception 'Provider payment identity mismatch' using errcode = '22023';
  end if;
  if (selected_payment.last_provider_event_at is not null and occurred_at < selected_payment.last_provider_event_at)
    or selected_payment.state in ('paid', 'partially_refunded', 'refunded')
    or (selected_payment.state = 'processing' and requested_state = 'requires_action')
    or (selected_payment.state = 'failed' and requested_state in ('requires_action', 'processing')) then
    update public.payment_events set processed_at = statement_timestamp(),
      safe_state_snapshot = jsonb_build_object('state', requested_state, 'ignored', true) where provider_event_id = event_id;
    return false;
  end if;
  update public.payments set state = requested_state, last_provider_event_at = occurred_at,
    provider_payment_id = apply_verified_payment_event.provider_payment_id,
    paid_at = case when requested_state = 'paid' then occurred_at else paid_at end where id = payment;
  if requested_state = 'paid' and selected_booking.status = 'payment_pending' then
    if selected_booking.hold_expires_at > statement_timestamp() then
      update public.bookings set status = 'confirmed' where id = selected_booking.id;
    else
      update public.bookings set status = 'cancelled', cancellation_reason = 'Payment arrived after hold expired; refund review required'
      where id = selected_booking.id;
    end if;
  end if;
  update public.payment_events set processed_at = statement_timestamp() where provider_event_id = event_id;
  return true;
end;
$$;

create function public.reserve_refund(payment uuid, request_key text, amount_minor bigint, reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare existing public.refunds; refund uuid;
begin
  perform 1 from public.payments where id = payment for update;
  if not found then raise exception 'Unknown payment' using errcode = '22023'; end if;
  select * into existing from public.refunds where idempotency_key = request_key;
  if found then
    if (existing.payment_id, existing.amount_minor, existing.reason) is distinct from (payment, reserve_refund.amount_minor, reserve_refund.reason) then
      raise exception 'Refund key reused' using errcode = '22023';
    end if;
    return existing.id;
  end if;
  insert into public.refunds(payment_id, idempotency_key, amount_minor, reason)
  values (payment, request_key, amount_minor, reason) returning id into refund;
  return refund;
end;
$$;

create function public.apply_verified_refund_event(refund uuid, event_id text, requested_state text,
  occurred_at timestamptz, provider_refund_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare selected_refund public.refunds; selected_payment public.payments; prior public.payment_events; total numeric;
begin
  if requested_state is null or requested_state not in ('pending', 'succeeded', 'failed')
    or occurred_at is null or not isfinite(occurred_at) or occurred_at > statement_timestamp() + interval '5 minutes'
    or event_id is null or length(event_id) not between 1 and 200
    or provider_refund_id is null or length(provider_refund_id) not between 1 and 200 then
    raise exception 'Invalid verified refund event' using errcode = '22023';
  end if;
  select * into selected_refund from public.refunds where id = refund;
  if not found then raise exception 'Unknown refund' using errcode = '22023'; end if;
  select * into selected_payment from public.payments where id = selected_refund.payment_id for update;
  select * into selected_refund from public.refunds where id = refund for update;
  insert into public.payment_events(payment_id, provider_event_id, event_type, safe_state_snapshot, provider_occurred_at)
  values (selected_payment.id, event_id, 'refund.' || requested_state,
    jsonb_build_object('refund_id', refund, 'state', requested_state), occurred_at) on conflict (provider_event_id) do nothing;
  if not found then
    select * into prior from public.payment_events where provider_event_id = event_id;
    if (prior.payment_id, prior.event_type, prior.provider_occurred_at, prior.safe_state_snapshot ->> 'refund_id')
      is distinct from (selected_payment.id, 'refund.' || requested_state, occurred_at, refund::text) then
      raise exception 'Provider event identity mismatch' using errcode = '22023';
    end if;
    return false;
  end if;
  if selected_refund.provider_refund_id is not null and selected_refund.provider_refund_id <> apply_verified_refund_event.provider_refund_id then
    raise exception 'Provider refund identity mismatch' using errcode = '22023';
  end if;
  if selected_refund.state in ('succeeded', 'failed') then
    update public.payment_events set processed_at = statement_timestamp(),
      safe_state_snapshot = safe_state_snapshot || '{"ignored":true}'::jsonb where provider_event_id = event_id;
    return false;
  end if;
  update public.refunds set state = requested_state, provider_refund_id = apply_verified_refund_event.provider_refund_id where id = refund;
  if requested_state = 'succeeded' then
    select coalesce(sum(amount_minor), 0) into total from public.refunds where payment_id = selected_payment.id and state = 'succeeded';
    update public.payments set state = case when total = amount_minor then 'refunded' else 'partially_refunded' end,
      refunded_at = case when total = amount_minor then occurred_at else null end where id = selected_payment.id;
  end if;
  update public.payment_events set processed_at = statement_timestamp() where provider_event_id = event_id;
  return true;
end;
$$;

revoke all on function public.prepare_booking_payment(uuid, text),
public.apply_verified_payment_event(uuid, text, text, timestamptz, text), public.reserve_refund(uuid, text, bigint, text),
public.apply_verified_refund_event(uuid, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.prepare_booking_payment(uuid, text),
public.apply_verified_payment_event(uuid, text, text, timestamptz, text), public.reserve_refund(uuid, text, bigint, text),
public.apply_verified_refund_event(uuid, text, text, timestamptz, text) to service_role;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.tutor_is_public(uuid) to anon, authenticated;
grant execute on function private.valid_timezone(text), private.active_actor(), private.has_role(text), private.owns_tutor(uuid),
private.booking_participant(uuid), private.payment_participant(uuid) to authenticated;

commit;
