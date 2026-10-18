import type { ActionState } from "../shared/errors";
import type { Booking } from "../bookings/types";

export const RATING_MIN = 1;
export const RATING_MAX = 5;

export type Review = {
  id: string;
  booking_id: string;
  tutor_id: string;
  rating: number;
  comment: string | null;
  status: "visible" | "hidden";
  created_at: string;
};

export type TutorRatingSummary = {
  tutor_id: string;
  rating_count: number;
  rating_avg: number | null;
  updated_at: string;
};

/** A completed booking of the signed-in student, with the review already left for it (if any). */
export type ReviewableBooking = {
  booking: Pick<Booking, "id" | "tutor_id" | "subject_id" | "starts_at" | "ends_at" | "status">;
  tutorName: string;
  subjectName: string;
  review: Review | null;
  tutorRating: TutorRatingSummary | null;
};

export type TutorReputation = {
  tutorId: string;
  tutorName: string;
  summary: TutorRatingSummary | null;
  recent: Review[];
};

export type ReviewActionState = ActionState & { reviewId?: string };
