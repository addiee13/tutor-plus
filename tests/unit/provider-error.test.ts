import { describe, expect, it, vi } from "vitest";
import { providerError } from "../../src/domains/shared/errors";

describe("providerError", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});

  it("maps provider email rate limits to a specific safe message", () => {
    const error = providerError({ status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" }, "password reset email");
    expect(error.code).toBe("rateLimited");
    expect(error.message).toMatch(/wait a few minutes/);
  });

  it("keeps other provider failures generic", () => {
    expect(providerError({ status: 500, code: "unexpected_failure" }, "sign-up").code).toBe("unavailable");
  });
});
