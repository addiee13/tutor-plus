"use server";

import { revalidatePath } from "next/cache";
import { createUserClient } from "@/lib/supabase/server";
import { safeMessage } from "@/domains/shared/errors";
import { requestBooking, cancelBooking } from "@/domains/bookings/service";
import { BookingInputError } from "@/domains/bookings/validation";
import type { BookingActionState } from "@/domains/bookings/types";

function failed(error: unknown): BookingActionState {
  return { message: error instanceof BookingInputError ? Object.values(error.fields)[0] : safeMessage(error), fields: error instanceof BookingInputError ? error.fields : undefined };
}

export async function requestBookingAction(_previous: BookingActionState, form: FormData): Promise<BookingActionState> {
  try {
    const booking = await requestBooking(await createUserClient(), form);
    revalidatePath("/bookings");
    return { success: true, bookingId: booking.id, message: "Reservation saved. Check its persisted status and hold below. Payment is not implemented; no charge was made by this request." };
  } catch (error) { return failed(error); }
}

export async function cancelBookingAction(_previous: BookingActionState, form: FormData): Promise<BookingActionState> {
  try {
    const booking = await cancelBooking(await createUserClient(), form);
    revalidatePath("/bookings");
    return { success: true, bookingId: booking.id, message: "Cancellation saved. This action does not issue a payment or refund." };
  } catch (error) { return failed(error); }
}
