import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../auth/service";
import { requireRole } from "../auth/policy";
import { getStudyPlan } from "../learning/service";
import { SessionPlanService } from "../sessions/service";
import { DomainError, InputError } from "../shared/errors";
import type {
  AssessmentTemplate,
  AssessmentTemplateQuestion,
  AssistantResponseReport,
  BadgePolicy,
  BadgeThreshold,
  AdminUser,
  AdminReview,
  AdminWorkspace,
  AskLearningAssistantInput,
  AssistantStatus,
  AuditEntry,
  GeocodeTutorLocationInput,
  GeocodeTutorLocationResult,
  LearningAssistantResult,
  MatchingFactorVersion,
  ModerateReviewInput,
  NotificationCategory,
  NotificationItem,
  NotificationPreference,
  NotificationTemplate,
  NotificationWorkspace,
  OperationalHealthMetric,
  ObservedDeliveryWebhookResult,
  OutboxWorkerResult,
  ReadAdminWorkspaceOptions,
  Resource,
  ResendDeliveryWebhookHeaders,
  ResolveSafetyReportInput,
  SafetyReport,
  SafetyReportInput,
  SafetyWorkspace,
  SaveMatchingFactorsInput,
  SaveNotificationPreferenceInput,
  SaveNotificationTemplateInput,
  SaveResourceInput,
  SaveAssessmentTemplateInput,
  SaveBadgePolicyInput,
  SaveSubjectInput,
  SetAdminUserStatusInput,
  SetAdminUserRoleInput,
  Subject,
  TutorAssessmentTemplate,
  ResolveAssistantResponseReportInput,
} from "./types";

const CATEGORIES: readonly NotificationCategory[] = [
  "booking",
  "session",
  "assessment",
  "assignment",
  "study_plan",
  "review",
  "safety",
  "system",
];
const REQUIRED_CATEGORIES = new Set<NotificationCategory>(["booking", "safety", "system"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOURCE_TYPES = new Set(["article", "video", "practice", "reference", "other"]);
const AI_CAVEAT =
  "AI-generated study guidance can be incomplete or wrong. Check it against course materials and ask your tutor when unsure. This response is a draft and does not change your records.";

type DbError = { code?: string };
type NotificationRow = {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  target_path: string | null;
  read_at: string | null;
  created_at: string;
  delivery_state?: NotificationItem["deliveryState"];
};
type PreferenceRow = { category: NotificationCategory; email_enabled: boolean };
type ResourceRow = {
  id: string;
  subject_id: string | null;
  title: string;
  description: string;
  url: string;
  resource_type: Resource["resourceType"];
  attribution: string | null;
  active: boolean;
};
type SubjectRow = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  active: boolean;
  sort_order: number;
};
type ReportRow = {
  id: string;
  reporter_id: string;
  target_user_id: string | null;
  target_review_id: string | null;
  reason: string;
  state: SafetyReport["state"];
  resolution_reason: string | null;
  created_at: string;
  resolved_at: string | null;
};
type AuditRow = {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
  created_at: string;
};
type TemplateRow = {
  id: string;
  version: number;
  category: NotificationCategory;
  title: string;
  body: string;
  target_path: string | null;
  active: boolean;
  updated_at: string;
};
type UserRow = {
  id: string;
  email: string | null;
  display_name: string;
  status: "active" | "inactive";
  roles: string[];
  created_at: string;
};
type ReviewRow = {
  id: string;
  tutor_id: string;
  rating: number;
  comment: string | null;
  recommended: boolean;
  status: "visible" | "hidden";
  created_at: string;
};
type AssessmentTemplateRow = {
  template_id: string;
  version_no: number;
  title: string;
  description: string;
  subject_id: string | null;
  purpose: AssessmentTemplate["purpose"];
  active?: boolean;
  questions: unknown;
  created_at: string;
};
type AssistantResponseReportRow = {
  id: string;
  reporter_id: string;
  request_id: string;
  reason: string;
  state: AssistantResponseReport["state"];
  resolved_by: string | null;
  resolution_reason: string | null;
  created_at: string;
  resolved_at: string | null;
};
type OperationalHealthRow = { metric_key: string; metric_value: number | string; window_start: string | null };
type BadgePolicyRow = { version: number; thresholds: unknown; created_at: string };
type ClaimedNotice = {
  id: string;
  recipient_email: string;
  category: NotificationCategory;
  title: string;
  body: string;
  target_path: string | null;
  email_enabled: boolean;
  provider_email_id?: string | null;
};

function unavailable(error?: DbError): never {
  if (error?.code === "42501") throw new DomainError("forbidden");
  throw new DomainError("unavailable");
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new InputError({ [field]: "Enter valid text." });
  const clean = normalizeLineEndings(value).trim();
  if (!clean || clean.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(clean)) {
    throw new InputError({ [field]: `Use 1 to ${max} characters.` });
  }
  return clean;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requiredText(value, field, max);
}

function id(value: unknown, field: string, optional = false): string | undefined {
  if (optional && (value === undefined || value === null || value === "")) return undefined;
  if (typeof value !== "string" || !UUID.test(value)) throw new InputError({ [field]: "Choose a valid item." });
  return value.toLowerCase();
}

function toNotification(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    targetPath: row.target_path,
    readAt: row.read_at,
    createdAt: row.created_at,
    ...(row.delivery_state ? { deliveryState: row.delivery_state } : {}),
  };
}

function toResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    subjectId: row.subject_id,
    title: row.title,
    description: row.description,
    url: row.url,
    resourceType: row.resource_type,
    attribution: row.attribution,
    active: row.active,
  };
}

function toSubject(row: SubjectRow): Subject {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    parentId: row.parent_id,
    active: row.active,
    sortOrder: row.sort_order,
  };
}

function toReport(row: ReportRow): SafetyReport {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    targetUserId: row.target_user_id,
    targetReviewId: row.target_review_id,
    reason: row.reason,
    state: row.state,
    resolutionReason: row.resolution_reason,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function toAudit(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function templateQuestions(value: unknown): AssessmentTemplateQuestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new DomainError("unavailable");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new DomainError("unavailable");
    const row = entry as Record<string, unknown>;
    if (
      typeof row.prompt !== "string" ||
      (row.kind !== "single_choice" && row.kind !== "short_answer") ||
      !Number.isSafeInteger(row.points) ||
      typeof row.topic !== "string" ||
      (row.choices !== null &&
        (!Array.isArray(row.choices) || row.choices.some((choice) => typeof choice !== "string"))) ||
      (row.correct_choice !== null && typeof row.correct_choice !== "string")
    ) {
      throw new DomainError("unavailable");
    }
    return {
      prompt: row.prompt,
      kind: row.kind,
      choices: row.choices as string[] | null,
      points: Number(row.points),
      correctChoice: row.correct_choice as string | null,
      topic: row.topic,
    };
  });
}

