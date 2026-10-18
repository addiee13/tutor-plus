import type { ActionState } from "../shared/errors";
import type { Booking } from "../bookings/types";

/** Which side of the booking the signed-in actor is on. */
export type SessionRole = "student" | "tutor";

/**
 * Where a booking is in its learning lifecycle:
 * `planning` before the session ends, `ended` once a confirmed session is past its end time,
 * `completed` after the tutor records delivery, and `unavailable` for unpaid or cancelled bookings.
 */
export type SessionPhase = "planning" | "ended" | "completed" | "unavailable";

export type SessionPermissions = Readonly<{
  editGoals: boolean;
  editAgenda: boolean;
  markCompleted: boolean;
  publishRecap: boolean;
  writeReflection: boolean;
}>;

export type SessionPlan = {
  booking_id: string;
  student_goals: string | null;
  student_questions: string | null;
  tutor_agenda: string | null;
  student_updated_at: string | null;
  tutor_updated_at: string | null;
};

export type SessionRecap = {
  booking_id: string;
  summary: string;
  mastery_notes: string | null;
  next_steps: string | null;
  revision: number;
  published_at: string;
  updated_at: string;
};

export type SessionReflection = {
  booking_id: string;
  reflection: string;
  updated_at: string;
};

export type SessionWorkspace = {
  role: SessionRole;
  phase: SessionPhase;
  can: SessionPermissions;
  booking: Booking;
  tutorName: string;
  subjectName: string;
  plan: SessionPlan | null;
  recap: SessionRecap | null;
  /** Always null for the tutor: the reflection is never read on the tutor's behalf. */
  reflection: SessionReflection | null;
  observedAt: number;
};

export type SessionActionState = ActionState & { savedAt?: string };
