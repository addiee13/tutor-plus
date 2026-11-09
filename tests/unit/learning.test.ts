import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../../src/domains/auth/service";
import type { Actor } from "../../src/domains/auth/policy";
import { DomainError, InputError } from "../../src/domains/shared/errors";
import {
  authorizeAssessmentRetake,
  filterTopicRecords,
  getAssessment,
  parseLearningProgressFilters,
  progressQueryAtEffectiveCap,
  summarizeLearningTopicEvidence,
} from "../../src/domains/learning/service";
import {
  parseCreateAssessment,
  parseCreateAssignment,
  parseAssignmentDraft,
  parseAssignmentFeedback,
  parseAssignmentSubmission,
  parseAssignmentCancellationReason,
  parseCreatePersonalStudyPlan,
  parseCreateStudyPlan,
  parsePlanGoalSnapshot,
  parseReviseStudyPlan,
} from "../../src/domains/learning/validation";

vi.mock("server-only", () => ({}));
vi.mock("../../src/domains/auth/service", () => ({ getActor: vi.fn() }));

const assessmentId = "00000000-0000-4000-8000-000000000101";
const tutorProfileId = "00000000-0000-4000-8000-000000000102";
const studentId = "00000000-0000-4000-8000-000000000103";
const questionId = "00000000-0000-4000-8000-000000000104";
const goalId = "00000000-0000-4000-8000-000000000107";
const milestoneId = "00000000-0000-4000-8000-000000000108";
const student: Actor = { id: studentId, roles: ["student"], sessionStartedAt: "2026-11-08T12:00:00Z" };
const tutor: Actor = {
  id: "00000000-0000-4000-8000-000000000105",
  roles: ["tutor"],
  sessionStartedAt: "2026-11-08T12:00:00Z",
};

type Rows = Record<string, Record<string, unknown>[]>;

function database(rows: Rows, rpcData: unknown = null) {
  const reads: string[] = [];
  const from = vi.fn((table: string) => {
    reads.push(table);
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: rows[table]?.[0] ?? null, error: null })),
      single: vi.fn(async () => ({ data: rows[table]?.[0] ?? null, error: null })),
      then: (resolve: (value: unknown) => void) => resolve({ data: rows[table] ?? [], error: null }),
    };
    return query;
  });
  const rpc = vi.fn(async () => ({ data: rpcData, error: null }));
  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc, reads };
}

function assessment(overrides: Record<string, unknown> = {}) {
  return {
    id: assessmentId,
    tutor_id: tutorProfileId,
    student_id: studentId,
    subject_id: "00000000-0000-4000-8000-000000000106",
    booking_id: null,
    title: "Algebra review",
    instructions: null,
    purpose: "diagnostic",
    status: "assigned",
    due_at: null,
    assigned_at: "2026-11-08T12:00:00Z",
    created_at: "2026-11-08T12:00:00Z",
    updated_at: "2026-11-08T12:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActor).mockResolvedValue(student);
});

