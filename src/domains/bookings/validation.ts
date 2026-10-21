import { InputError } from "../shared/errors";
import { readText } from "../shared/form";
import { bookingModes, type BookingMode } from "./types";

export { bookingModes, type BookingMode };

const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 180;
const REASON_MAX = 500;
const MS_PER_MINUTE = 60_000;

const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/;

export function parseBookingId(value: unknown, field = "booking"): string {
  if (typeof value !== "string" || !RECORD_ID.test(value)) {
    throw new InputError({ [field]: "Choose a valid record." });
  }
  return value.toLowerCase();
}

/** Accepts only strict ISO UTC input and rejects values that `Date` would silently roll over (e.g. Feb 30). */
export function parseUtcTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_UTC.test(value)) {
    throw new InputError({ [field]: "Enter an ISO UTC time ending in Z, such as 2026-10-02T14:00:00Z." });
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new InputError({ [field]: "Enter a real UTC date and time." });
  const normalized = new Date(timestamp).toISOString();
  const expected = value
    .replace(/T(\d{2}:\d{2})Z$/, "T$1:00Z")
    .replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction: string | undefined) => `.${(fraction ?? "").padEnd(3, "0")}Z`);
  if (normalized !== expected) throw new InputError({ [field]: "Enter a real UTC date and time." });
  return normalized;
}

function parseRequestKey(form: FormData): string | undefined {
  const submitted = form.get("request_key");
  if (submitted === null) return undefined;
  if (typeof submitted !== "string" || !REQUEST_KEY.test(submitted)) {
    throw new InputError({ request_key: "Reload the form to obtain a valid request key." });
  }
  return submitted.toLowerCase();
}

export function parseBookingRequest(form: FormData, now = Date.now()) {
  const tutor = parseBookingId(readText(form, "tutor"), "tutor");
  const subject = parseBookingId(readText(form, "subject"), "subject");
  const starts_at = parseUtcTimestamp(readText(form, "starts_at"), "starts_at");
  const ends_at = parseUtcTimestamp(readText(form, "ends_at"), "ends_at");
  if (Date.parse(starts_at) <= now) throw new InputError({ starts_at: "Choose a future UTC start time." });
  const durationMinutes = (Date.parse(ends_at) - Date.parse(starts_at)) / MS_PER_MINUTE;
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < MIN_DURATION_MINUTES ||
    durationMinutes > MAX_DURATION_MINUTES
  ) {
    throw new InputError({
      ends_at: `Choose a whole-minute duration between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes.`,
    });
  }
  const mode = readText(form, "mode");
  if (!bookingModes.includes(mode as BookingMode)) {
    throw new InputError({ mode: "Choose virtual or in-person tutoring." });
  }
  return { tutor, subject, starts_at, ends_at, mode: mode as BookingMode, request_key: parseRequestKey(form) };
}

/** Validates a slot lookup; the duration must be a whole number of minutes inside the booking policy. */
export function parseSlotQuery(tutor: unknown, duration: unknown) {
  const parsedTutor = parseBookingId(tutor, "tutor");
  if (
    typeof duration !== "number" ||
    !Number.isInteger(duration) ||
    duration < MIN_DURATION_MINUTES ||
    duration > MAX_DURATION_MINUTES
  ) {
    throw new InputError({
      duration: `Choose a session length between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes.`,
    });
  }
  return { tutor: parsedTutor, duration };
}

export function parseCancellation(form: FormData) {
  const booking = parseBookingId(readText(form, "booking"));
  const reason = readText(form, "reason");
  if (!reason || reason.length > REASON_MAX) {
    throw new InputError({ reason: `Enter a cancellation reason between 1 and ${REASON_MAX} characters.` });
  }
  return { booking, reason };
}
