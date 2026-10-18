import type { ActionState } from "../shared/errors";

export const bookingModes = ["virtual", "in_person"] as const;
export type BookingMode = (typeof bookingModes)[number];

export type BookingStatus = "draft" | "payment_pending" | "confirmed" | "in_progress" | "completed" | "cancelled";

/** Statuses a participant may still cancel from the UI. */
export const CANCELLABLE_STATUSES: readonly BookingStatus[] = ["draft", "payment_pending", "confirmed"];

export type PublicTutor = {
  id: string;
  public_display_name: string;
  headline: string;
  hourly_rate_minor: number;
  currency: string;
  supports_virtual: boolean;
  supports_in_person: boolean;
};

export type PublicSubject = { id: string; name: string };

export type TutorSubject = {
  tutor_id: string;
  subject_id: string;
  name: string;
  hourly_rate_minor: number;
  currency: string;
};

export type AvailabilityRule = {
  tutor_id: string;
  weekday: number;
  local_start: string;
  local_end: string;
  timezone: string;
  valid_from: string;
  valid_until: string | null;
};

export type AvailabilityException = {
  tutor_id: string;
  local_date: string;
  local_start: string | null;
  local_end: string | null;
  timezone: string;
  exception_type: "additional" | "unavailable";
};

export type Booking = {
  id: string;
  student_id: string;
  tutor_id: string;
  subject_id: string;
  starts_at: string;
  ends_at: string;
  mode: BookingMode;
  price_minor: number;
  platform_fee_minor: number;
  currency: string;
  status: BookingStatus;
  hold_expires_at: string | null;
  cancellation_reason: string | null;
};

export type BookingActionState = ActionState & { bookingId?: string };
