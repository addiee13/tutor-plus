begin;
set local search_path = public, extensions, pg_catalog;

-- Fully qualify every webhook argument and the RETURNING target. The output record name `event_id` shares
-- a PL/pgSQL namespace with the input argument, so an unqualified RETURNING event_id is ambiguous at REST.
create or replace function public.record_resend_delivery_event(
  event_id text,provider_email_id text,event_type text,event_created_at timestamptz
) returns table(duplicate boolean,matched boolean,delivery_state text)
language plpgsql security definer set search_path = '' as $$
declare linked_id uuid; current_state text; next_state text; inserted_event_id text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode='42501'; end if;
  if record_resend_delivery_event.event_id is null or length(record_resend_delivery_event.event_id) not between 1 and 200
    or record_resend_delivery_event.provider_email_id is null
    or length(record_resend_delivery_event.provider_email_id) not between 1 and 200
    or record_resend_delivery_event.event_type not in
      ('email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed')
    or (record_resend_delivery_event.event_created_at is not null
      and not isfinite(record_resend_delivery_event.event_created_at)) then
    raise exception 'Invalid delivery event' using errcode='22023';
  end if;
  select notices.id,notices.email_state into linked_id,current_state
    from private.notification_outbox as notices
    where notices.provider_email_id=record_resend_delivery_event.provider_email_id for update;
  insert into private.notification_delivery_events as delivery_events(
    event_id,provider_email_id,event_type,event_created_at,outbox_id
  ) values (
    record_resend_delivery_event.event_id,record_resend_delivery_event.provider_email_id,
    record_resend_delivery_event.event_type,record_resend_delivery_event.event_created_at,linked_id
  ) on conflict on constraint notification_delivery_events_pkey do nothing
  returning delivery_events.event_id into inserted_event_id;
  if inserted_event_id is null then
    return query select true,linked_id is not null,current_state;
    return;
  end if;
  if linked_id is null then return query select false,false,null::text; return; end if;
  next_state:=case
    when current_state='complained' then current_state
    when record_resend_delivery_event.event_type='email.complained' then 'complained'
    when current_state in ('delivered','bounced') then current_state
    when record_resend_delivery_event.event_type='email.delivered' then 'delivered'
    when record_resend_delivery_event.event_type='email.bounced' then 'bounced'
    when current_state='failed' then current_state
    when record_resend_delivery_event.event_type='email.failed' then 'failed'
    when record_resend_delivery_event.event_type in ('email.sent','email.delivery_delayed') then 'accepted'
    else current_state end;
  update private.notification_outbox as notices set email_state=next_state,updated_at=statement_timestamp()
    where notices.id=linked_id;
  update public.notifications as feed set delivery_state=next_state where feed.outbox_id=linked_id;
  return query select false,true,next_state;
end;
$$;

revoke all on function public.record_resend_delivery_event(text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.record_resend_delivery_event(text,text,text,timestamptz) to service_role;

commit;