function toAssessmentTemplate(row: AssessmentTemplateRow): AssessmentTemplate {
  return {
    id: row.template_id,
    version: row.version_no,
    title: row.title,
    description: row.description,
    subjectId: row.subject_id,
    purpose: row.purpose,
    active: row.active === true,
    questions: templateQuestions(row.questions),
    createdAt: row.created_at,
  };
}

function toTutorAssessmentTemplate(row: AssessmentTemplateRow): TutorAssessmentTemplate {
  const template = toAssessmentTemplate(row);
  return {
    id: template.id,
    version: template.version,
    title: template.title,
    description: template.description,
    subjectId: template.subjectId,
    purpose: template.purpose,
    questions: template.questions,
    createdAt: template.createdAt,
  };
}

function toAssistantResponseReport(row: AssistantResponseReportRow): AssistantResponseReport {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    requestId: row.request_id,
    reason: row.reason,
    state: row.state,
    resolvedBy: row.resolved_by,
    resolutionReason: row.resolution_reason,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function toTemplate(row: TemplateRow): NotificationTemplate {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    targetPath: row.target_path,
    active: row.active,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

/** Reads a bounded recipient-only feed and includes default values for every preference. */
export async function readNotificationWorkspace(client: SupabaseClient): Promise<NotificationWorkspace> {
  const actor = await getActor(client);
  const [notifications, preferences] = await Promise.all([
    client
      .from("notifications")
      .select("id,category,title,body,target_path,read_at,created_at,delivery_state")
      .eq("recipient_id", actor.id)
      .order("created_at", { ascending: false })
      .limit(100),
    client.from("notification_preferences").select("category,email_enabled").eq("user_id", actor.id),
  ]);
  if (notifications.error || preferences.error) unavailable(notifications.error ?? preferences.error ?? undefined);
  const saved = new Map(((preferences.data ?? []) as PreferenceRow[]).map((row) => [row.category, row.email_enabled]));
  return {
    notifications: ((notifications.data ?? []) as NotificationRow[]).map(toNotification),
    preferences: CATEGORIES.map((category): NotificationPreference => ({
      category,
      emailEnabled: REQUIRED_CATEGORIES.has(category) || (saved.get(category) ?? false),
      required: REQUIRED_CATEGORIES.has(category),
    })),
  };
}

export async function markNotificationRead(client: SupabaseClient, notificationId: string): Promise<string> {
  const actor = await getActor(client);
  const notification = id(notificationId, "notificationId") as string;
  const { data, error } = await client.rpc("mark_notification_read", { notification });
  if (error) unavailable(error);
  if (typeof data !== "string") throw new DomainError("unavailable");
  void actor;
  return data;
}

export async function saveNotificationPreference(
  client: SupabaseClient,
  value: SaveNotificationPreferenceInput,
): Promise<NotificationPreference> {
  await getActor(client);
  if (!CATEGORIES.includes(value.category) || typeof value.emailEnabled !== "boolean")
    throw new InputError({ preference: "Choose a valid notice preference." });
  const { data, error } = await client.rpc("save_notification_preference", {
    requested_category: value.category,
    requested_email_enabled: value.emailEnabled,
  });
  if (error) unavailable(error);
  const required = REQUIRED_CATEGORIES.has(value.category);
  return { category: value.category, emailEnabled: required || data === true, required };
}

/** Reads only approved, active catalog entries and never returns an arbitrary URL from user input. */
export async function listResources(
  client: SupabaseClient,
  options: { subjectId?: string; query?: string } = {},
): Promise<Resource[]> {
  const subjectId = id(options.subjectId, "subjectId", true);
  const query = options.query === undefined ? "" : requiredText(options.query, "query", 120);
  let request = client
    .from("resources")
    .select("id,subject_id,title,description,url,resource_type,attribution,active")
    .eq("active", true)
    .order("title", { ascending: true })
    .limit(50);
  if (subjectId) request = request.eq("subject_id", subjectId);
  if (query) {
    const escaped = query.replace(/[\\%_]/g, (character) => `\\${character}`);
    request = request.or(`title.ilike.%${escaped}%,description.ilike.%${escaped}%`);
  }
  const { data, error } = await request;
  if (error) unavailable(error);
  return ((data ?? []) as ResourceRow[]).map(toResource);
}

export async function submitSafetyReport(client: SupabaseClient, value: SafetyReportInput): Promise<{ id: string }> {
  await getActor(client);
  const tutor = id(value.targetTutorId, "targetTutorId", true);
  const targetUser = id(value.targetUserId, "targetUserId", true);
  const targetReview = id(value.targetReviewId, "targetReviewId", true);
  if ([tutor, targetUser, targetReview].filter(Boolean).length !== 1)
    throw new InputError({ target: "Choose one report target." });
  const reason = requiredText(value.reason, "reason", 2000);
  const { data, error } = await client.rpc("submit_safety_report", {
    tutor: tutor ?? null,
    target_user: targetUser ?? null,
    target_review: targetReview ?? null,
    report_reason: reason,
  });
  if (error) unavailable(error);
  if (typeof data !== "string") throw new DomainError("unavailable");
  return { id: data };
}

async function readAdminMatchingFactors(client: SupabaseClient): Promise<MatchingFactorVersion | null> {
  const { data, error } = await client.rpc("read_matching_factor_version");
  if (error) unavailable(error);
  if (!data) return null;
  const row = (Array.isArray(data) ? data[0] : data) as {
    version?: number;
    factors?: unknown;
    created_at?: string;
  } | null;
  if (!row || typeof row.version !== "number" || !Array.isArray(row.factors)) return null;
  return {
    version: row.version,
    factors: row.factors as MatchingFactorVersion["factors"],
    createdAt: row.created_at ?? "",
  };
}

/** Administrator-only cross-domain workspace. Every backing query still applies RLS or an admin RPC. */
export async function readSafetyWorkspace(client: SupabaseClient): Promise<SafetyWorkspace> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  const [reports, subjects, resources, audit, templates, factors] = await Promise.all([
    client
      .from("safety_reports")
      .select("id,reporter_id,target_user_id,target_review_id,reason,state,resolution_reason,created_at,resolved_at")
      .order("created_at", { ascending: false })
      .limit(200),
    client
      .from("subjects")
      .select("id,name,slug,parent_id,active,sort_order")
      .order("sort_order")
      .order("name")
      .limit(500),
    client
      .from("resources")
      .select("id,subject_id,title,description,url,resource_type,attribution,active")
      .order("title")
      .limit(200),
    client
      .from("audit_logs")
      .select("id,actor_id,action,entity_type,entity_id,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    client
      .from("notification_templates")
      .select("id,version,category,title,body,target_path,active,updated_at")
      .order("updated_at", { ascending: false })
      .limit(200),
    readAdminMatchingFactors(client),
  ]);
  if (reports.error || subjects.error || resources.error || audit.error || templates.error)
    unavailable(reports.error ?? subjects.error ?? resources.error ?? audit.error ?? templates.error ?? undefined);
  return {
    reports: ((reports.data ?? []) as ReportRow[]).map(toReport),
    subjects: ((subjects.data ?? []) as SubjectRow[]).map(toSubject),
    resources: ((resources.data ?? []) as ResourceRow[]).map(toResource),
    audit: ((audit.data ?? []) as AuditRow[]).map(toAudit),
    templates: ((templates.data ?? []) as TemplateRow[]).map(toTemplate),
    matchingFactors: factors,
  };
}

/** Administrator-only current template versions; this DTO includes answer keys for authorized authoring. */
export async function readAdminAssessmentTemplates(client: SupabaseClient): Promise<AssessmentTemplate[]> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  const { data, error } = await client.rpc("admin_read_assessment_templates", { page_size: 200, page_offset: 0 });
  if (error || !Array.isArray(data)) unavailable(error ?? undefined);
  return (data as AssessmentTemplateRow[]).map(toAssessmentTemplate);
}

/** Tutor-visible templates are scoped by the selected, server-verified booking subject and owning tutor. */
export async function readTutorAssessmentTemplates(
  client: SupabaseClient,
  bookingId: string,
): Promise<TutorAssessmentTemplate[]> {
  const actor = await getActor(client);
  requireRole(actor, "tutor");
  const booking = id(bookingId, "bookingId") as string;
  const { data, error } = await client.rpc("tutor_read_assessment_templates", { selected_booking: booking });
  if (error || !Array.isArray(data)) unavailable(error ?? undefined);
  return (data as AssessmentTemplateRow[]).map(toTutorAssessmentTemplate);
}

function assessmentTemplatePayload(value: SaveAssessmentTemplateInput): {
  questions: Array<Record<string, unknown>>;
  id?: string;
  expectedVersion?: number;
  title: string;
  description: string;
  subjectId: string | null;
  purpose: AssessmentTemplate["purpose"];
  active: boolean;
  reason: string;
} {
  if (value.confirmed !== true) throw new InputError({ confirmed: "Confirm this template version." });
  const templateId = id(value.id, "id", true);
  if (templateId && (!Number.isSafeInteger(value.expectedVersion) || (value.expectedVersion as number) < 1))
    throw new InputError({ expectedVersion: "Reload the current template before saving." });
  const title = requiredText(value.title, "title", 200);
  if (typeof value.description !== "string") throw new InputError({ description: "Enter valid text." });
  const description = normalizeLineEndings(value.description).trim();
  if (description.length > 4000) throw new InputError({ description: "Use at most 4000 characters." });
  if (!(["diagnostic", "pre_session", "post_session", "milestone"] as const).includes(value.purpose))
    throw new InputError({ purpose: "Choose a valid assessment purpose." });
  if (typeof value.active !== "boolean") throw new InputError({ active: "Choose whether the template is active." });
  if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 100)
    throw new InputError({ questions: "Add between 1 and 100 questions." });
  const questions = value.questions.map((question, index) => {
    const prompt = requiredText(question.prompt, `questions.${index}.prompt`, 2000);
    const topic = requiredText(question.topic, `questions.${index}.topic`, 200);
    if (!Number.isSafeInteger(question.points) || question.points < 1 || question.points > 100)
      throw new InputError({ [`questions.${index}.points`]: "Use a whole-number score from 1 to 100." });
    if (question.kind === "single_choice") {
      if (!Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 10)
        throw new InputError({ [`questions.${index}.choices`]: "Add 2 to 10 answer choices." });
      const choices = question.choices.map((choice) => requiredText(choice, `questions.${index}.choices`, 500));
      if (new Set(choices).size !== choices.length || !choices.includes(question.correctChoice ?? ""))
        throw new InputError({ [`questions.${index}.correctChoice`]: "Choose one of the distinct answer choices." });
      return {
        prompt,
        topic,
        kind: question.kind,
        choices,
        points: question.points,
        correct_choice: question.correctChoice,
      };
    }
    if (question.kind !== "short_answer" || question.choices !== null || question.correctChoice !== null)
      throw new InputError({ [`questions.${index}`]: "Short-answer questions cannot include answer keys or choices." });
    return { prompt, topic, kind: question.kind, choices: null, points: question.points, correct_choice: null };
  });
  return {
    ...(templateId ? { id: templateId, expectedVersion: value.expectedVersion } : {}),
    title,
    description,
    subjectId: id(value.subjectId, "subjectId", true) ?? null,
    purpose: value.purpose,
    active: value.active,
    questions,
    reason: requiredText(value.reason, "reason", 500),
  };
}

