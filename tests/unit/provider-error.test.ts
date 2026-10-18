import { describe, expect, it } from "vitest";
import { providerError, safeMessage } from "../../src/domains/shared/errors";

describe("provider failures", () => {
  it.each([{ status: 429 }, { code: "over_email_send_rate_limit" }, { code: "over_request_rate_limit" }])(
    "identifies rate limits safely: %j",
    (failure) => {
      expect(providerError(failure).code).toBe("rateLimited");
      expect(safeMessage(providerError(failure))).toMatch(/wait before trying again/i);
    },
  );

  it("keeps provider internals out of user-facing errors", () => {
    expect(providerError({ status: 500, code: "unexpected_failure" }).code).toBe("unavailable");
  });
});
