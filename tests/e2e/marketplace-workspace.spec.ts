import { readFileSync } from "node:fs";
import { expect, test, type Page, type Locator } from "@playwright/test";
const fixturePath = process.env.WORKSPACE_E2E_FIXTURES;
const f = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as {
      password: string;
      studentEmail: string;
      confirmedBookingId: string;
      tutorListingId: string;
      subjectId: string;
    })
  : null;
test.use({ trace: "off", actionTimeout: 15000 });
test.describe("Real marketplace coordination", () => {
  test.skip(!f, "Requires explicit disposable real marketplace fixtures.");
  test.setTimeout(180000);
  async function login(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Email address", { exact: true }).fill(f!.studentEmail);
    await page.getByLabel("Password", { exact: true }).fill(f!.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/dashboard");
  }
  async function currentStart(card: Locator) {
    await expect(card).toBeVisible();
    return new Date((await card.locator("time[datetime]").first().getAttribute("datetime"))!).toISOString();
  }
  async function openMove(card: Locator) {
    await card.getByText("Reschedule confirmed session", { exact: true }).click();
    const form = card.getByRole("form", { name: "Reschedule confirmed session", exact: true });
    await expect(form.getByRole("button", { name: /^Soonest/ })).toBeVisible();
    return form;
  }
  async function commit(form: Locator, card: Locator, reason: string) {
    await form.getByLabel("Reason for the time change", { exact: true }).fill(reason);
    await form.getByLabel("I confirm this change to the confirmed session time.", { exact: true }).check();
    await form.getByRole("button", { name: "Confirm new session time", exact: true }).click();
    await expect(
      card.getByText(
        "The confirmed session time was changed. The same booking and financial records were retained; no charge was created.",
      ),
    ).toBeVisible();
  }
  test("confirmed reschedule preserves identity/status/price, exposes history, and can be restored", async ({
    page,
  }, info) => {
    await login(page);
    await page.goto("/bookings");
    const card = page.locator(`[data-booking-id="${f!.confirmedBookingId}"]`);
    const originalStart = await currentStart(card);
    const price = await card.getByTestId("booking-price").innerText();
    const reason = `Local confirmed move ${info.project.name} ${Date.now()}`;
    let newStart = originalStart;
    try {
      const form = await openMove(card);
      await form.getByRole("button", { name: /^Soonest/ }).click();
      newStart = await form.locator('input[name="starts_at"]').inputValue();
      expect(newStart).not.toBe(originalStart);
      await commit(form, card, reason);
      await page.reload();
      await expect(card.getByTestId("booking-status")).toHaveText("confirmed");
      expect(await card.getByTestId("booking-price").innerText()).toBe(price);
      expect(await currentStart(card)).toBe(newStart);
      await page.goto(`/bookings/${f!.confirmedBookingId}`);
      await expect(page.getByRole("heading", { level: 1, name: "Booking details.", exact: true })).toBeVisible();
      await expect(page.getByText(reason, { exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath("confirmed-reschedule-history.png"), fullPage: true });
    } finally {
      await page.goto("/bookings");
      if ((await currentStart(card)) !== originalStart) {
        const form = await openMove(card);
        const cell = form.locator(`[data-slot-starts~="${originalStart}"]`);
        if (!(await cell.isVisible().catch(() => false)))
          await form.getByRole("button", { name: "Next week →", exact: true }).click();
        await cell.click();
        await form.locator(`[data-starts-at="${originalStart}"]`).click();
        await commit(form, card, `Restore original fixture ${Date.now()}`);
        await page.reload();
        expect(await currentStart(card)).toBe(originalStart);
      }
    }
    const matching = new URLSearchParams({
      run: "1",
      subject: f!.subjectId,
      mode: "virtual",
      rate: "40.00",
      availableAt: newStart,
      duration: "60",
      strategies: "worked examples",
      topic: "Math factoring",
      level: "beginner",
      goal: "Solve four of five examples",
    });
    await page.goto(`/matching?${matching}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Find support for your next goal.", exact: true }),
    ).toBeVisible();
    const match = page
      .locator(".tutor-grid article")
      .filter({ has: page.locator(`a[href="/tutors/${f!.tutorListingId}"]`) });
    await expect(match).toBeVisible();
    await match.getByText("Why this tutor appears here", { exact: true }).click();
    await expect(match.getByText(/Factor version/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("matching-factual-explanations.png"), fullPage: true });
  });
  test("manual location failure preserves the radius and never broadens results", async ({ page }) => {
    await page.goto("/tutors?city=New%20York&country=US&radius=15");
    await expect(page.getByRole("alert").filter({ hasText: /Location lookup/ })).toBeVisible();
    await expect(page.getByLabel("Search radius (km)", { exact: true })).toHaveValue("15");
    await expect(page.locator(".tutor-grid article")).toHaveCount(0);
  });
});
