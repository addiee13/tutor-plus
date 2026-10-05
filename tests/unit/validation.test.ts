import { describe, expect, it } from "vitest";
import { isTimeZone, parseEmail, parsePassword, parseProfile, parseRoleChange, parseSignup, parseStatusChange } from "../../src/domains/auth/validation";
import { DomainError, safeMessage } from "../../src/domains/shared/errors";

function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

const valid = { display_name: "Alex Learner", email: "ALEX@example.com", password: "a-secure-long-password", role_intent: "student", timezone: "America/New_York", adult_attested: "on" };

describe("UC-01 registration validation", () => {
  it("normalizes email and accepts Student or Tutor intent only", () => {
    expect(parseSignup(form(valid))).toEqual({ ...valid, email: "alex@example.com", adult_attested: true });
    expect(parseSignup(form({ ...valid, role_intent: "tutor" })).role_intent).toBe("tutor");
    expect(() => parseSignup(form({ ...valid, role_intent: "administrator" }))).toThrow();
  });
  it("rejects missing adult attestation and short passwords", () => {
    expect(() => parseSignup(form({ ...valid, adult_attested: "true" }))).toThrow();
    expect(() => parseSignup(form({ ...valid, password: "short" }))).toThrow();
  });
  it("does not trim passwords", () => {
    const password = "  significant spaces  ";
    expect(parsePassword(form({ password }))).toBe(password);
  });
  it.each(["not-email", "a@@b.com", "a b@example.com", "@example.com", "user@example"]) ("rejects malformed email %s", (email) => {
    expect(() => parseEmail(form({ email }))).toThrow();
  });
  it("rejects File payloads in text fields", () => {
    const payload = form(valid);
    payload.set("password", new File(["fake"], "password.txt"));
    expect(() => parseSignup(payload)).toThrow();
  });
});

describe("UC-02 profile validation", () => {
  it("whitelists fields, ignoring identity, status, roles and attestation spoofing", () => {
    const fields = parseProfile(form({ display_name: "  Alex  ", timezone: "UTC", id: "victim", status: "active", role: "administrator", adult_attested: "false" }));
    expect(fields).toEqual({ display_name: "Alex", timezone: "UTC" });
  });
  it.each(["UTC", "America/New_York", "Europe/London", "Asia/Kolkata"]) ("accepts IANA zone %s", (timezone) => expect(isTimeZone(timezone)).toBe(true));
  it.each(["", "Not/AZone", "GMT+99", "EST", "PST", "+05:30"]) ("rejects invalid or ambiguous zone %s", (timezone) => expect(isTimeZone(timezone)).toBe(false));
  it("rejects overly long names, blank names and control characters", () => {
    for (const display_name of [" ", "a", "x".repeat(81), "Alice\nAdmin"]) expect(() => parseProfile(form({ display_name, timezone: "UTC" }))).toThrow();
  });
});

describe("Administration and safe errors", () => {
  it("accepts only UUID targets, known roles and explicit grant/revoke operations", () => {
    const payload = { target: "12345678-1234-1234-1234-123456789abc", requested_role: "administrator", operation: "grant" };
    expect(parseRoleChange(form(payload))).toEqual(payload);
    expect(() => parseRoleChange(form({ ...payload, target: "x; drop table profiles" }))).toThrow();
    expect(() => parseRoleChange(form({ ...payload, requested_role: "superuser" }))).toThrow();
  });
  it("does not forward raw provider/database errors", () => {
    expect(safeMessage(new Error("JWT secret / backend failed at https://private.provider"))).not.toMatch(/JWT|backend|private|provider/i);
    expect(safeMessage(new DomainError("credentials"))).toMatch(/Check your details/);
  });
  it("bounds audited account-status changes", () => {
    const payload = { status_target: "12345678-1234-1234-1234-123456789abc", requested_status: "inactive", reason: "Requested account deactivation" };
    expect(parseStatusChange(form(payload))).toEqual({ target: payload.status_target, requested_status: "inactive", reason: payload.reason });
    expect(() => parseStatusChange(form({ ...payload, reason: "" }))).toThrow();
    expect(() => parseStatusChange(form({ ...payload, requested_status: "deleted" }))).toThrow();
  });
});
