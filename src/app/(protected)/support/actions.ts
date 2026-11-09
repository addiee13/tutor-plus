"use server";
import { createUserClient } from "@/lib/supabase/server";
import { actionFailure } from "@/lib/action-state";
import { InputError, type ActionState } from "@/domains/shared/errors";
import { submitSafetyReport } from "@/domains/platform/service";
import { getActor } from "@/domains/auth/service";
import { listLearningRelationships } from "@/domains/learning/service";
export async function safetyReportAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const client = await createUserClient();
    const actor = await getActor(client);
    const targetTutorId = String(form.get("targetTutorId") ?? "");
    const targetReviewId = String(form.get("targetReviewId") ?? "");
    if (targetReviewId) {
      if (targetTutorId) throw new InputError({ target: "Choose one report target." });
      const saved = await submitSafetyReport(client, {
        targetReviewId,
        reason: String(form.get("reason") ?? ""),
      });
      return { success: true, message: `Your concern was saved for administrator review. Reference: ${saved.id}.` };
    }
    let targetUserId: string | undefined;
    if (!targetTutorId) {
      const bookingId = String(form.get("relationship") ?? "");
      const relations = await listLearningRelationships(client);
      const found = relations.find((row) => row.bookingId === bookingId);
      if (!found)
        throw new InputError({ relationship: "Choose a participant from one of your learning relationships." });
      // Students know the tutor through its public listing; tutors know their linked learner through the authorized relationship.
      if (found.studentId !== actor.id) targetUserId = found.studentId;
      else {
        const saved = await submitSafetyReport(client, {
          targetTutorId: found.tutorId,
          reason: String(form.get("reason") ?? ""),
        });
        return { success: true, message: `Your concern was saved for administrator review. Reference: ${saved.id}.` };
      }
    }
    const saved = await submitSafetyReport(client, {
      targetTutorId: targetTutorId || undefined,
      targetUserId,
      reason: String(form.get("reason") ?? ""),
    });
    return { success: true, message: `Your concern was saved for administrator review. Reference: ${saved.id}.` };
  } catch (error) {
    return actionFailure(error, { reason: String(form.get("reason") ?? "") });
  }
}
