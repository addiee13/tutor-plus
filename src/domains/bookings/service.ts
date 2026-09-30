import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../auth/service";
import type { Actor } from "../auth/policy";
import { DomainError } from "../shared/errors";
import { requireBookingActor, requireBookingParticipant, requireBookingStudent } from "./policy";
import { BookingInputError, parseBookingRequest, parseCancellation } from "./validation";
import type { AvailabilityException, AvailabilityRule, Booking, PublicSubject, PublicTutor, TutorSubject } from "./types";

const bookingFields = "id,student_id,tutor_id,subject_id,starts_at,ends_at,mode,price_minor,platform_fee_minor,currency,status,hold_expires_at,cancellation_reason";
const tutorFields = "id,public_display_name,headline,hourly_rate_minor,currency,supports_virtual,supports_in_person";

function databaseFailure(error: { code?: string }): never {
  if (error.code === "42501") throw new DomainError("forbidden");
  if (error.code === "23P01" || error.code === "23505") {
    throw new BookingInputError({ starts_at: "That reservation conflicts with an existing request. Choose another time or reload your bookings." });
  }
  if (error.code === "22023") {
    throw new BookingInputError({ starts_at: "The reservation is no longer eligible. Check the tutor, subject, mode, notice period and buffered availability, then try again." });
  }
  throw new DomainError("unavailable");
}

async function ownedTutors(client: SupabaseClient, actor: Actor): Promise<{ id: string; public_display_name: string }[]> {
  if (!actor.roles.includes("tutor")) return [];
  const { data, error } = await client.from("tutor_profiles").select("id,public_display_name").eq("user_id", actor.id);
  if (error) throw new DomainError("unavailable");
  return data ?? [];
}

async function readBooking(client: SupabaseClient, id: string): Promise<Booking> {
  const { data, error } = await client.from("bookings").select(bookingFields).eq("id", id).maybeSingle();
  if (error) throw new DomainError("unavailable");
  if (!data) throw new DomainError("forbidden");
  return data as Booking;
}

export async function readBookingWorkspace(client: SupabaseClient) {
  const actor = await getActor(client);
  requireBookingActor(actor);
  const [tutors, subjects, bookings, own] = await Promise.all([
    client.from("public_tutor_snapshots").select(tutorFields).order("public_display_name").limit(100),
    client.from("subjects").select("id,name").eq("active", true).order("name").limit(200),
    client.from("bookings").select(bookingFields).order("created_at", { ascending: false }).limit(50),
    ownedTutors(client, actor)
  ]);
  if (tutors.error || subjects.error || bookings.error) throw new DomainError("unavailable");
  const publicTutors = (tutors.data ?? []) as PublicTutor[];
  const tutorIds = publicTutors.map((tutor) => tutor.id);
  let rules: AvailabilityRule[] = [];
  let exceptions: AvailabilityException[] = [];
  let links: TutorSubject[] = [];
  const readableSubjectTutorIds: string[] = [];
  let scheduleReadFailed = false;
  let subjectReadFailed = false;
  if (tutorIds.length) {
    const [schedule, overrides, linkedSubjects] = await Promise.all([
      client.from("availability_rules").select("tutor_id,weekday,local_start,local_end,timezone,valid_from,valid_until").in("tutor_id", tutorIds).eq("active", true).order("weekday").limit(1000),
      client.from("availability_exceptions").select("tutor_id,local_date,local_start,local_end,timezone,exception_type").in("tutor_id", tutorIds).gte("local_date", new Date(Date.now() - 86400000).toISOString().slice(0, 10)).lte("local_date", new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10)).order("local_date").limit(1000),
      Promise.all(tutorIds.map(async (tutor) => ({ tutor, ...await client.rpc("list_public_tutor_subjects", { tutor }) })))
    ]);
    scheduleReadFailed = !!(schedule.error || overrides.error);
    subjectReadFailed = linkedSubjects.some((result) => !!result.error);
    if (!scheduleReadFailed) {
      rules = (schedule.data ?? []) as AvailabilityRule[];
      exceptions = (overrides.data ?? []) as AvailabilityException[];
    }
    links = linkedSubjects.flatMap((result) => {
      if (result.error || !Array.isArray(result.data)) return [];
      readableSubjectTutorIds.push(result.tutor);
      return result.data.map((subject) => ({ tutor_id: result.tutor, subject_id: subject.subject_id, name: subject.name, hourly_rate_minor: subject.hourly_rate_minor, currency: subject.currency })) as TutorSubject[];
    });
  }
  const ownedTutorIds = own.map((tutor) => tutor.id);
  const participantBookings = (bookings.data ?? []) as Booking[];
  participantBookings.forEach((booking) => requireBookingParticipant(actor, booking, ownedTutorIds));
  const catalog = new Map<string, PublicSubject>((subjects.data ?? []).map((subject) => [subject.id, subject as PublicSubject]));
  links.forEach((link) => catalog.set(link.subject_id, { id: link.subject_id, name: link.name }));
  return { actor, tutors: publicTutors.filter((tutor) => !ownedTutorIds.includes(tutor.id)), subjects: [...catalog.values()], bookings: participantBookings, ownTutors: own, rules, exceptions, links, readableSubjectTutorIds, scheduleReadFailed, subjectReadFailed, observedAt: Date.now(), requestKey: randomUUID() };
}

export async function requestBooking(client: SupabaseClient, form: FormData): Promise<Booking> {
  const actor = await getActor(client);
  requireBookingStudent(actor);
  const parsed = parseBookingRequest(form);
  const { data: tutor, error: tutorError } = await client.from("public_tutor_snapshots").select(tutorFields).eq("id", parsed.tutor).maybeSingle();
  if (tutorError) throw new DomainError("unavailable");
  if (!tutor) throw new BookingInputError({ tutor: "Choose a currently published tutor." });
  if (!(parsed.mode === "virtual" ? tutor.supports_virtual : tutor.supports_in_person)) throw new BookingInputError({ mode: "This tutor does not offer that mode." });
  const { data: subjects, error: subjectError } = await client.rpc("list_public_tutor_subjects", { tutor: parsed.tutor });
  if (subjectError) throw new DomainError("unavailable");
  if (!Array.isArray(subjects) || !subjects.some((subject) => subject.subject_id === parsed.subject)) throw new BookingInputError({ subject: "Choose an active subject offered by this tutor." });
  const { data: id, error } = await client.rpc("create_booking", { ...parsed, request_key: parsed.request_key ?? randomUUID() });
  if (error) databaseFailure(error);
  if (typeof id !== "string") throw new DomainError("unavailable");
  const saved = await readBooking(client, id);
  requireBookingParticipant(actor, saved, []);
  return saved;
}

export async function cancelBooking(client: SupabaseClient, form: FormData): Promise<Booking> {
  const actor = await getActor(client);
  requireBookingActor(actor);
  const parsed = parseCancellation(form);
  const [booking, own] = await Promise.all([readBooking(client, parsed.booking), ownedTutors(client, actor)]);
  requireBookingParticipant(actor, booking, own.map((tutor) => tutor.id));
  if (!["draft", "payment_pending", "confirmed", "cancelled"].includes(booking.status)) {
    throw new BookingInputError({ reason: "This reservation can no longer be cancelled." });
  }
  const { error } = await client.rpc("cancel_booking", parsed);
  if (error) {
    if (error.code === "22023") throw new BookingInputError({ reason: "This reservation changed and can no longer be cancelled. Refresh your bookings." });
    databaseFailure(error);
  }
  const saved = await readBooking(client, parsed.booking);
  if (saved.status !== "cancelled") throw new DomainError("unavailable");
  return saved;
}