/** Saves a new immutable, audited admin template version with optimistic concurrency. */
export async function saveAssessmentTemplate(
  client: SupabaseClient,
  value: SaveAssessmentTemplateInput,
): Promise<AssessmentTemplate> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  const input = assessmentTemplatePayload(value);
  const { data, error } = await client.rpc("save_assessment_template", {
    p_template: input.id ?? null,
    p_expected_version: input.expectedVersion ?? null,
    p_title: input.title,
    p_description: input.description,
    p_subject: input.subjectId,
    p_purpose: input.purpose,
    p_questions: input.questions,
    p_active: input.active,
    p_confirmed: true,
    p_reason: input.reason,
  });
  if (error || !Array.isArray(data) || !data[0]) unavailable(error ?? undefined);
  const result = data[0] as { template_id?: unknown; version_no?: unknown };
  if (typeof result.template_id !== "string" || !Number.isSafeInteger(result.version_no))
    throw new DomainError("unavailable");
  const templates = await readAdminAssessmentTemplates(client);
  const saved = templates.find(
    (template) => template.id === result.template_id && template.version === result.version_no,
  );
  if (!saved) throw new DomainError("unavailable");
  return saved;
}

/** Creates a private draft from the template version selected for the tutor-owned booking. */
export async function createAssessmentFromTemplate(
  client: SupabaseClient,
  value: { templateId: string; bookingId: string },
): Promise<{ assessmentId: string }> {
  const actor = await getActor(client);
  requireRole(actor, "tutor");
  const templateId = id(value.templateId, "templateId") as string;
  const bookingId = id(value.bookingId, "bookingId") as string;
  const { data, error } = await client.rpc("create_assessment_from_template", {
    selected_template: templateId,
    selected_booking: bookingId,
  });
  if (error) unavailable(error);
  if (typeof data !== "string") throw new DomainError("unavailable");
  return { assessmentId: data };
}

