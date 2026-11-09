import { describe, expect, it } from "vitest";
import { formatViewerInstant, viewerTimeZone } from "../../src/lib/time-presentation";
describe("Sprint4 4.5 viewer time zones preserve UTC instants", () => {
  it("distinguishes both occurrences of the New York DST overlap", () => {
    const first = "2030-11-03T05:30:00Z";
    const second = "2030-11-03T06:30:00Z";
    expect(formatViewerInstant(first, "America/New_York")).toContain("1:30 AM EDT");
    expect(formatViewerInstant(second, "America/New_York")).toContain("1:30 AM EST");
    expect(formatViewerInstant(second, "UTC")).toContain("6:30 AM UTC");
    expect(second).toBe("2030-11-03T06:30:00Z");
  });
  it("uses an explicit UTC fallback for unavailable or invalid zones", () => {
    expect(viewerTimeZone("Mars/Olympus")).toBe("UTC");
    expect(viewerTimeZone(undefined)).toBe("UTC");
    expect(formatViewerInstant("2030-11-03T06:30:00Z", "Mars/Olympus")).toContain("6:30 AM UTC");
  });
  it("does not invent an instant for an invalid timestamp", () => {
    expect(formatViewerInstant("not-a-date", "America/New_York")).toBe("Time unavailable");
  });
});
