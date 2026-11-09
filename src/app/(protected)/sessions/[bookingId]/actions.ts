"use server";
import { InputError, type ActionState } from "@/domains/shared/errors";

import { revalidatePath } from "next/cache";
import { createUserClient } from "@/lib/supabase/server";
import { actionFailure } from "@/lib/action-state";
import {
  markSessionCompleted,
  publishStructuredRecap,
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
    form.delete("priorityTopic");
    String(form.get("priorityTopics") ?? "")
      .split(/[,\n]/)
      .map((topic) => topic.trim())
      .filter(Boolean)
      .forEach((topic) => form.append("priorityTopic", topic));
    const savedAt = await saveStudentPlan(await createUserClient(), form);
    refresh(form);
    return { success: true, savedAt, message: "Goals and questions saved. Your tutor can now read them." };
  } catch (error) {
    return actionFailure(error, readValues(form, ["goals", "questions", "priorityTopics"]));
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
    const savedAt = await publishStructuredRecap(await createUserClient(), {
      bookingId: String(form.get("booking") ?? ""),
      summary: String(form.get("summary") ?? ""),
      topics: String(form.get("topics") ?? "")
        .split(/[,\n]/)
        .map((topic) => topic.trim())
        .filter(Boolean),
      strengths: String(form.get("strengths") ?? ""),
      practiceAreas: String(form.get("practiceAreas") ?? ""),
      masteryNotes: String(form.get("mastery_notes") ?? "") || null,
      nextSteps: String(form.get("next_steps") ?? "") || null,
      resourceIds: form.getAll("resourceIds").map(String),
    });
    refresh(form);
    return { success: true, savedAt, message: "Recap published. Your student can now read it." };
  } catch (error) {
    return actionFailure(
      error instanceof InputError
        ? new InputError(
            Object.fromEntries(
              Object.entries(error.fields).map(([key, message]) => [
                key === "masteryNotes" ? "mastery_notes" : key === "nextSteps" ? "next_steps" : key,
                message,
              ]),
            ),
          )
        : error,
      readValues(form, ["summary", "topics", "strengths", "practiceAreas", "mastery_notes", "next_steps"]),
    );
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

export async function meetingDetailsAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { saveBookingPrivateDetails } = await import("@/domains/marketplace/service");
    await saveBookingPrivateDetails(await createUserClient(), String(form.get("bookingId") ?? ""), {
      meetingUrl: String(form.get("meetingUrl") ?? "") || null,
      meetingPlace: String(form.get("meetingPlace") ?? "") || null,
    });
    return { success: true, message: "Private meeting details were saved for this booking’s participants." };
  } catch (error) {
    return actionFailure(error, {
      meetingUrl: String(form.get("meetingUrl") ?? ""),
      meetingPlace: String(form.get("meetingPlace") ?? ""),
    });
  }
}

export async function saveAgendaLinksAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { saveTutorAgendaLearningLinks } = await import("@/domains/sessions/service");
    const links = form.getAll("learningLinks").map((value) => {
      const [kind, id, milestoneId] = String(value).split(":");
      if (kind === "milestone" && id && milestoneId) return { kind, studyPlanId: id, milestoneId } as const;
      if ((kind === "resource" || kind === "assignment" || kind === "assessment") && id) return { kind, id };
      throw new InputError({ learningLinks: "Choose a valid linked learning record." });
    });
    await saveTutorAgendaLearningLinks(await createUserClient(), String(form.get("booking") ?? ""), links);
    refresh(form);
    return { success: true, message: "The session agenda’s learning links were saved." };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function uploadSessionAttachmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new InputError({ file: "Choose a session preparation file." });
    const { uploadSessionAttachment } = await import("@/domains/sessions/service");
    await uploadSessionAttachment(await createUserClient(), String(form.get("booking") ?? ""), file);
    refresh(form);
    return { success: true, message: "Your private preparation file was uploaded. Its review is pending." };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function reviewSessionAttachmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    if (!form.has("confirmed")) throw new InputError({ confirmed: "Confirm your attachment review decision." });
    const decision = String(form.get("decision") ?? "");
    if (decision !== "approved" && decision !== "rejected")
      throw new InputError({ decision: "Choose Approve or Reject." });
    const { reviewSessionAttachment } = await import("@/domains/sessions/service");
    await reviewSessionAttachment(await createUserClient(), String(form.get("attachmentId") ?? ""), {
      decision,
      reason: String(form.get("reason") ?? "") || null,
    });
    refresh(form);
    return { success: true, message: "Your preparation-file review decision was saved." };
  } catch (error) {
    return actionFailure(error, readValues(form, ["decision", "reason"]));
  }
}
