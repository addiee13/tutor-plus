import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../auth/service";
import { hasRole, type Actor } from "../auth/policy";
import { requireBookingActor } from "../bookings/policy";
import { parseBookingId } from "../bookings/validation";
import type { Booking } from "../bookings/types";
import { DomainError, InputError, isDomainError } from "../shared/errors";
import { PgErrorCode } from "../shared/postgres";
import {
  parsePrivateUploadMetadata,
  parsePrivateUploadPath,
  privateUploadExtension,
  type PreparedPrivateUpload,
} from "../shared/uploads";
import { requireSessionPermission, resolveSessionRole, sessionPermissions, sessionPhase } from "./policy";
import {
  parseRecap,
  parseReflection,
  parseSessionAgendaLinks,
  parseSessionAttachmentReview,
  parseSessionTarget,
  parseStudentPlan,
  parseStructuredRecap,
  parseTutorAgenda,
} from "./validation";
import type {
  SessionAgendaLink,
  SessionAgendaLinkOption,
  SessionAttachment,
  SessionResource,
  SessionAttachmentReviewInput,
  SessionPermissions,
  SessionPlan,
  SessionRecap,
  SessionReflection,
  SessionRole,
  SessionWorkspace,
} from "./types";

const BOOKING_FIELDS =
  "id,student_id,tutor_id,subject_id,starts_at,ends_at,mode,price_minor,platform_fee_minor,currency,status,hold_expires_at,cancellation_reason";
const PLAN_FIELDS = "booking_id,student_goals,student_questions,tutor_agenda,student_updated_at,tutor_updated_at";
const RECAP_FIELDS =
  "booking_id,summary,mastery_notes,next_steps,revision,published_at,updated_at,topics,strengths,practice_areas";
const AGENDA_LINK_FIELDS =
  "id,booking_id,position,link_kind,resource_id,assignment_id,assessment_id,study_plan_id,plan_revision_no,milestone_id";
const ATTACHMENT_FIELDS =
  "id,booking_id,uploader_id,file_mime,file_size_bytes,status,reviewed_by,reviewed_at,review_reason,created_at";
const SESSION_ATTACHMENT_BUCKET = "session-plan-attachments";
const SESSION_FILE_LIMIT = 10 * 1024 * 1024;
const SESSION_FILE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain"]);

function validViewerTimezone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "UTC";
  const timezone = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

type Context = { actor: Actor; booking: Booking; role: SessionRole; can: SessionPermissions; now: number };
type AgendaLinkRow = {
  id: string;
  booking_id: string;
  position: number;
  link_kind: "resource" | "assignment" | "assessment" | "milestone";
  resource_id: string | null;
  assignment_id: string | null;
  assessment_id: string | null;
  study_plan_id: string | null;
  plan_revision_no: number | null;
  milestone_id: string | null;
};

