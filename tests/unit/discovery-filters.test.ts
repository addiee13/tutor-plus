import { describe, it, expect } from "vitest";
import { parseDiscoveryQuery } from "../../src/app/tutors/filters";
import { InputError } from "../../src/domains/shared/errors";

describe("public discovery query boundary", () => {
  it("preserves explicit subject, mode, budget, location and slot constraints", () => {
    const filters = parseDiscoveryQuery({
      subject: "a0000000-0000-4000-8000-000000000001",
      mode: "virtual",
      rate: "25.50",
      minRate: "20.10",
      latitude: "40.7",
      longitude: "-74",
      radius: "15",
      availableAt: "2026-12-01T14:00:00Z",
      duration: "60",
      page: "2",
    });
    expect(filters).toMatchObject({
      subjectId: "a0000000-0000-4000-8000-000000000001",
      mode: "virtual",
      maxHourlyRateMinor: 2550,
      minHourlyRateMinor: 2010,
      near: { latitude: 40.7, longitude: -74, radiusKm: 15 },
      availableAt: "2026-12-01T14:00:00.000Z",
      durationMinutes: 60,
      page: 2,
      pageSize: 12,
    });
  });
  it.each([
    { latitude: "40" },
    { longitude: "-74", radius: "15" },
    { mode: "unknown" },
    { rate: "NaN" },
    { minRate: "30", rate: "20" },
    { minRate: ["20", "30"] },
    { rate: "25.005" },
    { page: "-1" },
    { mode: ["virtual", "in_person"] },
    { availableAt: "2026-12-01T14:00:00Z" },
    { duration: "60" },
    { sort: "distance" },
  ])("rejects constraints that would otherwise broaden or corrupt results: %j", (query) => {
    expect(() => parseDiscoveryQuery(query)).toThrow(InputError);
  });
  it("uses a bounded unpriced page with the UI's explicit USD budget context", () => {
    expect(parseDiscoveryQuery({})).toEqual({ budgetCurrency: "USD", page: 1, pageSize: 12, sort: "relevance" });
  });
});
