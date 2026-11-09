import { describe, expect, it } from "vitest";
import { readProgressFilters } from "../../src/app/(protected)/progress/filters";
describe("progress query boundary", () => {
  it("keeps a subject-scoped topic containing punctuation and the inclusive date inputs", () => {
    expect(
      readProgressFilters({
        topic: JSON.stringify({ subjectId: "subject", topic: "Rates: part 1 / 2" }),
        from: "2026-11-01",
        to: "2026-11-08",
        goal: "goal",
        tutor: "tutor",
      }),
    ).toEqual({
      topic: { subjectId: "subject", topic: "Rates: part 1 / 2" },
      fromDate: "2026-11-01",
      toDate: "2026-11-08",
      goalId: "goal",
      tutorId: "tutor",
    });
  });
  it.each(["goal", "topic", "tutor", "from", "to"])("rejects duplicate %s instead of dropping a chosen filter", (key) =>
    expect(() => readProgressFilters({ [key]: ["one", "two"] })).toThrow(),
  );
  it.each([
    "bad JSON",
    JSON.stringify({ topic: "missing subject" }),
    JSON.stringify({ subjectId: "subject", topic: 4 }),
  ])("rejects malformed selected topic", (topic) => expect(() => readProgressFilters({ topic })).toThrow());
});
