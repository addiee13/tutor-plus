"use server";
import { createUserClient } from "@/lib/supabase/server";
import { actionFailure } from "@/lib/action-state";
import { InputError, type ActionState } from "@/domains/shared/errors";
import {
  saveNotificationTemplate,
  setAdminUserStatus,
  saveMatchingFactors,
  setAdminUserRole,
} from "@/domains/platform/service";
import { notificationCategories, type NotificationCategory, type MatchingFactorKey } from "@/domains/platform/types";
function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}
function values(form: FormData) {
  return Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string")) as Record<
    string,
    string
  >;
}
function confirmed(form: FormData) {
  if (!form.has("confirmed")) throw new InputError({ confirmed: "Confirm the change before it is recorded." });
}
export async function adminStatusAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    confirmed(form);
    const active = text(form, "status");
    if (active !== "active" && active !== "inactive")
      throw new InputError({ status: "Choose a valid account status." });
    await setAdminUserStatus(await createUserClient(), {
      userId: text(form, "userId"),
      active: active === "active",
      confirmed: true,
      reason: text(form, "reason"),
    });
    return { success: true, message: "The confirmed account status decision and reason were recorded." };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function adminRoleAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    confirmed(form);
    const role = text(form, "role"),
      operation = text(form, "operation");
    if (role !== "student" && role !== "tutor" && role !== "administrator")
      throw new InputError({ role: "Choose a valid capability." });
    if (operation !== "grant" && operation !== "revoke") throw new InputError({ operation: "Choose Grant or Revoke." });
    await setAdminUserRole(await createUserClient(), {
      userId: text(form, "userId"),
      role,
      operation,
      confirmed: true,
      reason: text(form, "reason"),
    });
    return { success: true, message: "The confirmed capability decision and reason were recorded." };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function templateAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    confirmed(form);
    const category = text(form, "category");
    if (!notificationCategories.some((value) => value === category))
      throw new InputError({ category: "Choose a valid notification category." });
    await saveNotificationTemplate(await createUserClient(), {
      id: text(form, "id") || undefined,
      category: category as NotificationCategory,
      title: text(form, "title"),
      body: text(form, "body"),
      targetPath: text(form, "targetPath") || null,
      active: form.has("active"),
      confirmed: true,
      reason: text(form, "reason"),
    });
    return { success: true, message: "The notification template change was saved with its reason and version." };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
export async function matchingFactorsAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    confirmed(form);
    const keys: MatchingFactorKey[] = ["rate_fit", "teaching_preference", "rating", "experience", "completed_sessions"];
    await saveMatchingFactors(await createUserClient(), {
      factors: keys.map((key) => ({
        key,
        label: text(form, `label:${key}`),
        weight: Number(text(form, `weight:${key}`)),
        active: form.has(`active:${key}`),
      })),
      confirmed: true,
      reason: text(form, "reason"),
    });
    return { success: true, message: "A new matching factor version was published with the recorded reason." };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
