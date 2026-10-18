import { canBook, hasRole, requireRole, type Actor } from "../auth/policy";
import { DomainError } from "../shared/errors";
import type { Booking } from "./types";

export function requireBookingActor(actor: Actor): void {
  if (!canBook(actor)) throw new DomainError("forbidden");
}

export function requireBookingStudent(actor: Actor): void {
  requireRole(actor, "student");
}

export function requireBookingParticipant(
  actor: Actor,
  booking: Pick<Booking, "student_id" | "tutor_id">,
  ownedTutorIds: readonly string[],
): void {
  requireBookingActor(actor);
  const isStudent = hasRole(actor, "student") && actor.id === booking.student_id;
  const isTutor = hasRole(actor, "tutor") && ownedTutorIds.includes(booking.tutor_id);
  if (!isStudent && !isTutor) throw new DomainError("forbidden");
}
