import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../auth/service";
import { requireRole } from "../auth/policy";
import type { Booking } from "../bookings/types";
import { DomainError, InputError } from "../shared/errors";
import { PgErrorCode } from "../shared/postgres";
import { isReviewable, requireReviewAuthor } from "./policy";
import { parseReview } from "./validation";
import type { Review, ReviewableBooking, TutorRatingSummary, TutorReputation } from "./types";

const REVIEW_FIELDS = "id,booking_id,tutor_id,rating,comment,status,created_at";
const SUMMARY_FIELDS = "tutor_id,rating_count,rating_avg,updated_at";
const DUPLICATE_MESSAGE = "You’ve already reviewed this session. Each completed session can be reviewed once.";

type BookingRow = Pick<Booking, "id" | "student_id" | "tutor_id" | "subject_id" | "starts_at" | "ends_at" | "status">;

async function ratingSummaries(client: SupabaseClient, tutorIds: string[]): Promise<TutorRatingSummary[]> {
  if (!tutorIds.length) return [];
  const { data, error } = await client.from("tutor_rating_summaries").select(SUMMARY_FIELDS).in("tutor_id", tutorIds);
  if (error) throw new DomainError("unavailable");
  return (data ?? []) as TutorRatingSummary[];
}

/** The signed-in student's completed sessions, each with its review (if already left) and the tutor's rating. */
export async function listEligibleBookings(client: SupabaseClient): Promise<ReviewableBooking[]> {
  const actor = await getActor(client);
  requireRole(actor, "student");
  const { data, error } = await client
    .from("bookings")
    .select("id,student_id,tutor_id,subject_id,starts_at,ends_at,status")
    .eq("student_id", actor.id)
    .eq("status", "completed")
    .order("ends_at", { ascending: false })
    .limit(50);
  if (error) throw new DomainError("unavailable");
  const bookings = (data ?? []) as BookingRow[];
  bookings.forEach((booking) => requireReviewAuthor(actor, booking));
  if (!bookings.length) return [];

  const tutorIds = [...new Set(bookings.map((booking) => booking.tutor_id))];
  const [reviews, tutors, subjects, summaries] = await Promise.all([
    client
      .from("reviews")
      .select(REVIEW_FIELDS)
      .in(
        "booking_id",
        bookings.map((booking) => booking.id),
      ),
    client.from("public_tutor_snapshots").select("id,public_display_name").in("id", tutorIds),
    client
      .from("subjects")
      .select("id,name")
      .in("id", [...new Set(bookings.map((booking) => booking.subject_id))]),
    ratingSummaries(client, tutorIds),
  ]);
  if (reviews.error || tutors.error || subjects.error) throw new DomainError("unavailable");
  return bookings.map((booking) => ({
    booking,
    tutorName:
      tutors.data?.find((tutor) => tutor.id === booking.tutor_id)?.public_display_name ??
      "Tutor listing no longer public",
    subjectName:
      subjects.data?.find((subject) => subject.id === booking.subject_id)?.name ?? "Subject no longer listed",
    review: ((reviews.data ?? []) as Review[]).find((review) => review.booking_id === booking.id) ?? null,
    tutorRating: summaries.find((summary) => summary.tutor_id === booking.tutor_id) ?? null,
  }));
}

export async function submitReview(client: SupabaseClient, form: FormData): Promise<Review> {
  const parsed = parseReview(form);
  const actor = await getActor(client);
  requireRole(actor, "student");
  const { data: booking, error } = await client
    .from("bookings")
    .select("id,student_id,status")
    .eq("id", parsed.booking)
    .maybeSingle<Pick<Booking, "id" | "student_id" | "status">>();
  if (error) throw new DomainError("unavailable");
  if (!booking) throw new DomainError("forbidden");
  requireReviewAuthor(actor, booking);
  if (!isReviewable(booking)) {
    throw new InputError({
      rating: "Only completed sessions can be reviewed. This session hasn’t been completed yet.",
    });
  }
  const existing = await client.from("reviews").select("id").eq("booking_id", booking.id).maybeSingle();
  if (existing.error) throw new DomainError("unavailable");
  if (existing.data) throw new InputError({ rating: DUPLICATE_MESSAGE });

  const { data: id, error: rpcError } = await client.rpc("submit_review", parsed);
  if (rpcError) {
    // The unique booking constraint is the final authority when two submissions race.
    if (rpcError.code === PgErrorCode.uniqueViolation) throw new InputError({ rating: DUPLICATE_MESSAGE });
    if (rpcError.code === PgErrorCode.insufficientPrivilege) throw new DomainError("forbidden");
    if (rpcError.code === PgErrorCode.invalidParameterValue) {
      throw new InputError({ rating: "This session is no longer eligible for review. Refresh the page." });
    }
    throw new DomainError("unavailable");
  }
  if (typeof id !== "string") throw new DomainError("unavailable");
  const saved = await client.from("reviews").select(REVIEW_FIELDS).eq("id", id).single<Review>();
  if (saved.error || !saved.data) throw new DomainError("unavailable");
  return saved.data;
}

/** The signed-in tutor's server-computed rating and most recent visible reviews, per tutor listing. */
export async function getTutorRatingSummary(client: SupabaseClient): Promise<TutorReputation[]> {
  const actor = await getActor(client);
  requireRole(actor, "tutor");
  const { data: tutors, error } = await client
    .from("tutor_profiles")
    .select("id,public_display_name")
    .eq("user_id", actor.id);
  if (error) throw new DomainError("unavailable");
  if (!tutors?.length) return [];
  const tutorIds = tutors.map((tutor) => tutor.id as string);
  const [summaries, reviews] = await Promise.all([
    ratingSummaries(client, tutorIds),
    client
      .from("reviews")
      .select(REVIEW_FIELDS)
      .in("tutor_id", tutorIds)
      .eq("status", "visible")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (reviews.error) throw new DomainError("unavailable");
  return tutors.map((tutor) => ({
    tutorId: tutor.id as string,
    tutorName: tutor.public_display_name as string,
    summary: summaries.find((summary) => summary.tutor_id === tutor.id) ?? null,
    recent: ((reviews.data ?? []) as Review[]).filter((review) => review.tutor_id === tutor.id),
  }));
}

/** UC-07 domain service: the class-diagram name for this module's operations. */
export const ReviewService = { listEligibleBookings, submitReview, getTutorRatingSummary } as const;
