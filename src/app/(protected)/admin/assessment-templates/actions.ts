"use server";
import { createUserClient } from "@/lib/supabase/server";
import { actionFailure } from "@/lib/action-state";
import { InputError, type ActionState } from "@/domains/shared/errors";
import { saveAssessmentTemplate, createAssessmentFromTemplate } from "@/domains/platform/service";
import { readQuestionForm } from "@/lib/learning-question-form";
export async function assessmentTemplateAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const text = (key: string) => String(form.get(key) ?? "").trim();
    if (!form.has("confirmed")) throw new InputError({ confirmed: "Confirm this assessment template version." });
    const purpose = text("purpose");
    if (purpose !== "diagnostic" && purpose !== "pre_session" && purpose !== "post_session" && purpose !== "milestone")
      throw new InputError({ purpose: "Choose a supported assessment purpose." });
    const saved = await saveAssessmentTemplate(await createUserClient(), {
      id: text("id") || undefined,
      expectedVersion: text("expectedVersion") ? Number(text("expectedVersion")) : undefined,
      title: text("title"),
      description: text("description"),
      subjectId: text("subjectId") || null,
      purpose,
      questions: readQuestionForm(form),
      active: form.has("active"),
      confirmed: true,
      reason: text("reason"),
    });
    return {
      success: true,
      message: `Assessment template version ${saved.version} was saved with its authoring reason.`,
    };
  } catch (error) {
    return actionFailure(
      error,
      Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string")) as Record<
        string,
        string
      >,
    );
  }
}
export async function useAssessmentTemplateAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const saved = await createAssessmentFromTemplate(await createUserClient(), {
      templateId: String(form.get("templateId") ?? ""),
      bookingId: String(form.get("bookingId") ?? ""),
    });
    return {
      success: true,
      message: "An assessment draft was created from the approved template. Review it before assigning it.",
      values: { savedHref: `/assessments/${saved.assessmentId}` },
    };
  } catch (error) {
    return actionFailure(error);
  }
}
