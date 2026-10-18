import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../auth/service";
import { hasRole, type Actor } from "../auth/policy";
import { DomainError, InputError } from "../shared/errors";
import { PgErrorCode } from "../shared/postgres";
import { requireBookingActor, requireBookingParticipant, requireBookingStudent } from "./policy";
import { parseBookingRequest, parseCancellation } from "./validation";
import {
  CANCELLABLE_STATUSES,
  type AvailabilityException,
  type AvailabilityRule,
  type Booking,
  type PublicSubject,
  type PublicTutor,
  type TutorSubject,
} from "./types";

const BOOKING_FIELDS =
  "id,student_id,tutor_id,subject_id,starts_at,ends_at,mode,price_minor,platform_fee_minor,currency,status,hold_expires_at,cancellation_reason";
const TUTOR_FIELDS = "id,public_display_name,headline,hourly_rate_minor,currency,supports_virtual,supports_in_person";
const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_WINDOW_DAYS = 8;

type OwnedTutor = { id: string; public_display_name: string };
type PublicTutorSubjectRow = { subject_id: string; name: string; hourly_rate_minor: number; currency: string };

type TutorSchedules = {
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  links: TutorSubject[];
  readableSubjectTutorIds: string[];
  scheduleReadFailed: boolean;
  subjectReadFailed: boolean;
};

const EMPTY_SCHEDULES: TutorSchedules = {
  rules: [],
  exceptions: [],
  links: [],
  readableSubjectTutorIds: [],
  scheduleReadFailed: false,
  subjectReadFailed: false,
};

