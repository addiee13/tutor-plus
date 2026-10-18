import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../../src/domains/auth/service";
import type { Actor } from "../../src/domains/auth/policy";
import { DomainError, InputError } from "../../src/domains/shared/errors";
import {
  requireSessionPermission,
  resolveSessionRole,
  sessionPermissions,
  sessionPhase,
} from "../../src/domains/sessions/policy";
import { parseRecap, parseReflection, parseStudentPlan, parseTutorAgenda } from "../../src/domains/sessions/validation";
import { getWorkspace, publishRecap, saveStudentPlan } from "../../src/domains/sessions/service";
import { describeRating, isReviewable, requireReviewAuthor } from "../../src/domains/reviews/policy";
import { parseReview } from "../../src/domains/reviews/validation";
import { submitReview } from "../../src/domains/reviews/service";

vi.mock("server-only", () => ({}));
vi.mock("../../src/domains/auth/service", () => ({ getActor: vi.fn() }));

const bookingId = "00000000-0000-4000-8000-000000000010";
const tutorId = "00000000-0000-4000-8000-000000000011";
const student: Actor = { id: "student-1", roles: ["student"], sessionStartedAt: "2026-10-18T12:00:00Z" };
const tutor: Actor = { id: "tutor-user", roles: ["tutor"], sessionStartedAt: "2026-10-18T12:00:00Z" };
const now = Date.parse("2026-10-18T12:00:00Z");

function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([name, value]) => data.set(name, value));
  return data;
}

type Rows = Record<string, Record<string, unknown>[]>;

/** A minimal PostgREST stand-in: records each table read so tests can assert what the service requested. */
function database(
  rows: Rows,
  rpcResult: { data: unknown; error: { code: string } | null } = { data: null, error: null },
) {
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
  const rpc = vi.fn(async () => rpcResult);
  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc, reads };
}

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: bookingId,
    student_id: student.id,
    tutor_id: tutorId,
    subject_id: "00000000-0000-4000-8000-000000000012",
    starts_at: "2026-10-20T15:00:00Z",
    ends_at: "2099-10-20T16:00:00Z",
    status: "confirmed",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActor).mockResolvedValue(student);
});

describe("UC-09 session policy", () => {
  it("resolves only the booked student or the owning tutor", () => {
    expect(resolveSessionRole(student, booking(), [])).toBe("student");
    expect(resolveSessionRole(tutor, booking(), [tutorId])).toBe("tutor");
    expect(() => resolveSessionRole({ ...student, id: "intruder" }, booking(), [])).toThrow(DomainError);
    expect(() => resolveSessionRole(tutor, booking(), [])).toThrow(DomainError);
    // A tutor capability without the student role cannot borrow the student side, even with the right ID.
    expect(() => resolveSessionRole({ ...tutor, id: student.id }, booking(), [])).toThrow(DomainError);
  });

  it("derives the lifecycle phase from status and end time", () => {
    expect(sessionPhase({ status: "confirmed", ends_at: "2026-10-18T13:00:00Z" }, now)).toBe("planning");
    expect(sessionPhase({ status: "in_progress", ends_at: "2026-10-18T12:00:00Z" }, now)).toBe("ended");
    expect(sessionPhase({ status: "completed", ends_at: "2026-10-18T13:00:00Z" }, now)).toBe("completed");
    for (const status of ["draft", "payment_pending", "cancelled"] as const)
      expect(sessionPhase({ status, ends_at: "2026-10-18T13:00:00Z" }, now)).toBe("unavailable");
  });

  it("offers each side only its own actions at the right time", () => {
    expect(sessionPermissions("student", "planning")).toMatchObject({
      editGoals: true,
      editAgenda: false,
      writeReflection: false,
    });
    expect(sessionPermissions("tutor", "planning")).toMatchObject({
      editAgenda: true,
      editGoals: false,
      publishRecap: false,
    });
    expect(sessionPermissions("tutor", "ended")).toMatchObject({
      publishRecap: true,
      markCompleted: true,
      editAgenda: false,
    });
    expect(sessionPermissions("tutor", "completed")).toMatchObject({ publishRecap: true, markCompleted: false });
    expect(sessionPermissions("student", "completed")).toMatchObject({ writeReflection: true, editGoals: false });
    expect(Object.values(sessionPermissions("student", "unavailable")).some(Boolean)).toBe(false);
    expect(() => requireSessionPermission(sessionPermissions("tutor", "completed"), "writeReflection")).toThrow(
      DomainError,
    );
  });
});

