"use server";
import { revalidatePath } from "next/cache";
import { createUserClient } from "@/lib/supabase/server";
import { actionFailure } from "@/lib/action-state";
import { InputError, type ActionState } from "@/domains/shared/errors";
import { readLearningProfile, saveLearningProfile } from "@/domains/marketplace/service";
export async function learningProfileAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const client = await createUserClient();
    const previous = await readLearningProfile(client);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const preferredMode = text("preferredMode") || previous.preferredMode;
    if (preferredMode !== "virtual" && preferredMode !== "in_person" && preferredMode !== "no_preference")
      throw new InputError({ preferredMode: "Choose a valid learning-mode preference." });
    await saveLearningProfile(client, {
      displayName: previous.displayName,
      timezone: previous.timezone,
      bio: text("bio") || null,
      city: text("city") || null,
      region: text("region") || null,
      postalCode: text("postalCode") || null,
      countryCode: text("countryCode") || null,
      interests: text("interests")
        .split(/[,\n]/)
        .map((value) => value.trim())
        .filter(Boolean),
      preferredMode,
      learningPreferences: {
        ...previous.learningPreferences,
        goals: text("goals"),
        preferredApproach: text("preferredApproach"),
        accessNeeds: text("accessNeeds"),
      },
    });
    revalidatePath("/profile");
    return { success: true, message: "Your private learning profile and preferences were saved." };
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

export async function profileAvatarAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const file = form.get("avatar");
    if (!(file instanceof File) || !file.size) throw new InputError({ avatar: "Choose a profile image to upload." });
    const { uploadProfileAvatar } = await import("@/domains/profiles/service");
    await uploadProfileAvatar(await createUserClient(), file);
    return { success: true, message: "Your private profile photo was saved." };
  } catch (error) {
    return actionFailure(error);
  }
}
export async function deleteProfileAvatarAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    if (!form.has("confirmed")) throw new InputError({ confirmed: "Confirm removal of your private profile photo." });
    const { deleteOwnProfileAvatar } = await import("@/domains/profiles/service");
    await deleteOwnProfileAvatar(await createUserClient());
    return { success: true, message: "Your private profile photo was removed." };
  } catch (error) {
    return actionFailure(error);
  }
}
