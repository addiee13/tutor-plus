import { hasRole, type Actor } from "../auth/policy";
import type { Booking } from "../bookings/types";
import { DomainError } from "../shared/errors";

/** Only the booked student may review a session. Completion and uniqueness are reported as field errors. */
export function requireReviewAuthor(actor: Actor, booking: Pick<Booking, "student_id">): void {
  if (!hasRole(actor, "student") || booking.student_id !== actor.id) throw new DomainError("forbidden");
}

export function isReviewable(booking: Pick<Booking, "status">): boolean {
  return booking.status === "completed";
}

export function canReview(actor: Actor): boolean {
  return hasRole(actor, "student");
}

export function canViewReputation(actor: Actor): boolean {
  return hasRole(actor, "tutor");
}

/** Formats a server-computed average for display; there is no client-side recalculation. */
export function describeRating(summary: { rating_count: number; rating_avg: number | null } | null): string {
  if (!summary || summary.rating_count === 0 || summary.rating_avg === null) return "No reviews yet";
  const reviews = summary.rating_count === 1 ? "review" : "reviews";
  return `${Number(summary.rating_avg).toFixed(1)} out of 5 · ${summary.rating_count} ${reviews}`;
}
