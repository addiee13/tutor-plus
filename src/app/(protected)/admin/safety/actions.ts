"use server";
import { createUserClient } from "@/lib/supabase/server";
import { actionFailure } from "@/lib/action-state";
import { InputError, type ActionState } from "@/domains/shared/errors";
import type { ResourceType } from "@/domains/platform/types";
import { resolveSafetyReport, moderateReview, saveResource, saveSubject } from "@/domains/platform/service";
function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}
function values(form: FormData) {
  return Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string")) as Record<
    string,
    string
  >;
}
function requireConfirmation(form: FormData) {
  if (!form.has("confirmed")) throw new InputError({ confirmed: "Confirm this change before it is recorded." });
}
export async function resolveReportAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    requireConfirmation(form);
    const state = text(form, "state");
    if (state !== "reviewing" && state !== "resolved" && state !== "dismissed")
      throw new InputError({ state: "Choose a valid review state." });
    await resolveSafetyReport(await createUserClient(), {
      id: text(form, "id"),
      state,
      reason: text(form, "reason"),
      confirmed: true,
    });
    return { success: true, message: "The report decision and reason were recorded." };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function moderateReviewAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    requireConfirmation(form);
    const status = text(form, "status");
    if (status !== "visible" && status !== "hidden")
      throw new InputError({ status: "Choose a valid review visibility." });
    await moderateReview(await createUserClient(), {
      id: text(form, "id"),
      status,
      reason: text(form, "reason"),
      confirmed: true,
    });
    return { success: true, message: "Review visibility and the moderation reason were recorded." };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function saveResourceAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    requireConfirmation(form);
    const resourceType = text(form, "resourceType");
    if (!["article", "video", "practice", "reference", "other"].includes(resourceType))
      throw new InputError({ resourceType: "Choose a supported resource type." });
    await saveResource(await createUserClient(), {
      id: text(form, "id") || undefined,
      subjectId: text(form, "subjectId") || undefined,
      title: text(form, "title"),
      description: text(form, "description"),
      url: text(form, "url"),
      resourceType: resourceType as ResourceType,
      attribution: text(form, "attribution"),
      active: form.has("active"),
      confirmed: true,
      reason: text(form, "reason"),
    });
    return { success: true, message: "The resource and its attribution were saved." };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function saveSubjectAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    requireConfirmation(form);
    await saveSubject(await createUserClient(), {
      id: text(form, "id") || undefined,
      name: text(form, "name"),
      slug: text(form, "slug"),
      parentId: text(form, "parentId") || undefined,
      active: form.has("active"),
      confirmed: true,
      reason: text(form, "reason"),
      sortOrder: Number(text(form, "sortOrder")),
    });
    return { success: true, message: "The subject taxonomy change was saved." };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
