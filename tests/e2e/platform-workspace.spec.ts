import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const fixturePath = process.env.WORKSPACE_E2E_FIXTURES;
const f = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as {
      password: string;
      studentEmail: string;
      adminEmail: string;
      otherEmail: string;
      subjectId: string;
      tutorListingId: string;
    })
  : null;

test.use({ trace: "off", actionTimeout: 15000 });
test.describe("Persisted platform workspaces", () => {
  test.skip(!f, "Requires explicitly supplied disposable real Auth/PostgREST fixtures.");
  test.setTimeout(180000);

  async function login(page: Page, role: "student" | "admin" | "other") {
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

  test("known tutor report, confirmed admin decision, attributed resource and unconfigured assistant", async ({
    page,
  }, info) => {
    const stamp = `${info.project.name} ${Date.now()}`;
    const concern = `Local safety review proof ${stamp}`;
    const resourceTitle = `Factoring reference ${stamp}`;
    const decisionReason = `Reviewed the disposable local concern ${stamp}`;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await login(page, "student");
    await page.goto(`/support?tutor=${f!.tutorListingId}`);
    const report = page.getByRole("form", { name: "Submit a safety report", exact: true });
    await report.getByLabel("What should we review?", { exact: true }).fill(concern);
    await report.getByRole("button", { name: "Send report for review", exact: false }).click();
    await expect(report.getByText(/Your concern was saved for administrator review\. Reference:/)).toBeVisible();
    await logout(page);
    await login(page, "admin");
    await page.goto("/admin/safety");
    const record = page.locator("li.workspace-record").filter({ has: page.getByText(concern, { exact: true }) });
    await record.getByText("Review & record a decision", { exact: true }).click();
    const decision = record.getByRole("form", { name: "Resolve safety report", exact: true });
    await decision.getByLabel("Review state", { exact: true }).selectOption("resolved");
    await decision.getByLabel("Decision reason", { exact: true }).fill(decisionReason);
    await decision.getByLabel("I confirm this administrative decision", { exact: true }).check();
    await decision.getByRole("button", { name: "Record decision", exact: false }).click();
    await expect(decision.getByText("The report decision and reason were recorded.")).toBeVisible();
    await page.reload();
    await expect(record.locator(".workspace-status")).toHaveText("Resolved");
    await expect(page.getByText(decisionReason, { exact: true })).toBeVisible();
    await page.getByText("Add a learning resource", { exact: true }).click();
    const resource = page.getByRole("form", { name: "Add learning resource", exact: true });
    await resource.getByLabel("Resource title", { exact: false }).fill(resourceTitle);
    await resource
      .getByLabel("Description", { exact: false })
      .fill("A source-backed factoring reference for this local workflow check.");
    await resource
      .getByLabel("Resource URL", { exact: false })
      .fill("https://openstax.org/details/books/elementary-algebra-2e");
    await resource.getByLabel("Subject", { exact: false }).selectOption(f!.subjectId);
    await resource.getByLabel("Resource type", { exact: true }).selectOption("reference");
    await resource.getByLabel("Attribution & source", { exact: false }).fill("OpenStax, Elementary Algebra 2e");
    await resource.getByLabel("Reason for this content change", { exact: true }).fill(`Local resource proof ${stamp}`);
    await resource.getByLabel("I confirm this resource change", { exact: true }).check();
    await resource.getByRole("button", { name: "Save resource", exact: false }).click();
    await expect(resource.getByText("The resource and its attribution were saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: resourceTitle, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("admin-confirmed-safety-resource.png"), fullPage: true });
    await logout(page);
    await login(page, "student");
    await page.goto(`/resources?q=${encodeURIComponent(resourceTitle)}`);
    await expect(page.getByRole("heading", { name: resourceTitle, exact: true })).toBeVisible();
    await expect(page.getByText(/OpenStax, Elementary Algebra 2e/)).toBeVisible();
    await page.goto("/assistant");
    await expect(page.getByText("The learning assistant is not configured yet.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask a learning question", exact: false })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Draft guidance", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("assistant-unconfigured.png"), fullPage: true });
    await page.goto("/admin/accounts");
    await expect(page.getByRole("alert").filter({ hasText: "not available for your account" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("admin account search and reasoned template version persist; notification preference remains owned", async ({
    page,
  }, info) => {
    const stamp = `${info.project.name} ${Date.now()}`;
    const title = `Optional study notice ${stamp}`;
    await login(page, "admin");
    await page.goto("/admin/accounts");
    await page.getByLabel("Name, email or account reference", { exact: true }).fill(f!.otherEmail);
    await page.getByRole("button", { name: "Search accounts", exact: false }).click();
    await expect(page.locator("section.workspace-section")).toHaveCount(2);
    await expect(page.getByText(f!.otherEmail, { exact: true })).toBeVisible();
    await page.goto("/admin/templates");
    const template = page.getByRole("form", { name: "Create notification template", exact: true });
    await template.getByLabel("Notification category", { exact: true }).selectOption("study_plan");
    await template.getByLabel("Notice title", { exact: true }).fill(title);
    await template
      .getByLabel("Notice body", { exact: true })
      .fill("Review the current dates and goals in your study plan.");
    await template.getByLabel("Destination path", { exact: false }).fill("/study-plans");
    await template.getByLabel("Use this template for future notices", { exact: true }).uncheck();
    await template
      .getByLabel("Reason for this template change", { exact: true })
      .fill(`Disposable inactive template proof ${stamp}`);
    await template.getByLabel("I confirm this notification template change", { exact: true }).check();
    await template.getByRole("button", { name: "Save confirmed template", exact: false }).click();
    await expect(
      template.getByText("The notification template change was saved with its reason and version."),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("admin-template-version.png"), fullPage: true });
    await logout(page);
    await login(page, "student");
    await page.goto("/notifications");
    const preference = page.getByRole("form", { name: "Email preference for study_plan", exact: true });
    const checkbox = preference.getByLabel("Send these updates by email", { exact: true });
    const previous = await checkbox.isChecked();
    await checkbox.setChecked(!previous);
    await preference.getByRole("button", { name: "Save preference", exact: false }).click();
    await expect(preference.getByText(/Your notification preference was saved/)).toBeVisible();
    await page.reload();
    await expect(checkbox).toBeChecked({ checked: !previous });
    await expect(page.getByRole("form", { name: "Email preference for system", exact: true })).toHaveCount(0);
    await expect(page.getByText(/Required account notice/).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("notification-feed-preferences.png"), fullPage: true });
    await checkbox.setChecked(previous);
    await preference.getByRole("button", { name: "Save preference", exact: false }).click();
    await expect(preference.getByText(/Your notification preference was saved/)).toBeVisible();
  });

  test("recipient reads a real queued update without claiming email delivery", async ({ page }, info) => {
    await login(page, "student");
    await page.goto("/notifications");
    const unread = page
      .locator("li[data-notification-id]")
      .filter({
        has: page.getByRole("button", { name: "Mark as read", exact: false }),
      })
      .first();
    await expect(unread).toBeVisible();
    const id = await unread.getAttribute("data-notification-id");
    await unread.getByRole("button", { name: "Mark as read", exact: false }).click();
    await page.reload();
    const saved = page.locator(`li[data-notification-id="${id}"]`);
    await expect(saved.getByText("Read", { exact: true })).toBeVisible();
    await expect(saved.getByRole("button", { name: "Mark as read", exact: false })).toHaveCount(0);
    await saved.screenshot({ path: info.outputPath("notification-read-persisted.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