/** Maps SQL failures to user-facing outcomes without exposing constraint details. */
function databaseFailure(error: { code?: string }): never {
  switch (error.code) {
    case PgErrorCode.insufficientPrivilege:
      throw new DomainError("forbidden");
    case PgErrorCode.exclusionViolation:
    case PgErrorCode.uniqueViolation:
      throw new InputError({
        starts_at: "That reservation conflicts with an existing request. Choose another time or reload your bookings.",
      });
    case PgErrorCode.invalidParameterValue:
      throw new InputError({
        starts_at:
          "The reservation is no longer eligible. Check the tutor, subject, mode, notice period and buffered availability, then try again.",
      });
    default:
      throw new DomainError("unavailable");
  }
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function ownedTutors(client: SupabaseClient, actor: Actor): Promise<OwnedTutor[]> {
  if (!hasRole(actor, "tutor")) return [];
  const { data, error } = await client.from("tutor_profiles").select("id,public_display_name").eq("user_id", actor.id);
  if (error) throw new DomainError("unavailable");
  return data ?? [];
}

async function readBooking(client: SupabaseClient, id: string): Promise<Booking> {
  const { data, error } = await client.from("bookings").select(BOOKING_FIELDS).eq("id", id).maybeSingle<Booking>();
  if (error) throw new DomainError("unavailable");
  if (!data) throw new DomainError("forbidden");
  return data;
}

async function listTutorSubjects(client: SupabaseClient, tutor: string) {
  const { data, error } = await client.rpc("list_public_tutor_subjects", { tutor });
  return { tutor, data: data as PublicTutorSubjectRow[] | null, error };
}

/**
 * Reads availability and subject offerings for the listed tutors. Partial read failures are reported as flags
 * so the page can say what it could not load rather than inventing availability.
 */
async function readTutorSchedules(client: SupabaseClient, tutorIds: string[], now: number): Promise<TutorSchedules> {
  if (!tutorIds.length) return EMPTY_SCHEDULES;
  const from_date = isoDate(now - DAY_MS);
  const to_date = isoDate(now + SCHEDULE_WINDOW_DAYS * DAY_MS);
  // Availability tables are owner-only under RLS; published tutors' schedules come from public DTO functions.
  const [schedules, overrides, subjectResults] = await Promise.all([
    Promise.all(
      tutorIds.map(async (tutor) => {
        const { data, error } = await client.rpc("list_public_tutor_availability", { tutor });
        return {
          error,
          rows: ((data ?? []) as Omit<AvailabilityRule, "tutor_id">[]).map((row) => ({ ...row, tutor_id: tutor })),
        };
      }),
    ),
    Promise.all(
      tutorIds.map(async (tutor) => {
        const { data, error } = await client.rpc("list_public_tutor_exceptions", { tutor, from_date, to_date });
        return {
          error,
          rows: ((data ?? []) as Omit<AvailabilityException, "tutor_id">[]).map((row) => ({ ...row, tutor_id: tutor })),
        };
      }),
    ),
    Promise.all(tutorIds.map((tutor) => listTutorSubjects(client, tutor))),
  ]);

  const scheduleReadFailed = [...schedules, ...overrides].some((result) => Boolean(result.error));
  const readable = subjectResults.filter((result) => !result.error && Array.isArray(result.data));
  return {
    rules: scheduleReadFailed ? [] : schedules.flatMap((result) => result.rows),
    exceptions: scheduleReadFailed ? [] : overrides.flatMap((result) => result.rows),
    links: readable.flatMap(({ tutor, data }) =>
      (data ?? []).map(({ subject_id, name, hourly_rate_minor, currency }) => ({
        tutor_id: tutor,
        subject_id,
        name,
        hourly_rate_minor,
        currency,
      })),
    ),
    readableSubjectTutorIds: readable.map((result) => result.tutor),
    scheduleReadFailed,
    subjectReadFailed: subjectResults.some((result) => Boolean(result.error)),
  };
}

export async function readBookingWorkspace(client: SupabaseClient) {
  const actor = await getActor(client);
  requireBookingActor(actor);
  const now = Date.now();
  const [tutors, subjects, bookings, ownTutors] = await Promise.all([
    client.from("public_tutor_snapshots").select(TUTOR_FIELDS).order("public_display_name").limit(100),
    client.from("subjects").select("id,name").eq("active", true).order("name").limit(200),
    client.from("bookings").select(BOOKING_FIELDS).order("created_at", { ascending: false }).limit(50),
    ownedTutors(client, actor),
  ]);
  if (tutors.error || subjects.error || bookings.error) throw new DomainError("unavailable");

  const publicTutors = (tutors.data ?? []) as PublicTutor[];
  const schedules = await readTutorSchedules(
    client,
    publicTutors.map((tutor) => tutor.id),
    now,
  );

  // Defence in depth: RLS should only return participant bookings, but each row is re-authorized here.
  const ownedTutorIds = ownTutors.map((tutor) => tutor.id);
  const participantBookings = (bookings.data ?? []) as Booking[];
  participantBookings.forEach((booking) => requireBookingParticipant(actor, booking, ownedTutorIds));

  const catalog = new Map<string, PublicSubject>(
    ((subjects.data ?? []) as PublicSubject[]).map((subject) => [subject.id, subject]),
  );
  schedules.links.forEach((link) => catalog.set(link.subject_id, { id: link.subject_id, name: link.name }));

  return {
    actor,
    tutors: publicTutors.filter((tutor) => !ownedTutorIds.includes(tutor.id)),
    subjects: [...catalog.values()],
    bookings: participantBookings,
    ownTutors,
    ...schedules,
    observedAt: now,
    requestKey: randomUUID(),
  };
}

export type BookingWorkspace = Awaited<ReturnType<typeof readBookingWorkspace>>;

export async function requestBooking(client: SupabaseClient, form: FormData): Promise<Booking> {
  const actor = await getActor(client);
  requireBookingStudent(actor);
  const parsed = parseBookingRequest(form);

  const { data: tutor, error: tutorError } = await client
    .from("public_tutor_snapshots")
    .select(TUTOR_FIELDS)
    .eq("id", parsed.tutor)
    .maybeSingle<PublicTutor>();
  if (tutorError) throw new DomainError("unavailable");
  if (!tutor) throw new InputError({ tutor: "Choose a currently published tutor." });
  const supportsMode = parsed.mode === "virtual" ? tutor.supports_virtual : tutor.supports_in_person;
  if (!supportsMode) throw new InputError({ mode: "This tutor does not offer that mode." });

  const { data: subjects, error: subjectError } = await listTutorSubjects(client, parsed.tutor);
  if (subjectError) throw new DomainError("unavailable");
  if (!Array.isArray(subjects) || !subjects.some((subject) => subject.subject_id === parsed.subject)) {
    throw new InputError({ subject: "Choose an active subject offered by this tutor." });
  }

  const { data: id, error } = await client.rpc("create_booking", {
    ...parsed,
    request_key: parsed.request_key ?? randomUUID(),
  });
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
  requireBookingParticipant(
    actor,
    booking,
    own.map((tutor) => tutor.id),
  );
  // An already-cancelled booking is passed through so a retried submission stays idempotent.
  if (booking.status !== "cancelled" && !CANCELLABLE_STATUSES.includes(booking.status)) {
    throw new InputError({ reason: "This reservation can no longer be cancelled." });
  }

  const { error } = await client.rpc("cancel_booking", parsed);
  if (error) {
    if (error.code === PgErrorCode.invalidParameterValue) {
      throw new InputError({
        reason: "This reservation changed and can no longer be cancelled. Refresh your bookings.",
      });
    }
    databaseFailure(error);
  }

  const saved = await readBooking(client, parsed.booking);
  if (saved.status !== "cancelled") throw new DomainError("unavailable");
  return saved;
}
