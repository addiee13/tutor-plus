import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
const path = process.env.WORKSPACE_E2E_FIXTURES;
const f = path
  ? (JSON.parse(readFileSync(path, "utf8")) as {
      password: string;
      studentEmail: string;
      tutorEmail: string;
      confirmedBookingId: string;
      completedBookingId: string;
    })
  : null;
test.use({ trace: "off", actionTimeout: 15000 });
test.describe("Topic-tagged learning coordination", () => {
  test.skip(!f, "Requires explicitly supplied disposable real Auth/PostgREST/private Storage fixtures.");
  test.setTimeout(180000);
  async function login(page: Page, role: "student" | "tutor") {
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
  test("topic and milestone task, private draft, explicit submission and editable tutor feedback", async ({
    page,
  }, info) => {
    const stamp = `${info.project.name} ${Date.now()}`;
    const title = `Draft practice ${stamp}`,
      privateBody = `Private draft reasoning ${stamp}`,
      feedback = `Check the sign ${stamp}`;
    await login(page, "tutor");
    await page.goto("/assignments");
    const create = page.getByRole("form", { name: "Create assignment draft", exact: true });
    await create.getByLabel("Learning relationship", { exact: true }).selectOption(f!.confirmedBookingId);
    await create.getByLabel("Assignment title", { exact: true }).fill(title);
    await create.getByLabel("Learning topic", { exact: true }).fill("Math factoring");
    await create
      .getByLabel("Instructions & success criteria", { exact: true })
      .fill("Explain the sign before factoring and check your expanded result.");
    await create
      .getByLabel("Due date & time (UTC)", { exact: true })
      .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    const milestones = create.getByLabel("Linked study-plan milestone", { exact: false });
    const options = await milestones
      .locator("option")
      .evaluateAll((rows) => rows.map((row) => (row as HTMLOptionElement).value).filter(Boolean));
    expect(options.length).toBeGreaterThan(0);
    await milestones.selectOption(options[0]);
    await create.getByRole("button", { name: "Save assignment draft", exact: false }).click();
    await expect(create.getByText("Assignment draft saved. Assign it when the instructions are ready.")).toBeVisible();
    const href = await create.getByRole("link", { name: "Open saved work", exact: false }).getAttribute("href");
    await page.goto(href!);
    await page.getByRole("button", { name: "Assign to learner", exact: false }).click();
    await expect(page.getByText("Your assignment was assigned to the learner.")).toBeVisible();
    await logout(page);
    await login(page, "student");
    await page.goto(href!);
    const draft = page.getByRole("form", { name: "Save private assignment draft", exact: true });
    await draft.getByLabel("Your written response", { exact: true }).fill(privateBody);
    await draft.getByRole("button", { name: "Save private draft", exact: false }).click();
    await expect(
      draft.getByText("Your private assignment draft was saved. Your tutor cannot see it until you submit it."),
    ).toBeVisible();
    await page.reload();
    await expect(draft.getByLabel("Your written response", { exact: true })).toHaveValue(privateBody);
    await logout(page);
    await login(page, "tutor");
    await page.goto(href!);
    expect(await page.content()).not.toContain(privateBody);
    await logout(page);
    await login(page, "student");
    await page.goto(href!);
    const submit = page.getByRole("form", { name: "Submit saved assignment draft", exact: true });
    await submit.getByLabel("I confirm this saved draft is ready for tutor review", { exact: true }).check();
    await submit.getByRole("button", { name: "Submit saved draft", exact: false }).click();
    await expect(page.getByRole("heading", { name: "Awaiting tutor feedback", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Awaiting tutor feedback", exact: true })).toBeVisible();
    await expect(page.getByRole("form", { name: "Save private assignment draft", exact: true })).toHaveCount(0);
    await logout(page);
    await login(page, "tutor");
    await page.goto(href!);
    await page.getByText("Review this submission", { exact: true }).click();
    const review = page.getByRole("form", { name: "Review submission 1", exact: true });
    await review.getByLabel("Feedback", { exact: true }).fill(feedback);
    await review.getByLabel("Next step", { exact: true }).selectOption("returned");
    await review.getByRole("button", { name: "Save review", exact: false }).click();
    await expect(review.getByText("Your assignment feedback and review outcome were saved.")).toBeVisible();
    await page.reload();
    await page.getByText("Edit feedback on this submission", { exact: true }).click();
    await review.getByLabel("Feedback", { exact: true }).fill(`${feedback}. Expand once to verify.`);
    await review.getByRole("button", { name: "Save review", exact: false }).click();
    await expect(
      page.locator(".notice.success .workspace-prose").filter({ hasText: `${feedback}. Expand once to verify.` }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.locator(".notice.success .workspace-prose").filter({ hasText: `${feedback}. Expand once to verify.` }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("assignment-draft-feedback-history.png"), fullPage: true });
    await logout(page);
    await login(page, "student");
    await page.goto(href!);
    await expect(draft).toBeVisible();
    await expect(
      page.locator(".notice.success .workspace-prose").filter({ hasText: `${feedback}. Expand once to verify.` }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await logout(page);
    await login(page, "tutor");
    await page.goto(href!);
    const cancel = page.getByRole("form", { name: "Cancel assignment", exact: true });
    const reason = `Replace this returned task with more focused practice ${stamp}`;
    await cancel.getByLabel("Cancellation reason", { exact: true }).fill(reason);
    await cancel.getByLabel("I confirm cancellation of this assignment", { exact: true }).check();
    await cancel.getByRole("button", { name: "Cancel assignment", exact: false }).click();
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
    await expect(page.getByRole("form", { name: "Close assignment submissions", exact: true })).toHaveCount(0);
    await logout(page);
    await login(page, "student");
    await page.goto(href!);
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
    await expect(draft).toHaveCount(0);
    await expect(
      page.locator(".notice.success .workspace-prose").filter({ hasText: `${feedback}. Expand once to verify.` }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("cancelled-assignment-retains-feedback.png"), fullPage: true });
  });
  test("priority topics, repeated agenda links, private attachment approval and structured recap history", async ({
    page,
  }, info) => {
    const stamp = `${info.project.name} ${Date.now()}`;
    const summary = `Factored using a common term ${stamp}`;
    await login(page, "student");
    await page.goto(`/sessions/${f!.confirmedBookingId}`);
    const goals = page.getByRole("form", { name: "Save session goals", exact: true });
    await goals
      .getByLabel("Goals for this session", { exact: true })
      .fill("Explain the common factor and check the signs.");
    await goals.getByLabel("Priority topics", { exact: true }).fill("Common factors, sign errors");
    await goals.getByRole("button", { name: "Save goals", exact: false }).click();
    await expect(goals.getByText("Goals and questions saved. Your tutor can now read them.")).toBeVisible();
    const upload = page.getByRole("form", { name: "Upload preparation file", exact: true });
    const file = Buffer.from(`Private preparation ${stamp}`);
    await upload
      .locator('input[type="file"]')
      .setInputFiles({ name: "preparation.txt", mimeType: "text/plain", buffer: file });
    await upload.getByRole("button", { name: "Upload preparation file", exact: false }).click();
    await expect(upload.getByText("Your private preparation file was uploaded. Its review is pending.")).toBeVisible();
    await page.reload();
    const attachment = page.locator("li[data-attachment-id]").filter({ hasText: "Pending" }).first();
    const attachmentId = await attachment.getAttribute("data-attachment-id");
    expect(attachmentId).toBeTruthy();
    await logout(page);
    await login(page, "tutor");
    await page.goto(`/sessions/${f!.confirmedBookingId}`);
    await expect(
      page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Goals and questions", exact: true }) })
        .getByText("Common factors · sign errors", { exact: true }),
    ).toBeVisible();
    expect((await page.request.get(`/sessions/files/${attachmentId}`)).status()).toBe(403);
    const savedAttachment = page.locator(`li[data-attachment-id="${attachmentId}"]`);
    const review = savedAttachment.getByRole("form");
    await review.getByLabel("Review decision", { exact: true }).selectOption("approved");
    await review.getByLabel("Review reason", { exact: false }).fill("Suitable for the booked factoring lesson.");
    await review.getByLabel("I confirm this preparation-file review decision", { exact: true }).check();
    await review.getByRole("button", { name: "Record file review", exact: false }).click();
    await expect(savedAttachment.getByText("Approved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(savedAttachment.getByText("Approved", { exact: true })).toBeVisible();
    const response = await page.request.get(`/sessions/files/${attachmentId}`);
    expect(response.status()).toBe(200);
    expect(await response.body()).toEqual(file);
    const links = page.getByRole("form", { name: "Save agenda learning links", exact: true });
    const choices = links.locator('input[name="learningLinks"]');
    expect(await choices.count()).toBeGreaterThan(0);
    await choices.first().check();
    for (let attempt = 0; attempt < 2; attempt++) {
      await links.getByRole("button", { name: "Save agenda links", exact: false }).click();
      await expect(links.getByText("The session agenda’s learning links were saved.")).toBeVisible();
      await page.reload();
    }
    await page.goto(`/sessions/${f!.completedBookingId}`);
    const recap = page.getByRole("form", { name: "Publish session recap", exact: true });
    await recap.getByLabel("What you covered", { exact: true }).fill(summary);
    await recap.getByLabel("Topics covered", { exact: true }).fill("Common factors, sign errors");
    await recap.getByLabel("Observed strengths", { exact: true }).fill("Identified the common factor independently.");
    await recap.getByLabel("Areas to practise", { exact: true }).fill("Check the negative sign before expanding.");
    const resources = recap.locator('input[name="resourceIds"]');
    expect(await resources.count()).toBeGreaterThan(0);
    await resources.first().check();
    await recap.getByRole("button", { name: /Publish recap|Update recap/ }).click();
    await expect(recap.getByText("Recap published. Your student can now read it.")).toBeVisible();
    await page.reload();
    const firstPublished = (await page.getByTestId("recap-provenance").innerText()).split(" · revision ")[0];
    await recap
      .getByLabel("Next steps", { exact: true })
      .fill("Practise three factoring examples and expand each result.");
    await recap.getByRole("button", { name: "Update recap", exact: false }).click();
    await expect(recap.getByText("Recap published. Your student can now read it.")).toBeVisible();
    await page.reload();
    expect((await page.getByTestId("recap-provenance").innerText()).split(" · revision ")[0]).toBe(firstPublished);
    await logout(page);
    await login(page, "student");
    await page.goto(`/sessions/${f!.completedBookingId}`);
    await expect(page.getByText(summary, { exact: true })).toBeVisible();
    await expect(page.getByText("Identified the common factor independently.", { exact: true })).toBeVisible();
    await expect(page.getByText("Check the negative sign before expanding.", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("structured-recap-student.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
