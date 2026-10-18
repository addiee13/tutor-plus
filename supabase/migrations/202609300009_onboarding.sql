begin;

-- Social (OAuth) and passwordless identities arrive without the signup form's metadata. The existing
-- provisioning trigger still creates their profile, but with adult_attested = false, which keeps them
-- outside private.active_actor() and every RLS policy until they complete this one-time onboarding.

create function public.onboarding_state() returns text
language sql stable security definer set search_path = '' as $$
  select case when profiles.status <> 'active' then 'inactive'
    when profiles.adult_attested then 'complete' else 'required' end
  from public.profiles as profiles join auth.users as users on users.id = profiles.id
  where profiles.id = auth.uid() and users.email_confirmed_at is not null
    and public.current_session_started_at() is not null;
$$;

create function public.complete_onboarding(chosen_name text, chosen_timezone text, requested_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or public.current_session_started_at() is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  -- Administrator is never self-assignable; only the audited administrator RPCs can grant it.
  if requested_role is null or requested_role not in ('student', 'tutor') then
    raise exception 'Invalid initial capability' using errcode = '22023';
  end if;
  if chosen_name is null or length(btrim(chosen_name)) not between 2 and 80 or chosen_name ~ '[[:cntrl:]]' then
    raise exception 'Invalid display name' using errcode = '22023';
  end if;
  if chosen_timezone is null or not private.valid_timezone(chosen_timezone) then
    raise exception 'Invalid timezone' using errcode = '22023';
  end if;
  perform 1 from public.profiles as profiles join auth.users as users on users.id = profiles.id
  where profiles.id = actor and profiles.status = 'active' and not profiles.adult_attested
    and users.email_confirmed_at is not null for update of profiles;
  if not found then raise exception 'Onboarding unavailable' using errcode = '42501'; end if;
  update public.profiles set display_name = btrim(chosen_name), timezone = chosen_timezone,
    adult_attested = true, adult_attested_at = statement_timestamp() where id = actor;
  -- Replace only the self-service default the trigger provisioned; never touch granted capabilities.
  delete from public.user_roles where user_id = actor and granted_by is null
    and role in ('student', 'tutor') and role <> requested_role;
  insert into public.user_roles(user_id, role) values (actor, requested_role) on conflict (user_id, role) do nothing;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, reason, safe_metadata)
  values (actor, 'account.onboarded', 'profiles', actor, 'Self-service onboarding', jsonb_build_object('initial_role', requested_role));
end;
$$;

revoke all on function public.onboarding_state(), public.complete_onboarding(text, text, text) from public, anon, authenticated;
grant execute on function public.onboarding_state(), public.complete_onboarding(text, text, text) to authenticated;

commit;