describe("learning input contracts", () => {
  it("requires a private key for every multiple-choice question", () => {
    const input = {
      tutorId: tutorProfileId,
      studentId,
      subjectId: "00000000-0000-4000-8000-000000000106",
      bookingId: null,
      title: "Check-in",
      instructions: null,
      purpose: "diagnostic",
      dueAt: null,
      questions: [
        {
          prompt: "2 + 2?",
          kind: "single_choice",
          choices: ["3", "4"],
          points: 1,
          correctChoice: null,
          topic: "Arithmetic",
        },
      ],
    };
    expect(() => parseCreateAssessment(input)).toThrow(InputError);
  });

  it("rejects forged short-answer keys and accepts an explicit rubric-scored item", () => {
    const base = {
      tutorId: tutorProfileId,
      studentId,
      subjectId: "00000000-0000-4000-8000-000000000106",
      bookingId: null,
      title: "Written explanation",
      instructions: null,
      purpose: "diagnostic",
      dueAt: null,
    };
    expect(() =>
      parseCreateAssessment({
        ...base,
        questions: [
          {
            prompt: "Why?",
            kind: "short_answer",
            choices: null,
            points: 3,
            correctChoice: "Do not leak",
            topic: "Reasoning",
          },
        ],
      }),
    ).toThrow(InputError);
    expect(
      parseCreateAssessment({
        ...base,
        questions: [
          { prompt: "Why?", kind: "short_answer", choices: null, points: 3, correctChoice: null, topic: "Reasoning" },
        ],
      }).questions[0],
    ).toMatchObject({ kind: "short_answer", correctChoice: null, topic: "Reasoning" });
  });

  it("requires a relationship topic for assignments and keeps drafts separate from submission", () => {
    const input = {
      tutorId: tutorProfileId,
      studentId,
      bookingId: "00000000-0000-4000-8000-000000000109",
      title: "Practice",
      topic: "Fractions",
      instructions: "Compare the fractions.",
      submissionType: "text",
      dueAt: "2026-12-01T16:00:00Z",
      acceptsLate: true,
      studyPlanId: null,
      milestoneId: null,
    };
    expect(parseCreateAssignment(input)).toMatchObject({ topic: "Fractions", bookingId: input.bookingId });
    expect(() => parseCreateAssignment({ ...input, topic: "" })).toThrow(InputError);
    expect(parseAssignmentDraft({ body: " first draft ", linkUrl: null })).toEqual({
      body: "first draft",
      linkUrl: null,
    });
    expect(() => parseAssignmentDraft({ body: "work", linkUrl: "https://example.test" })).toThrow(InputError);
  });

  it("counts assignment instructions, submission text and feedback after line-ending normalization", () => {
    const multiline = (maximum: number) => {
      const left = Math.floor((maximum - 1) / 2);
      const visible = `${"A".repeat(left)}\n${"B".repeat(maximum - left - 1)}`;
      return { visible, browserTransport: visible.replace(/\n/g, "\r\n") };
    };
    const assignmentBase = {
      tutorId: tutorProfileId,
      studentId,
      bookingId: "00000000-0000-4000-8000-000000000109",
      title: "Practice",
      topic: "Fractions",
      submissionType: "text",
      dueAt: "2026-12-01T16:00:00Z",
      acceptsLate: true,
      studyPlanId: null,
      milestoneId: null,
    };
    const instructions = multiline(4000);
    expect(instructions.browserTransport).toHaveLength(4001);
    expect(parseCreateAssignment({ ...assignmentBase, instructions: instructions.browserTransport }).instructions).toBe(
      instructions.visible,
    );
    expect(() =>
      parseCreateAssignment({ ...assignmentBase, instructions: `${instructions.browserTransport}x` }),
    ).toThrow(InputError);

    const submission = multiline(8000);
    expect(submission.browserTransport).toHaveLength(8001);
    expect(parseAssignmentSubmission({ body: submission.browserTransport }).body).toBe(submission.visible);
    expect(() => parseAssignmentSubmission({ body: `${submission.browserTransport}x` })).toThrow(InputError);

    const feedback = multiline(4000);
    expect(feedback.browserTransport).toHaveLength(4001);
    expect(
      parseAssignmentFeedback({ feedback: feedback.browserTransport, score: null, outcome: "returned" }).feedback,
    ).toBe(feedback.visible);
    expect(() =>
      parseAssignmentFeedback({ feedback: `${feedback.browserTransport}x`, score: null, outcome: "returned" }),
    ).toThrow(InputError);
    expect(
      parseAssignmentFeedback({ feedback: "first\rsecond\tthird", score: null, outcome: "returned" }).feedback,
    ).toBe("first\nsecond\tthird");
  });

  it("normalizes required cancellation reasons and caps them at 500 characters", () => {
    expect(parseAssignmentCancellationReason("  Schedule changed  ")).toBe("Schedule changed");
    expect(() => parseAssignmentCancellationReason("   ")).toThrow(InputError);
    expect(() => parseAssignmentCancellationReason("x".repeat(501))).toThrow(InputError);
  });

  it("summarizes only subject-scoped saved topic sources and exact repeated recap wording", () => {
    const subjectId = "00000000-0000-4000-8000-000000000110";
    const otherSubjectId = "00000000-0000-4000-8000-000000000111";
    const records = [
      {
        id: "q1",
        subjectId,
        topic: "Fractions",
        tutorId: "tutor-1",
        sourceKind: "assessment_question" as const,
        sourceId: "a1",
        occurredAt: "2026-10-01T00:00:00Z",
        sourceLabel: "Quiz",
        sourcePath: "/assessments/a1",
        assessmentPoints: { earned: 3, possible: 4 },
      },
      {
        id: "s1",
        subjectId,
        topic: "fractions",
        tutorId: "tutor-1",
        sourceKind: "session_recap" as const,
        sourceId: "b1",
        occurredAt: "2026-10-02T00:00:00Z",
        sourceLabel: "Session",
        sourcePath: "/sessions/b1",
        recapNarrative: { strengths: "Understands equivalent fractions", practiceAreas: "Simplify fractions" },
      },
      {
        id: "s2",
        subjectId,
        topic: "Fractions",
        tutorId: "tutor-1",
        sourceKind: "session_recap" as const,
        sourceId: "b2",
        occurredAt: "2026-10-03T00:00:00Z",
        sourceLabel: "Session",
        sourcePath: "/sessions/b2",
        recapNarrative: { strengths: "understands   equivalent fractions", practiceAreas: null },
      },
      {
        id: "m1",
        subjectId,
        topic: "Fractions",
        tutorId: "tutor-1",
        sourceKind: "tutor_observation" as const,
        sourceId: "a1",
        occurredAt: "2026-10-04T00:00:00Z",
        sourceLabel: "Tutor observation",
        sourcePath: "/assessments/a1",
        tutorObservation: { label: "improving" as const, observedAt: "2026-10-04T00:00:00Z", note: "Saved note" },
      },
      {
        id: "q2",
        subjectId: otherSubjectId,
        topic: "Fractions",
        tutorId: "tutor-2",
        sourceKind: "assessment_question" as const,
        sourceId: "a2",
        occurredAt: "2026-10-05T00:00:00Z",
        sourceLabel: "Other subject quiz",
        sourcePath: "/assessments/a2",
        assessmentPoints: { earned: 2, possible: 2 },
      },
    ];
    const summaries = summarizeLearningTopicEvidence(records);
    expect(summaries).toHaveLength(2);
    expect(summaries.find((summary) => summary.subjectId === subjectId)).toMatchObject({
      topic: "Fractions",
      assessmentPoints: { earned: 3, possible: 4 },
      latestTutorObservation: { label: "improving" },
      recurringStrengths: [{ text: "Understands equivalent fractions", recapCount: 2 }],
      recurringPracticeAreas: [],
    });
    expect(summaries.find((summary) => summary.subjectId === otherSubjectId)?.assessmentPoints).toEqual({
      earned: 2,
      possible: 2,
    });
  });

  it("validates UTC date filters and scopes saved evidence without hiding current-plan dates", () => {
    const subjectId = "00000000-0000-4000-8000-000000000110";
    const records = [
      {
        id: "new",
        subjectId,
        topic: "Fractions",
        tutorId: "tutor-1",
        goalIds: [goalId],
        sourceKind: "assessment_question" as const,
        sourceId: "attempt-1",
        occurredAt: "2026-11-08T00:00:00.000Z",
        sourceLabel: "Quiz",
        sourcePath: "/assessments/a1",
      },
      {
        id: "old",
        subjectId,
        topic: "Fractions",
        tutorId: "tutor-2",
        goalIds: [],
        sourceKind: "assessment_question" as const,
        sourceId: "attempt-2",
        occurredAt: "2026-11-07T23:59:59.999Z",
        sourceLabel: "Quiz",
        sourcePath: "/assessments/a2",
      },
      {
        id: "end-of-day",
        subjectId,
        topic: "Fractions",
        tutorId: "tutor-1",
        goalIds: [goalId],
        sourceKind: "assignment_submission" as const,
        sourceId: "submission-1",
        occurredAt: "2026-11-08T23:59:59.999Z",
        sourceLabel: "Task",
        sourcePath: "/assignments/task-1",
      },
      {
        id: "other-subject",
        subjectId: "00000000-0000-4000-8000-000000000111",
        topic: "Fractions",
        tutorId: "tutor-1",
        goalIds: [goalId],
        sourceKind: "assessment_question" as const,
        sourceId: "attempt-3",
        occurredAt: "2026-11-08T12:00:00.000Z",
        sourceLabel: "Other",
        sourcePath: "/assessments/a3",
      },
    ];
    expect(parseLearningProgressFilters({ fromDate: "2026-11-08", toDate: "2026-11-08" })).toEqual({
      fromDate: "2026-11-08",
      toDate: "2026-11-08",
    });
    const longTopic = "T".repeat(200);
    expect(parseLearningProgressFilters({ topic: { subjectId, topic: longTopic } }).topic?.topic).toBe(longTopic);
    expect(() => parseLearningProgressFilters({ topic: { subjectId, topic: `${longTopic}x` } })).toThrow(InputError);
    expect(() => parseLearningProgressFilters({ fromDate: "2026-02-29" })).toThrow(InputError);
    expect(() => parseLearningProgressFilters({ fromDate: "2026-02-31" })).toThrow(InputError);
    expect(() => parseLearningProgressFilters({ fromDate: "2026-11-09", toDate: "2026-11-08" })).toThrow(InputError);
    expect(
      filterTopicRecords(records, {
        fromDate: "2026-11-08",
        toDate: "2026-11-08",
        goalId,
        topic: { subjectId, topic: "fractions" },
        tutorId: "tutor-1",
      }),
    ).toEqual([records[0], records[2]]);
  });

  it("flags an effective PostgREST row cap even when the requested page is larger", () => {
    expect(progressQueryAtEffectiveCap(99, 100)).toBe(false);
    expect(progressQueryAtEffectiveCap(100, 100)).toBe(true);
    expect(progressQueryAtEffectiveCap(999, 2000)).toBe(false);
    expect(progressQueryAtEffectiveCap(1000, 2000)).toBe(true);
  });

  it("normalizes study plan revisions while keeping supplied milestone identities", () => {
    const create = parseCreateStudyPlan({
      tutorId: tutorProfileId,
      studentId,
      subjectId: null,
      bookingId: assessmentId,
      title: "Fractions",
      description: null,
      goals: [
        {
          title: "Compare",
          topic: "Fractions",
          targetDate: "2026-12-01",
          baseline: "Cannot compare unlike denominators yet",
          schedule: "Two 30 minute practices weekly",
          successCriterion: "Order 8 of 10 fraction sets correctly",
          description: null,
          milestones: [
            {
              title: "Order fractions",
              description: null,
              status: "planned",
              targetDate: "2026-11-22",
              links: [],
            },
          ],
        },
      ],
    });
    const first = create.goals[0];
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first.milestones[0].id).toMatch(/^[0-9a-f-]{36}$/i);

    const revised = parseReviseStudyPlan({
      expectedRevision: 1,
      title: "Fractions, revised",
      description: "More practice",
      goals: [{ ...first, title: "Compare and order" }],
    });
    expect(revised.goals[0].id).toBe(first.id);
    expect(revised.goals[0].milestones[0].id).toBe(first.milestones[0].id);
  });

  it("does not invent structured criteria while reading a legacy study plan snapshot", () => {
    const snapshot = parsePlanGoalSnapshot([
      {
        id: goalId,
        title: "Compare",
        description: null,
        milestones: [{ id: milestoneId, title: "Order fractions", description: null }],
      },
    ]);
    expect(snapshot[0]).toMatchObject({
      topic: null,
      targetDate: null,
      baseline: null,
      schedule: null,
      successCriterion: null,
    });
    expect(snapshot[0].milestones[0]).toMatchObject({ status: "unspecified", targetDate: null, links: [] });
  });

  it("accepts a structured student-owned plan with a subject and no tutor or booking fields", () => {
    const plan = parseCreatePersonalStudyPlan({
      subjectId: "00000000-0000-4000-8000-000000000106",
      title: "Personal fractions goal",
      description: null,
      goals: [
        {
          title: "Compare fractions",
          topic: "Fractions",
          targetDate: "2026-12-01",
          baseline: "Cannot compare unlike denominators yet",
          schedule: "Practice twice weekly",
          successCriterion: "Correctly compare 8 of 10 sets",
          description: null,
          milestones: [{ title: "Find a common denominator", status: "planned", targetDate: null, links: [] }],
        },
      ],
    });
    expect(plan.subjectId).toBe("00000000-0000-4000-8000-000000000106");
    expect(plan.goals[0].milestones[0].id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(() => parseCreatePersonalStudyPlan({ title: "Missing subject", goals: [] })).toThrow(InputError);
  });
});

