import { describe, expect, it } from "vitest";
import { ABSOLUTE_SESSION_MS, assertSessionAge, requireOwner, requireRole, resolveActor } from "../../src/domains/auth/policy";

const now = Date.parse("2026-09-30T18:00:00.000Z");
const base = { id: "user-1", emailConfirmed: true, status: "active", adultAttested: true, roles: ["student"], sessionStartedAt: new Date(now - 60_000).toISOString() };

describe("UC-01 absolute session policy", () => {
  it("permits a verified, active adult with current database roles", () => {
    expect(resolveActor(base, now).roles).toEqual(["student"]);
  });
  it("ends at exactly 24 hours, not after a sliding refresh", () => {
    const start = new Date(now - ABSOLUTE_SESSION_MS).toISOString();
    expect(() => assertSessionAge(start, now)).toThrow("session has ended");
    expect(() => assertSessionAge(start, now - 1)).not.toThrow();
    const refreshedTokenIssuedAt = new Date(now - 1000).toISOString();
    expect(() => resolveActor({ ...base, sessionStartedAt: start, tokenIssuedAt: refreshedTokenIssuedAt } as typeof base, now)).toThrow("session has ended");
  });
  it.each([null, undefined, "", "not-a-date", 0, new Date(now + 1).toISOString()])("fails closed on missing, malformed, or future anchors: %s", (anchor) => {
    expect(() => assertSessionAge(anchor, now)).toThrow();
  });
  it("requires verified email, active status and adult attestation", () => {
    expect(() => resolveActor({ ...base, emailConfirmed: false }, now)).toThrow("verify your email");
    expect(() => resolveActor({ ...base, status: "inactive" }, now)).toThrow("not available");
    expect(() => resolveActor({ ...base, adultAttested: false }, now)).toThrow("not available");
  });
  it("uses capabilities rather than mutually exclusive account subclasses", () => {
    const actor = resolveActor({ ...base, roles: ["student", "tutor", "superuser"] }, now);
    expect(actor.roles).toEqual(["student", "tutor"]);
    expect(() => requireRole(actor, "tutor")).not.toThrow();
    expect(() => requireRole(actor, "administrator")).toThrow();
  });
  it("denies removed and invented roles and cross-account writes", () => {
    expect(() => resolveActor({ ...base, roles: [] }, now)).toThrow();
    expect(() => resolveActor({ ...base, roles: ["superuser"] }, now)).toThrow();
    expect(() => requireOwner(resolveActor(base, now), "user-2")).toThrow();
  });
  it("does not expose a mutable actor capability list", () => {
    const actor = resolveActor(base, now);
    expect(Object.isFrozen(actor)).toBe(true);
    expect(Object.isFrozen(actor.roles)).toBe(true);
  });
  it("recognizes the database administrator vocabulary", () => {
    expect(() => requireRole(resolveActor({ ...base, roles: ["administrator"] }, now), "administrator")).not.toThrow();
  });
});
