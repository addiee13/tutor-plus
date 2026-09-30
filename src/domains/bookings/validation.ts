import { DomainError } from "../shared/errors";

export class BookingInputError extends DomainError {
  constructor(public readonly fields: Record<string, string>) { super("validation"); }
}

const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestKey = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const bookingModes = ["virtual", "in_person"] as const;
export type BookingMode = typeof bookingModes[number];

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function parseBookingId(value: unknown, field = "booking"): string {
  if (typeof value !== "string" || !identifier.test(value)) {
    throw new BookingInputError({ [field]: "Choose a valid record." });
  }
  return value.toLowerCase();
}

export function parseUtcTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)) {
    throw new BookingInputError({ [field]: "Enter an ISO UTC time ending in Z, such as 2026-10-02T14:00:00Z." });
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new BookingInputError({ [field]: "Enter a real UTC date and time." });
  const normalized = new Date(timestamp).toISOString();
  const expected = value.replace(/T(\d{2}:\d{2})Z$/, "T$1:00Z").replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction: string | undefined) => `.${(fraction ?? "").padEnd(3, "0")}Z`);
  if (normalized !== expected) throw new BookingInputError({ [field]: "Enter a real UTC date and time." });
  return normalized;
}

export function parseBookingRequest(form: FormData, now = Date.now()) {
  const tutor = parseBookingId(text(form, "tutor"), "tutor");
  const subject = parseBookingId(text(form, "subject"), "subject");
  const starts_at = parseUtcTimestamp(text(form, "starts_at"), "starts_at");
  const ends_at = parseUtcTimestamp(text(form, "ends_at"), "ends_at");
  if (Date.parse(starts_at) <= now) throw new BookingInputError({ starts_at: "Choose a future UTC start time." });
  const durationMinutes = (Date.parse(ends_at) - Date.parse(starts_at)) / 60000;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 180) {
    throw new BookingInputError({ ends_at: "Choose a whole-minute duration between 15 and 180 minutes." });
  }
  const mode = text(form, "mode");
  if (!bookingModes.includes(mode as BookingMode)) throw new BookingInputError({ mode: "Choose virtual or in-person tutoring." });
  const submittedKey = form.get("request_key");
  if (submittedKey !== null && (typeof submittedKey !== "string" || !requestKey.test(submittedKey))) {
    throw new BookingInputError({ request_key: "Reload the form to obtain a valid request key." });
  }
  return { tutor, subject, starts_at, ends_at, mode: mode as BookingMode, request_key: typeof submittedKey === "string" ? submittedKey.toLowerCase() : undefined };
}

export function parseCancellation(form: FormData) {
  const booking = parseBookingId(text(form, "booking"));
  const reason = text(form, "reason");
  if (!reason || reason.length > 500) throw new BookingInputError({ reason: "Enter a cancellation reason between 1 and 500 characters." });
  return { booking, reason };
}
