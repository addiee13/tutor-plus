"use server";

import { revalidatePath } from "next/cache";
import { createUserClient } from "@/lib/supabase/server";
import { actionFailure } from "@/lib/action-state";
import {
  markSessionCompleted,
  publishRecap,
  saveReflection,
  saveStudentPlan,
  saveTutorAgenda,
} from "@/domains/sessions/service";
import type { SessionActionState } from "@/domains/sessions/types";
import { readValues } from "@/domains/shared/form";

function refresh(form: FormData) {
  const booking = form.get("booking");
  if (typeof booking === "string") revalidatePath(`/sessions/${booking}`);
}

export async function saveGoalsAction(_previous: SessionActionState, form: FormData): Promise<SessionActionState> {
  try {
    const savedAt = await saveStudentPlan(await createUserClient(), form);
    refresh(form);
    return { success: true, savedAt, message: "Goals and questions saved. Your tutor can now read them." };
  } catch (error) {
    return actionFailure(error, readValues(form, ["goals", "questions"]));
  }
}

export async function saveAgendaAction(_previous: SessionActionState, form: FormData): Promise<SessionActionState> {
  try {
    const savedAt = await saveTutorAgenda(await createUserClient(), form);
    refresh(form);
    return { success: true, savedAt, message: "Agenda saved. Your student can now read it." };
  } catch (error) {
    return actionFailure(error, readValues(form, ["agenda"]));
  }
}

export async function markCompletedAction(_previous: SessionActionState, form: FormData): Promise<SessionActionState> {
  try {
    await markSessionCompleted(await createUserClient(), form);
    refresh(form);
    revalidatePath("/bookings");
    return { success: true, message: "Session marked as delivered. The booking is now completed." };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function publishRecapAction(_previous: SessionActionState, form: FormData): Promise<SessionActionState> {
  try {
    const savedAt = await publishRecap(await createUserClient(), form);
    refresh(form);
    return { success: true, savedAt, message: "Recap published. Your student can now read it." };
  } catch (error) {
    return actionFailure(error, readValues(form, ["summary", "mastery_notes", "next_steps"]));
  }
}

export async function saveReflectionAction(_previous: SessionActionState, form: FormData): Promise<SessionActionState> {
  try {
    const savedAt = await saveReflection(await createUserClient(), form);
    refresh(form);
    return { success: true, savedAt, message: "Private reflection saved. Only you can see it." };
  } catch (error) {
    return actionFailure(error, readValues(form, ["reflection"]));
  }
}
