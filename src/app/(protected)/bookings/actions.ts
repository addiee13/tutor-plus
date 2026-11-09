"use server";

import { revalidatePath } from "next/cache";
import { createUserClient } from "@/lib/supabase/server";
import { actionFailure } from "@/lib/action-state";
import { safeMessage } from "@/domains/shared/errors";
import { cancelBooking, listTutorSlots, requestBooking } from "@/domains/bookings/service";
import type { BookingActionState, SlotListResult } from "@/domains/bookings/types";

/** Booking forms lead with the first field problem, since their fields sit far apart on the page. */
function bookingFailure(error: unknown): BookingActionState {
  const state = actionFailure(error);
  const firstFieldMessage = state.fields ? Object.values(state.fields)[0] : undefined;
  return { message: firstFieldMessage ?? state.message, fields: state.fields };
}

export async function requestBookingAction(_previous: BookingActionState, form: FormData): Promise<BookingActionState> {
  try {
    const booking = await requestBooking(await createUserClient(), form);
    revalidatePath("/bookings");
    return {
      success: true,
      bookingId: booking.id,
      message:
        "Reservation saved. Check its persisted status and hold below. Payment is not implemented; no charge was made by this request.",
    };
  } catch (error) {
    return bookingFailure(error);
  }
}

export async function cancelBookingAction(_previous: BookingActionState, form: FormData): Promise<BookingActionState> {
  try {
    const booking = await cancelBooking(await createUserClient(), form);
    revalidatePath("/bookings");
    return {
      success: true,
      bookingId: booking.id,
      message: "Cancellation saved. This action does not issue a payment or refund.",
    };
  } catch (error) {
    return bookingFailure(error);
  }
}

export async function listTutorSlotsAction(tutor: string, duration: number): Promise<SlotListResult> {
  try {
    return await listTutorSlots(await createUserClient(), { tutor, duration });
  } catch (error) {
    return { message: safeMessage(error) };
  }
}

export async function rescheduleBookingAction(
  _previous: BookingActionState,
  form: FormData,
): Promise<BookingActionState> {
  try {
    const { rescheduleBooking } = await import("@/domains/marketplace/service");
    const mode = String(form.get("mode") ?? "");
    if (mode !== "virtual" && mode !== "in_person") return { message: "Choose a valid teaching mode." };
    const booking = await rescheduleBooking(await createUserClient(), {
      bookingId: String(form.get("bookingId") ?? ""),
      tutorId: String(form.get("tutorId") ?? ""),
      subjectId: String(form.get("subjectId") ?? ""),
      startsAt: String(form.get("starts_at") ?? ""),
      endsAt: String(form.get("ends_at") ?? ""),
      mode,
      requestKey: String(form.get("requestKey") ?? ""),
      confirmedMove: form.has("confirmed_move"),
      reason: String(form.get("reason") ?? "") || undefined,
    });
    revalidatePath("/bookings");
    return {
      success: true,
      bookingId: booking.id,
      message:
        booking.status === "confirmed"
          ? "The confirmed session time was changed. The same booking and financial records were retained; no charge was created."
          : "Reservation moved to the new pending hold. The original reservation was replaced. No payment or confirmation was created.",
    };
  } catch (error) {
    return bookingFailure(error);
  }
}

export async function saveBookingNotesAction(
  _previous: import("@/domains/shared/errors").ActionState,
  form: FormData,
): Promise<import("@/domains/shared/errors").ActionState> {
  try {
    const { saveBookingStudentNotes } = await import("@/domains/bookings/service");
    const text = (name: string) => String(form.get(name) ?? "").trim();
    await saveBookingStudentNotes(await createUserClient(), text("bookingId"), {
      learningGoal: text("learningGoal") || null,
      topics: text("topics")
        .split(/[,\n]/)
        .map((value) => value.trim())
        .filter(Boolean),
      questions: text("questions") || null,
      privateNote: text("privateNote") || null,
      shareWithTutor: form.has("shareWithTutor"),
    });
    return {
      success: true,
      message: "Your booking notes and sharing choice were saved. Your private note stays visible only to you.",
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
