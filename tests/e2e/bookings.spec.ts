import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const enabled = process.env.BOOKING_E2E === "1";
test.use({ trace: "off" });

test.describe("LIVE UC-04 reservation persistence (explicit disposable fixtures required)", () => {
  test.skip(
    !enabled,
    "Set BOOKING_E2E=1 and provide verified local booking fixtures; a skip is not a passing persistence test.",
  );
  test.describe.configure({ mode: "serial" });

  test("persists a payment-pending reservation, reloads it and cancels through the real RPC", async ({
    page,
  }, testInfo) => {
    const required = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "BOOKING_E2E_STUDENT_EMAIL",
      "BOOKING_E2E_STUDENT_PASSWORD",
      "BOOKING_E2E_TUTOR_ID",
      "BOOKING_E2E_SUBJECT_ID",
      "BOOKING_E2E_STARTS_AT",
      "BOOKING_E2E_ENDS_AT",
    ];
    for (const name of required) if (!process.env[name]) throw new Error(`Missing required fixture variable: ${name}`);
    const mode = process.env.BOOKING_E2E_MODE ?? "virtual";
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const login = await client.auth.signInWithPassword({
      email: process.env.BOOKING_E2E_STUDENT_EMAIL!,
      password: process.env.BOOKING_E2E_STUDENT_PASSWORD!,
    });
    if (login.error || !login.data.user?.email_confirmed_at)
      throw new Error("A real verified student fixture is required.");
    let bookingId: string | undefined;
    let submittedKey: string | undefined;
    try {
      await page.goto("/login");
      await page.getByLabel("Email address").fill(process.env.BOOKING_E2E_STUDENT_EMAIL!);
      await page.getByLabel("Password", { exact: true }).fill(process.env.BOOKING_E2E_STUDENT_PASSWORD!);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL("**/dashboard");
      await page.goto("/bookings");
      await expect(page.getByRole("heading", { name: "Bookings.", exact: true })).toBeVisible();
      await expect(page.getByText("Payment not implemented — no charge.", { exact: true })).toBeVisible();
      await page.getByLabel("Published tutor", { exact: true }).selectOption(process.env.BOOKING_E2E_TUTOR_ID!);
      await page.getByLabel("Subject", { exact: true }).selectOption(process.env.BOOKING_E2E_SUBJECT_ID!);
      await page.getByLabel("Session mode").selectOption(mode);
      await page.getByLabel("Start time (ISO UTC)").fill(process.env.BOOKING_E2E_STARTS_AT!);
      await page.getByLabel("End time (ISO UTC)").fill(process.env.BOOKING_E2E_ENDS_AT!);
      submittedKey = await page.locator('input[name="request_key"]').inputValue();
      await page.getByRole("button", { name: "Request reservation — no charge" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Reservation saved." })).toBeVisible();
      const saved = await client
        .from("bookings")
        .select("id,status,price_minor,hold_expires_at,student_id,tutor_id,subject_id,starts_at,ends_at,mode")
        .eq("student_id", login.data.user.id)
        .eq("request_key", submittedKey)
        .single();
      expect(saved.error).toBeNull();
      expect(saved.data).toMatchObject({
        status: "payment_pending",
        tutor_id: process.env.BOOKING_E2E_TUTOR_ID,
        subject_id: process.env.BOOKING_E2E_SUBJECT_ID,
        mode,
      });
      bookingId = saved.data!.id;
      expect(Number(saved.data!.price_minor)).toBeGreaterThan(0);
      expect(Date.parse(saved.data!.hold_expires_at)).toBeGreaterThan(Date.now());
      expect(Date.parse(saved.data!.starts_at)).toBe(Date.parse(process.env.BOOKING_E2E_STARTS_AT!));
      expect(Date.parse(saved.data!.ends_at)).toBe(Date.parse(process.env.BOOKING_E2E_ENDS_AT!));
      const payments = await client.from("payments").select("id").eq("booking_id", bookingId);
      expect(payments.error).toBeNull();
      expect(payments.data).toEqual([]);
      const replay = await client.rpc("create_booking", {
        tutor: process.env.BOOKING_E2E_TUTOR_ID,
        subject: process.env.BOOKING_E2E_SUBJECT_ID,
        starts_at: process.env.BOOKING_E2E_STARTS_AT,
        ends_at: process.env.BOOKING_E2E_ENDS_AT,
        mode,
        request_key: submittedKey,
      });
      expect(replay.error).toBeNull();
      expect(replay.data).toBe(bookingId);
      const anonymous = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const deniedRead = await anonymous.from("bookings").select("id").eq("id", bookingId);
      expect(deniedRead.error !== null || deniedRead.data?.length === 0).toBe(true);
      const deniedCancel = await anonymous.rpc("cancel_booking", {
        booking: bookingId,
        reason: "Unauthorized attempt must fail",
      });
      expect(deniedCancel.error).not.toBeNull();
      const conflicting = await client.rpc("create_booking", {
        tutor: process.env.BOOKING_E2E_TUTOR_ID,
        subject: process.env.BOOKING_E2E_SUBJECT_ID,
        starts_at: process.env.BOOKING_E2E_STARTS_AT,
        ends_at: process.env.BOOKING_E2E_ENDS_AT,
        mode,
        request_key: crypto.randomUUID(),
      });
      expect(conflicting.error?.code).toBe("23P01");
      const reusedKey = await client.rpc("create_booking", {
        tutor: process.env.BOOKING_E2E_TUTOR_ID,
        subject: process.env.BOOKING_E2E_SUBJECT_ID,
        starts_at: process.env.BOOKING_E2E_STARTS_AT,
        ends_at: new Date(Date.parse(process.env.BOOKING_E2E_ENDS_AT!) + 60000).toISOString(),
        mode,
        request_key: submittedKey,
      });
      expect(reusedKey.error?.code).toBe("22023");
      await page.reload();
      const card = page.locator(`[data-booking-id="${bookingId}"]`);
      await expect(card.getByTestId("booking-status")).toHaveText("payment_pending");
      await expect(card.getByTestId("booking-price")).toContainText(`${saved.data!.price_minor}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("booking-persisted.png"), fullPage: true });
      await card.getByText("Cancel reservation", { exact: true }).click();
      await card.getByLabel("Cancellation reason").fill("Disposable UC-04 browser fixture cleanup");
      await card.getByRole("button", { name: "Save cancellation" }).click();
      await expect(card.getByTestId("booking-status")).toHaveText("cancelled");
      await page.reload();
      await expect(page.locator(`[data-booking-id="${bookingId}"]`).getByTestId("booking-status")).toHaveText(
        "cancelled",
      );
      const cancelled = await client.from("bookings").select("status,cancellation_reason").eq("id", bookingId).single();
      expect(cancelled.error).toBeNull();
      expect(cancelled.data?.status).toBe("cancelled");
      await page.screenshot({ path: testInfo.outputPath("booking-cancelled.png"), fullPage: true });
    } finally {
      if (!bookingId && submittedKey) {
        const lookup = await client
          .from("bookings")
          .select("id")
          .eq("student_id", login.data.user.id)
          .eq("request_key", submittedKey)
          .maybeSingle();
        if (lookup.error) throw new Error("Could not inspect the disposable reservation for cleanup.");
        bookingId = lookup.data?.id;
      }
      try {
        if (bookingId) {
          const cleanup = await client.rpc("cancel_booking", {
            booking: bookingId,
            reason: "Disposable UC-04 fixture cleanup",
          });
          if (cleanup.error)
            throw new Error("Could not cancel the disposable reservation; manual cleanup is required.");
        }
      } finally {
        await client.auth.signOut({ scope: "local" });
      }
    }
  });
});
