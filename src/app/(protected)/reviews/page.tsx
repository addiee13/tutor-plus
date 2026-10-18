import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { hasRole } from "@/domains/auth/policy";
import { safeMessage } from "@/domains/shared/errors";
import { formatUtc } from "@/domains/bookings/presentation";
import { describeRating } from "@/domains/reviews/policy";
import { getTutorRatingSummary, listEligibleBookings } from "@/domains/reviews/service";
import type { Review, ReviewableBooking, TutorReputation } from "@/domains/reviews/types";
import { ReviewForm } from "./forms";
import styles from "./reviews.module.css";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  if (!publicConfig()) return null;
  const { client, actor } = await protectedContext();
  const isStudent = hasRole(actor, "student");
  const isTutor = hasRole(actor, "tutor");

  let sessions: ReviewableBooking[] = [];
  let reputation: TutorReputation[] = [];
  let failure: unknown = null;
  try {
    [sessions, reputation] = await Promise.all([
      isStudent ? listEligibleBookings(client) : Promise.resolve([]),
      isTutor ? getTutorRatingSummary(client) : Promise.resolve([]),
    ]);
  } catch (error) {
    failure = error;
  }

  return (
    <>
      <section className="page-heading">
        <span className="eyebrow">UC-07 · REVIEWS AND RATINGS</span>
        <h1>Reviews.</h1>
        <p>
          {isStudent
            ? "Rate the sessions you have completed. Only the student of a completed session can review it, once."
            : "See the rating students have given your completed sessions."}
        </p>
      </section>
      {failure ? (
        <div className="notice warning" role="alert">
          {safeMessage(failure)} Refresh this page to try again; nothing was submitted by loading it.
        </div>
      ) : !isStudent && !isTutor ? (
        <div className="notice warning" role="status">
          Reviews are available to student and tutor accounts.
        </div>
      ) : (
        <div className={isStudent && isTutor ? styles.grid : undefined}>
          {isStudent && <StudentSessions sessions={sessions} />}
          {isTutor && <TutorReputationPanel reputation={reputation} />}
        </div>
      )}
    </>
  );
}

function StudentSessions({ sessions }: { sessions: ReviewableBooking[] }) {
  return (
    <section className={styles.stack} aria-labelledby="eligible-heading">
      <h2 id="eligible-heading" className={styles.srOnly}>
        Completed sessions
      </h2>
      {!sessions.length && (
        <div className="panel">
          <p>
            You have no completed sessions yet. Once a tutor records a session as delivered, you can review it here.
          </p>
          <Link className="button secondary" href="/bookings">
            Open bookings
          </Link>
        </div>
      )}
      {sessions.map((entry) => (
        <article key={entry.booking.id} className={`panel ${styles.card}`} data-booking-id={entry.booking.id}>
          <span className="tag">{entry.review ? "REVIEWED" : "READY FOR REVIEW"}</span>
          <h3>
            {entry.tutorName} · {entry.subjectName}
          </h3>
          <ul className={styles.facts}>
            <li>
              Session <time dateTime={entry.booking.starts_at}>{formatUtc(entry.booking.starts_at)}</time>
            </li>
            <li>
              Status <code>{entry.booking.status}</code>
            </li>
            <li data-testid="tutor-rating">Tutor rating: {describeRating(entry.tutorRating)}</li>
          </ul>
          {entry.review ? <SubmittedReview review={entry.review} /> : <ReviewForm bookingId={entry.booking.id} />}
          <p className={styles.meta}>
            <Link href={`/sessions/${entry.booking.id}`}>Open session workspace and recap</Link>
          </p>
        </article>
      ))}
    </section>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className={styles.given} aria-label={`${rating} out of 5 stars`}>
      {"★".repeat(rating)}
      <span>{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function SubmittedReview({ review }: { review: Review }) {
  return (
    <div data-testid="submitted-review">
      <Stars rating={review.rating} />
      {review.comment && <p className={styles.quote}>{review.comment}</p>}
      <p className={styles.meta}>
        Submitted {formatUtc(review.created_at)} · {review.status === "visible" ? "Visible" : "Hidden by moderation"}.
        Reviews can’t be edited or submitted twice.
      </p>
    </div>
  );
}

function TutorReputationPanel({ reputation }: { reputation: TutorReputation[] }) {
  if (!reputation.length) {
    return (
      <section className="panel">
        <span className="tag">YOUR RATING</span>
        <h2>No tutor listing yet.</h2>
        <p>Create and publish a tutor listing to receive reviews from completed sessions.</p>
      </section>
    );
  }
  return (
    <div className={styles.stack}>
      {reputation.map((entry) => (
        <section key={entry.tutorId} className={`panel ${styles.card}`} aria-label={`Rating for ${entry.tutorName}`}>
          <span className="tag">YOUR RATING</span>
          <h2>{entry.tutorName}</h2>
          <div className={styles.score} data-testid="tutor-summary">
            <strong>{entry.summary?.rating_avg != null ? Number(entry.summary.rating_avg).toFixed(1) : "—"}</strong>
            <span>{describeRating(entry.summary)}</span>
          </div>
          <p className={styles.meta}>
            Calculated by the database from visible reviews of completed sessions
            {entry.summary ? `; last updated ${formatUtc(entry.summary.updated_at)}` : ""}. It cannot be edited.
          </p>
          {entry.recent.length ? (
            <ul className={styles.reviewList}>
              {entry.recent.map((review) => (
                <li key={review.id}>
                  <Stars rating={review.rating} />
                  {review.comment && <p className={styles.quote}>{review.comment}</p>}
                  <span className={styles.meta}>{formatUtc(review.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No reviews yet. Students can review a session after it is completed.</p>
          )}
        </section>
      ))}
    </div>
  );
}
