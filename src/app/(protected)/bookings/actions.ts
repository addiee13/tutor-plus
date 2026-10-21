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
