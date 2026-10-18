import { DomainError } from "../shared/errors";

export const ABSOLUTE_SESSION_MS = 24 * 60 * 60 * 1000;
export const roles = ["student", "tutor", "administrator"] as const;
export type Role = (typeof roles)[number];
export type Actor = Readonly<{ id: string; roles: readonly Role[]; sessionStartedAt: string }>;

type ActorInput = {
  id: string;
  emailConfirmed: boolean;
  status: string;
  adultAttested: boolean;
  roles: unknown[];
  sessionStartedAt: unknown;
};

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (roles as readonly string[]).includes(value);
}

export function assertSessionAge(startedAt: unknown, now = Date.now()): asserts startedAt is string {
  if (typeof startedAt !== "string") throw new DomainError("expired");
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started) || started > now || now - started >= ABSOLUTE_SESSION_MS) {
    throw new DomainError("expired");
  }
}

export function resolveActor(input: ActorInput, now = Date.now()): Actor {
  if (!input.emailConfirmed) throw new DomainError("unverified");
  assertSessionAge(input.sessionStartedAt, now);
  if (input.status !== "active" || input.adultAttested !== true) throw new DomainError("forbidden");
  const currentRoles = input.roles.filter(isRole);
  if (!currentRoles.length) throw new DomainError("forbidden");
  return Object.freeze({
    id: input.id,
    roles: Object.freeze(currentRoles),
    sessionStartedAt: input.sessionStartedAt,
  });
}

export function hasRole(actor: Actor, role: Role): boolean {
  return actor.roles.includes(role);
}

/** Students and tutors take part in bookings; administrators alone do not. */
export function canBook(actor: Actor): boolean {
  return hasRole(actor, "student") || hasRole(actor, "tutor");
}

export function requireRole(actor: Actor, role: Role): void {
  if (!hasRole(actor, role)) throw new DomainError("forbidden");
}

export function requireOwner(actor: Actor, ownerId: string): void {
  if (actor.id !== ownerId) throw new DomainError("forbidden");
}