async function readResources(client: SupabaseClient, ids: string[]): Promise<SessionResource[]> {
  if (!ids.length) return [];
  const { data, error } = await client
    .from("resources")
    .select("id,title,url,resource_type")
    .in("id", [...new Set(ids)]);
  if (error) throw new DomainError("unavailable");
  const byId = new Map((data ?? []).map((row) => [row.id as string, row as SessionResource]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

async function resolveAgendaLinks(client: SupabaseClient, rows: AgendaLinkRow[]): Promise<SessionAgendaLink[]> {
  if (!rows.length) return [];
  const resourceIds = rows.flatMap((row) => (row.resource_id ? [row.resource_id] : []));
  const assignmentIds = rows.flatMap((row) => (row.assignment_id ? [row.assignment_id] : []));
  const assessmentIds = rows.flatMap((row) => (row.assessment_id ? [row.assessment_id] : []));
  const planIds = [...new Set(rows.flatMap((row) => (row.study_plan_id ? [row.study_plan_id] : [])))];
  const [resources, assignments, assessments, revisions] = await Promise.all([
    resourceIds.length
      ? client.from("resources").select("id,title").in("id", resourceIds)
      : Promise.resolve({ data: [], error: null }),
    assignmentIds.length
      ? client.from("assignments").select("id,title").in("id", assignmentIds)
      : Promise.resolve({ data: [], error: null }),
    assessmentIds.length
      ? client.from("assessments").select("id,title").in("id", assessmentIds)
      : Promise.resolve({ data: [], error: null }),
    planIds.length
      ? client.from("study_plan_revisions").select("plan_id,revision_no,goals,title").in("plan_id", planIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (resources.error || assignments.error || assessments.error || revisions.error)
    throw new DomainError("unavailable");
  const result: SessionAgendaLink[] = [];
  for (const row of rows) {
    if (row.link_kind === "resource" && row.resource_id) {
      const item = (resources.data ?? []).find((candidate) => candidate.id === row.resource_id);
      result.push({
        kind: "resource",
        id: row.resource_id,
        position: row.position,
        label: item?.title ?? "Resource no longer listed",
      });
    } else if (row.link_kind === "assignment" && row.assignment_id) {
      const item = (assignments.data ?? []).find((candidate) => candidate.id === row.assignment_id);
      result.push({
        kind: "assignment",
        id: row.assignment_id,
        position: row.position,
        label: item?.title ?? "Assignment",
      });
    } else if (row.link_kind === "assessment" && row.assessment_id) {
      const item = (assessments.data ?? []).find((candidate) => candidate.id === row.assessment_id);
      result.push({
        kind: "assessment",
        id: row.assessment_id,
        position: row.position,
        label: item?.title ?? "Assessment",
      });
    } else if (
      row.link_kind === "milestone" &&
      row.study_plan_id &&
      row.milestone_id &&
      row.plan_revision_no !== null
    ) {
      const revision = (revisions.data ?? []).find(
        (candidate) => candidate.plan_id === row.study_plan_id && candidate.revision_no === row.plan_revision_no,
      );
      let label = "Milestone";
      if (revision && Array.isArray(revision.goals)) {
        outer: for (const rawGoal of revision.goals) {
          if (!rawGoal || typeof rawGoal !== "object" || Array.isArray(rawGoal)) continue;
          const goal = rawGoal as Record<string, unknown>;
          if (!Array.isArray(goal.milestones)) continue;
          for (const rawMilestone of goal.milestones) {
            if (!rawMilestone || typeof rawMilestone !== "object" || Array.isArray(rawMilestone)) continue;
            const milestone = rawMilestone as Record<string, unknown>;
            if (milestone.id === row.milestone_id && typeof milestone.title === "string") {
              label = `${typeof goal.topic === "string" ? `${goal.topic} · ` : ""}${milestone.title}`;
              break outer;
            }
          }
        }
      }
      result.push({
        kind: "milestone",
        studyPlanId: row.study_plan_id,
        milestoneId: row.milestone_id,
        position: row.position,
        label,
      });
    }
  }
  return result;
}

/** Maps SQL failures to user-facing outcomes; a refused rule is reported on the form field that triggered it. */
function databaseFailure(error: { code?: string }, field: string, message: string): never {
  if (error.code === PgErrorCode.insufficientPrivilege) throw new DomainError("forbidden");
  if (error.code === PgErrorCode.invalidParameterValue) throw new InputError({ [field]: message });
  throw new DomainError("unavailable");
}

async function readBooking(client: SupabaseClient, id: string): Promise<Booking> {
  const { data, error } = await client.from("bookings").select(BOOKING_FIELDS).eq("id", id).maybeSingle<Booking>();
  if (error) throw new DomainError("unavailable");
  // RLS hides bookings the actor does not take part in; that is reported exactly like a forbidden record.
  if (!data) throw new DomainError("forbidden");
  return data;
}

async function ownedTutorIds(client: SupabaseClient, actor: Actor): Promise<string[]> {
  if (!hasRole(actor, "tutor")) return [];
  const { data, error } = await client.from("tutor_profiles").select("id").eq("user_id", actor.id);
  if (error) throw new DomainError("unavailable");
  return (data ?? []).map((row) => row.id as string);
}

/** Re-authorizes the actor against the booking on every read and write. */
async function loadContext(client: SupabaseClient, bookingId: string): Promise<Context> {
  const actor = await getActor(client);
  requireBookingActor(actor);
  const [booking, tutorIds] = await Promise.all([readBooking(client, bookingId), ownedTutorIds(client, actor)]);
  const role = resolveSessionRole(actor, booking, tutorIds);
  const now = Date.now();
  return { actor, booking, role, can: sessionPermissions(role, sessionPhase(booking, now)), now };
}

async function tutorName(client: SupabaseClient, booking: Booking, role: SessionRole): Promise<string> {
  const table = role === "tutor" ? "tutor_profiles" : "public_tutor_snapshots";
  const { data } = await client
    .from(table)
    .select("public_display_name")
    .eq("id", booking.tutor_id)
    .maybeSingle<{ public_display_name: string }>();
  return data?.public_display_name ?? "Tutor listing no longer public";
}

async function subjectName(client: SupabaseClient, booking: Booking): Promise<string> {
  const { data } = await client
    .from("subjects")
    .select("name")
    .eq("id", booking.subject_id)
    .maybeSingle<{ name: string }>();
  return data?.name ?? "Subject no longer listed";
}

export async function getWorkspace(client: SupabaseClient, bookingId: string): Promise<SessionWorkspace> {
  let id: string;
  try {
    id = parseBookingId(bookingId);
  } catch (error) {
    // A malformed ID in the URL is treated like any other record the actor cannot open.
    if (isDomainError(error)) throw new DomainError("forbidden");
    throw error;
  }
  const { actor, booking, role, can, now } = await loadContext(client, id);
  const [tutor, subject, profile, plan, recap, reflection, linkRows, recapResourceRows, attachments] =
    await Promise.all([
      tutorName(client, booking, role),
      subjectName(client, booking),
      client.from("profiles").select("timezone").eq("id", actor.id).maybeSingle<{ timezone: string }>(),
      client
        .from("session_plans")
        .select(`${PLAN_FIELDS},priority_topics`)
        .eq("booking_id", id)
        .maybeSingle<SessionPlan>(),
      client.from("session_recaps").select(RECAP_FIELDS).eq("booking_id", id).maybeSingle<SessionRecap>(),
      // The reflection belongs to the student alone; it is never requested for the tutor's view.
      role === "student"
        ? client
            .from("session_reflections")
            .select("booking_id,reflection,updated_at")
            .eq("booking_id", id)
            .maybeSingle<SessionReflection>()
        : Promise.resolve({ data: null, error: null }),
      client.from("session_plan_learning_links").select(AGENDA_LINK_FIELDS).eq("booking_id", id).order("position"),
      client.from("session_recap_resources").select("resource_id,position").eq("booking_id", id).order("position"),
      client
        .from("session_plan_attachments")
        .select(ATTACHMENT_FIELDS)
        .eq("booking_id", id)
        .order("created_at", { ascending: false }),
    ]);
  if (
    profile.error ||
    plan.error ||
    recap.error ||
    reflection.error ||
    linkRows.error ||
    recapResourceRows.error ||
    attachments.error
  )
    throw new DomainError("unavailable");
  const agendaLinks = await resolveAgendaLinks(client, (linkRows.data ?? []) as AgendaLinkRow[]);
  const resourceIds = (recapResourceRows.data ?? []).map((row) => row.resource_id as string);
  const recapResources = await readResources(client, resourceIds);
  return {
    role,
    phase: sessionPhase(booking, now),
    can,
    booking,
    tutorName: tutor,
    subjectName: subject,
    viewerTimezone: validViewerTimezone(profile.data?.timezone),
    plan: plan.data,
    recap: recap.data,
    reflection: role === "student" ? reflection.data : null,
    agendaLinks,
    recapResources,
    attachments: (attachments.data ?? []) as SessionAttachment[],
    observedAt: now,
  };
}

async function callSaving(
  client: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
  field: string,
  refusal: string,
): Promise<string> {
  const { data, error } = await client.rpc(name, parameters);
  if (error) databaseFailure(error, field, refusal);
  if (typeof data !== "string") throw new DomainError("unavailable");
  return data;
}

export async function saveStudentPlan(client: SupabaseClient, form: FormData): Promise<string> {
  const parsed = parseStudentPlan(form);
  const { can } = await loadContext(client, parsed.booking);
  requireSessionPermission(can, "editGoals");
  return callSaving(
    client,
    "save_session_preparation",
    {
      booking: parsed.booking,
      goals: parsed.goals,
      questions: parsed.questions,
      priority_topics: parsed.priorityTopics,
    },
    "goals",
    "The planner closed for this booking. Refresh to see its current state.",
  );
}

/** Lists only agenda targets that the current tutor can link to the selected booking. */
export async function listSessionLearningLinkOptions(
  client: SupabaseClient,
  bookingId: string,
): Promise<SessionAgendaLinkOption[]> {
  const { booking, role, can } = await loadContext(client, parseBookingId(bookingId));
  if (role !== "tutor") throw new DomainError("forbidden");
  requireSessionPermission(can, "editAgenda");
  const [resources, assignments, assessments, plans] = await Promise.all([
    client
      .from("resources")
      .select("id,title")
      .eq("active", true)
      .or(`subject_id.is.null,subject_id.eq.${booking.subject_id}`)
      .order("title")
      .limit(100),
    client
      .from("assignments")
      .select("id,title")
      .eq("tutor_id", booking.tutor_id)
      .eq("student_id", booking.student_id)
      .eq("subject_id", booking.subject_id)
      .neq("status", "draft")
      .limit(100),
    client
      .from("assessments")
      .select("id,title")
      .eq("tutor_id", booking.tutor_id)
      .eq("student_id", booking.student_id)
      .eq("subject_id", booking.subject_id)
      .neq("status", "draft")
      .limit(100),
    client
      .from("study_plans")
      .select("id,current_revision")
      .eq("tutor_id", booking.tutor_id)
      .eq("student_id", booking.student_id)
      .eq("subject_id", booking.subject_id)
      .eq("booking_id", booking.id)
      .eq("status", "active"),
  ]);
  if (resources.error || assignments.error || assessments.error || plans.error) throw new DomainError("unavailable");
  const planRows = plans.data ?? [];
  const revisions = planRows.length
    ? await client
        .from("study_plan_revisions")
        .select("plan_id,revision_no,title,goals")
        .in(
          "plan_id",
          planRows.map((row) => row.id),
        )
    : { data: [], error: null };
  if (revisions.error) throw new DomainError("unavailable");
  const options: SessionAgendaLinkOption[] = [
    ...(resources.data ?? []).map((row) => ({
      kind: "resource" as const,
      id: row.id as string,
      label: row.title as string,
    })),
    ...(assignments.data ?? []).map((row) => ({
      kind: "assignment" as const,
      id: row.id as string,
      label: row.title as string,
    })),
    ...(assessments.data ?? []).map((row) => ({
      kind: "assessment" as const,
      id: row.id as string,
      label: row.title as string,
    })),
  ];
  for (const plan of planRows) {
    const revision = (revisions.data ?? []).find(
      (row) => row.plan_id === plan.id && row.revision_no === plan.current_revision,
    );
    if (!revision || !Array.isArray(revision.goals)) continue;
    for (const rawGoal of revision.goals) {
      if (!rawGoal || typeof rawGoal !== "object" || Array.isArray(rawGoal)) continue;
      const goal = rawGoal as Record<string, unknown>;
      const topic = typeof goal.topic === "string" ? goal.topic : "";
      if (!Array.isArray(goal.milestones)) continue;
      for (const rawMilestone of goal.milestones) {
        if (!rawMilestone || typeof rawMilestone !== "object" || Array.isArray(rawMilestone)) continue;
        const milestone = rawMilestone as Record<string, unknown>;
        if (typeof milestone.id !== "string" || typeof milestone.title !== "string") continue;
        options.push({
          kind: "milestone",
          studyPlanId: plan.id as string,
          milestoneId: milestone.id,
          label: `${topic ? `${topic} · ` : ""}${milestone.title}`,
        });
      }
    }
  }
  return options;
}

export async function listSessionRecapResourceOptions(
  client: SupabaseClient,
  bookingId: string,
): Promise<SessionResource[]> {
  const { booking, role, can } = await loadContext(client, parseBookingId(bookingId));
  if (role !== "tutor") throw new DomainError("forbidden");
  requireSessionPermission(can, "publishRecap");
  const { data, error } = await client
    .from("resources")
    .select("id,title,url,resource_type")
    .eq("active", true)
    .or(`subject_id.is.null,subject_id.eq.${booking.subject_id}`)
    .order("title")
    .limit(100);
  if (error) throw new DomainError("unavailable");
  return (data ?? []) as SessionResource[];
}

export async function saveTutorAgendaLearningLinks(
  client: SupabaseClient,
  bookingId: string,
  links: unknown,
): Promise<number> {
  const normalized = parseSessionAgendaLinks(links);
  const { can } = await loadContext(client, parseBookingId(bookingId));
  requireSessionPermission(can, "editAgenda");
  const payload = normalized.map((item) =>
    item.kind === "milestone"
      ? { kind: item.kind, studyPlanId: item.studyPlanId, milestoneId: item.milestoneId }
      : { kind: item.kind, id: item.id },
  );
  const { data, error } = await client.rpc("save_session_agenda_learning_links", {
    booking: bookingId,
    links: payload,
  });
  if (error) databaseFailure(error, "links", "One or more learning links no longer match this booking.");
  if (typeof data !== "number") throw new DomainError("unavailable");
  return data;
}

export async function saveTutorAgenda(client: SupabaseClient, form: FormData): Promise<string> {
  const parsed = parseTutorAgenda(form);
  const { can } = await loadContext(client, parsed.booking);
  requireSessionPermission(can, "editAgenda");
  return callSaving(
    client,
    "save_session_agenda",
    parsed,
    "agenda",
    "The planner closed for this booking. Refresh to see its current state.",
  );
}

export async function markSessionCompleted(client: SupabaseClient, form: FormData): Promise<void> {
  const booking = parseSessionTarget(form);
  const { can } = await loadContext(client, booking);
  requireSessionPermission(can, "markCompleted");
  const { data, error } = await client.rpc("mark_session_completed", { booking });
  if (error) {
    databaseFailure(
      error,
      "booking",
      "This session can’t be marked delivered yet. It must be confirmed, have meeting details and be past its end time.",
    );
  }
  if (data !== "completed") throw new DomainError("unavailable");
}

export async function publishRecap(client: SupabaseClient, form: FormData): Promise<string> {
  const parsed = parseRecap(form);
  const { can } = await loadContext(client, parsed.booking);
  requireSessionPermission(can, "publishRecap");
  return callSaving(
    client,
    "publish_session_recap",
    parsed,
    "summary",
    "A recap can be published only after the session has ended.",
  );
}

export async function publishStructuredRecap(client: SupabaseClient, input: unknown): Promise<string> {
  const parsed = parseStructuredRecap(input);
  const { can } = await loadContext(client, parsed.bookingId);
  requireSessionPermission(can, "publishRecap");
  const { data, error } = await client.rpc("publish_structured_session_recap_v2", {
    booking: parsed.bookingId,
    summary: parsed.summary,
    topics: parsed.topics,
    mastery_notes: parsed.masteryNotes,
    strengths: parsed.strengths,
    practice_areas: parsed.practiceAreas,
    next_steps: parsed.nextSteps,
    resource_ids: parsed.resourceIds,
  });
  if (error) databaseFailure(error, "summary", "A structured recap can be published only after this session ends.");
  if (typeof data !== "string") throw new DomainError("unavailable");
  return data;
}

function sessionFileExtension(mime: string): string {
  return { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "text/plain": ".txt" }[mime] ?? "";
}

export async function prepareSessionAttachmentUpload(
  client: SupabaseClient,
  bookingId: string,
  mime: unknown,
  bytes: unknown,
): Promise<PreparedPrivateUpload> {
  const metadata = parsePrivateUploadMetadata(mime, bytes);
  const id = parseBookingId(bookingId);
  const { actor, role, can } = await loadContext(client, id);
  requireSessionPermission(can, "uploadAttachment");
  if (role !== "student") throw new DomainError("forbidden");
  const path = `${id}/${actor.id}/${randomUUID()}${privateUploadExtension(metadata.mime)}`;
  const { data, error } = await client.storage.from(SESSION_ATTACHMENT_BUCKET).createSignedUploadUrl(path, {
    upsert: false,
  });
  if (error || !data?.token) throw new DomainError("unavailable");
  return { bucket: SESSION_ATTACHMENT_BUCKET, path, token: data.token };
}

export async function registerUploadedSessionAttachment(
  client: SupabaseClient,
  bookingId: string,
  uploadedPath: unknown,
  mime: unknown,
  bytes: unknown,
): Promise<SessionAttachment> {
  const metadata = parsePrivateUploadMetadata(mime, bytes);
  const id = parseBookingId(bookingId);
  const { actor, role, can } = await loadContext(client, id);
  requireSessionPermission(can, "uploadAttachment");
  if (role !== "student") throw new DomainError("forbidden");
  const path = parsePrivateUploadPath(uploadedPath, id, actor.id, metadata.mime);
  const storage = client.storage.from(SESSION_ATTACHMENT_BUCKET);
  const { data: attachmentId, error } = await client.rpc("register_session_plan_attachment", {
    booking: id,
    path,
    mime: metadata.mime,
    bytes: metadata.bytes,
  });
  if (error || typeof attachmentId !== "string") {
    await storage.remove([path]).catch(() => undefined);
    if (error) databaseFailure(error, "file", "This session is no longer open for an attachment.");
    throw new DomainError("unavailable");
  }
  const { data, error: readError } = await client
    .from("session_plan_attachments")
    .select(ATTACHMENT_FIELDS)
    .eq("id", attachmentId)
    .single<SessionAttachment>();
  if (readError || !data) throw new DomainError("unavailable");
  return data;
}

export async function uploadSessionAttachment(
  client: SupabaseClient,
  bookingId: string,
  file: File,
): Promise<SessionAttachment> {
  const { actor, role, can } = await loadContext(client, parseBookingId(bookingId));
  requireSessionPermission(can, "uploadAttachment");
  if (role !== "student") throw new DomainError("forbidden");
  if (!(file instanceof File) || !file.size || file.size > SESSION_FILE_LIMIT || !SESSION_FILE_TYPES.has(file.type)) {
    throw new InputError({ file: "Choose a PDF, PNG, JPEG, or text file no larger than 10 MiB." });
  }
  const path = `${bookingId}/${actor.id}/${randomUUID()}${sessionFileExtension(file.type)}`;
  const storage = client.storage.from(SESSION_ATTACHMENT_BUCKET);
  const { error: uploadError } = await storage.upload(path, file, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) throw new DomainError("unavailable");
  const { data: attachmentId, error } = await client.rpc("register_session_plan_attachment", {
    booking: bookingId,
    path,
    mime: file.type,
    bytes: file.size,
  });
  if (error || typeof attachmentId !== "string") {
    await storage.remove([path]).catch(() => undefined);
    if (error) databaseFailure(error, "file", "This session is no longer open for an attachment.");
    throw new DomainError("unavailable");
  }
  const { data, error: readError } = await client
    .from("session_plan_attachments")
    .select(ATTACHMENT_FIELDS)
    .eq("id", attachmentId)
    .single<SessionAttachment>();
  if (readError || !data) throw new DomainError("unavailable");
  return data;
}

export async function reviewSessionAttachment(
  client: SupabaseClient,
  attachmentId: unknown,
  input: unknown,
): Promise<SessionAttachment> {
  const id = parseBookingId(String(attachmentId ?? ""));
  const review: SessionAttachmentReviewInput = parseSessionAttachmentReview(input);
  const { data: existing, error: existingError } = await client
    .from("session_plan_attachments")
    .select("id,booking_id")
    .eq("id", id)
    .maybeSingle<{ id: string; booking_id: string }>();
  if (existingError) throw new DomainError("unavailable");
  if (!existing) throw new DomainError("forbidden");
  const { can, role } = await loadContext(client, existing.booking_id);
  if (role !== "tutor") throw new DomainError("forbidden");
  requireSessionPermission(can, "reviewAttachment");
  const { error } = await client.rpc("review_session_plan_attachment", {
    attachment: id,
    decision: review.decision,
    reason: review.reason,
  });
  if (error) databaseFailure(error, "decision", "This attachment has already been reviewed or is unavailable.");
  const { data, error: readError } = await client
    .from("session_plan_attachments")
    .select(ATTACHMENT_FIELDS)
    .eq("id", id)
    .single<SessionAttachment>();
  if (readError || !data) throw new DomainError("unavailable");
  return data;
}

export async function getSessionAttachmentDownload(client: SupabaseClient, attachmentId: unknown): Promise<string> {
  const id = parseBookingId(String(attachmentId ?? ""));
  const { data: attachment, error } = await client
    .from("session_plan_attachments")
    .select("id,booking_id,uploader_id,storage_path,status")
    .eq("id", id)
    .maybeSingle<{ id: string; booking_id: string; uploader_id: string; storage_path: string; status: string }>();
  if (error) throw new DomainError("unavailable");
  if (!attachment) throw new DomainError("forbidden");
  const { actor, role } = await loadContext(client, attachment.booking_id);
  const isOwner = role === "student" && attachment.uploader_id === actor.id;
  const isTutor = role === "tutor" && attachment.status === "approved";
  if (!isOwner && !isTutor) throw new DomainError("forbidden");
  const { data, error: storageError } = await client.storage
    .from(SESSION_ATTACHMENT_BUCKET)
    .createSignedUrl(attachment.storage_path, 120);
  if (storageError || !data?.signedUrl) throw new DomainError("unavailable");
  return data.signedUrl;
}

export async function saveReflection(client: SupabaseClient, form: FormData): Promise<string> {
  const parsed = parseReflection(form);
  const { can } = await loadContext(client, parsed.booking);
  requireSessionPermission(can, "writeReflection");
  return callSaving(
    client,
    "save_session_reflection",
    parsed,
    "reflection",
    "Your private reflection opens after the session has ended.",
  );
}

/** UC-09 domain service: the class-diagram name for this module's operations. */
export const SessionPlanService = {
  getWorkspace,
  saveStudentPlan,
  saveTutorAgenda,
  listSessionLearningLinkOptions,
  saveTutorAgendaLearningLinks,
  listSessionRecapResourceOptions,
  markSessionCompleted,
  publishRecap,
  publishStructuredRecap,
  uploadSessionAttachment,
  reviewSessionAttachment,
  getSessionAttachmentDownload,
  saveReflection,
} as const;
