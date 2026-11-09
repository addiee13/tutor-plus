begin;
set local search_path = public, extensions, pg_catalog;

create function public.publish_structured_session_recap_v2(
  booking uuid,summary text,topics text[],mastery_notes text,strengths text,
  practice_areas text,next_steps text,resource_ids uuid[]
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare tutor uuid; saved timestamptz; item text; normalized text[]:=array[]::text[]; resource_id uuid; position_no integer:=0;
begin
  if not private.booking_tutor(booking) then raise exception 'Not authorized' using errcode='42501'; end if;
  if not private.session_has_ended(booking) then raise exception 'Recap cannot be published before the session ends' using errcode='22023'; end if;
  if topics is null or cardinality(topics) not between 1 and 20 then raise exception 'Add one to twenty covered topics' using errcode='22023'; end if;
  foreach item in array topics loop
    item:=private.require_text(item,200,true);
    if not item=any(normalized) then normalized:=array_append(normalized,item); end if;
  end loop;
  if resource_ids is null or cardinality(resource_ids)>20 then raise exception 'Choose up to twenty approved resources' using errcode='22023'; end if;
  select tutor_id into tutor from public.bookings where id=booking;
  insert into public.session_recaps(booking_id,tutor_id,summary,mastery_notes,next_steps,topics,strengths,practice_areas)
  values(booking,tutor,private.require_text(summary,4000,true),private.require_text(mastery_notes,2000,false),
    private.require_text(next_steps,2000,false),normalized,private.require_text(strengths,2000,true),
    private.require_text(practice_areas,2000,true))
  on conflict(booking_id) do update set summary=excluded.summary,mastery_notes=excluded.mastery_notes,next_steps=excluded.next_steps,
    topics=excluded.topics,strengths=excluded.strengths,practice_areas=excluded.practice_areas
  returning updated_at into saved;
  delete from public.session_recap_resources where booking_id=booking;
  foreach resource_id in array resource_ids loop
    position_no:=position_no+1;
    insert into public.session_recap_resources(booking_id,position,resource_id) values(booking,position_no,resource_id);
  end loop;
  return saved;
end;
$$;

-- Keep the original seven-argument PostgREST contract intact for callers from the first structured-recap release.
create or replace function public.publish_structured_session_recap(
  booking uuid,summary text,topics text[],strengths text,practice_areas text,next_steps text,resource_ids uuid[]
) returns timestamptz language plpgsql security definer set search_path = '' as $$
begin
  return public.publish_structured_session_recap_v2(
    booking,summary,topics,strengths,strengths,practice_areas,next_steps,resource_ids
  );
end;
$$;

revoke all on function public.publish_structured_session_recap_v2(uuid,text,text[],text,text,text,text,uuid[])
  from public,anon,authenticated;
grant execute on function public.publish_structured_session_recap_v2(uuid,text,text[],text,text,text,text,uuid[])
  to authenticated;

commit;