function mapBadgeThresholds(value: unknown): BadgeThreshold[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) throw new DomainError("unavailable");
  const allowed = new Set(["completed_sessions", "visible_reviews", "rating_average", "recommendations"]);
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new DomainError("unavailable");
    const row = item as Record<string, unknown>;
    if (!allowed.has(String(row.fact)) || typeof row.threshold !== "number" || typeof row.label !== "string")
      throw new DomainError("unavailable");
    return { fact: row.fact as BadgeThreshold["fact"], threshold: row.threshold, label: row.label };
  });
}

export async function readBadgePolicy(client: SupabaseClient): Promise<BadgePolicy> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  const { data, error } = await client.rpc("admin_read_badge_policy");
  if (error || !Array.isArray(data) || !data[0]) unavailable(error ?? undefined);
  const row = data[0] as BadgePolicyRow;
  return { version: row.version, thresholds: mapBadgeThresholds(row.thresholds), createdAt: row.created_at };
}

export async function saveBadgePolicy(client: SupabaseClient, value: SaveBadgePolicyInput): Promise<BadgePolicy> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  if (value.confirmed !== true) throw new InputError({ confirmed: "Confirm this badge policy version." });
  if (!Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 1)
    throw new InputError({ expectedVersion: "Reload the current badge policy before saving." });
  const thresholds = mapBadgeThresholds(value.thresholds);
  const facts = new Set<string>();
  for (const [index, threshold] of thresholds.entries()) {
    const field = `thresholds.${index}`;
    if (facts.has(threshold.fact)) throw new InputError({ [field]: "Use each supported fact once." });
    facts.add(threshold.fact);
    if (
      threshold.fact === "rating_average"
        ? threshold.threshold < 1 || threshold.threshold > 5
        : threshold.threshold < 1 || threshold.threshold > 100000 || !Number.isSafeInteger(threshold.threshold)
    )
      throw new InputError({ [`${field}.threshold`]: "Choose a threshold within the supported range." });
    requiredText(threshold.label, `${field}.label`, 120);
  }
  const reason = requiredText(value.reason, "reason", 500);
  const { error } = await client.rpc("save_badge_policy", {
    expected_version: value.expectedVersion,
    thresholds,
    confirmed: true,
    reason,
  });
  if (error) unavailable(error);
  return readBadgePolicy(client);
}

/** A learner can report only a completed request owned by this account; database RPC performs the ownership check. */
export async function reportAssistantResponse(
  client: SupabaseClient,
  value: { requestId: string; reason: string },
): Promise<{ id: string }> {
  const actor = await getActor(client);
  requireRole(actor, "student");
  const request = id(value.requestId, "requestId") as string;
  const reason = requiredText(value.reason, "reason", 1000);
  const { data, error } = await client.rpc("report_assistant_response", { request, report_reason: reason });
  if (error) unavailable(error);
  if (typeof data !== "string") throw new DomainError("unavailable");
  return { id: data };
}

export async function resolveAssistantResponseReport(
  client: SupabaseClient,
  value: ResolveAssistantResponseReportInput,
): Promise<void> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  if (value.confirmed !== true) throw new InputError({ confirmed: "Confirm this report action." });
  if (!["reviewing", "resolved", "dismissed"].includes(value.state))
    throw new InputError({ state: "Choose a valid report state." });
  const { error } = await client.rpc("resolve_assistant_response_report", {
    report: id(value.id, "id"),
    requested_state: value.state,
    confirmed: true,
    reason: requiredText(value.reason, "reason", 500),
  });
  if (error) unavailable(error);
}

export async function readAdminOperationalHealth(client: SupabaseClient): Promise<OperationalHealthMetric[]> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  const { data, error } = await client.rpc("admin_read_operational_health");
  if (error || !Array.isArray(data)) unavailable(error ?? undefined);
  return (data as OperationalHealthRow[]).map((row) => ({
    key: row.metric_key,
    value: Number(row.metric_value),
    windowStart: row.window_start,
  }));
}

export async function readAdminWorkspace(
  client: SupabaseClient,
  options: ReadAdminWorkspaceOptions = {},
): Promise<AdminWorkspace> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  const page = Number.isSafeInteger(options.page) ? Math.max(1, options.page as number) : 1;
  const pageSize = Number.isSafeInteger(options.pageSize) ? Math.min(50, Math.max(1, options.pageSize as number)) : 25;
  const query =
    options.query === undefined || options.query.trim() === "" ? null : requiredText(options.query, "query", 120);
  const [
    workspace,
    usersResult,
    factorAuditResult,
    reviewResult,
    assistantReportsResult,
    operationalHealth,
    badgePolicy,
  ] = await Promise.all([
    readSafetyWorkspace(client),
    client.rpc("admin_search_users", {
      search_text: query,
      page_size: pageSize + 1,
      page_offset: (page - 1) * pageSize,
    }),
    client
      .from("audit_logs")
      .select("id,actor_id,action,entity_type,entity_id,reason,created_at")
      .eq("action", "matching.factor_version_saved")
      .order("created_at", { ascending: false })
      .limit(100),
    client
      .from("reviews")
      .select("id,tutor_id,rating,comment,recommended,status,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    client.rpc("admin_read_assistant_response_reports", { page_size: 200, page_offset: 0 }),
    readAdminOperationalHealth(client),
    readBadgePolicy(client),
  ]);
  if (usersResult.error || factorAuditResult.error || reviewResult.error || assistantReportsResult.error)
    unavailable(
      usersResult.error ?? factorAuditResult.error ?? reviewResult.error ?? assistantReportsResult.error ?? undefined,
    );
  const userRows = (usersResult.data ?? []) as UserRow[];
  const users: AdminUser[] = userRows.slice(0, pageSize).map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    roles: row.roles,
    createdAt: row.created_at,
  }));
  return {
    ...workspace,
    users,
    reviews: ((reviewResult.data ?? []) as ReviewRow[]).map((row): AdminReview => ({
      id: row.id,
      tutorId: row.tutor_id,
      rating: row.rating,
      comment: row.comment,
      recommended: row.recommended,
      moderationStatus: row.status,
      createdAt: row.created_at,
    })),
    hasMoreUsers: userRows.length > pageSize,
    matchingFactorAudit: ((factorAuditResult.data ?? []) as AuditRow[]).map(toAudit),
    assistantReports: ((assistantReportsResult.data ?? []) as AssistantResponseReportRow[]).map(
      toAssistantResponseReport,
    ),
    operationalHealth,
    badgePolicy,
  };
}

