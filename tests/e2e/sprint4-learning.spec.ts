import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
const fixturePath = process.env.WORKSPACE_E2E_FIXTURES;
const f = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as {
      password: string;
      tutorEmail: string;
      studentEmail: string;
      otherEmail: string;
      studentId: string;
      subjectId: string;
      confirmedBookingId: string;
      completedBookingId?: string;
    })
  : null;
test.use({ trace: "off", actionTimeout: 15000 });
test.describe("Sprint4 source-backed learning journeys", () => {
  test.skip(!f, "Requires explicit disposable real Auth/PostgREST/Storage fixtures.");
  test.setTimeout(180000);
  async function login(page: Page, role: "tutor" | "student" | "other") {
    await page.goto("/login");
    await page.getByLabel("Email address", { exact: true }).fill(f![`${role}Email`]);
    await page.getByLabel("Password", { exact: true }).fill(f!.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/dashboard");
  }
  async function logout(page: Page) {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(/\/login/);
  }
  test("structured goal, missed date, explicit learner proposal confirmation, dated mastery and bounded progress", async ({
    page,
  }, info) => {
    await login(page, "tutor");
    await page.goto("/study-plans");
    const form = page.getByRole("form", { name: "Create study plan", exact: true });
    const stamp = Date.now();
    const goalTitle = `Factor simple quadratic expressions ${info.project.name} ${stamp}`;
    const observation = `Saved work ${info.project.name} ${stamp} shows progress while sign errors still need attention.`;
    const title = `Structured factoring ${info.project.name} ${stamp}`,
      oldDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      newDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await form.getByLabel("Learning relationship", { exact: true }).selectOption(f!.confirmedBookingId);
    await form.getByLabel("Plan title", { exact: true }).fill(title);
    await form.getByLabel("Goal 1", { exact: true }).fill(goalTitle);
    await form.getByLabel("Goal 1 — topic", { exact: true }).fill("Math factoring");
    await form
      .getByLabel("Goal 1 — target date", { exact: true })
      .fill(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
    await form.getByLabel("Goal 1 — starting point", { exact: true }).fill("2 of 5 on the starting check");
    await form.getByLabel("Goal 1 — practice schedule", { exact: true }).fill("Tuesday at 14:00 UTC");
    await form
      .getByLabel("Goal 1 — success criterion", { exact: true })
      .fill("Solve and explain 4 of 5 factoring examples");
    await form.getByLabel("Goal 1 · milestone 1", { exact: true }).fill("Explain the common factor");
    await form.getByLabel("Milestone 1.1 — target date", { exact: false }).fill(oldDate);
    const material = form.locator('input[name="milestoneLinks:0:0"]');
    if (await material.count()) await material.first().check();
    await form.getByRole("button", { name: "Create study plan", exact: false }).click();
    await expect(
      form.getByText("Your study plan revision was saved. Progress stays linked to dated learning evidence."),
    ).toBeVisible();
    const href = await form.getByRole("link", { name: "Open saved work", exact: false }).getAttribute("href");
    await page.goto(href!);
    await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
    await expect(
      page.getByText("The target date has passed. The saved date stays visible until it is explicitly rescheduled.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("2 of 5 on the starting check", { exact: true })).toBeVisible();
    await page.getByText("Propose a date for learner confirmation", { exact: true }).click();
    const proposal = page.getByRole("form", { name: "Propose a new date for Explain the common factor", exact: true });
    await proposal.getByLabel("Proposed target date", { exact: true }).fill(newDate);
    await proposal
      .getByLabel("Why this date may help", { exact: true })
      .fill("More guided practice before the next check.");
    await proposal.getByRole("button", { name: "Save date proposal", exact: false }).click();
    await expect(
      page.getByText("A draft date proposal was saved. The current plan is unchanged until the learner confirms it."),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("The target date has passed. The saved date stays visible until it is explicitly rescheduled.", {
        exact: true,
      }),
    ).toBeVisible();
    await logout(page);
    await login(page, "student");
    await page.goto(href!);
    const decision = page.getByRole("form", { name: "Decide date proposal", exact: true });
    await decision.getByLabel("Your decision", { exact: true }).selectOption("accept");
    await decision.getByLabel("Decision reason", { exact: true }).fill("More practice");
    await decision.getByLabel("I confirm any accepted date change", { exact: true }).check();
    await decision.getByRole("button", { name: "Record my decision", exact: false }).click();
    await expect(page.getByText("Your accepted date change was recorded with its reason and date.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("More practice", { exact: true })).toBeVisible();
    await expect(
      page.getByText("The target date has passed. The saved date stays visible until it is explicitly rescheduled.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("plan-learner-confirmed-replan.png"), fullPage: true });
    await page.goto("/progress");
    await expect(page.getByRole("heading", { level: 1, name: "Learning progress.", exact: true })).toBeVisible();
    await expect(page.getByText(goalTitle, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await logout(page);
    await login(page, "tutor");
    await page.goto(`/progress?student=${f!.studentId}`);
    const mastery = page.getByRole("form", { name: "Record Math topic mastery", exact: true });
    await mastery.getByLabel("Topic", { exact: true }).fill("Math factoring");
    await mastery.getByLabel("Current judgement", { exact: true }).selectOption("improving");
    const source = mastery.getByLabel("Dated evidence source", { exact: true });
    const choices = await source
      .locator("option")
      .evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value).filter(Boolean));
    expect(choices.length).toBeGreaterThan(0);
    await source.selectOption(choices[0]);
    await mastery.getByLabel("What the evidence shows (optional)", { exact: true }).fill(observation);
    await mastery.getByRole("button", { name: "Save dated observation", exact: false }).click();
    await expect(
      page.getByText(
        "Your topic observation was saved with its evidence source and date. Earlier observations remain in the history.",
      ),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText("Improving", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("progress-tutor-dated-evidence.png"), fullPage: true });
    await logout(page);
    await login(page, "student");
    await page.goto("/progress");
    await expect(page.getByText(observation, { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("progress-student-evidence.png"), fullPage: true });
    await logout(page);
    await login(page, "other");
    await page.goto(`/progress?student=${f!.studentId}`);
    await expect(page.getByRole("alert").filter({ hasText: "not available for your account" })).toBeVisible();
    await expect(page.getByText(observation, { exact: true })).toHaveCount(0);
  });
  test("owner deletes only an optional reflection and required learning evidence stays visible", async ({
    page,
  }, info) => {
    test.skip(!f!.completedBookingId, "Needs an explicit completed local booking fixture.");
    await login(page, "student");
    await page.goto(`/sessions/${f!.completedBookingId}`);
    const form = page
      .getByRole("form", { name: /reflection/i })
      .filter({ has: page.getByRole("button", { name: /Save reflection/ }) });
    const textarea = form.locator("textarea");
    await textarea.fill(`Optional reflection ${info.project.name}`);
    await form.getByRole("button", { name: /Save reflection/ }).click();
    await page.reload();
    const deletion = page.getByRole("form", { name: "Delete optional reflection", exact: true });
    await deletion.getByLabel("I confirm I want to delete my optional reflection", { exact: true }).check();
    await deletion.getByRole("button", { name: "Delete reflection", exact: false }).click();
    await expect(
      page.getByText("Your optional reflection was deleted. Session, assessment and audit records are retained."),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole("form", { name: "Delete optional reflection", exact: true })).toHaveCount(0);
    await page.goto("/progress");
    await expect(page.getByRole("heading", { name: "Assessment evidence", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("progress-after-optional-reflection-delete.png"), fullPage: true });
  });
  test("student creates and revises a private plan before any tutor booking", async ({ page }, info) => {
    await login(page, "other");
    await page.goto("/study-plans");
    const form = page.getByRole("form", { name: "Create study plan", exact: true });
    await expect(form.getByLabel("Learning relationship", { exact: true })).toHaveCount(0);
    await form.getByLabel("Subject", { exact: true }).selectOption(f!.subjectId);
    const stamp = Date.now();
    const title = `Personal goal ${info.project.name} ${stamp}`;
    const goalTitle = `Learn factoring independently ${info.project.name} ${stamp}`;
    await form.getByLabel("Plan title", { exact: true }).fill(title);
    await form.getByLabel("Goal 1", { exact: true }).fill(goalTitle);
    await form.getByLabel("Goal 1 — topic", { exact: true }).fill("Factoring");
    await form
      .getByLabel("Goal 1 — target date", { exact: true })
      .fill(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
    await form.getByLabel("Goal 1 — starting point", { exact: true }).fill("Can identify one of five common factors");
    await form.getByLabel("Goal 1 — practice schedule", { exact: true }).fill("Tuesday at 14:00 UTC");
    await form.getByLabel("Goal 1 — success criterion", { exact: true }).fill("Explain four of five common factors");
    await form.getByLabel("Goal 1 · milestone 1", { exact: true }).fill("Identify a common factor");
    await form.getByRole("button", { name: "Create study plan", exact: false }).click();
    await expect(
      form.getByText("Your study plan revision was saved. Progress stays linked to dated learning evidence."),
    ).toBeVisible();
    const href = await form.getByRole("link", { name: "Open saved work", exact: false }).getAttribute("href");
    await page.goto(href!);
    await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "No matching booked tutor relationship is available. You can keep working on this plan independently.",
        { exact: true },
      ),
    ).toBeVisible();
    const edit = page.getByRole("form", { name: "Revise study plan", exact: true });
    await edit
      .getByLabel("Goal 1 — success criterion", { exact: true })
      .fill("Explain all five common factors with examples");
    await edit.getByRole("button", { name: "Save new revision", exact: false }).click();
    await expect(
      edit.getByText("Your study plan revision was saved. Progress stays linked to dated learning evidence."),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText("Explain all five common factors with examples", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("personal-plan-before-booking.png"), fullPage: true });
    await page.goto("/progress");
    await expect(page.getByText(goalTitle, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await logout(page);
    await login(page, "student");
    await page.goto(href!);
    await expect(page.getByRole("alert").filter({ hasText: "not available for your account" })).toBeVisible();
  });
});
