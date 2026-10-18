"use client";

import { useActionState, useId } from "react";
import type { ReviewActionState } from "@/domains/reviews/types";
import { FormResult } from "@/components/form-controls";
import { submitReviewAction } from "./actions";
import styles from "./reviews.module.css";

const initial: ReviewActionState = { message: "" };
const STARS = [5, 4, 3, 2, 1] as const;
const STAR_LABELS: Record<number, string> = { 1: "Poor", 2: "Fair", 3: "Good", 4: "Very good", 5: "Excellent" };

export function ReviewForm({ bookingId }: { bookingId: string }) {
  const [state, action, pending] = useActionState(submitReviewAction, initial);
  const id = useId();
  const ratingError = state.fields?.rating;
  const commentError = state.fields?.comment;
  return (
    <form className="form" action={action} aria-label="Review this session">
      <input type="hidden" name="booking" value={bookingId} />
      <fieldset className="form-fields" disabled={pending || state.success}>
        <fieldset className={styles.stars} aria-describedby={`${id}-rating-help`}>
          <legend>Your rating</legend>
          <div className={styles.starRow}>
            {STARS.map((value) => (
              <label key={value} className={styles.star} title={`${value} – ${STAR_LABELS[value]}`}>
                <input
                  type="radio"
                  name="rating"
                  value={value}
                  required
                  defaultChecked={state.values?.rating === String(value)}
                />
                <span aria-hidden="true">★</span>
                <span className={styles.srOnly}>
                  {value} star{value === 1 ? "" : "s"} – {STAR_LABELS[value]}
                </span>
              </label>
            ))}
          </div>
          <span id={`${id}-rating-help`} className="hint">
            Choose 1 to 5 stars. Each completed session can be reviewed once.
          </span>
        </fieldset>
        <div className="field">
          <label htmlFor={`${id}-comment`}>Comment (optional)</label>
          <textarea
            id={`${id}-comment`}
            name="comment"
            className={styles.textarea}
            rows={3}
            maxLength={2000}
            defaultValue={state.values?.comment ?? ""}
            aria-invalid={!!commentError}
            aria-describedby={`${id}-comment-help`}
          />
          <span id={`${id}-comment-help`} className={commentError ? "field-error" : "hint"}>
            {commentError ?? "Up to 2,000 characters. Visible to the tutor; your name is not shown publicly."}
          </span>
        </div>
        <button className="button primary" type="submit" disabled={pending || state.success}>
          {pending ? "Submitting…" : "Submit review"}
          <span aria-hidden="true">→</span>
        </button>
      </fieldset>
      {/* A rating problem (invalid, duplicate, ineligible) is announced once, here, with its specific reason. */}
      <FormResult state={ratingError && !state.success ? { ...state, message: ratingError } : state} />
    </form>
  );
}
