import type { ActionState } from "../shared/errors";

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
export type TutorSubject = { tutor_id: string; subject_id: string; name: string; hourly_rate_minor: number; currency: string };
export type AvailabilityRule = { tutor_id: string; weekday: number; local_start: string; local_end: string; timezone: string; valid_from: string; valid_until: string | null };
export type AvailabilityException = { tutor_id: string; local_date: string; local_start: string | null; local_end: string | null; timezone: string; exception_type: "additional" | "unavailable" };
export type Booking = {
  id: string;
  student_id: string;
  tutor_id: string;
  subject_id: string;
  starts_at: string;
  ends_at: string;
  mode: "virtual" | "in_person";
  price_minor: number;
  platform_fee_minor: number;
  currency: string;
  status: "draft" | "payment_pending" | "confirmed" | "in_progress" | "completed" | "cancelled";
  hold_expires_at: string | null;
  cancellation_reason: string | null;
};
export type BookingActionState = ActionState & { bookingId?: string };
