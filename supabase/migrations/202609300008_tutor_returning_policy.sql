begin;

alter policy tutor_owner_read on public.tutor_profiles
using (user_id = auth.uid() and private.has_role('tutor'));
alter policy tutor_owner_update on public.tutor_profiles
using (user_id = auth.uid() and private.has_role('tutor'))
with check (user_id = auth.uid() and private.has_role('tutor'));

commit;
