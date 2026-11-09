import { describe, expect, it } from "vitest";
import { parseOtp, parseSignup } from "../../src/domains/auth/validation";
const form = (values: Record<string, string>) => {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
};
const valid = {
  display_name: "Boundary Learner",
  email: "boundary@example.test",
  password: "A7!bcDefGh12",
  timezone: "UTC",
  adult_attested: "on",
  role_intent: "student",
};
describe("Sprint4 1.2 exact registration partitions", () => {
  it.each([12, 128])("permits the documented %i character password boundary", (length) => {
    const password = "x".repeat(length);
    expect(parseSignup(form({ ...valid, password })).password).toBe(password);
  });
  it.each([11, 129])("refuses the documented %i character password boundary", (length) => {
    expect(() => parseSignup(form({ ...valid, password: "x".repeat(length) }))).toThrow();
  });
  it.each([{ email: "alex@" }, { adult_attested: "" }, { role_intent: "administrator" }])(
    "refuses an invalid registration partition %j",
    (variant) => {
      expect(() => parseSignup(form({ ...valid, ...variant }))).toThrow();
    },
  );
});
describe("Sprint4 1.11 code shape is separate from provider authority", () => {
  it.each(["123456", "1234567", "12345678"])("accepts the syntactic code %s without claiming authentication", (code) =>
    expect(parseOtp(form({ code }))).toBe(code),
  );
  it.each(["12345", "123456789", "12x456"])("refuses malformed code %s before provider access", (code) =>
    expect(() => parseOtp(form({ code }))).toThrow(),
  );
});