export async function resolveSafetyReport(client: SupabaseClient, value: ResolveSafetyReportInput): Promise<void> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  if (value.confirmed !== true) throw new InputError({ confirmed: "Confirm this report action." });
  const report = id(value.id, "id") as string;
  if (!["reviewing", "resolved", "dismissed"].includes(value.state))
    throw new InputError({ state: "Choose a valid report state." });
  const reason = requiredText(value.reason, "reason", 500);
  const { error } = await client.rpc("resolve_safety_report", { report, requested_state: value.state, reason });
  if (error) unavailable(error);
}

export async function moderateReview(client: SupabaseClient, value: ModerateReviewInput): Promise<void> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  if (value.confirmed !== true) throw new InputError({ confirmed: "Confirm this review moderation." });
  const review = id(value.id, "id") as string;
  if (value.status !== "visible" && value.status !== "hidden")
    throw new InputError({ status: "Choose a valid moderation state." });
  const reason = requiredText(value.reason, "reason", 500);
  const { error } = await client.rpc("moderate_review", { review, requested_status: value.status, reason });
  if (error) unavailable(error);
}

export async function saveResource(client: SupabaseClient, value: SaveResourceInput): Promise<Resource> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  if (value.confirmed !== true) throw new InputError({ confirmed: "Confirm this catalog change." });
  const resource = id(value.id, "id", true) ?? null;
  const subject = id(value.subjectId, "subjectId", true) ?? null;
  if (!RESOURCE_TYPES.has(value.resourceType)) throw new InputError({ resourceType: "Choose a resource type." });
  if (typeof value.active !== "boolean") throw new InputError({ active: "Choose whether this resource is active." });
  const title = requiredText(value.title, "title", 200);
  const description = normalizeLineEndings(value.description).trim();
  if (description.length > 2000) throw new InputError({ description: "Keep descriptions under 2,000 characters." });
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw new InputError({ url: "Enter a valid HTTPS URL." });
  }
  if (url.protocol !== "https:" || url.username || url.password || value.url.length > 2000)
    throw new InputError({ url: "Use a public HTTPS resource link." });
  const attribution = optionalText(value.attribution, "attribution", 500);
  const reason = requiredText(value.reason, "reason", 500);
  const { data: savedId, error } = await client.rpc("save_resource", {
    resource,
    subject,
    resource_title: title,
    resource_description: description,
    resource_url: url.toString(),
    resource_type: value.resourceType,
    resource_attribution: attribution,
    is_active: value.active,
    confirmed: true,
    reason,
  });
  if (error || typeof savedId !== "string") unavailable(error ?? undefined);
  const { data, error: readError } = await client
    .from("resources")
    .select("id,subject_id,title,description,url,resource_type,attribution,active")
    .eq("id", savedId)
    .single<ResourceRow>();
  if (readError || !data) unavailable(readError ?? undefined);
  return toResource(data);
}

export async function saveSubject(client: SupabaseClient, value: SaveSubjectInput): Promise<Subject> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  if (value.confirmed !== true) throw new InputError({ confirmed: "Confirm this subject catalog change." });
  const subject = id(value.id, "id", true) ?? null;
  const parent = id(value.parentId, "parentId", true) ?? null;
  const name = requiredText(value.name, "name", 100);
  const slug = requiredText(value.slug, "slug", 120);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))
    throw new InputError({ slug: "Use lowercase words separated by hyphens." });
  if (!Number.isSafeInteger(value.sortOrder) || value.sortOrder < -100000 || value.sortOrder > 100000)
    throw new InputError({ sortOrder: "Enter a valid display order." });
  const reason = requiredText(value.reason, "reason", 500);
  const { data: savedId, error } = await client.rpc("save_subject", {
    subject,
    subject_name: name,
    subject_slug: slug,
    parent,
    is_active: value.active,
    sort_position: value.sortOrder,
    confirmed: true,
    reason,
  });
  if (error || typeof savedId !== "string") unavailable(error ?? undefined);
  const { data, error: readError } = await client
    .from("subjects")
    .select("id,name,slug,parent_id,active,sort_order")
    .eq("id", savedId)
    .single<SubjectRow>();
  if (readError || !data) unavailable(readError ?? undefined);
  return toSubject(data);
}

export async function saveNotificationTemplate(
  client: SupabaseClient,
  value: SaveNotificationTemplateInput,
): Promise<NotificationTemplate> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  if (value.confirmed !== true) throw new InputError({ confirmed: "Confirm this template version." });
  if (!CATEGORIES.includes(value.category)) throw new InputError({ category: "Choose a valid notification category." });
  const template = id(value.id, "id", true) ?? null;
  const title = requiredText(value.title, "title", 200);
  const body = requiredText(value.body, "body", 2000);
  const targetPath = optionalText(value.targetPath, "targetPath", 500);
  if (targetPath && (!targetPath.startsWith("/") || targetPath.startsWith("//")))
    throw new InputError({ targetPath: "Use a path inside TutorPlus." });
  const reason = requiredText(value.reason, "reason", 500);
  const { data: savedId, error } = await client.rpc("save_notification_template", {
    template,
    category: value.category,
    template_title: title,
    template_body: body,
    target: targetPath,
    is_active: value.active,
    confirmed: true,
    reason,
  });
  if (error || typeof savedId !== "string") unavailable(error ?? undefined);
  const { data, error: readError } = await client
    .from("notification_templates")
    .select("id,version,category,title,body,target_path,active,updated_at")
    .eq("id", savedId)
    .order("version", { ascending: false })
    .limit(1)
    .single<TemplateRow>();
  if (readError || !data) unavailable(readError ?? undefined);
  return toTemplate(data);
}

export async function setAdminUserStatus(client: SupabaseClient, value: SetAdminUserStatusInput): Promise<void> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  if (value.confirmed !== true) throw new InputError({ confirmed: "Confirm this account status change." });
  const target = id(value.userId, "userId") as string;
  const reason = requiredText(value.reason, "reason", 500);
  const { error } = await client.rpc("set_admin_user_status", {
    target,
    active: value.active,
    confirmed: true,
    reason,
  });
  if (error) unavailable(error);
}

