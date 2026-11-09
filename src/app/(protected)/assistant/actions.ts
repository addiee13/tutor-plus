"use server";
import { createUserClient } from "@/lib/supabase/server";
import { actionFailure } from "@/lib/action-state";
import type { ActionState } from "@/domains/shared/errors";
import { askLearningAssistant, reportAssistantResponse } from "@/domains/platform/service";
import type { Resource } from "@/domains/platform/types";
export type AssistantState = ActionState & {
  answer?: string;
  resources?: Resource[];
  caveat?: string;
  requestId?: string;
};
export async function askAssistantAction(_previous: AssistantState, form: FormData): Promise<AssistantState> {
  try {
    const response = await askLearningAssistant(await createUserClient(), {
      question: String(form.get("question") ?? ""),
      bookingId: String(form.get("bookingId") ?? "") || undefined,
      planId: String(form.get("planId") ?? "") || undefined,
      resourceIds: form.getAll("resourceIds").map(String),
    });
    return {
      success: true,
      message: "Your learning assistant response is ready.",
      answer: response.answer,
      requestId: response.requestId,
      caveat: response.caveat,
      resources: response.resources,
      values: { question: String(form.get("question") ?? ""), planId: String(form.get("planId") ?? "") },
    };
  } catch (error) {
    return actionFailure(error, { question: String(form.get("question") ?? "") });
  }
}

export async function reportAssistantResponseAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const saved = await reportAssistantResponse(await createUserClient(), {
      requestId: String(form.get("requestId") ?? ""),
      reason: String(form.get("reason") ?? ""),
    });
    return { success: true, message: `Your response concern was saved for review. Reference: ${saved.id}.` };
  } catch (error) {
    return actionFailure(error, { reason: String(form.get("reason") ?? "") });
  }
}
