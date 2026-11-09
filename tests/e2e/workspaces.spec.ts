import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/** Only run against an explicitly supplied disposable local runtime. No fixture is an application demo state. */
const fixturePath = process.env.WORKSPACE_E2E_FIXTURES;
const fixtures = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as {
      password: string;
      tutorEmail: string;
      studentEmail: string;
      otherEmail: string;
      confirmedBookingId: string;
      tutorListingId: string;
      subjectId: string;
    })
  : null;

test.use({ trace: "off", actionTimeout: 15000 });
test.describe("Real persisted learning workspaces", () => {
  test.skip(
    !fixtures,
    "Requires explicit disposable real Auth/PostgREST/Storage fixtures. A skip does not prove persistence.",
  );
  test.setTimeout(180_000);

  async function login(page: Page, role: "tutor" | "student" | "other") {
    await page.goto("/login");
    await page.getByLabel("Email address", { exact: true }).fill(fixtures![`${role}Email`]);
    await page.getByLabel("Password", { exact: true }).fill(fixtures!.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/dashboard");
  }
  async function logout(page: Page) {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(/\/login/);
  }

  test("tutor authors/assigns an assessment, student submits, tutor scores, unrelated user is denied", async ({
    page,
  }, info) => {
    const title = `UI assessment ${info.project.name} ${Date.now()}`;
    await login(page, "tutor");
    await page.goto("/assessments");
    await expect(page.getByRole("heading", { name: "Assessments.", exact: true })).toBeVisible();
    const create = page.getByRole("form", { name: "Create assessment draft", exact: true });
    await create.getByLabel("Learning relationship", { exact: true }).selectOption(fixtures!.confirmedBookingId);
    await create.getByLabel("Assessment title", { exact: true }).fill(title);
    await create
      .getByLabel("Instructions for your learner", { exact: false })
      .fill("Explain your reasoning in your own words.");
    await create.getByLabel("Question 1 — prompt", { exact: true }).fill("Why does checking your work help learning?");
    await create.getByLabel("Question 1 — topic", { exact: true }).fill("Learning reflection");
    await create.getByLabel("Question 1 — points", { exact: true }).fill("5");
    await create.getByRole("button", { name: "Save assessment draft", exact: false }).click();
    await expect(
      create.getByText("Assessment draft saved. Review it before assigning it to your learner."),
    ).toBeVisible();
    const href = await create.getByRole("link", { name: "Open saved work", exact: false }).getAttribute("href");
    expect(href).toMatch(/^\/assessments\/[a-f0-9-]+$/);
    await page.goto(href!);
    await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Assign to learner", exact: false }).click();
    await expect(page.getByText("Assessment assigned. Your learner can now open and complete it.")).toBeVisible();
    await logout(page);
    await login(page, "student");
    await page.goto(href!);
    await page
      .getByLabel("Why does checking your work help learning?", { exact: false })
      .fill("Checking reveals mistakes and helps me decide what to practice next.");
    await page.getByLabel("Save or submit", { exact: true }).selectOption("true");
    await page.getByRole("button", { name: "Save answers", exact: false }).click();
    await expect(
      page.getByText("Your assessment attempt was submitted. Any written answers await tutor review."),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("Checking reveals mistakes and helps me decide what to practice next.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Correct answer:", { exact: false })).toHaveCount(0);
    await logout(page);
    await login(page, "tutor");
    await page.goto(href!);
    await page.getByText("Score written responses & give feedback", { exact: true }).click();
    await page.getByLabel("Points for written answers", { exact: true }).fill("5");
    await page
      .getByLabel("Feedback for your learner", { exact: true })
      .fill("Clear reflection on how mistakes guide your practice.");
    await page.getByRole("button", { name: "Save scoring & feedback", exact: false }).click();
    await expect(page.getByText("Your assessment scoring and feedback were saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("5 / 5 points", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("assessment-tutor-scored.png"), fullPage: true });
    await logout(page);
    await login(page, "student");
    await page.goto(href!);
    await expect(page.getByText("5 / 5 points", { exact: true })).toBeVisible();
    await expect(page.getByRole("form", { name: "Complete assessment", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("assessment-student-result.png"), fullPage: true });
    await logout(page);
    await login(page, "other");
    await page.goto(href!);
    await expect(page.getByRole("alert").filter({ hasText: "not available for your account" })).toBeVisible();
    await expect(
      page.getByText("Checking reveals mistakes and helps me decide what to practice next.", { exact: true }),
    ).toHaveCount(0);
  });

  test("private assignment upload persists, tutor downloads and reviews it", async ({ page }, info) => {
    const title = `UI file assignment ${info.project.name} ${Date.now()}`;
    await login(page, "tutor");
    await page.goto("/assignments");
    const create = page.getByRole("form", { name: "Create assignment draft", exact: true });
    await create.getByLabel("Learning relationship", { exact: true }).selectOption(fixtures!.confirmedBookingId);
    await create.getByLabel("Assignment title", { exact: true }).fill(title);
    await create.getByLabel("Learning topic", { exact: true }).fill("Math practice");
    await create
      .getByLabel("Instructions & success criteria", { exact: true })
      .fill("Upload a brief explanation of what you practiced.");
    await create.getByLabel("How the learner submits", { exact: true }).selectOption("file");
    await create
      .getByLabel("Due date & time (UTC)", { exact: true })
      .fill(new Date(Date.now() + 86400_000).toISOString().slice(0, 16));
    await create.getByRole("button", { name: "Save assignment draft", exact: false }).click();
    await expect(create.getByText("Assignment draft saved. Assign it when the instructions are ready.")).toBeVisible();
    const href = await create.getByRole("link", { name: "Open saved work", exact: false }).getAttribute("href");
    await page.goto(href!);
    await page.getByRole("button", { name: "Assign to learner", exact: false }).click();
    await expect(page.getByText("Your assignment was assigned to the learner.")).toBeVisible();
    await logout(page);
    await login(page, "student");
    await page.goto(href!);
    await page.getByLabel("Your file", { exact: true }).setInputFiles({
      name: "practice.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Real local assignment file verification."),
    });
    await page.getByRole("button", { name: "Submit work", exact: false }).click();
    await expect(page.getByRole("heading", { name: "Awaiting tutor feedback", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("link", { name: "Open private file", exact: false })).toBeVisible();
    await logout(page);
    await login(page, "tutor");
    await page.goto(href!);
    const download = await page.getByRole("link", { name: "Open private file", exact: false }).getAttribute("href");
    const file = await page.request.get(download!);
    expect(file.status()).toBe(200);
    expect(await file.text()).toBe("Real local assignment file verification.");
    await page.getByText("Review this submission", { exact: true }).click();
    await page.getByLabel("Feedback", { exact: true }).fill("Your practice record is clear and complete.");
    await page.getByLabel("Next step", { exact: true }).selectOption("completed");
    await page.getByRole("button", { name: "Save review", exact: false }).click();
    await expect(page.getByText("Your assignment feedback and review outcome were saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Your practice record is clear and complete.", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("assignment-file-reviewed.png"), fullPage: true });
    await logout(page);
    await login(page, "other");
    const denied = await page.request.get(download!);
    expect(denied.status()).toBe(403);
  });

  test("study-plan revisions preserve milestones and link saved learning evidence", async ({ page }, info) => {
    await login(page, "tutor");
    await page.goto("/study-plans");
    const create = page.getByRole("form", { name: "Create study plan", exact: true });
    await create.getByLabel("Learning relationship", { exact: true }).selectOption(fixtures!.confirmedBookingId);
    const title = `UI study plan ${info.project.name} ${Date.now()}`;
    await create.getByLabel("Plan title", { exact: true }).fill(title);
    await create.getByLabel("Goal 1", { exact: true }).fill("Build a steady practice habit");
    await create.getByLabel("Goal 1 — topic", { exact: true }).fill("Math factoring");
    await create
      .getByLabel("Goal 1 — target date", { exact: true })
      .fill(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
    await create.getByLabel("Goal 1 — starting point", { exact: true }).fill("2 of 5 practice questions");
    await create.getByLabel("Goal 1 — practice schedule", { exact: true }).fill("Tuesday at 14:00 UTC");
    await create
      .getByLabel("Goal 1 — success criterion", { exact: true })
      .fill("Explain and solve 4 of 5 factoring questions");
    await create
      .getByLabel("Goal 1 · milestone 1", { exact: true })
      .fill("Explain what a practice record demonstrates");
    await create.getByRole("button", { name: "Create study plan", exact: false }).click();
    await expect(
      create.getByText("Your study plan revision was saved. Progress stays linked to dated learning evidence."),
    ).toBeVisible();
    const href = await create.getByRole("link", { name: "Open saved work", exact: false }).getAttribute("href");
    await page.goto(href!);
    await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
    const edit = page.getByRole("form", { name: "Revise study plan", exact: true });
    await edit.getByLabel("Plan title", { exact: true }).fill(`${title} revised`);
    await edit.getByRole("button", { name: "Save new revision", exact: false }).click();
    await expect(
      edit.getByText("Your study plan revision was saved. Progress stays linked to dated learning evidence."),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText(`Revision 1 · ${title}`, { exact: true })).toBeVisible();
    await page.getByText("Link saved learning evidence", { exact: true }).click();
    const evidence = page.getByRole("form", { name: /Record evidence for/ });
    const options = evidence.getByLabel("Saved learning record", { exact: true });
    const eligible = await options
      .locator("option")
      .evaluateAll((elements) => elements.map((element) => (element as HTMLOptionElement).value).filter(Boolean));
    expect(eligible.length).toBeGreaterThan(0);
    await options.selectOption(eligible[0]);
    await evidence.getByRole("button", { name: "Link evidence", exact: false }).click();
    await expect(
      page.getByText("Evidence was linked to this milestone. Progress now reflects the saved record."),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "1 of 1 milestones have evidence", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("study-plan-evidence.png"), fullPage: true });
  });
});
