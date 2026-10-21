import { describe, expect, it } from "vitest";
import { sessionHourCoverage } from "../../src/domains/bookings/presentation";

describe("selected session coverage", () => {
  it("covers 5–7 AM for two hours and excludes the ending hour", () => {
    const cells = sessionHourCoverage("2026-10-22T09:00:00Z", "2026-10-22T11:00:00Z", "America/New_York");
    expect([...cells.values()]).toEqual([
      { day: "2026-10-22", hour: 5, from: 0, to: 60 },
      { day: "2026-10-22", hour: 6, from: 0, to: 60 },
    ]);
  });

  it("shrinks to the exact half hour when the duration is shortened", () => {
    const cells = sessionHourCoverage("2026-10-22T09:00:00Z", "2026-10-22T09:30:00Z", "America/New_York");
    expect([...cells.values()]).toEqual([{ day: "2026-10-22", hour: 5, from: 0, to: 30 }]);
  });

  it("covers partial hours for a 5:30–7:30 AM session", () => {
    const cells = sessionHourCoverage("2026-10-22T09:30:00Z", "2026-10-22T11:30:00Z", "America/New_York");
    expect([...cells.values()]).toEqual([
      { day: "2026-10-22", hour: 5, from: 30, to: 60 },
      { day: "2026-10-22", hour: 6, from: 0, to: 60 },
      { day: "2026-10-22", hour: 7, from: 0, to: 30 },
    ]);
  });

  it("follows the display zone across midnight", () => {
    const cells = sessionHourCoverage("2026-10-23T03:30:00Z", "2026-10-23T05:30:00Z", "America/New_York");
    expect([...cells.values()]).toEqual([
      { day: "2026-10-22", hour: 23, from: 30, to: 60 },
      { day: "2026-10-23", hour: 0, from: 0, to: 60 },
      { day: "2026-10-23", hour: 1, from: 0, to: 30 },
    ]);
    expect([...sessionHourCoverage("2026-10-23T03:30:00Z", "2026-10-23T05:30:00Z", "UTC").values()]).toEqual([
      { day: "2026-10-23", hour: 3, from: 30, to: 60 },
      { day: "2026-10-23", hour: 4, from: 0, to: 60 },
      { day: "2026-10-23", hour: 5, from: 0, to: 30 },
    ]);
  });

  it("skips the missing clock hour when daylight saving starts", () => {
    const cells = sessionHourCoverage("2027-03-14T06:00:00Z", "2027-03-14T08:00:00Z", "America/New_York");
    expect([...cells.values()]).toEqual([
      { day: "2027-03-14", hour: 1, from: 0, to: 60 },
      { day: "2027-03-14", hour: 3, from: 0, to: 60 },
    ]);
  });
});
