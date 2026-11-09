"use server";
import { createUserClient } from "@/lib/supabase/server";
import { saveBadgePolicy } from "@/domains/platform/service";
import type { BadgeThreshold } from "@/domains/platform/types";
import { actionFailure } from "@/lib/action-state";
import { InputError, type ActionState } from "@/domains/shared/errors";
export async function badgePolicyAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const text = (key: string) => String(form.get(key) ?? "").trim();
    if (!form.has("confirmed")) throw new InputError({ confirmed: "Confirm this badge policy version." });
    const count = Number(text("thresholdCount"));
    if (!Number.isInteger(count) || count < 1 || count > 4)
      throw new InputError({ thresholds: "Use one to four supported badge rules." });
    const thresholds = Array.from({ length: count }, (_, i): BadgeThreshold => {
      const fact = text(`fact:${i}`);
      if (
        fact !== "completed_sessions" &&
        fact !== "visible_reviews" &&
        fact !== "rating_average" &&
        fact !== "recommendations"
      )
        throw new InputError({ [`fact:${i}`]: "Choose a supported public platform fact." });
      return { fact, threshold: Number(text(`threshold:${i}`)), label: text(`label:${i}`) };
    });
    const saved = await saveBadgePolicy(await createUserClient(), {
      expectedVersion: Number(text("expectedVersion")),
      thresholds,
      confirmed: true,
      reason: text("reason"),
    });
    return { success: true, message: `Badge policy version ${saved.version} was published with its reason.` };
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
