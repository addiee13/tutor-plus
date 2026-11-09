import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
const fixturePath = process.env.WORKSPACE_E2E_FIXTURES;
const f = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as {
      password: string;
      studentEmail: string;
      tutorEmail: string;
      adminEmail: string;
      otherEmail: string;
      subjectId: string;
      confirmedBookingId: string;
      tutorListingId: string;
    })
  : null;
test.use({ trace: "off", actionTimeout: 15000 });
test.describe("Reviewed learning catalog and saved support", () => {
  test.skip(!f, "Requires explicit disposable real Auth/PostgREST platform fixtures.");
  test.setTimeout(240000);
  async function login(page: Page, role: "student" | "tutor" | "admin" | "other") {
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
  test("admin template versions copy to an authorized Tutor draft and keep Student keys private", async ({
    page,
  }, info) => {
    const title = `Approved math template ${info.project.name} ${Date.now()}`;
    await login(page, "admin");
    await page.goto("/admin/assessment-templates");
    const create = page.getByRole("form", { name: "Create assessment template", exact: true });
    await create.getByLabel("Assessment template title", { exact: true }).fill(title);
    await create
      .getByLabel("Template instructions", { exact: false })
      .fill("Choose the sum and check it with a second method.");
    await create.getByLabel("Template subject", { exact: false }).selectOption(f!.subjectId);
    await create.getByLabel("Question 1 — topic", { exact: true }).fill("Math factoring");
    await create.getByLabel("Question 1 — prompt", { exact: true }).fill("What is 2 + 2?");
    await create.getByLabel("Question 1 — answer type", { exact: true }).selectOption("single_choice");
    await create.getByLabel("Question 1 — points", { exact: true }).fill("2");
    await create.getByLabel("Question 1 — answer choices", { exact: false }).fill("3\n4");
    await create.getByLabel("Question 1 — correct choice", { exact: false }).fill("4");
    await create.getByLabel("Make this version available to eligible tutors", { exact: true }).check();
    await create
      .getByLabel("Reason for this template version", { exact: true })
      .fill("Reviewed the local arithmetic definition and private answer key.");
    await create.getByLabel("I confirm this assessment template version", { exact: true }).check();
    await create.getByRole("button", { name: "Save confirmed template version", exact: false }).click();
    await expect(create.getByText("Assessment template version 1 was saved with its authoring reason.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await logout(page);
    await login(page, "tutor");
    await page.goto(`/assessments?templateBooking=${f!.confirmedBookingId}`);
    const catalog = page
      .locator("article.workspace-record")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await catalog.getByRole("button", { name: "Create draft from this template", exact: false }).click();
    await expect(
      catalog.getByText("An assessment draft was created from the approved template. Review it before assigning it."),
    ).toBeVisible();
    const href = await catalog.getByRole("link", { name: "Open saved work", exact: false }).getAttribute("href");
    await page.goto(href!);
    await expect(
      page
        .getByRole("form", { name: "Edit assessment draft", exact: true })
        .getByLabel("Question 1 — prompt", { exact: true }),
    ).toHaveValue("What is 2 + 2?");
    await page.getByRole("button", { name: "Assign to learner", exact: false }).click();
    await expect(page.getByRole("heading", { name: "Questions & answer key", exact: true })).toBeVisible({
      timeout: 45000,
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Questions & answer key", exact: true })).toBeVisible();
    await logout(page);
    await login(page, "admin");
    await page.goto("/admin/assessment-templates");
    const section = page
      .locator("section.workspace-section")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await section.getByText("Revise this template", { exact: true }).click();
    const edit = section.getByRole("form", { name: "Revise assessment template", exact: true });
    await edit.getByLabel("Question 1 — prompt", { exact: true }).fill("What is 3 + 3?");
    await edit.getByLabel("Question 1 — answer choices", { exact: false }).fill("5\n6");
    await edit.getByLabel("Question 1 — correct choice", { exact: false }).fill("6");
    await edit
      .getByLabel("Reason for this template version", { exact: true })
      .fill("Publish a second reviewed definition while retaining existing copies.");
    await edit.getByLabel("I confirm this assessment template version", { exact: true }).check();
    await edit.getByRole("button", { name: "Save confirmed template version", exact: false }).click();
    await expect(edit.getByText("Assessment template version 2 was saved with its authoring reason.")).toBeVisible();
    await page.reload();
    await section.screenshot({ path: info.outputPath("admin-assessment-template-version.png") });
    await logout(page);
    await login(page, "tutor");
    await page.goto(href!);
    await expect(page.getByRole("heading", { name: "What is 2 + 2?", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What is 3 + 3?", exact: true })).toHaveCount(0);
    await logout(page);
    await login(page, "student");
    await page.goto(href!);
    await expect(page.getByLabel("What is 2 + 2?", { exact: false })).toBeVisible();
    await expect(page.getByText("Correct answer:", { exact: true })).toHaveCount(0);
    await expect(page.locator('[name^="correctChoice:"]')).toHaveCount(0);
    expect(await page.content()).not.toContain('"correct_choice"');
    await page.screenshot({ path: info.outputPath("student-template-assessment-no-keys.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test("saved Tutor ownership, dashboard records and inclusive price bounds remain real", async ({ page }, info) => {
    await login(page, "student");
    await page.goto(`/tutors/${f!.tutorListingId}`);
    const remove = page.getByRole("form", { name: "Remove saved tutor", exact: true });
    if (await remove.count()) {
      await remove.getByRole("button", { name: "Remove from saved tutors", exact: false }).click();
      await expect(page.getByRole("form", { name: "Save tutor for later", exact: true })).toBeVisible();
      await page.reload();
    }
    await page
      .getByRole("form", { name: "Save tutor for later", exact: true })
      .getByRole("button", { name: "Save tutor for later", exact: false })
      .click();
    await expect(remove).toBeVisible();
    await page.reload();
    await expect(remove).toBeVisible();
    await page.goto("/dashboard");
    const saved = page
      .locator("section.workspace-section")
      .filter({ has: page.getByRole("heading", { name: "Saved tutors", exact: true }) });
    await expect(saved.getByRole("link", { name: "Local Proof Tutor", exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upcoming & current sessions", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("student-dashboard-real-records.png"), fullPage: true });
    await logout(page);
    await login(page, "other");
    await page.goto("/saved-tutors");
    await expect(page.getByRole("link", { name: "Local Proof Tutor", exact: true })).toHaveCount(0);
    await logout(page);
    await login(page, "student");
    await page.goto("/saved-tutors");
    await page.getByRole("button", { name: "Remove saved tutor", exact: false }).click();
    await expect(page.getByRole("link", { name: "Local Proof Tutor", exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("link", { name: "Local Proof Tutor", exact: true })).toHaveCount(0);
    await page.goto("/tutors?minRate=25&rate=25");
    await expect(page.getByRole("link", { name: "Local Proof Tutor", exact: true })).toBeVisible();
    await expect(page.getByLabel("Minimum per hour (USD)", { exact: true })).toHaveValue("25");
    await page.goto("/tutors?minRate=25.01&rate=30");
    await expect(page.getByRole("link", { name: "Local Proof Tutor", exact: true })).toHaveCount(0);
    await page.goto("/tutors?minRate=30&rate=20");
    await expect(
      page.getByRole("alert").filter({ hasText: "Maximum rate must be at least the minimum rate" }),
    ).toBeVisible();
    await expect(page.getByLabel("Minimum per hour (USD)", { exact: true })).toHaveValue("30");
    await expect(page.getByLabel("Maximum per hour (USD)", { exact: true })).toHaveValue("20");
    await expect(page.getByRole("link", { name: "Local Proof Tutor", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("discovery-bounds-retained.png"), fullPage: true });
    const params = new URLSearchParams({
      run: "1",
      subject: f!.subjectId,
      mode: "virtual",
      rate: "40",
      availableAt: "2026-11-09T16:00:00Z",
      duration: "60",
      strategies: "female",
    });
    await page.goto(`/matching?${params}`);
    await expect(page.getByRole("alert").filter({ hasText: "Choose listed teaching methods" })).toBeVisible();
    await expect(page.locator('textarea[name="strategies"]')).toHaveCount(0);
    await expect(page.locator('input[type="checkbox"][name="strategies"]')).toHaveCount(5);
  });
  test("confirmed badge policy label versions reach the Tutor dashboard and can be restored", async ({
    page,
  }, info) => {
    await login(page, "admin");
    await page.goto("/admin/badges");
    const form = page.getByRole("form", { name: "Publish badge policy", exact: true });
    const label = form.getByLabel("Rule 1 — public badge label", { exact: true });
    const original = await label.inputValue();
    const version = Number(await form.locator('input[name="expectedVersion"]').inputValue());
    const changed = `${original.slice(0, 75)} · UI proof ${info.project.name}`;
    try {
      await label.fill(changed);
      await form
        .getByLabel("Reason for the badge policy change", { exact: true })
        .fill("Verify the attributed public-fact policy label in this disposable runtime.");
      await form.getByLabel("I confirm this public badge policy version", { exact: true }).check();
      await form.getByRole("button", { name: "Publish confirmed badge policy", exact: false }).click();
      await expect(form.getByText(`Badge policy version ${version + 1} was published with its reason.`)).toBeVisible();
      await page.reload();
      await expect(label).toHaveValue(changed);
      await form.screenshot({ path: info.outputPath("admin-badge-policy-version.png") });
      await logout(page);
      await login(page, "tutor");
      await page.goto("/dashboard");
      const progress = page
        .locator("section.workspace-section")
        .filter({ has: page.getByRole("heading", { name: "Badge progress from platform facts", exact: true }) });
      await expect(progress.getByRole("heading", { name: changed, exact: true })).toBeVisible();
      await expect(progress.getByText(new RegExp(`Published policy version ${version + 1}`))).toBeVisible();
      await progress.screenshot({ path: info.outputPath("tutor-factual-badge-progress.png") });
    } finally {
      if (await page.getByRole("button", { name: "Sign out", exact: true }).count()) await logout(page);
      await login(page, "admin");
      await page.goto("/admin/badges");
      await label.fill(original);
      await form
        .getByLabel("Reason for the badge policy change", { exact: true })
        .fill("Restore the previous factual badge label after local UI verification.");
      await form.getByLabel("I confirm this public badge policy version", { exact: true }).check();
      await form.getByRole("button", { name: "Publish confirmed badge policy", exact: false }).click();
      await expect(form.getByText(/Badge policy version \d+ was published with its reason\./)).toBeVisible();
    }
  });
});
