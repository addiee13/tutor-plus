import { describe, expect, it } from "vitest";
import { admittedDestination, safeAuthReturn, withAuthReturn } from "../../src/lib/auth-return";

describe("post-auth application destinations", () => {
  it("preserves the tutor selection and additional booking context", () => {
    const path = "/bookings?tutor=631607ae-1598-432d-b94c-ed8d8f41dc79&subject=math";
    expect(safeAuthReturn(path)).toBe(path);
    const login = withAuthReturn("/login?notice=expired", path);
    const parsed = new URL(login, "https://tutorplus.invalid");
    expect(parsed.searchParams.get("notice")).toBe("expired");
    expect(parsed.searchParams.get("next")).toBe(path);
    expect(admittedDestination("/dashboard", parsed.searchParams.get("next"))).toBe(path);
  });
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/%2f%2fevil.example",
    "/bookings/%5cevil",
    "/bookings/../auth/callback",
    "/auth/callback",
    "/login",
    "/bookings\nLocation: https://evil.example",
    "",
    null,
    ["/bookings"],
  ])("rejects an unsafe or unsupported destination: %s", (value) => {
    expect(safeAuthReturn(value)).toBeUndefined();
    expect(admittedDestination("/dashboard", value)).toBe("/dashboard");
  });
  it("keeps account admission gates authoritative while carrying a destination through onboarding", () => {
    expect(admittedDestination("/welcome", "/bookings?tutor=t1")).toBe("/welcome?next=%2Fbookings%3Ftutor%3Dt1");
    expect(admittedDestination("/login?notice=access-denied", "/bookings")).toBe("/login?notice=access-denied");
    expect(withAuthReturn("/auth/callback", "https://evil.example")).toBe("/auth/callback");
  });
});
