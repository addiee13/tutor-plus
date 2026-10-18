import { hasRole, type Actor } from "../auth/policy";
import type { Booking } from "../bookings/types";
import { DomainError } from "../shared/errors";
import type { SessionPermissions, SessionPhase, SessionRole } from "./types";

type BookingFacts = Pick<Booking, "student_id" | "tutor_id" | "status" | "ends_at">;

/** Resolves the actor's side of the booking; anyone else is refused even if they know the booking ID. */
export function resolveSessionRole(
  actor: Actor,
  booking: Pick<Booking, "student_id" | "tutor_id">,
  ownedTutorIds: readonly string[],
): SessionRole {
  if (hasRole(actor, "student") && booking.student_id === actor.id) return "student";
  if (hasRole(actor, "tutor") && ownedTutorIds.includes(booking.tutor_id)) return "tutor";
  throw new DomainError("forbidden");
}

export function sessionPhase(booking: Pick<BookingFacts, "status" | "ends_at">, now: number): SessionPhase {
  if (booking.status === "completed") return "completed";
  if (booking.status === "confirmed" || booking.status === "in_progress") {
    return Date.parse(booking.ends_at) <= now ? "ended" : "planning";
  }
  return "unavailable";
}

/** Mirrors the database rules so the UI only offers actions the SQL functions will accept. */
export function sessionPermissions(role: SessionRole, phase: SessionPhase): SessionPermissions {
  const afterSession = phase === "ended" || phase === "completed";
  return Object.freeze({
    editGoals: role === "student" && phase === "planning",
    editAgenda: role === "tutor" && phase === "planning",
    markCompleted: role === "tutor" && phase === "ended",
    publishRecap: role === "tutor" && afterSession,
    writeReflection: role === "student" && afterSession,
  });
}

export function requireSessionPermission(permissions: SessionPermissions, action: keyof SessionPermissions): void {
  if (!permissions[action]) throw new DomainError("forbidden");
}