describe("UC-09 input validation", () => {
  it("requires goals, trims text and accepts optional questions", () => {
    expect(parseStudentPlan(form({ booking: bookingId, goals: "  Factor quadratics  " }))).toEqual({
      booking: bookingId,
      goals: "Factor quadratics",
      questions: null,
    });
    expect(() => parseStudentPlan(form({ booking: bookingId, goals: "   " }))).toThrow(InputError);
    expect(() => parseStudentPlan(form({ booking: bookingId, goals: "x".repeat(2001) }))).toThrow(InputError);
    expect(() => parseStudentPlan(form({ booking: "forged", goals: "ok" }))).toThrow(InputError);
  });

  it("keeps line breaks but rejects control characters", () => {
    expect(parseTutorAgenda(form({ booking: bookingId, agenda: "1. Warm-up\n2. Practice" })).agenda).toContain("\n");
    expect(() => parseTutorAgenda(form({ booking: bookingId, agenda: "bad\u0007bell" }))).toThrow(InputError);
  });

  it("requires a recap summary and a reflection, and ignores forged authorship fields", () => {
    const recap = parseRecap(form({ booking: bookingId, summary: "Covered roots", tutor_id: "forged", revision: "9" }));
    expect(recap).toEqual({ booking: bookingId, summary: "Covered roots", mastery_notes: null, next_steps: null });
    expect(() => parseRecap(form({ booking: bookingId, summary: "" }))).toThrow(InputError);
    expect(() => parseReflection(form({ booking: bookingId, reflection: "" }))).toThrow(InputError);
    expect(parseReflection(form({ booking: bookingId, reflection: "Private", student_id: "x" }))).toEqual({
      booking: bookingId,
      reflection: "Private",
    });
  });
});

