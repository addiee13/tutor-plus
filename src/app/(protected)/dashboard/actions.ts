"use server";
import { revalidatePath } from "next/cache";
import { createUserClient } from "@/lib/supabase/server";
import { saveTutor, unsaveTutor } from "@/domains/marketplace/service";
import { actionFailure } from "@/lib/action-state";
import type { ActionState } from "@/domains/shared/errors";
export async function saveTutorAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const tutorId = String(form.get("tutorId") ?? "");
    await saveTutor(await createUserClient(), tutorId);
    revalidatePath("/dashboard");
    revalidatePath(`/tutors/${tutorId}`);
    return { success: true, message: "This tutor was saved to your account." };
  } catch (error) {
    return actionFailure(error);
  }
}
export async function unsaveTutorAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const tutorId = String(form.get("tutorId") ?? "");
    await unsaveTutor(await createUserClient(), tutorId);
    revalidatePath("/dashboard");
    revalidatePath(`/tutors/${tutorId}`);
    return { success: true, message: "This tutor was removed from your saved list." };
  } catch (error) {
    return actionFailure(error);
  }
}
