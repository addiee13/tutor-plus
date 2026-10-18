import { InputError, type FieldErrors } from "../shared/errors";
import { readText } from "../shared/form";
import { parseBookingId } from "../bookings/validation";
import { RATING_MAX, RATING_MIN } from "./types";

export const COMMENT_MAX = 2000;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Accepts the booking, an integer rating and an optional comment; aggregates and identities are never read. */
export function parseReview(form: FormData) {
  const booking = parseBookingId(readText(form, "booking"));
  const ratingText = readText(form, "rating");
  const comment = readText(form, "comment");
  const fields: FieldErrors = {};
  const rating = /^\d$/.test(ratingText) ? Number(ratingText) : NaN;
  if (!Number.isInteger(rating) || rating < RATING_MIN || rating > RATING_MAX) {
    fields.rating = `Choose a rating from ${RATING_MIN} to ${RATING_MAX} stars.`;
  }
  if (comment.length > COMMENT_MAX) fields.comment = `Keep your comment to ${COMMENT_MAX} characters or fewer.`;
  else if (CONTROL_CHARACTERS.test(comment)) fields.comment = "Remove unsupported characters from your comment.";
  if (Object.keys(fields).length) throw new InputError(fields);
  return { booking, rating, comment: comment || null };
}