describe("UC-09 service contracts (mocked, not live persistence)", () => {
  it("never requests the student reflection for the tutor view", async () => {
    vi.mocked(getActor).mockResolvedValue(tutor);
    const fixture = database({ bookings: [booking()], tutor_profiles: [{ id: tutorId, public_display_name: "T" }] });
    const workspace = await getWorkspace(fixture.client, bookingId);
    expect(workspace.role).toBe("tutor");
    expect(workspace.reflection).toBeNull();
    expect(fixture.reads).not.toContain("session_reflections");
  });

  it("reads the reflection for the booked student", async () => {
    const fixture = database({
      bookings: [booking({ status: "completed" })],
      session_reflections: [{ reflection: "Mine" }],
    });
    const workspace = await getWorkspace(fixture.client, bookingId);
    expect(workspace.reflection).toMatchObject({ reflection: "Mine" });
    expect(workspace.can.writeReflection).toBe(true);
  });

  it("treats malformed and hidden booking IDs as forbidden", async () => {
    await expect(getWorkspace(database({}).client, "not-a-uuid")).rejects.toMatchObject({ code: "forbidden" });
    await expect(getWorkspace(database({ bookings: [] }).client, bookingId)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("passes only the migration's named arguments to save_session_goals", async () => {
    const fixture = database({ bookings: [booking()] }, { data: "2026-10-18T12:00:00Z", error: null });
    await saveStudentPlan(fixture.client, form({ booking: bookingId, goals: "Goals", student_id: "forged" }));
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("save_session_goals", {
      booking: bookingId,
      goals: "Goals",
      questions: null,
    });
  });

  it("refuses an early recap before calling the database", async () => {
    vi.mocked(getActor).mockResolvedValue(tutor);
    const fixture = database({ bookings: [booking()], tutor_profiles: [{ id: tutorId }] });
    await expect(publishRecap(fixture.client, form({ booking: bookingId, summary: "Early" }))).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});

describe("UC-07 review rules", () => {
  it("parses integer ratings 1–5 and optional comments", () => {
    expect(parseReview(form({ booking: bookingId, rating: "5", comment: " Great " }))).toEqual({
      booking: bookingId,
      rating: 5,
      comment: "Great",
    });
    expect(parseReview(form({ booking: bookingId, rating: "1" })).comment).toBeNull();
    for (const rating of ["0", "6", "4.5", "", "five", "-1"])
      expect(() => parseReview(form({ booking: bookingId, rating }))).toThrow(InputError);
    expect(() => parseReview(form({ booking: bookingId, rating: "4", comment: "x".repeat(2001) }))).toThrow(InputError);
  });

  it("ignores forged aggregate and identity fields", () => {
    const parsed = parseReview(
      form({ booking: bookingId, rating: "4", rating_avg: "5", student_id: "x", tutor_id: "y" }),
    );
    expect(Object.keys(parsed).sort()).toEqual(["booking", "comment", "rating"]);
  });

  it("allows only the booked student and only completed sessions", () => {
    expect(() => requireReviewAuthor(student, { student_id: student.id })).not.toThrow();
    expect(() => requireReviewAuthor(student, { student_id: "someone-else" })).toThrow(DomainError);
    expect(() => requireReviewAuthor(tutor, { student_id: tutor.id })).toThrow(DomainError);
    expect(isReviewable({ status: "completed" })).toBe(true);
    expect(isReviewable({ status: "confirmed" })).toBe(false);
  });

  it("describes only server-computed ratings", () => {
    expect(describeRating(null)).toBe("No reviews yet");
    expect(describeRating({ rating_count: 0, rating_avg: null })).toBe("No reviews yet");
    expect(describeRating({ rating_count: 1, rating_avg: 5 })).toBe("5.0 out of 5 · 1 review");
    expect(describeRating({ rating_count: 3, rating_avg: 4.33 })).toBe("4.3 out of 5 · 3 reviews");
  });
});

describe("UC-07 service contracts (mocked, not live persistence)", () => {
  it("refuses a duplicate before calling submit_review", async () => {
    const fixture = database({ bookings: [booking({ status: "completed" })], reviews: [{ id: "existing" }] });
    const attempt = submitReview(fixture.client, form({ booking: bookingId, rating: "5" }));
    await expect(attempt).rejects.toBeInstanceOf(InputError);
    await expect(attempt).rejects.toMatchObject({ fields: { rating: expect.stringContaining("already reviewed") } });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("maps a racing unique violation to the duplicate message", async () => {
    const fixture = database(
      { bookings: [booking({ status: "completed" })] },
      { data: null, error: { code: "23505" } },
    );
    await expect(submitReview(fixture.client, form({ booking: bookingId, rating: "4" }))).rejects.toMatchObject({
      fields: { rating: expect.stringContaining("already reviewed") },
    });
  });

  it("refuses incomplete sessions and other students", async () => {
    const pending = database({ bookings: [booking({ status: "confirmed" })] });
    await expect(submitReview(pending.client, form({ booking: bookingId, rating: "4" }))).rejects.toBeInstanceOf(
      InputError,
    );
    const foreign = database({ bookings: [booking({ student_id: "other" })] });
    await expect(submitReview(foreign.client, form({ booking: bookingId, rating: "4" }))).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(pending.rpc).not.toHaveBeenCalled();
    expect(foreign.rpc).not.toHaveBeenCalled();
  });

  it("sends only booking, rating and comment to submit_review", async () => {
    const fixture = database(
      { bookings: [booking({ status: "completed" })] },
      { data: "00000000-0000-4000-8000-000000000099", error: null },
    );
    // The duplicate pre-check reads `reviews`; the saved review read uses the same table afterwards.
    let reviewReads = 0;
    const originalFrom = fixture.from.getMockImplementation()!;
    fixture.from.mockImplementation((table: string) => {
      const query = originalFrom(table);
      if (table === "reviews" && reviewReads++ > 0) {
        query.single = vi.fn(async () => ({
          data: { id: "00000000-0000-4000-8000-000000000099", rating: 4 },
          error: null,
        }));
      }
      return query;
    });
    const saved = await submitReview(fixture.client, form({ booking: bookingId, rating: "4", rating_avg: "5" }));
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("submit_review", {
      booking: bookingId,
      rating: 4,
      comment: null,
    });
    expect(saved).toMatchObject({ rating: 4 });
  });
});
