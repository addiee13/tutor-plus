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
  uploadAttachment: boolean;
  reviewAttachment: boolean;
}>;

export type SessionAgendaLinkInput =
  | { kind: "resource" | "assignment" | "assessment"; id: string }
  | { kind: "milestone"; studyPlanId: string; milestoneId: string };

export type SessionAgendaLinkOption = SessionAgendaLinkInput & { label: string };
export type SessionAgendaLink = SessionAgendaLinkInput & { position: number; label: string };

export type SessionResource = { id: string; title: string; url: string; resource_type: string };

export type SessionAttachment = {
  id: string;
  booking_id: string;
  uploader_id: string;
  file_mime: "application/pdf" | "image/png" | "image/jpeg" | "text/plain";
  file_size_bytes: number;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  created_at: string;
};

export type SessionAttachmentReviewInput = { decision: "approved" | "rejected"; reason?: string | null };

export type SessionPlan = {
  booking_id: string;
  student_goals: string | null;
  student_questions: string | null;
  tutor_agenda: string | null;
  student_updated_at: string | null;
  tutor_updated_at: string | null;
  priority_topics: string[] | null;
};

export type SessionRecap = {
  booking_id: string;
  summary: string;
  mastery_notes: string | null;
  next_steps: string | null;
  revision: number;
  published_at: string;
  updated_at: string;
  topics: string[] | null;
  strengths: string | null;
  practice_areas: string | null;
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
  /** Current viewer's validated IANA zone; UTC instants in `booking` are unchanged. */
  viewerTimezone: string;
  plan: SessionPlan | null;
  recap: SessionRecap | null;
  /** Always null for the tutor: the reflection is never read on the tutor's behalf. */
  reflection: SessionReflection | null;
  agendaLinks: SessionAgendaLink[];
  recapResources: SessionResource[];
  attachments: SessionAttachment[];
  observedAt: number;
};

export type SessionActionState = ActionState & { savedAt?: string };
