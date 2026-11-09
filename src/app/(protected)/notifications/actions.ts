"use server";
import { createUserClient } from "@/lib/supabase/server";
import { actionFailure } from "@/lib/action-state";
import { InputError, type ActionState } from "@/domains/shared/errors";
import { notificationCategories, type NotificationCategory } from "@/domains/platform/types";
import { markNotificationRead, saveNotificationPreference } from "@/domains/platform/service";
export async function markReadAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await markNotificationRead(await createUserClient(), String(form.get("id") ?? ""));
    return { success: true, message: "Notification marked as read." };
  } catch (error) {
    return actionFailure(error);
  }
}
export async function notificationPreferenceAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const category = String(form.get("category") ?? "");
    if (!notificationCategories.some((value) => value === category))
      throw new InputError({ category: "Choose a valid notification category." });
    await saveNotificationPreference(await createUserClient(), {
      category: category as NotificationCategory,
      emailEnabled: form.has("emailEnabled"),
    });
    return {
      success: true,
      message: "Your notification preference was saved. Email delivery depends on the configured delivery service.",
    };
  } catch (error) {
    return actionFailure(error);
  }
}
