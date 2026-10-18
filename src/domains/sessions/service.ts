import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../auth/service";
import { hasRole, type Actor } from "../auth/policy";
import { requireBookingActor } from "../bookings/policy";
import { parseBookingId } from "../bookings/validation";
import type { Booking } from "../bookings/types";
import { DomainError, InputError, isDomainError } from "../shared/errors";
import { PgErrorCode } from "../shared/postgres";
import { requireSessionPermission, resolveSessionRole, sessionPermissions, sessionPhase } from "./policy";
import { parseRecap, parseReflection, parseSessionTarget, parseStudentPlan, parseTutorAgenda } from "./validation";
import type {
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
const RECAP_FIELDS = "booking_id,summary,mastery_notes,next_steps,revision,published_at,updated_at";

type Context = { actor: Actor; booking: Booking; role: SessionRole; can: SessionPermissions; now: number };

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
  const { booking, role, can, now } = await loadContext(client, id);
  const [tutor, subject, plan, recap, reflection] = await Promise.all([
    tutorName(client, booking, role),
    subjectName(client, booking),
    client.from("session_plans").select(PLAN_FIELDS).eq("booking_id", id).maybeSingle<SessionPlan>(),
    client.from("session_recaps").select(RECAP_FIELDS).eq("booking_id", id).maybeSingle<SessionRecap>(),
    // The reflection belongs to the student alone; it is never requested for the tutor's view.
    role === "student"
      ? client
          .from("session_reflections")
          .select("booking_id,reflection,updated_at")
          .eq("booking_id", id)
          .maybeSingle<SessionReflection>()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (plan.error || recap.error || reflection.error) throw new DomainError("unavailable");
  return {
    role,
    phase: sessionPhase(booking, now),
    can,
    booking,
    tutorName: tutor,
    subjectName: subject,
    plan: plan.data,
    recap: recap.data,
    reflection: role === "student" ? reflection.data : null,
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
    "save_session_goals",
    parsed,
    "goals",
    "The planner closed for this booking. Refresh to see its current state.",
  );
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
  markSessionCompleted,
  publishRecap,
  saveReflection,
} as const;
