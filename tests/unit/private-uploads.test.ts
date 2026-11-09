import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../../src/domains/auth/service";
import { prepareAssignmentUpload, submitUploadedAssignment } from "../../src/domains/learning/service";
import { InputError } from "../../src/domains/shared/errors";
import { parsePrivateUploadMetadata, parsePrivateUploadPath } from "../../src/domains/shared/uploads";

vi.mock("server-only", () => ({}));
vi.mock("../../src/domains/auth/service", () => ({ getActor: vi.fn() }));

const assignmentId = "00000000-0000-4000-8000-000000000101";
const studentId = "00000000-0000-4000-8000-000000000102";
const otherId = "00000000-0000-4000-8000-000000000103";
const fileId = "00000000-0000-4000-8000-000000000104";
const path = `${assignmentId}/${studentId}/${fileId}.txt`;

function database(overrides: Record<string, unknown> = {}) {
  const assignment = {
    id: assignmentId,
    student_id: studentId,
    tutor_id: otherId,
    submission_type: "file",
    status: "assigned",
    submissions_closed_at: null,
    accepts_late: true,
    due_at: "2026-11-01T00:00:00Z",
    ...overrides,
  };
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: table === "assignments" ? assignment : { id: fileId }, error: null })),
      maybeSingle: vi.fn(async () => ({ data: table === "assignments" ? assignment : null, error: null })),
      then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
    };
    return query;
  });
  const sign = vi.fn(async () => ({ data: { token: "one-object-token" }, error: null }));
  const remove = vi.fn(async () => ({ error: null }));
  const storage = { from: vi.fn(() => ({ createSignedUploadUrl: sign, remove })) };
  const rpc = vi.fn(async () => ({ data: fileId, error: null as { code: string } | null }));
  return { client: { from, rpc, storage } as unknown as SupabaseClient, sign, remove, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActor).mockResolvedValue({
    id: studentId,
    roles: ["student"],
    sessionStartedAt: "2026-11-09T00:00:00Z",
  });
});

describe("private direct upload boundaries", () => {
  it("accepts exactly 10 MiB and rejects oversize, empty, fractional and unsupported files", () => {
    expect(parsePrivateUploadMetadata("text/plain", 10 * 1024 * 1024).bytes).toBe(10 * 1024 * 1024);
    for (const bytes of [0, -1, 10 * 1024 * 1024 + 1, 1.5, NaN, "100"])
      expect(() => parsePrivateUploadMetadata("text/plain", bytes)).toThrow(InputError);
    expect(() => parsePrivateUploadMetadata("application/javascript", 10)).toThrow(InputError);
  });

  it("rejects paths for a different student, assignment, extension or non-UUID filename", () => {
    expect(parsePrivateUploadPath(path, assignmentId, studentId, "text/plain")).toBe(path);
    for (const candidate of [
      `${assignmentId}/${otherId}/${fileId}.txt`,
      `${otherId}/${studentId}/${fileId}.txt`,
      `${assignmentId}/${studentId}/${fileId}.pdf`,
      `${assignmentId}/${studentId}/../file.txt`,
    ])
      expect(() => parsePrivateUploadPath(candidate, assignmentId, studentId, "text/plain")).toThrow(InputError);
  });

  it("creates one non-overwriting user-scoped token for the assigned student", async () => {
    const db = database();
    const upload = await prepareAssignmentUpload(db.client, assignmentId, "text/plain", 10 * 1024 * 1024);
    expect(upload.bucket).toBe("assignment-submissions");
    expect(upload.path.startsWith(`${assignmentId}/${studentId}/`)).toBe(true);
    expect(parsePrivateUploadPath(upload.path, assignmentId, studentId, "text/plain")).toBe(upload.path);
    expect(db.sign).toHaveBeenCalledWith(upload.path, { upsert: false });
  });

  it("never signs for another student or an assignment that no longer accepts files", async () => {
    for (const overrides of [
      { student_id: otherId },
      { status: "submitted" },
      { status: "cancelled" },
      { submissions_closed_at: "2026-11-09T00:00:00Z" },
      { submission_type: "text" },
      { accepts_late: false, due_at: "2000-01-01T00:00:00Z" },
    ]) {
      const db = database(overrides);
      await expect(prepareAssignmentUpload(db.client, assignmentId, "text/plain", 20)).rejects.toThrow();
      expect(db.sign).not.toHaveBeenCalled();
    }
  });

  it("sends only metadata to the existing storage-verifying RPC", async () => {
    const db = database();
    await submitUploadedAssignment(db.client, assignmentId, path, "text/plain", 10 * 1024 * 1024);
    expect(db.rpc).toHaveBeenCalledWith("submit_assignment_with_file", {
      assignment: assignmentId,
      body: null,
      link_url: null,
      file_path: path,
      file_mime: "text/plain",
      file_size_bytes: 10 * 1024 * 1024,
    });
  });

  it("does not register or remove an arbitrary path supplied by the client", async () => {
    const db = database();
    await expect(
      submitUploadedAssignment(db.client, assignmentId, `${assignmentId}/${otherId}/${fileId}.txt`, "text/plain", 20),
    ).rejects.toThrow(InputError);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.remove).not.toHaveBeenCalled();
  });

  it("preserves a failed object verification as failure and only cleans the student's orphan path", async () => {
    const db = database();
    db.rpc.mockResolvedValueOnce({ data: fileId, error: { code: "22023" } });
    await expect(submitUploadedAssignment(db.client, assignmentId, path, "text/plain", 20)).rejects.toThrow(InputError);
    expect(db.remove).toHaveBeenCalledWith([path]);
  });
});
