import { DomainError } from "../shared/errors";

export const ABSOLUTE_SESSION_MS = 24 * 60 * 60 * 1000;
export const roles = ["student", "tutor", "administrator"] as const;
export type Role = typeof roles[number];
export type Actor = Readonly<{ id: string; roles: readonly Role[]; sessionStartedAt: string }>;

export function assertSessionAge(startedAt: unknown, now = Date.now()): void {
  if (typeof startedAt !== "string") throw new DomainError("expired");
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started) || started > now || now - started >= ABSOLUTE_SESSION_MS) throw new DomainError("expired");
}

export function resolveActor(input: { id: string; emailConfirmed: boolean; status: string; adultAttested: boolean; roles: unknown[]; sessionStartedAt: unknown }, now = Date.now()): Actor {
  if (!input.emailConfirmed) throw new DomainError("unverified");
  assertSessionAge(input.sessionStartedAt, now);
  if (input.status !== "active" || input.adultAttested !== true) throw new DomainError("forbidden");
  const currentRoles = input.roles.filter((role): role is Role => typeof role === "string" && roles.includes(role as Role));
  if (!currentRoles.length) throw new DomainError("forbidden");
  return Object.freeze({ id: input.id, roles: Object.freeze(currentRoles), sessionStartedAt: input.sessionStartedAt as string });
}

export function requireRole(actor: Actor, role: Role): void {
  if (!actor.roles.includes(role)) throw new DomainError("forbidden");
}

export function requireOwner(actor: Actor, ownerId: string): void {
  if (actor.id !== ownerId) throw new DomainError("forbidden");
}
