import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
const fixturePath = process.env.WORKSPACE_E2E_FIXTURES;
const f = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as {
      password: string;
      studentEmail: string;
      tutorEmail: string;
      otherEmail: string;
      confirmedBookingId: string;
      tutorListingId: string;
    })
  : null;
test.use({ trace: "off", actionTimeout: 15000 });
test.describe("Private profile and learning coordination", () => {
  test.skip(!f, "Requires explicit disposable real Auth/PostgREST/private Storage fixtures.");
  test.setTimeout(180000);
  async function login(page: Page, role: "student" | "tutor" | "other") {
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
  test("owned interests, preferred mode and private avatar persist with explicit deletion", async ({ page }, info) => {
    await login(page, "student");
    await page.goto("/profile");
    const preferences = page.getByRole("form", { name: "Save learning preferences", exact: true });
    await preferences.getByLabel("Learning interests", { exact: false }).fill("Factoring, independent study");
    await preferences.getByLabel("Preferred learning mode", { exact: true }).selectOption("virtual");
    await preferences.getByRole("button", { name: "Save learning profile", exact: false }).click();
    await expect(preferences.getByText("Your private learning profile and preferences were saved.")).toBeVisible();
    await page.reload();
    await expect(preferences.getByLabel("Learning interests", { exact: false })).toHaveValue(
      "Factoring, independent study",
    );
    await expect(preferences.getByLabel("Preferred learning mode", { exact: true })).toHaveValue("virtual");
    const avatar = page.getByRole("form", { name: "Upload private profile photo", exact: true });
    await avatar.locator('input[type="file"]').setInputFiles({
      name: "private-avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3XkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await avatar.getByRole("button", { name: "Save private profile photo", exact: false }).click();
    await expect(avatar.getByText("Your private profile photo was saved.")).toBeVisible();
    await page.reload();
    const section = page
      .locator("section.workspace-section")
      .filter({ has: page.getByRole("heading", { name: "Your private profile photo", exact: true }) });
    await expect(section.locator("img")).toBeVisible();
    await expect(section.locator("img")).toHaveJSProperty("naturalWidth", 1);
    await section.screenshot({ path: info.outputPath("private-avatar-persisted.png") });
    await section.getByText("Remove private profile photo", { exact: true }).click();
    const deletion = section.getByRole("form", { name: "Remove private profile photo", exact: true });
    await deletion.getByLabel("I confirm removal of my private profile photo", { exact: true }).check();
    await deletion.getByRole("button", { name: "Remove photo", exact: false }).click();
    await page.reload();
    await expect(section.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test("only consented booking context is visible to the booked tutor", async ({ page }, info) => {
    const stamp = `${info.project.name} ${Date.now()}`;
    const goal = `Shared factoring goal ${stamp}`;
    const privateNote = `Private learner note ${stamp}`;
    await login(page, "student");
    await page.goto(`/bookings/${f!.confirmedBookingId}`);
    const notes = page.getByRole("form", { name: "Save booking learning notes", exact: true });
    await notes.getByLabel("Learning goal", { exact: false }).fill(goal);
    await notes.getByRole("textbox", { name: "Topics (optional)", exact: true }).fill("Common factors, sign errors");
    await notes.getByLabel("Questions for the session", { exact: false }).fill("When should I factor out a negative?");
    await notes.getByLabel("Private note — only you", { exact: false }).fill(privateNote);
    const consent = notes.getByLabel("Share this goal, topics and questions with the tutor on this booking", {
      exact: true,
    });
    await consent.uncheck();
    await notes.getByRole("button", { name: "Save notes & sharing", exact: false }).click();
    await expect(
      notes.getByText("Your booking notes and sharing choice were saved. Your private note stays visible only to you."),
    ).toBeVisible();
    await page.reload();
    await expect(notes.getByLabel("Private note — only you", { exact: false })).toHaveValue(privateNote);
    await logout(page);
    await login(page, "tutor");
    await page.goto(`/bookings/${f!.confirmedBookingId}`);
    await expect(
      page.getByText("The learner has not shared reservation notes with you.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(goal, { exact: true })).toHaveCount(0);
    expect(await page.content()).not.toContain(privateNote);
    await logout(page);
    await login(page, "student");
    await page.goto(`/bookings/${f!.confirmedBookingId}`);
    await consent.check();
    await notes.getByRole("button", { name: "Save notes & sharing", exact: false }).click();
    await expect(
      notes.getByText("Your booking notes and sharing choice were saved. Your private note stays visible only to you."),
    ).toBeVisible();
    await logout(page);
    await login(page, "tutor");
    await page.goto(`/bookings/${f!.confirmedBookingId}`);
    await expect(page.getByText(goal, { exact: true })).toBeVisible();
    await expect(page.getByText("When should I factor out a negative?", { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain(privateNote);
    const shared = page
      .locator("section.workspace-section")
      .filter({ has: page.getByRole("heading", { name: "Shared reservation notes", exact: true }) });
    await shared.screenshot({ path: info.outputPath("tutor-consented-notes.png") });
    await logout(page);
    await login(page, "other");
    await page.goto(`/bookings/${f!.confirmedBookingId}`);
    await expect(page.getByRole("alert").filter({ hasText: "not available for your account" })).toBeVisible();
    expect(await page.content()).not.toContain(privateNote);
    expect(await page.content()).not.toContain(goal);
  });
  test("public teaching languages persist and filter before displaying results", async ({ page }, info) => {
    await login(page, "tutor");
    await page.goto("/tutor-studio");
    await page.getByText("Choose the languages you teach in", { exact: true }).click();
    const languages = page.getByRole("form", { name: "Save tutor teaching languages", exact: true });
    await languages.getByLabel("English", { exact: true }).check();
    await languages.getByLabel("French", { exact: true }).check();
    await languages.getByLabel("Japanese", { exact: true }).uncheck();
    await languages.getByRole("button", { name: "Save teaching languages", exact: false }).click();
    await expect(
      languages.getByText("Your chosen teaching languages were saved. They are available as public tutor information."),
    ).toBeVisible();
    await page.reload();
    await page.getByText("Choose the languages you teach in", { exact: true }).click();
    await expect(languages.getByLabel("English", { exact: true })).toBeChecked();
    await expect(languages.getByLabel("French", { exact: true })).toBeChecked();
    await page.goto(`/tutors/${f!.tutorListingId}`);
    await expect(page.getByText("English · French", { exact: true })).toBeVisible();
    await page.goto("/tutors?language=ja");
    await expect(page.getByRole("link", { name: "Local Proof Tutor", exact: true })).toHaveCount(0);
    await page.goto("/tutors?language=ja&otherLanguage=fr");
    await expect(page.getByRole("link", { name: "Local Proof Tutor", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("language-hard-filter.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
