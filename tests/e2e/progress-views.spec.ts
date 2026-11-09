import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
const fixturePath = process.env.WORKSPACE_E2E_FIXTURES;
const f = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as {
      password: string;
      studentEmail: string;
      subjectId: string;
      tutorListingId: string;
    })
  : null;
test.use({ trace: "off", actionTimeout: 15000 });
test("progress filters scope dated evidence while keeping current goal targets explicit", async ({ page }, info) => {
  test.skip(!f, "Requires explicit disposable real Auth/PostgREST learning records.");
  test.setTimeout(240000);
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(f!.studentEmail);
  await page.getByLabel("Password", { exact: true }).fill(f!.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
  await page.goto("/progress");
  const form = page.getByRole("form", { name: "Filter learning progress", exact: true });
  const topic = JSON.stringify({ subjectId: f!.subjectId, topic: "Math factoring" });
  await form.getByLabel("Subject & topic", { exact: true }).selectOption(topic);
  await form.getByLabel("Tutor", { exact: true }).selectOption(f!.tutorListingId);
  await form.getByRole("button", { name: "Apply progress filters", exact: false }).click();
  await expect(form.getByLabel("Subject & topic", { exact: true })).toHaveValue(topic);
  const topics = page
    .locator("section.workspace-section")
    .filter({ has: page.getByRole("heading", { name: "Evidence by learning topic", exact: true }) });
  await expect(topics.getByRole("heading", { level: 3 })).toHaveCount(1);
  await expect(topics.getByRole("heading", { level: 3, name: "Math · Math factoring", exact: true })).toBeVisible();
  await form.getByLabel("Evidence date from", { exact: true }).fill("2030-01-01");
  await form.getByLabel("Evidence date through", { exact: true }).fill("2030-01-02");
  await form.getByRole("button", { name: "Apply progress filters", exact: false }).click();
  await expect(
    topics.getByText(
      "No topic-tagged evidence matches this view. Clear filters or open the context histories to see other saved work.",
      { exact: true },
    ),
  ).toBeVisible();
  const goals = page
    .locator("section.workspace-section")
    .filter({ has: page.getByRole("heading", { name: "Active goals", exact: true }) });
  expect(await goals.locator("li.workspace-record").count()).toBeGreaterThan(0);
  await expect(page.locator(".evidence-plot")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("progress-filtered-date-goal-context.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Clear progress filters", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Learning progress.", exact: true })).toBeVisible({ timeout: 45000 });
  const goalOptions = await form
    .getByLabel("Goal", { exact: true })
    .locator("option")
    .evaluateAll((rows) => rows.map((row) => (row as HTMLOptionElement).value).filter(Boolean));
  expect(goalOptions.length).toBeGreaterThan(0);
  await form.getByLabel("Goal", { exact: true }).selectOption(goalOptions[0]);
  await form.getByRole("button", { name: "Apply progress filters", exact: false }).click();
  await expect(page.getByRole("heading", { name: "Learning progress.", exact: true })).toBeVisible({ timeout: 45000 });
  await expect(goals.locator("li.workspace-record")).toHaveCount(1);
  await page.goto("/progress?from=2030-01-02&to=2030-01-01");
  await expect(page.getByRole("alert").filter({ hasText: "Please check the highlighted details" })).toBeVisible();
  await expect(page.locator(".evidence-plot")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Clear filters & open permitted progress", exact: false })).toBeVisible();
});