export async function setAdminUserRole(client: SupabaseClient, value: SetAdminUserRoleInput): Promise<void> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  if (value.confirmed !== true) throw new InputError({ confirmed: "Confirm this role change." });
  if (!["student", "tutor", "administrator"].includes(value.role))
    throw new InputError({ role: "Choose a valid role." });
  if (value.operation !== "grant" && value.operation !== "revoke")
    throw new InputError({ operation: "Choose grant or revoke." });
  const target = id(value.userId, "userId") as string;
  const reason = requiredText(value.reason, "reason", 500);
  const { error } = await client.rpc("set_admin_user_role", {
    target,
    requested_role: value.role,
    operation: value.operation,
    confirmed: true,
    reason,
  });
  if (error) unavailable(error);
}

export async function saveMatchingFactors(
  client: SupabaseClient,
  value: SaveMatchingFactorsInput,
): Promise<MatchingFactorVersion> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  if (value.confirmed !== true) throw new InputError({ confirmed: "Confirm this ranking-factor version." });
  const reason = requiredText(value.reason, "reason", 500);
  const { data, error } = await client.rpc("save_matching_factor_version", {
    factors: value.factors,
    reason,
    confirmed: true,
  });
  if (error) unavailable(error);
  const version = await readAdminMatchingFactors(client);
  if (!version || (typeof data === "number" && version.version !== data)) throw new DomainError("unavailable");
  return version;
}

/** Forward-geocodes a city/postal locality on the server. Permanent storage is requested so returned coordinates
 * may lawfully be persisted in a tutor listing; provider failure never turns into a missing radius filter. */
export async function geocodeTutorLocation(
  _client: SupabaseClient,
  value: GeocodeTutorLocationInput,
): Promise<GeocodeTutorLocationResult> {
  const token = process.env.MAPBOX_ACCESS_TOKEN?.trim();
  if (!token) return { configured: false, location: null, label: null, error: "not_configured" };
  const city = optionalText(value.city, "city", 100);
  const countryCode = requiredText(value.countryCode, "countryCode", 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new InputError({ countryCode: "Choose a two-letter country code." });
  const region = optionalText(value.region, "region", 100);
  const postalCode = optionalText(value.postalCode, "postalCode", 20);
  if (!city && !postalCode) throw new InputError({ city: "Enter a city or postal code." });
  const query = [city, region, postalCode, countryCode].filter(Boolean).join(", ");
  if (query.includes(";")) throw new InputError({ city: "Remove unsupported punctuation from the location." });
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", query);
  url.searchParams.set("country", countryCode.toLowerCase());
  url.searchParams.set("types", "place,postcode,locality,region");
  url.searchParams.set("autocomplete", "false");
  url.searchParams.set("permanent", "true");
  url.searchParams.set("limit", "1");
  url.searchParams.set("access_token", token);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return { configured: true, location: null, label: null, error: "provider_unavailable" };
    const payload = (await response.json()) as {
      features?: Array<{ geometry?: { coordinates?: unknown }; properties?: { name?: unknown } }>;
    };
    const feature = payload.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (
      !feature ||
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      typeof coordinates[0] !== "number" ||
      typeof coordinates[1] !== "number"
    ) {
      return { configured: true, location: null, label: null, error: "not_found" };
    }
    const [longitude, latitude] = coordinates;
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return { configured: true, location: null, label: null, error: "provider_unavailable" };
    }
    const label = typeof feature.properties?.name === "string" ? feature.properties.name.slice(0, 120) : query;
    return { configured: true, location: { latitude, longitude }, label, error: null };
  } catch {
    return { configured: true, location: null, label: null, error: "provider_unavailable" };
  }
}

export async function readAssistantStatus(): Promise<AssistantStatus> {
  return {
    configured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
    promptLimit: boundedEnvInteger("ASSISTANT_PROMPT_LIMIT", 100, 1, 10000),
  };
}

function openAIConfig(): { key: string; model: string; baseUrl: string } | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  return key && model ? { key, model, baseUrl } : null;
}

function boundedEnvInteger(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

async function recordAssistantOperationalOutcome(
  client: SupabaseClient,
  requestId: string,
  startedAt: number,
  outcome: "success" | "failure" | "rate_limited",
): Promise<void> {
  // Metrics are best-effort and contain no prompt, selected context, provider body or generated answer.
  try {
    await client.rpc("record_operational_event", {
      correlation: requestId,
      action_name: "assistant.response",
      event_category: "assistant",
      duration: Math.max(0, Math.min(120000, Date.now() - startedAt)),
      event_outcome: outcome,
    });
  } catch {
    // The underlying assistant outcome is canonical; a metrics outage must not rewrite it.
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] as string,
  );
}

