import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const fixturePath = process.env.WORKSPACE_E2E_FIXTURES;
const fixtures = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as {
      password: string;
      tutorEmail: string;
      studentEmail: string;
      confirmedBookingId: string;
    })
  : null;

test.use({ trace: "off" });
test.describe("Assignment upload request boundaries — case 8.2", () => {
  test.skip(!fixtures, "Requires explicit disposable real Auth/PostgREST/Storage fixtures.");
  test.setTimeout(180_000);

  async function login(page: Page, role: "tutor" | "student") {
    await page.goto("/login");
    await page.getByLabel("Email address", { exact: true }).fill(fixtures![`${role}Email`]);
    await page.getByLabel("Password", { exact: true }).fill(fixtures!.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/dashboard");
  }

  async function createFileAssignment(page: Page, title: string) {
    await login(page, "tutor");
    await page.goto("/assignments");
    const form = page.getByRole("form", { name: "Create assignment draft", exact: true });
    await form.getByLabel("Learning relationship", { exact: true }).selectOption(fixtures!.confirmedBookingId);
    await form.getByLabel("Assignment title", { exact: true }).fill(title);
    await form.getByLabel("Learning topic", { exact: true }).fill("Math file practice");
    await form
      .getByLabel("Instructions & success criteria", { exact: true })
      .fill("Upload a plain-text practice record within the advertised file limit.");
    await form.getByLabel("How the learner submits", { exact: true }).selectOption("file");
    await form
      .getByLabel("Due date & time (UTC)", { exact: true })
      .fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
    await form.getByRole("button", { name: "Save assignment draft", exact: false }).click();
    await expect(form.getByText("Assignment draft saved. Assign it when the instructions are ready.")).toBeVisible();
    const href = await form.getByRole("link", { name: "Open saved work", exact: false }).getAttribute("href");
    expect(href).toMatch(/^\/assignments\/[a-f0-9-]+$/);
    await page.goto(href!);
    await page.getByRole("button", { name: "Assign to learner", exact: false }).click();
    await expect(page.getByText("Your assignment was assigned to the learner.")).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(/\/login/);
    await login(page, "student");
    await page.goto(href!);
    return href!;
  }

  test("10 MiB passes the complete browser-to-private-storage upload", async ({ page }, info) => {
    await createFileAssignment(page, `Exact 10 MiB ${info.project.name} ${Date.now()}`);
    await page.getByLabel("Your file", { exact: true }).setInputFiles({
      name: "practice-at-limit.txt",
      mimeType: "text/plain",
      buffer: Buffer.alloc(10 * 1024 * 1024, 65),
    });
    await page.getByRole("button", { name: "Submit work", exact: false }).click();
    await expect(page.getByRole("heading", { name: "Awaiting tutor feedback", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Awaiting tutor feedback", exact: true })).toBeVisible();
    await expect(page.getByRole("form", { name: "Submit assignment", exact: true })).toHaveCount(0);
    const link = page.getByRole("link", { name: "Open private file", exact: false });
    await expect(link).toBeVisible();
    const file = await page.request.get((await link.getAttribute("href"))!);
    expect(file.status()).toBe(200);
    expect((await file.body()).length).toBe(10 * 1024 * 1024);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("assignment-file-at-10mib.png"), fullPage: true });
  });

  test("10 MiB plus one byte reaches validation and leaves no submission", async ({ page }, info) => {
    const href = await createFileAssignment(page, `Over 10 MiB ${info.project.name} ${Date.now()}`);
    await page.getByLabel("Your file", { exact: true }).setInputFiles({
      name: "practice-too-large.txt",
      mimeType: "text/plain",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 65),
    });
    const response = page.waitForResponse(
      (row) => row.request().method() === "POST" && new URL(row.url()).pathname === href,
    );
    await page.getByRole("button", { name: "Submit work", exact: false }).click();
    expect((await response).status()).toBe(200);
    await expect(page.getByRole("link", { name: "Files must be 10 MiB or smaller.", exact: true })).toBeVisible();
    await expect(page.getByText("Your work was submitted and saved for tutor review.")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("link", { name: "Open private file", exact: false })).toHaveCount(0);
    await expect(page.getByText("Work will appear here", { exact: true })).toBeVisible();
  });
});
