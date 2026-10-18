"use server";

import { createUserClient } from "@/lib/supabase/server";
import { actionFailure } from "@/lib/action-state";
import { submitReview } from "@/domains/reviews/service";
import type { ReviewActionState } from "@/domains/reviews/types";
import { readValues } from "@/domains/shared/form";

export async function submitReviewAction(_previous: ReviewActionState, form: FormData): Promise<ReviewActionState> {
  try {
    const review = await submitReview(await createUserClient(), form);
    // Protected pages render per request, so no revalidation is needed. Revalidating would re-render /reviews
    // immediately and unmount this form before the student sees the receipt below.
    return {
      success: true,
      reviewId: review.id,
      message: `Thank you — your ${review.rating}-star review was saved. The tutor’s rating has been recalculated.`,
    };
  } catch (error) {
    return actionFailure(error, readValues(form, ["rating", "comment"]));
  }
}
