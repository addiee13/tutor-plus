import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../../src/domains/auth/service";
import type { Actor } from "../../src/domains/auth/policy";
import { DomainError, InputError } from "../../src/domains/shared/errors";
import {
  askLearningAssistant,
  createAssessmentFromTemplate,
  markNotificationRead,
  observeResendDeliveryWebhook,
  readAdminWorkspace,
  readNotificationWorkspace,
  reportAssistantResponse,
  resolveAssistantResponseReport,
  saveAssessmentTemplate,
  saveBadgePolicy,
  saveResource,
  saveNotificationPreference,
  submitSafetyReport,
} from "../../src/domains/platform/service";

const serviceRoleRpc = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ rpc: serviceRoleRpc })) }));
vi.mock("server-only", () => ({}));
vi.mock("../../src/domains/auth/service", () => ({ getActor: vi.fn() }));

const userId = "00000000-0000-4000-8000-000000000101";
const notificationId = "00000000-0000-4000-8000-000000000102";
const actor: Actor = { id: userId, roles: ["student"], sessionStartedAt: "2026-11-08T12:00:00Z" };

type RowMap = Record<string, Record<string, unknown>[]>;

function database(
  rows: RowMap = {},
  rpcValues: Record<string, unknown> = {},
  rpcErrors: Record<string, { code: string; message?: string }> = {},
) {
  const reads: string[] = [];
  const predicates: Array<[string, unknown, unknown]> = [];
  const from = vi.fn((table: string) => {
    reads.push(table);
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((column: string, value: unknown) => {
        predicates.push([table, column, value]);
        return query;
      }),
      in: vi.fn((column: string, value: unknown) => {
        predicates.push([table, column, value]);
        return query;
      }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: rows[table]?.[0] ?? null, error: null })),
      single: vi.fn(async () => ({ data: rows[table]?.[0] ?? null, error: null })),
      then: (resolve: (value: unknown) => void) => resolve({ data: rows[table] ?? [], error: null }),
    };
    return query;
  });
  const rpc = vi.fn(async (name: string) => ({ data: rpcValues[name] ?? null, error: rpcErrors[name] ?? null }));
  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc, reads, predicates };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActor).mockResolvedValue(actor);
});

describe("recipient notifications", () => {
  it("returns a bounded owner feed with required categories always enabled", async () => {
    const fixture = database({
      notifications: [
        {
          id: notificationId,
          category: "session",
          title: "Session",
          body: "Update",
          target_path: "/sessions",
          read_at: null,
          created_at: "2026-11-08T10:00:00Z",
        },
      ],
      notification_preferences: [
        { category: "booking", email_enabled: false },
        { category: "assignment", email_enabled: true },
      ],
    });
    const workspace = await readNotificationWorkspace(fixture.client);
    expect(workspace.notifications).toHaveLength(1);
    expect(workspace.notifications[0]).toMatchObject({ id: notificationId, targetPath: "/sessions" });
    expect(workspace.preferences).toHaveLength(8);
    expect(workspace.preferences.find((preference) => preference.category === "booking")).toMatchObject({
      emailEnabled: true,
      required: true,
    });
    expect(workspace.preferences.find((preference) => preference.category === "assignment")).toMatchObject({
      emailEnabled: true,
      required: false,
    });
    expect(fixture.predicates).toContainEqual(["notifications", "recipient_id", userId]);
    expect(fixture.predicates).toContainEqual(["notification_preferences", "user_id", userId]);
  });

  it("sends read changes only through the recipient-checked RPC", async () => {
    const fixture = database({}, { mark_notification_read: "2026-11-08T12:00:00Z" });
    await expect(markNotificationRead(fixture.client, notificationId)).resolves.toBe("2026-11-08T12:00:00Z");
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("mark_notification_read", { notification: notificationId });
    await expect(markNotificationRead(fixture.client, "not-a-uuid")).rejects.toBeInstanceOf(InputError);
  });

  it("preserves required notices when a user disables their email preference", async () => {
    const fixture = database({}, { save_notification_preference: false });
    await expect(
      saveNotificationPreference(fixture.client, { category: "booking", emailEnabled: false }),
    ).resolves.toMatchObject({
      category: "booking",
      emailEnabled: true,
      required: true,
    });
    await expect(
      saveNotificationPreference(fixture.client, { category: "assignment", emailEnabled: false }),
    ).resolves.toMatchObject({
      category: "assignment",
      emailEnabled: false,
      required: false,
    });
    expect(fixture.rpc).toHaveBeenNthCalledWith(1, "save_notification_preference", {
      requested_category: "booking",
      requested_email_enabled: false,
    });
  });
});