function createServiceRoleClient(): SupabaseClient {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new DomainError("configuration");
  return createClient(base, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function authorizedJobToken(candidate: string | undefined): boolean {
  const expected = process.env.PLATFORM_JOB_SECRET;
  if (!candidate || !expected) return false;
  const actualBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/** Enqueues future 24-hour and 1-hour reminders. A last-minute booking receives no past-due reminder. */
export async function enqueueBookingRemindersJob(token: string | undefined): Promise<{ queued: number }> {
  if (!authorizedJobToken(token)) throw new DomainError("forbidden");
  const service = createServiceRoleClient();
  const [bookingNotices, learningNotices] = await Promise.all([
    service.rpc("enqueue_booking_reminders"),
    service.rpc("enqueue_learning_notices"),
  ]);
  if (
    bookingNotices.error ||
    learningNotices.error ||
    typeof bookingNotices.data !== "number" ||
    typeof learningNotices.data !== "number"
  ) {
    unavailable(bookingNotices.error ?? learningNotices.error ?? undefined);
  }
  return { queued: bookingNotices.data + learningNotices.data };
}

/** Processes a bounded outbox batch. Provider acceptance is recorded as acceptance, never as observed delivery. */
export async function processNotificationOutboxJob(token: string | undefined): Promise<OutboxWorkerResult> {
  if (!authorizedJobToken(token)) throw new DomainError("forbidden");
  const service = createServiceRoleClient();
  const { data, error } = await service.rpc("claim_notification_outbox", { batch_size: 50 });
  if (error || !Array.isArray(data)) unavailable(error ?? undefined);
  const result: OutboxWorkerResult = { claimed: data.length, accepted: 0, notConfigured: 0, retrying: 0, exhausted: 0 };
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  for (const raw of data as ClaimedNotice[]) {
    let outcome: "accepted" | "disabled" | "not_configured" | "retry" | "failed" = "disabled";
    let errorCode: string | null = null;
    if (raw.email_enabled) {
      if (!resendKey || !from) {
        outcome = "not_configured";
      } else {
        const origin = process.env.NEXT_PUBLIC_SITE_URL;
        const actionUrl = origin && raw.target_path ? new URL(raw.target_path, origin).toString() : null;
        const html = `<h1>${escapeHtml(raw.title)}</h1><p>${escapeHtml(raw.body)}</p>${actionUrl ? `<p><a href="${escapeHtml(actionUrl)}">Open TutorPlus</a></p>` : ""}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
              "Idempotency-Key": raw.id,
            },
            body: JSON.stringify({
              from,
              to: [raw.recipient_email],
              subject: raw.title,
              html,
              text: `${raw.title}\n\n${raw.body}${actionUrl ? `\n\n${actionUrl}` : ""}`,
            }),
            signal: controller.signal,
          });
          if (response.ok) {
            outcome = "accepted";
            const payload = (await response.json().catch(() => null)) as { id?: unknown } | null;
            if (typeof payload?.id === "string" && payload.id.length <= 200) raw.provider_email_id = payload.id;
          } else if (response.status === 429 || response.status >= 500) {
            outcome = "retry";
            errorCode = response.status === 429 ? "provider_rate_limited" : "provider_unavailable";
          } else {
            outcome = "failed";
            errorCode = "provider_rejected";
          }
        } catch {
          outcome = "retry";
          errorCode = "provider_unavailable";
        } finally {
          clearTimeout(timeout);
        }
      }
    }
    const { data: completion, error: completeError } = await service.rpc("complete_notification_outbox_v2", {
      p_notice: raw.id,
      p_outcome: outcome,
      p_error_code: errorCode,
      p_provider_id: raw.provider_email_id ?? null,
    });
    if (completeError || !Array.isArray(completion) || !completion[0]) throw new DomainError("unavailable");
    const completed = completion[0] as { state?: unknown; email_state?: unknown };
    if (outcome === "accepted") result.accepted += 1;
    else if (outcome === "not_configured") result.notConfigured += 1;
    if (completed.state === "pending" && completed.email_state === "retrying") result.retrying += 1;
    if (completed.state === "failed") result.exhausted += 1;
  }
  return result;
}

function equalSecret(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifyResendWebhook(rawBody: string, headers: ResendDeliveryWebhookHeaders, secret: string): boolean {
  const eventId = headers.id?.trim();
  const timestampText = headers.timestamp?.trim();
  const signatures = headers.signature?.trim();
  if (!eventId || eventId.length > 200 || !timestampText || !/^\d{1,12}$/.test(timestampText) || !signatures)
    return false;
  const timestampSeconds = Number(timestampText);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;
  if (!secret.startsWith("whsec_")) return false;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secret.slice("whsec_".length), "base64");
  } catch {
    return false;
  }
  if (!secretBytes.length) return false;
  const signedContent = `${eventId}.${timestampText}.${rawBody}`;
  const expected = createHmac("sha256", secretBytes).update(signedContent).digest();
  let matched = false;
  for (const candidate of signatures.split(/\s+/)) {
    if (!candidate.startsWith("v1,")) continue;
    let decoded: Buffer;
    try {
      decoded = Buffer.from(candidate.slice(3), "base64");
    } catch {
      continue;
    }
    if (equalSecret(decoded, expected)) matched = true;
  }
  return matched;
}

/** Verify Resend/Svix's raw-body signature before recording a deduplicated delivery event. */
export async function observeResendDeliveryWebhook(
  rawBody: string,
  headers: ResendDeliveryWebhookHeaders,
): Promise<ObservedDeliveryWebhookResult> {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) throw new DomainError("configuration");
  if (typeof rawBody !== "string" || rawBody.length > 64_000 || !verifyResendWebhook(rawBody, headers, secret))
    throw new DomainError("forbidden");
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new InputError({ body: "Webhook body must contain valid JSON." });
  }
  if (!payload || typeof payload !== "object") throw new InputError({ body: "Webhook event is invalid." });
  const event = payload as { type?: unknown; created_at?: unknown; data?: { email_id?: unknown } };
  const eventTypes = new Set([
    "email.sent",
    "email.delivered",
    "email.delivery_delayed",
    "email.bounced",
    "email.complained",
    "email.failed",
  ]);
  if (
    typeof event.type !== "string" ||
    !eventTypes.has(event.type) ||
    typeof event.data?.email_id !== "string" ||
    !event.data.email_id.trim() ||
    event.data.email_id.length > 200
  ) {
    throw new InputError({ body: "Webhook event is not a supported delivery event." });
  }
  let createdAt: string | null = null;
  if (event.created_at !== undefined) {
    if (typeof event.created_at !== "string" || !Number.isFinite(Date.parse(event.created_at))) {
      throw new InputError({ body: "Webhook event timestamp is invalid." });
    }
    createdAt = new Date(event.created_at).toISOString();
  }
  const service = createServiceRoleClient();
  const { data, error } = await service.rpc("record_resend_delivery_event", {
    event_id: headers.id!.trim(),
    provider_email_id: event.data.email_id.trim(),
    event_type: event.type,
    event_created_at: createdAt,
  });
  if (error || !Array.isArray(data) || !data[0]) unavailable(error ?? undefined);
  const row = data[0] as { duplicate?: unknown; matched?: unknown; delivery_state?: unknown };
  return {
    duplicate: row.duplicate === true,
    matched: row.matched === true,
    deliveryState: typeof row.delivery_state === "string" ? row.delivery_state : null,
  };
}

function selectedResourceContext(resources: Resource[]): string {
  if (!resources.length) return "";
  return `\nApproved selected resources (citations are returned separately):\n${resources
    .map(
      (resource) =>
        `- ${resource.title}${resource.attribution ? ` (${resource.attribution})` : ""}: ${resource.description.slice(0, 400)} [${resource.url}]`,
    )
    .join("\n")}`;
}

/**
 * Uses only records the caller explicitly selected and the user-scoped domain services authorize. The response is
 * a text draft; it does not write goals, mastery, bookings, payments, or other learning state.
 */
export async function askLearningAssistant(
  client: SupabaseClient,
  value: AskLearningAssistantInput,
): Promise<LearningAssistantResult> {
  const actor = await getActor(client);
  requireRole(actor, "student");
  const question = requiredText(value.question, "question", boundedEnvInteger("ASSISTANT_PROMPT_LIMIT", 100, 1, 10000));
  const bookingId = id(value.bookingId, "bookingId", true);
  const planId = id(value.planId, "planId", true);
  if (!bookingId && !planId && !value.resourceIds?.length)
    throw new InputError({ context: "Choose a session, study plan or approved resource to include." });
  const resourceIds = (value.resourceIds ?? []).map((resourceId) => id(resourceId, "resourceIds") as string);
  if (resourceIds.length > 5 || new Set(resourceIds).size !== resourceIds.length)
    throw new InputError({ resourceIds: "Choose up to five different resources." });
  const config = openAIConfig();
  if (!config) throw new DomainError("configuration");

  const contextParts: string[] = [];
  if (bookingId) {
    const workspace = await SessionPlanService.getWorkspace(client, bookingId);
    if (workspace.role !== "student" || workspace.booking.student_id !== actor.id) throw new DomainError("forbidden");
    if (workspace.plan?.student_goals)
      contextParts.push(`Selected session learner goals: ${workspace.plan.student_goals}`);
    if (workspace.plan?.student_questions)
      contextParts.push(`Selected session learner questions: ${workspace.plan.student_questions}`);
    if (workspace.recap)
      contextParts.push(
        `Selected session tutor recap: ${workspace.recap.summary}\nNext steps: ${workspace.recap.next_steps ?? "not provided"}`,
      );
  }
  if (planId) {
    const detail = await getStudyPlan(client, planId);
    if (detail.plan.student_id !== actor.id) throw new DomainError("forbidden");
    const current = detail.revisions.find((revision) => revision.revision_no === detail.plan.current_revision);
    if (!current) throw new DomainError("unavailable");
    contextParts.push(`Selected study plan: ${current.title}. ${current.description ?? ""}`);
    for (const goal of current.goals.slice(0, 20)) {
      contextParts.push(
        `Goal ${goal.position}: ${goal.title}; topic ${goal.topic}; success criterion ${goal.successCriterion ?? "not specified"}.`,
      );
      for (const milestone of goal.milestones.slice(0, 20))
        contextParts.push(`Milestone ${milestone.position}: ${milestone.title}; state ${milestone.status}.`);
    }
  }
  let resources: Resource[] = [];
  if (resourceIds.length) {
    const { data, error } = await client
      .from("resources")
      .select("id,subject_id,title,description,url,resource_type,attribution,active")
      .eq("active", true)
      .in("id", resourceIds)
      .limit(5);
    if (error) unavailable(error);
    resources = ((data ?? []) as ResourceRow[]).map(toResource);
    if (resources.length !== resourceIds.length)
      throw new InputError({ resourceIds: "One or more selected resources are no longer available." });
  }
  const contextText = contextParts.join("\n").slice(0, 8000) + selectedResourceContext(resources);
  const questionHash = createHash("sha256").update(question).digest("hex");
  const limit = boundedEnvInteger("ASSISTANT_PROMPT_LIMIT", 100, 1, 10000);
  const quota = boundedEnvInteger("ASSISTANT_DAILY_QUOTA", 2, 1, 100);
  const selectedContext = { ...(bookingId ? { bookingId } : {}), ...(planId ? { planId } : {}), resourceIds };
  const { data: requestId, error: startError } = await client.rpc("start_assistant_request", {
    question_hash: questionHash,
    chars: question.length,
    selected_context: selectedContext,
    model_name: config.model,
    prompt_limit: limit,
    daily_quota: quota,
  });
  if (startError || typeof requestId !== "string") {
    if (startError?.code === "22023")
      throw new InputError({
        question: "The daily assistant limit has been reached or the request exceeds its configured limit.",
      });
    unavailable(startError ?? undefined);
  }
  const startedAt = Date.now();

  const finish = async (
    outcome: "succeeded" | "refused" | "failed",
    responseId: string | null,
    chars: number | null,
  ) => {
    const { error } = await client.rpc("finish_assistant_request", {
      request: requestId,
      outcome,
      response_id: responseId,
      chars,
    });
    if (error) throw new DomainError("unavailable");
  };
  let response: Response;
  try {
    const endpoint = `${config.baseUrl}/responses`;
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        "User-Agent": "TutorPlus/1.0",
      },
      body: JSON.stringify({
        model: config.model,
        store: false,
        max_output_tokens: 2048,
        reasoning: { effort: "low" },
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "You are a study assistant. Use only the explicitly selected context and selected approved resources below. Distinguish known facts from suggestions, do not claim to change records, and treat all requested actions as drafts requiring authorized human confirmation. If context does not support an answer, say so.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Question: ${question}\n\nSelected context:\n${contextText || "No context was provided."}`,
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(boundedEnvInteger("ASSISTANT_TIMEOUT_MS", 20000, 1000, 60000)),
    });
  } catch {
    await finish("failed", null, null);
    await recordAssistantOperationalOutcome(client, requestId, startedAt, "failure");
    throw new DomainError("unavailable");
  }
  if (!response.ok) {
    await finish("failed", null, null);
    await recordAssistantOperationalOutcome(
      client,
      requestId,
      startedAt,
      response.status === 429 ? "rate_limited" : "failure",
    );
    throw new DomainError(response.status === 429 ? "rateLimited" : "unavailable");
  }
  let payload: {
    id?: unknown;
    status?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    output_text?: unknown;
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    await finish("failed", null, null);
    await recordAssistantOperationalOutcome(client, requestId, startedAt, "failure");
    throw new DomainError("unavailable");
  }
  const refusal = payload.output?.some((item) => item.content?.some((part) => part.type === "refusal")) ?? false;
  const answer =
    typeof payload.output_text === "string"
      ? payload.output_text.trim()
      : (payload.output ?? [])
          .flatMap((item) => item.content ?? [])
          .filter((part) => part.type === "output_text")
          .map((part) => part.text ?? "")
          .join("\n")
          .trim();
  const responseId = typeof payload.id === "string" ? payload.id.slice(0, 200) : null;
  if (refusal || payload.status === "incomplete" || !answer) {
    await finish("refused", responseId, answer.length);
    await recordAssistantOperationalOutcome(client, requestId, startedAt, "failure");
    throw new DomainError("unavailable");
  }
  await finish("succeeded", responseId, answer.length);
  await recordAssistantOperationalOutcome(client, requestId, startedAt, "success");
  return { requestId, answer, resources, draftOnly: true, caveat: AI_CAVEAT };
}
