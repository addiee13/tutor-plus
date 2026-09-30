import type { Actor } from "../auth/policy";
import { requireRole } from "../auth/policy";
import { DomainError } from "../shared/errors";

export function requireBookingActor(actor: Actor): void {
  if (!actor.roles.includes("student") && !actor.roles.includes("tutor")) throw new DomainError("forbidden");
}

export function requireBookingStudent(actor: Actor): void {
  requireRole(actor, "student");
}

export function requireBookingParticipant(actor: Actor, booking: { student_id: string; tutor_id: string }, ownedTutorIds: readonly string[]): void {
  requireBookingActor(actor);
  if ((actor.roles.includes("student") && actor.id === booking.student_id)
    || (actor.roles.includes("tutor") && ownedTutorIds.includes(booking.tutor_id))) return;
  throw new DomainError("forbidden");
}
