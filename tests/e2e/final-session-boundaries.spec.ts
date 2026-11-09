import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { formatViewerInstant } from "../../src/lib/time-presentation";
const file = process.env.WORKSPACE_E2E_FIXTURES;
const f = file
  ? (JSON.parse(readFileSync(file, "utf8")) as {
      password: string;
      studentEmail: string;
      tutorEmail: string;
      confirmedBookingId: string;
      completedBookingId: string;
    })
  : null;
test.use({ trace: "off", actionTimeout: 15000 });
async function login(page: Page, role: "student" | "tutor") {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(f![`${role}Email`]);
  await page.getByLabel("Password", { exact: true }).fill(f!.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
}
async function rawText(field: Locator, value: string) {
  // Send an adversarial form value without changing SSR attributes during hydration.
  await field.evaluate((element, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(element, next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}
async function send(form: Locator) {
  const page = form.page();
  const path = new URL(page.url()).pathname;
  const response = page.waitForResponse(
    (item) => new URL(item.url()).pathname === path && item.request().method() === "POST",
  );
  await form.dispatchEvent("submit");
  await response;
}
test.describe("Independent exact session and display partitions", () => {
  test.skip(!f, "Requires explicit future and completed local no-charge fixtures.");
  test.setTimeout(180000);
  test("student preparation accepts2000 but refuses blank, overlength and control input without overwriting", async ({
    page,
  }) => {
    await login(page, "student");
    await page.goto(`/sessions/${f!.confirmedBookingId}`);
    const form = page.getByRole("form", { name: "Save session goals", exact: true });
    const goals = form.getByLabel("Goals for this session", { exact: true });
    const original = await goals.inputValue();
    try {
      await goals.fill("G".repeat(2000));
      await send(form);
      await page.reload();
      await expect(goals).toHaveValue("G".repeat(2000));
      for (const invalid of ["", "G".repeat(2001), "Goal\u0001unsupported"]) {
        await rawText(goals, invalid);
        await send(form);
        await expect(form.getByRole("alert")).toBeVisible();
        await page.reload();
        await expect(goals).toHaveValue("G".repeat(2000));
      }
    } finally {
      await goals.fill(original || "Restore the learner's factoring goals.");
      await send(form);
      await page.reload();
    }
  });
  test("tutor agenda accepts4000 and line breaks but rejects blank,4001 and unsupported controls", async ({ page }) => {
    await login(page, "tutor");
    await page.goto(`/sessions/${f!.confirmedBookingId}`);
    const form = page.getByRole("form", { name: "Save session agenda", exact: true });
    const agenda = form.getByLabel("Session agenda", { exact: true });
    const original = await agenda.inputValue();
    const accepted = `First line\n\t${"A".repeat(3988)}`;
    expect(accepted.length).toBe(4000);
    try {
      await agenda.fill(accepted);
      await send(form);
      await page.reload();
      await expect(agenda).toHaveValue(accepted);
      for (const invalid of ["", "A".repeat(4001), "Agenda\u0001unsupported"]) {
        await rawText(agenda, invalid);
        await send(form);
        await expect(form.getByRole("alert")).toBeVisible();
        await page.reload();
        await expect(agenda).toHaveValue(accepted);
      }
    } finally {
      await agenda.fill(original || "Restore the tutor's factoring agenda.");
      await send(form);
      await page.reload();
    }
  });
  test("recap keeps additional notes optional, permits exact2000 notes and4000 summary, and refuses overflow", async ({
    page,
  }, info) => {
    await login(page, "tutor");
    await page.goto(`/sessions/${f!.completedBookingId}`);
    const form = page.getByRole("form", { name: "Publish session recap", exact: true });
    const summary = form.getByLabel("What you covered", { exact: true });
    const notes = form.getByLabel("Additional tutor notes", { exact: true });
    const originalSummary = await summary.inputValue();
    const originalNotes = await notes.inputValue();
    const submit = () => send(form);
    const saved = () => page.reload();
    try {
      await notes.fill("");
      await submit();
      await saved();
      await page.reload();
      await expect(notes).toHaveValue("");
      await summary.fill("S".repeat(4000));
      await notes.fill("N".repeat(2000));
      await submit();
      await saved();
      await page.reload();
      await expect(summary).toHaveValue("S".repeat(4000));
      await expect(notes).toHaveValue("N".repeat(2000));
      await rawText(notes, "N".repeat(2001));
      await submit();
      await expect(form.getByRole("alert")).toBeVisible();
      await page.reload();
      await expect(notes).toHaveValue("N".repeat(2000));
      await rawText(summary, "S".repeat(4001));
      await submit();
      await expect(form.getByRole("alert")).toBeVisible();
      await page.reload();
      await expect(summary).toHaveValue("S".repeat(4000));
      await page.screenshot({ path: info.outputPath("recap-exact-boundaries-persisted.png"), fullPage: true });
    } finally {
      await summary.fill(originalSummary || "The learner practised factoring with clear worked examples.");
      await notes.fill(originalNotes);
      await submit();
      await saved();
    }
  });
  test("profile viewer zone renders booking/session local time without changing the canonical instant", async ({
    page,
  }, info) => {
    await login(page, "student");
    await page.goto("/profile");
    const zone = page.getByLabel("Time zone", { exact: true });
    const original = await zone.inputValue();
    try {
      await zone.selectOption("America/New_York");
      await page.getByRole("button", { name: "Save profile", exact: true }).click();
      await expect(page.getByText(/Your profile is saved/)).toBeVisible();
      await page.goto("/bookings");
      const card = page.locator(`[data-booking-id="${f!.confirmedBookingId}"]`);
      const local = card.getByTestId("viewer-local-time");
      const instant = (await local.getAttribute("datetime"))!;
      await expect(local).toHaveAttribute("data-timezone", "America/New_York");
      await expect(local).toHaveText(formatViewerInstant(instant, "America/New_York"));
      await expect(card.getByText("Starts (UTC)", { exact: true })).toBeVisible();
      await page.goto(`/sessions/${f!.confirmedBookingId}`);
      await expect(page.getByTestId("viewer-local-time")).toHaveAttribute("datetime", instant);
      await expect(page.getByTestId("viewer-local-time")).toHaveText(formatViewerInstant(instant, "America/New_York"));
      await expect(page.getByText("Canonical session (UTC)", { exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath("viewer-local-with-canonical-utc.png"), fullPage: true });
    } finally {
      await page.goto("/profile");
      await zone.selectOption(original);
      await page.getByRole("button", { name: "Save profile", exact: true }).click();
      await expect(page.getByText(/Your profile is saved/)).toBeVisible();
    }
  });
});
