begin;

create function public.list_public_tutor_subjects(tutor uuid)
returns table(subject_id uuid, name text, slug text, hourly_rate_minor bigint, currency char(3))
language sql stable security definer set search_path = '' as $$
  select subjects.id, subjects.name, subjects.slug,
    coalesce(links.rate_override_minor, tutors.hourly_rate_minor), tutors.currency
  from public.tutor_subjects as links join public.subjects as subjects on subjects.id = links.subject_id
  join public.tutor_profiles as tutors on tutors.id = links.tutor_id
  where links.tutor_id = tutor and subjects.active and private.tutor_is_public(tutor)
  order by subjects.sort_order, subjects.name;
$$;
revoke all on function public.list_public_tutor_subjects(uuid) from public, anon, authenticated;
grant execute on function public.list_public_tutor_subjects(uuid) to anon, authenticated;

commit;