describe("learning service authorization", () => {
  it("never queries answer keys when a student opens an assessment", async () => {
    const fixture = database({
      assessments: [assessment()],
      assessment_questions: [
        {
          id: questionId,
          assessment_id: assessmentId,
          position: 1,
          prompt: "2+2?",
          kind: "single_choice",
          choices: ["3", "4"],
          points: 1,
        },
      ],
      assessment_attempts: [],
      tutor_profiles: [],
    });
    const detail = await getAssessment(fixture.client, assessmentId);
    expect(detail.answerKeys).toBeNull();
    expect(fixture.reads).not.toContain("assessment_answer_keys");
    expect(detail.questions).toHaveLength(1);
  });

  it("only asks the tutor-authorized retake RPC after confirming tutor ownership", async () => {
    vi.mocked(getActor).mockResolvedValue(tutor);
    const fixture = database({
      assessments: [assessment()],
      tutor_profiles: [{ id: tutorProfileId, user_id: tutor.id }],
    });
    await authorizeAssessmentRetake(fixture.client, assessmentId);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("authorize_assessment_retake", { assessment: assessmentId });
  });

  it("returns forbidden for an assessment hidden by row security", async () => {
    const fixture = database({});
    await expect(getAssessment(fixture.client, assessmentId)).rejects.toBeInstanceOf(DomainError);
    await expect(getAssessment(fixture.client, assessmentId)).rejects.toMatchObject({ code: "forbidden" });
  });
});
