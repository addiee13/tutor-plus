begin;
set local search_path = public, extensions, pg_catalog;

-- Sprint 3: UC-09 Session Planner and Recap, UC-07 Reviews and Ratings.
-- Every write goes through a SECURITY DEFINER function that re-checks the caller's booking role, and every table
-- carries trigger-level invariants so even privileged writers cannot attach records to the wrong booking.

create function private.booking_student(booking uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('student') and exists (
    select 1 from public.bookings where id = booking and student_id = auth.uid()
  );
$$;

create function private.booking_tutor(booking uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('tutor') and exists (
    select 1 from public.bookings as bookings join public.tutor_profiles as tutors on tutors.id = bookings.tutor_id
    where bookings.id = booking and tutors.user_id = auth.uid()
  );
$$;

-- A session has ended when it is completed, or when a confirmed/in-progress session is past its end time.
create function private.session_has_ended(booking uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bookings where id = booking and (status = 'completed'
      or (status in ('confirmed', 'in_progress') and ends_at <= statement_timestamp()))
  );
$$;

-- UC-09 ------------------------------------------------------------------------------------------------------------

create table public.session_plans (
  booking_id uuid primary key references public.bookings(id) on delete restrict,
  student_goals text check (length(student_goals) <= 2000),
  student_questions text check (length(student_questions) <= 2000),
  tutor_agenda text check (length(tutor_agenda) <= 4000),
  student_updated_at timestamptz,
  tutor_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((student_goals is null) = (student_updated_at is null)),
  check ((tutor_agenda is null) = (tutor_updated_at is null))
);

create table public.session_recaps (
  booking_id uuid primary key references public.bookings(id) on delete restrict,
  tutor_id uuid not null references public.tutor_profiles(id) on delete restrict,
  summary text not null check (length(btrim(summary)) between 1 and 4000),
  mastery_notes text check (length(mastery_notes) <= 2000),
  next_steps text check (length(next_steps) <= 2000),
  revision integer not null default 1 check (revision > 0),
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (updated_at >= published_at)
);
create index session_recaps_tutor_idx on public.session_recaps(tutor_id);

create table public.session_reflections (
  booking_id uuid not null references public.bookings(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  reflection text not null check (length(btrim(reflection)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (booking_id, student_id)
);
create index session_reflections_student_idx on public.session_reflections(student_id);

create function private.guard_session_record() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected_booking public.bookings;
begin
  select * into selected_booking from public.bookings where id = new.booking_id;
  if not found then raise exception 'Unknown booking' using errcode = '22023'; end if;
  if tg_op = 'UPDATE' and new.booking_id <> old.booking_id then
    raise exception 'Immutable session booking' using errcode = '22023';
  end if;
  if selected_booking.status not in ('confirmed', 'in_progress', 'completed') then
    raise exception 'Session records require a confirmed booking' using errcode = '22023';
  end if;
  if tg_table_name = 'session_recaps' then
    if new.tutor_id <> selected_booking.tutor_id then
      raise exception 'Recap author must be the booked tutor' using errcode = '22023';
    end if;
    if not private.session_has_ended(new.booking_id) then
      raise exception 'Recap cannot be published before the session ends' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' then
      new.published_at := old.published_at;
      new.revision := old.revision + 1;
    end if;
  elsif tg_table_name = 'session_reflections' then
    if new.student_id <> selected_booking.student_id then
      raise exception 'Reflection owner must be the booked student' using errcode = '22023';
    end if;
    if not private.session_has_ended(new.booking_id) then
      raise exception 'Reflection opens after the session ends' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' then new.created_at := old.created_at; end if;
  elsif tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger session_plans_guard before insert or update on public.session_plans
for each row execute function private.guard_session_record();
create trigger session_recaps_guard before insert or update on public.session_recaps
for each row execute function private.guard_session_record();
create trigger session_reflections_guard before insert or update on public.session_reflections
for each row execute function private.guard_session_record();

create function private.require_text(value text, maximum integer, required boolean) returns text
language plpgsql immutable set search_path = '' as $$
declare cleaned text := nullif(btrim(coalesce(value, '')), '');
begin
  if (required and cleaned is null) or length(cleaned) > maximum or cleaned ~ '[\x01-\x08\x0B\x0C\x0E-\x1F]' then
    raise exception 'Invalid text input' using errcode = '22023';
  end if;
  return cleaned;
end;
$$;

create function public.save_session_goals(booking uuid, goals text, questions text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare saved_at timestamptz;
begin
  if not private.booking_student(booking) then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform 1 from public.bookings where id = booking and status in ('confirmed', 'in_progress');
  if not found then raise exception 'Planner is closed for this booking' using errcode = '22023'; end if;
  insert into public.session_plans(booking_id, student_goals, student_questions, student_updated_at)
  values (booking, private.require_text(goals, 2000, true), private.require_text(questions, 2000, false), statement_timestamp())
  on conflict (booking_id) do update set student_goals = excluded.student_goals,
    student_questions = excluded.student_questions, student_updated_at = excluded.student_updated_at
  returning student_updated_at into saved_at;
  return saved_at;
end;
$$;

create function public.save_session_agenda(booking uuid, agenda text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare saved_at timestamptz;
begin
  if not private.booking_tutor(booking) then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform 1 from public.bookings where id = booking and status in ('confirmed', 'in_progress');
  if not found then raise exception 'Planner is closed for this booking' using errcode = '22023'; end if;
  insert into public.session_plans(booking_id, tutor_agenda, tutor_updated_at)
  values (booking, private.require_text(agenda, 4000, true), statement_timestamp())
  on conflict (booking_id) do update set tutor_agenda = excluded.tutor_agenda, tutor_updated_at = excluded.tutor_updated_at
  returning tutor_updated_at into saved_at;
  return saved_at;
end;
$$;

create function public.publish_session_recap(booking uuid, summary text, mastery_notes text, next_steps text)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare tutor uuid; saved_at timestamptz;
begin
  if not private.booking_tutor(booking) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if not private.session_has_ended(booking) then
    raise exception 'Recap cannot be published before the session ends' using errcode = '22023';
  end if;
  select tutor_id into tutor from public.bookings where id = booking;
  insert into public.session_recaps(booking_id, tutor_id, summary, mastery_notes, next_steps)
  values (booking, tutor, private.require_text(summary, 4000, true), private.require_text(mastery_notes, 2000, false),
    private.require_text(next_steps, 2000, false))
  on conflict (booking_id) do update set summary = excluded.summary, mastery_notes = excluded.mastery_notes,
    next_steps = excluded.next_steps
  returning updated_at into saved_at;
  return saved_at;
end;
$$;

create function public.save_session_reflection(booking uuid, reflection text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare saved_at timestamptz;
begin
  if not private.booking_student(booking) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if not private.session_has_ended(booking) then
    raise exception 'Reflection opens after the session ends' using errcode = '22023';
  end if;
  insert into public.session_reflections(booking_id, student_id, reflection)
  values (booking, auth.uid(), private.require_text(reflection, 4000, true))
  on conflict (booking_id, student_id) do update set reflection = excluded.reflection
  returning updated_at into saved_at;
  return saved_at;
end;
$$;

-- The booked tutor records delivery of a confirmed session after its scheduled end time.
create function public.mark_session_completed(booking uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare selected_booking public.bookings;
begin
  if not private.booking_tutor(booking) then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into selected_booking from public.bookings where id = booking for update;
  if selected_booking.status = 'completed' then return 'completed'; end if;
  if selected_booking.status not in ('confirmed', 'in_progress') or selected_booking.ends_at > statement_timestamp() then
    raise exception 'Only a confirmed session that has ended can be completed' using errcode = '22023';
  end if;
  if selected_booking.status = 'confirmed' then
    update public.bookings set status = 'in_progress' where id = booking;
  end if;
  update public.bookings set status = 'completed' where id = booking;
  return 'completed';
end;
$$;

-- UC-07 ------------------------------------------------------------------------------------------------------------

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  tutor_id uuid not null references public.tutor_profiles(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  comment text check (length(comment) <= 2000),
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  moderation_reason text check (length(moderation_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'visible' or moderation_reason is not null)
);
create index reviews_tutor_status_idx on public.reviews(tutor_id, status, created_at desc);
create index reviews_student_idx on public.reviews(student_id, created_at desc);

create table public.tutor_rating_summaries (
  tutor_id uuid primary key references public.tutor_profiles(id) on delete restrict,
  rating_count integer not null default 0 check (rating_count >= 0),
  rating_sum integer not null default 0 check (rating_sum between rating_count and rating_count * 5),
  rating_avg numeric(3,2) check (rating_avg between 1 and 5),
  updated_at timestamptz not null default now(),
  check ((rating_count = 0) = (rating_avg is null))
);

create function private.guard_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare selected_booking public.bookings;
begin
  if tg_op = 'INSERT' then
    select * into selected_booking from public.bookings where id = new.booking_id for update;
    if not found or selected_booking.status <> 'completed' then
      raise exception 'Only completed sessions can be reviewed' using errcode = '22023';
    end if;
    if new.student_id <> selected_booking.student_id or new.tutor_id <> selected_booking.tutor_id then
      raise exception 'Review must belong to the booked student and tutor' using errcode = '22023';
    end if;
    if new.status <> 'visible' then raise exception 'New reviews start visible' using errcode = '22023'; end if;
  else
    if (new.id, new.booking_id, new.student_id, new.tutor_id, new.rating, new.comment, new.created_at)
      is distinct from (old.id, old.booking_id, old.student_id, old.tutor_id, old.rating, old.comment, old.created_at) then
      raise exception 'Submitted reviews are immutable; only moderation state changes' using errcode = '22023';
    end if;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger reviews_guard before insert or update on public.reviews
for each row execute function private.guard_review();
create trigger reviews_no_delete before delete on public.reviews
for each row execute function private.prevent_history_mutation();

-- The aggregate is derived only from visible reviews and is never client-writable.
create function private.refresh_tutor_rating() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tutor uuid := new.tutor_id;
begin
  perform pg_catalog.pg_advisory_xact_lock(93126003, pg_catalog.hashtext(tutor::text));
  insert into public.tutor_rating_summaries(tutor_id, rating_count, rating_sum, rating_avg, updated_at)
  select tutor, count(*), coalesce(sum(rating), 0), round(avg(rating), 2), statement_timestamp()
  from public.reviews where tutor_id = tutor and status = 'visible'
  on conflict (tutor_id) do update set rating_count = excluded.rating_count, rating_sum = excluded.rating_sum,
    rating_avg = excluded.rating_avg, updated_at = excluded.updated_at;
  return null;
end;
$$;
create trigger reviews_refresh_rating after insert or update of status on public.reviews
for each row execute function private.refresh_tutor_rating();

create function public.submit_review(booking uuid, rating integer, comment text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare selected_booking public.bookings; review uuid;
begin
  if not private.booking_student(booking) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if rating is null or rating not between 1 and 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = '22023';
  end if;
  select * into selected_booking from public.bookings where id = booking;
  if selected_booking.status <> 'completed' then
    raise exception 'Only completed sessions can be reviewed' using errcode = '22023';
  end if;
  insert into public.reviews(booking_id, student_id, tutor_id, rating, comment)
  values (booking, auth.uid(), selected_booking.tutor_id, rating, private.require_text(comment, 2000, false))
  returning id into review;
  return review;
end;
$$;

create function public.moderate_review(review uuid, requested_status text, reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.assert_administrator();
begin
  if requested_status is null or requested_status not in ('visible', 'hidden')
    or reason is null or length(btrim(reason)) not between 1 and 500 then
    raise exception 'Invalid moderation request' using errcode = '22023';
  end if;
  update public.reviews set status = requested_status, moderation_reason = btrim(reason) where id = review;
  if not found then raise exception 'Unknown review' using errcode = '22023'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, reason, safe_metadata)
  values (actor, 'review.moderated', 'reviews', review, btrim(reason), jsonb_build_object('status', requested_status));
end;
$$;

-- Public reputation DTO: approved rating and comment only; no student identity or booking link.
create function public.list_public_tutor_reviews(tutor uuid)
returns table(rating smallint, comment text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select reviews.rating, reviews.comment, reviews.created_at from public.reviews as reviews
  where reviews.tutor_id = tutor and reviews.status = 'visible' and private.tutor_is_public(tutor)
  order by reviews.created_at desc limit 50;
$$;

-- RLS and grants -----------------------------------------------------------------------------------------------------

alter table public.session_plans enable row level security;
alter table public.session_recaps enable row level security;
alter table public.session_reflections enable row level security;
alter table public.reviews enable row level security;
alter table public.tutor_rating_summaries enable row level security;
revoke all on public.session_plans, public.session_recaps, public.session_reflections, public.reviews,
public.tutor_rating_summaries from public, anon, authenticated, service_role;
grant select on public.session_plans, public.session_recaps, public.session_reflections, public.reviews,
public.tutor_rating_summaries to authenticated;
grant select on public.tutor_rating_summaries to anon;
grant select on public.session_plans, public.session_recaps, public.reviews, public.tutor_rating_summaries to service_role;

create policy session_plans_participants on public.session_plans for select to authenticated
using (private.booking_participant(booking_id));
create policy session_recaps_participants on public.session_recaps for select to authenticated
using (private.booking_participant(booking_id));
-- The reflection is private to its student: the booked tutor's participation does not grant access.
create policy session_reflections_owner on public.session_reflections for select to authenticated
using (student_id = auth.uid() and private.has_role('student'));
create policy reviews_read on public.reviews for select to authenticated
using ((student_id = auth.uid() and private.active_actor())
  or (status = 'visible' and private.owns_tutor(tutor_id)) or private.has_role('administrator'));
create policy rating_summaries_public on public.tutor_rating_summaries for select to anon
using (private.tutor_is_public(tutor_id));
create policy rating_summaries_read on public.tutor_rating_summaries for select to authenticated
using (private.tutor_is_public(tutor_id) or private.owns_tutor(tutor_id));

revoke all on function public.save_session_goals(uuid, text, text), public.save_session_agenda(uuid, text),
public.publish_session_recap(uuid, text, text, text), public.save_session_reflection(uuid, text),
public.mark_session_completed(uuid), public.submit_review(uuid, integer, text), public.moderate_review(uuid, text, text),
public.list_public_tutor_reviews(uuid) from public, anon, authenticated;
grant execute on function public.save_session_goals(uuid, text, text), public.save_session_agenda(uuid, text),
public.publish_session_recap(uuid, text, text, text), public.save_session_reflection(uuid, text),
public.mark_session_completed(uuid), public.submit_review(uuid, integer, text), public.moderate_review(uuid, text, text)
to authenticated;
grant execute on function public.list_public_tutor_reviews(uuid) to anon, authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.tutor_is_public(uuid) to anon, authenticated;
grant execute on function private.valid_timezone(text), private.active_actor(), private.has_role(text), private.owns_tutor(uuid),
private.booking_participant(uuid), private.payment_participant(uuid) to authenticated;

commit;
