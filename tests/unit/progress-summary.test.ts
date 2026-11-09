import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "../../src/domains/auth/policy";
import { getActor } from "../../src/domains/auth/service";
import { getLearningProgress } from "../../src/domains/learning/service";
import type { LearningProgressOverview, LearningTopicRecord } from "../../src/domains/learning/types";
import { SessionPlanService } from "../../src/domains/sessions/service";
import { requestStudyAI } from "../../src/domains/platform/service";
import { generateLearningProgressSummary } from "../../src/domains/platform/progress-summary";
import { buildProgressSummaryContext } from "../../src/domains/platform/progress-summary-context";

vi.mock("server-only", () => ({}));
vi.mock("../../src/domains/auth/service", () => ({ getActor: vi.fn() }));
vi.mock("../../src/domains/learning/service", () => ({ getLearningProgress: vi.fn() }));
vi.mock("../../src/domains/sessions/service", () => ({ SessionPlanService: { getWorkspace: vi.fn() } }));
vi.mock("../../src/domains/platform/service", () => ({ requestStudyAI: vi.fn() }));

const client = {} as SupabaseClient;
const actor: Actor = { id: "owner-id", roles: ["student"], sessionStartedAt: new Date().toISOString() };
const record: LearningTopicRecord = {
  id: "topic1",
  subjectId: "math",
  topic: "Chain rule",
  tutorId: null,
  sourceKind: "session_recap",
  sourceId: "booking1",
  occurredAt: "2026-11-08T19:00:00Z",
  sourceLabel: "Calculus recap",
  sourcePath: "/sessions/booking1",
  recapNarrative: { strengths: "Demo practice only", practiceAreas: "Remember inner derivative" },
};
function overview(records: LearningTopicRecord[] = []): LearningProgressOverview {
  return {
    studentId: actor.id,
    activeGoals: [],
    milestones: [],
    sessions: [],
    tasks: [],
    assessments: [],
    topicEvidence: [],
    topicRecords: records,
    topicSummaries: [],
    filterOptions: { goals: [], topics: [], tutors: [] },
    coverage: { bounded: false, cappedSources: [], rowCap: 1000 },
    events: [],
    observedAt: "2026-11-09T12:00:00Z",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getActor).mockResolvedValue(actor);
  vi.mocked(requestStudyAI).mockResolvedValue({
    answer: "One demo session does not establish improvement [S1].",
    requestId: "request1",
  });
});

describe("AI progress summary boundaries", () => {
  it("denies tutor-only accounts before reading private records or calling the provider", async () => {
    vi.mocked(getActor).mockResolvedValue({ ...actor, roles: ["tutor"] });
    await expect(generateLearningProgressSummary(client)).rejects.toMatchObject({ code: "forbidden" });
    expect(getLearningProgress).not.toHaveBeenCalled();
    expect(requestStudyAI).not.toHaveBeenCalled();
  });
  it("does not spend a provider request when filters leave no evidence", async () => {
    vi.mocked(getLearningProgress).mockResolvedValue(overview());
    await expect(generateLearningProgressSummary(client, { fromDate: "2026-11-09" })).rejects.toMatchObject({
      fields: { evidence: expect.stringContaining("enough saved evidence") },
    });
    expect(requestStudyAI).not.toHaveBeenCalled();
  });
  it("uses the authenticated student, forwards filters, hydrates only filtered recap sources, and keeps demo labels", async () => {
    const progress = overview([record]);
    // A broad sidebar session must not leak into a filtered summary.
    progress.sessions.push({
      bookingId: "unselected",
      tutorId: "t",
      tutorName: "Private",
      subjectId: "s",
      subjectName: "Other",
      endsAt: "2026-11-08",
      recapAvailable: true,
    });
    vi.mocked(getLearningProgress).mockResolvedValue(progress);
    vi.mocked(SessionPlanService.getWorkspace).mockResolvedValue({
      role: "student",
      booking: { student_id: actor.id },
      recap: { summary: "CALCULUS DEMO SESSION. Chain rule example.", next_steps: "Practice derivatives" },
    } as Awaited<ReturnType<typeof SessionPlanService.getWorkspace>>);
    const filters = { fromDate: "2026-11-01", toDate: "2026-11-09" };
    const result = await generateLearningProgressSummary(client, filters);
    expect(getLearningProgress).toHaveBeenCalledWith(client, actor.id, filters);
    expect(SessionPlanService.getWorkspace).toHaveBeenCalledExactlyOnceWith(client, "booking1");
    const input = vi.mocked(requestStudyAI).mock.calls[0][1];
    expect(input.contextText).toContain("CALCULUS DEMO SESSION");
    expect(input.contextText).not.toContain("unselected");
    expect(input.system).toContain("insufficient evidence to establish improvement");
    expect(input.selectedContext).toMatchObject({ feature: "learning_progress_summary", filters });
    expect(result.sources).toEqual([{ id: "S1", label: "Calculus recap", path: "/sessions/booking1" }]);
    expect(result.caveat).toContain("No learning records or mastery labels were changed");
  });
  it("propagates provider failure instead of returning a fabricated summary", async () => {
    vi.mocked(getLearningProgress).mockResolvedValue(overview([{ ...record, sourceKind: "assessment_question" }]));
    vi.mocked(requestStudyAI).mockRejectedValue(new Error("provider failure"));
    await expect(generateLearningProgressSummary(client)).rejects.toThrow("provider failure");
  });
  it("bounds context and source links together and warns about incomplete history", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      ...record,
      sourceId: `b${i}`,
      id: `t${i}`,
      recapNarrative: { strengths: "x".repeat(5000), practiceAreas: "y".repeat(5000) },
    }));
    const result = buildProgressSummaryContext(overview(many), {});
    expect(result.limited).toBe(true);
    expect(result.sources).toHaveLength(16);
    expect(result.contextText.length).toBeLessThan(30000);
    const parsed = JSON.parse(result.contextText);
    expect(parsed.evidence.map((row: { source: string }) => row.source)).toEqual(
      result.sources.map((source) => source.id),
    );
    expect(parsed.incompleteHistory).toBe(true);
  });
  it("marks source query caps even for a small returned collection", () => {
    const progress = overview([record]);
    progress.coverage.bounded = true;
    expect(buildProgressSummaryContext(progress, {}).limited).toBe(true);
  });
});
