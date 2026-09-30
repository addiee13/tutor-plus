begin;

create table private.admin_bootstrap_guard (
  singleton boolean primary key default true check (singleton),
  target uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
revoke all on private.admin_bootstrap_guard from public, anon, authenticated, service_role;

create function public.bootstrap_initial_admin(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(93126001);
  if exists (select 1 from private.admin_bootstrap_guard) or exists (
    select 1 from public.user_roles where role = 'administrator') then
    raise exception 'Initial administrator already established' using errcode = '22023';
  end if;
  perform 1 from public.profiles as profiles join auth.users as users on users.id = profiles.id
  where profiles.id = target and profiles.status = 'active' and profiles.adult_attested
    and users.email_confirmed_at is not null for update of profiles;
  if not found then raise exception 'Ineligible bootstrap target' using errcode = '22023'; end if;
  insert into private.admin_bootstrap_guard(singleton, target) values (true, target);
  insert into public.user_roles(user_id, role, granted_by) values (target, 'administrator', null);
  insert into public.audit_logs(action, entity_type, entity_id, reason)
  values ('admin.bootstrap', 'profiles', target, 'One-time privileged administrator bootstrap');
end;
$$;
revoke all on function public.bootstrap_initial_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_initial_admin(uuid) to service_role;

commit;