describe("Resend delivery webhooks", () => {
  it("verifies the timestamped raw body and records the provider event through the service-role RPC", async () => {
    const signingKey = Buffer.from("unit-test-resend-webhook-key");
    const secret = `whsec_${signingKey.toString("base64")}`;
    const eventId = "evt_delivery_001";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: "email_provider_123" },
    });
    const signature = createHmac("sha256", signingKey).update(`${eventId}.${timestamp}.${body}`).digest("base64");
    const before = {
      secret: process.env.RESEND_WEBHOOK_SECRET,
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    process.env.RESEND_WEBHOOK_SECRET = secret;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://unit-test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-service-key";
    serviceRoleRpc.mockResolvedValue({
      data: [{ duplicate: false, matched: true, delivery_state: "delivered" }],
      error: null,
    });
    try {
      await expect(
        observeResendDeliveryWebhook(body, {
          id: eventId,
          timestamp,
          signature: `v1,${signature}`,
        }),
      ).resolves.toEqual({ duplicate: false, matched: true, deliveryState: "delivered" });
      expect(serviceRoleRpc).toHaveBeenCalledExactlyOnceWith("record_resend_delivery_event", {
        event_id: eventId,
        provider_email_id: "email_provider_123",
        event_type: "email.delivered",
        event_created_at: JSON.parse(body).created_at,
      });
    } finally {
      if (before.secret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
      else process.env.RESEND_WEBHOOK_SECRET = before.secret;
      if (before.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = before.url;
      if (before.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = before.key;
      serviceRoleRpc.mockReset();
    }
  });

  it("rejects stale or invalid signatures before creating an admin database client", async () => {
    const before = process.env.RESEND_WEBHOOK_SECRET;
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from("unit-test-key").toString("base64")}`;
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600);
    try {
      await expect(
        observeResendDeliveryWebhook("{}", {
          id: "evt_old",
          timestamp: oldTimestamp,
          signature: "v1,invalid",
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(serviceRoleRpc).not.toHaveBeenCalled();
    } finally {
      if (before === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
      else process.env.RESEND_WEBHOOK_SECRET = before;
    }
  });
});

describe("authorization boundaries", () => {
  it("does not invoke admin search for a student even if caller code requests an admin workspace", async () => {
    const fixture = database();
    await expect(readAdminWorkspace(fixture.client)).rejects.toMatchObject({ code: "forbidden" });
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(fixture.from).not.toHaveBeenCalled();
  });

  it("requires exactly one report target and returns only the opaque report ID", async () => {
    const fixture = database({}, { submit_safety_report: notificationId });
    await expect(
      submitSafetyReport(fixture.client, { targetUserId: userId, targetReviewId: notificationId, reason: "Concern" }),
    ).rejects.toBeInstanceOf(InputError);
    await expect(
      submitSafetyReport(fixture.client, { targetTutorId: notificationId, reason: "Concern" }),
    ).resolves.toEqual({ id: notificationId });
    expect(fixture.rpc).toHaveBeenCalledWith("submit_safety_report", {
      tutor: notificationId,
      target_user: null,
      target_review: null,
      report_reason: "Concern",
    });
  });

  it("rejects assistant prompts without explicitly selected context before provider access", async () => {
    delete process.env.OPENAI_API_KEY;
    const fixture = database();
    await expect(askLearningAssistant(fixture.client, { question: "Help me study" })).rejects.toBeInstanceOf(
      InputError,
    );
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(fixture.reads).toHaveLength(0);
  });

  it("sends only explicitly selected approved resources and returns a draft-only provider answer", async () => {
    const resourceId = "00000000-0000-4000-8000-000000000201";
    const fixture = database(
      {
        resources: [
          {
            id: resourceId,
            subject_id: null,
            title: "Fraction practice",
            description: "A short public exercise.",
            url: "https://resources.example/fractions",
            resource_type: "practice",
            attribution: "TutorPlus",
            active: true,
          },
        ],
      },
      { start_assistant_request: "assistant-request" },
    );
    const before = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL };
    process.env.OPENAI_API_KEY = "unit-test-key";
    process.env.OPENAI_MODEL = "gpt-6-test";
    let sentBody = "";
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ id: "resp_1", status: "completed", output_text: "Try the practice." }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await askLearningAssistant(fixture.client, {
        question: "Can you explain fractions?",
        resourceIds: [resourceId],
      });
      expect(result).toMatchObject({ answer: "Try the practice.", draftOnly: true });
      expect(result.resources.map((resource) => resource.id)).toEqual([resourceId]);
      expect(fixture.predicates).toContainEqual(["resources", "id", [resourceId]]);
      expect(fixture.rpc).toHaveBeenCalledWith(
        "start_assistant_request",
        expect.objectContaining({ selected_context: { resourceIds: [resourceId] } }),
      );
      const request = JSON.parse(sentBody) as { input: Array<{ content: Array<{ text: string }> }> };
      expect(request.input[1]?.content[0]?.text).toContain("Fraction practice");
      expect(request.input[1]?.content[0]?.text).not.toContain("unselected");
      expect(fixture.rpc).toHaveBeenCalledWith(
        "finish_assistant_request",
        expect.objectContaining({ request: "assistant-request", outcome: "succeeded" }),
      );
    } finally {
      vi.unstubAllGlobals();
      if (before.key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = before.key;
      if (before.model === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = before.model;
    }
  });

  it("stops at the database quota boundary and records provider failures without fabricating an answer", async () => {
    const resourceId = "00000000-0000-4000-8000-000000000202";
    const quota = database(
      {
        resources: [
          {
            id: resourceId,
            subject_id: null,
            title: "Resource",
            description: "",
            url: "https://x.test",
            resource_type: "article",
            attribution: null,
            active: true,
          },
        ],
      },
      {},
      { start_assistant_request: { code: "22023" } },
    );
    const before = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL };
    process.env.OPENAI_API_KEY = "unit-test-key";
    process.env.OPENAI_MODEL = "gpt-6-test";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        askLearningAssistant(quota.client, { question: "Help", resourceIds: [resourceId] }),
      ).rejects.toBeInstanceOf(InputError);
      expect(fetchMock).not.toHaveBeenCalled();

      const unavailable = database(
        {
          resources: [
            {
              id: resourceId,
              subject_id: null,
              title: "Resource",
              description: "",
              url: "https://x.test",
              resource_type: "article",
              attribution: null,
              active: true,
            },
          ],
        },
        { start_assistant_request: "assistant-request" },
      );
      fetchMock.mockResolvedValue(new Response("provider unavailable", { status: 503 }));
      await expect(
        askLearningAssistant(unavailable.client, { question: "Help", resourceIds: [resourceId] }),
      ).rejects.toBeInstanceOf(DomainError);
      expect(unavailable.rpc).toHaveBeenCalledWith(
        "finish_assistant_request",
        expect.objectContaining({ request: "assistant-request", outcome: "failed" }),
      );
    } finally {
      vi.unstubAllGlobals();
      if (before.key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = before.key;
      if (before.model === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = before.model;
    }
  });
});

describe("baseline admin templates, reputation and assistant reports", () => {
  const question = {
    prompt: "Which value is larger?",
    kind: "single_choice" as const,
    choices: ["1/2", "1/3"],
    points: 2,
    correctChoice: "1/2",
    topic: "Fractions",
  };

  it("denies non-admin template authoring before any database call", async () => {
    const fixture = database();
    vi.mocked(getActor).mockResolvedValue(actor);
    await expect(
      saveAssessmentTemplate(fixture.client, {
        title: "Fractions",
        description: "",
        purpose: "diagnostic",
        active: true,
        questions: [question],
        confirmed: true,
        reason: "Approved",
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ code: "forbidden" });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("validates template answer keys and badge thresholds before persistence", async () => {
    const fixture = database();
    vi.mocked(getActor).mockResolvedValue({ ...actor, roles: ["administrator"] });
    await expect(
      saveAssessmentTemplate(fixture.client, {
        title: "Fractions",
        description: "",
        purpose: "diagnostic",
        active: true,
        questions: [{ ...question, correctChoice: "not listed" }],
        confirmed: true,
        reason: "Approved",
      }),
    ).rejects.toBeInstanceOf(InputError);
    await expect(
      saveBadgePolicy(fixture.client, {
        expectedVersion: 1,
        confirmed: true,
        reason: "Policy revision",
        thresholds: [{ fact: "rating_average", threshold: 5.5, label: "Unsupported score" }],
      }),
    ).rejects.toBeInstanceOf(InputError);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("normalizes multiline template and resource descriptions before exact limits", async () => {
    const templateId = "00000000-0000-4000-8000-000000000103";
    const templateDescription = `${"x".repeat(3998)}\r\ny`;
    const normalizedTemplateDescription = `${"x".repeat(3998)}\ny`;
    const questionRow = {
      prompt: "Which value is larger?",
      kind: "single_choice",
      choices: ["1/2", "1/3"],
      points: 2,
      correct_choice: "1/2",
      topic: "Fractions",
    };
    const templateFixture = database(
      {},
      {
        save_assessment_template: [{ template_id: templateId, version_no: 1 }],
        admin_read_assessment_templates: [
          {
            template_id: templateId,
            version_no: 1,
            title: "Fractions",
            description: normalizedTemplateDescription,
            subject_id: null,
            purpose: "diagnostic",
            active: true,
            questions: [questionRow],
            created_at: "2026-11-08T12:00:00Z",
          },
        ],
      },
    );
    vi.mocked(getActor).mockResolvedValue({ ...actor, roles: ["administrator"] });
    await expect(
      saveAssessmentTemplate(templateFixture.client, {
        title: "Fractions",
        description: templateDescription,
        purpose: "diagnostic",
        active: true,
        questions: [question],
        confirmed: true,
        reason: "Approved",
      }),
    ).resolves.toMatchObject({ description: normalizedTemplateDescription });
    expect(templateFixture.rpc).toHaveBeenCalledWith(
      "save_assessment_template",
      expect.objectContaining({ p_description: normalizedTemplateDescription }),
    );
    await expect(
      saveAssessmentTemplate(templateFixture.client, {
        title: "Fractions",
        description: `${"x".repeat(3999)}\r\ny`,
        purpose: "diagnostic",
        active: true,
        questions: [question],
        confirmed: true,
        reason: "Approved",
      }),
    ).rejects.toBeInstanceOf(InputError);
    expect(templateFixture.rpc).toHaveBeenCalledTimes(2);

    const resourceId = "00000000-0000-4000-8000-000000000104";
    const resourceDescription = `${"x".repeat(1998)}\r\ny`;
    const normalizedResourceDescription = `${"x".repeat(1998)}\ny`;
    const resourceFixture = database(
      {
        resources: [
          {
            id: resourceId,
            subject_id: null,
            title: "Fractions",
            description: normalizedResourceDescription,
            url: "https://example.invalid/guide",
            resource_type: "article",
            attribution: null,
            active: true,
          },
        ],
      },
      { save_resource: resourceId },
    );
    await expect(
      saveResource(resourceFixture.client, {
        title: "Fractions",
        description: resourceDescription,
        url: "https://example.invalid/guide",
        resourceType: "article",
        active: true,
        confirmed: true,
        reason: "Approved",
      }),
    ).resolves.toMatchObject({ description: normalizedResourceDescription });
    expect(resourceFixture.rpc).toHaveBeenCalledWith(
      "save_resource",
      expect.objectContaining({ resource_description: normalizedResourceDescription }),
    );
    await expect(
      saveResource(resourceFixture.client, {
        title: "Fractions",
        description: `${"x".repeat(1999)}\r\ny`,
        url: "https://example.invalid/guide",
        resourceType: "article",
        active: true,
        confirmed: true,
        reason: "Approved",
      }),
    ).rejects.toBeInstanceOf(InputError);
    expect(resourceFixture.rpc).toHaveBeenCalledExactlyOnceWith("save_resource", expect.anything());
  });

  it("limits template reuse to tutors and requires student ownership for AI reports", async () => {
    const fixture = database({ reports: [] }, { report_assistant_response: notificationId });
    vi.mocked(getActor).mockResolvedValue(actor);
    await expect(
      createAssessmentFromTemplate(fixture.client, {
        templateId: notificationId,
        bookingId: notificationId,
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ code: "forbidden" });
    const reportReason = `${"x".repeat(998)}\r\ny`;
    const normalizedReportReason = `${"x".repeat(998)}\ny`;
    await expect(
      reportAssistantResponse(fixture.client, { requestId: notificationId, reason: reportReason }),
    ).resolves.toEqual({ id: notificationId });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("report_assistant_response", {
      request: notificationId,
      report_reason: normalizedReportReason,
    });
    await expect(
      reportAssistantResponse(fixture.client, {
        requestId: notificationId,
        reason: `${"x".repeat(999)}\r\ny`,
      }),
    ).rejects.toBeInstanceOf(InputError);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("report_assistant_response", {
      request: notificationId,
      report_reason: normalizedReportReason,
    });
  });

  it("requires administrator role and explicit confirmation to resolve AI reports", async () => {
    const fixture = database();
    vi.mocked(getActor).mockResolvedValue(actor);
    await expect(
      resolveAssistantResponseReport(fixture.client, {
        id: notificationId,
        state: "resolved",
        confirmed: true,
        reason: "Reviewed",
      }),
    ).rejects.toMatchObject<Partial<DomainError>>({ code: "forbidden" });
    vi.mocked(getActor).mockResolvedValue({ ...actor, roles: ["administrator"] });
    await expect(
      resolveAssistantResponseReport(fixture.client, {
        id: notificationId,
        state: "resolved",
        confirmed: false,
        reason: "Reviewed",
      } as never),
    ).rejects.toBeInstanceOf(InputError);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});
