import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
const fixturePath = process.env.WORKSPACE_E2E_FIXTURES;
const f = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as {
      password: string;
      studentEmail: string;
      adminEmail: string;
      completedBookingId: string;
      tutorListingId: string;
    })
  : null;
const sql = (query: string) =>
  execFileSync(
    "/opt/homebrew/opt/postgresql@17/bin/psql",
    [
      "-X",
      "-h",
      "/tmp/tutorplus-native-runtime",
      "-p",
      "55438",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      query,
    ],
    { encoding: "utf8" },
  ).trim();
test.use({ trace: "off", actionTimeout: 15000 });
async function login(page: Page, role: "student" | "admin") {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(f![`${role}Email`]);
  await page.getByLabel("Password", { exact: true }).fill(f!.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
}
test.describe("Independent UC07 reputation persistence", () => {
  test.skip(!f, "Requires an explicit completed local no-charge booking fixture.");
  test.setTimeout(180000);
  test("one completed-session review, factual public recommendation and audited hide/restore", async ({
    page,
    browser,
  }, info) => {
    expect(f!.completedBookingId).toMatch(/^[a-f0-9-]{36}$/i);
    await login(page, "student");
    await page.goto("/reviews");
    const card = page.locator(`article[data-booking-id="${f!.completedBookingId}"]`);
    const form = card.getByRole("form", { name: "Review this session", exact: true });
    const createdHere = (await form.count()) === 1;
    if (createdHere) {
      await form.getByLabel("5 stars – Excellent", { exact: true }).check();
      await form
        .getByLabel("Comment (optional)", { exact: true })
        .fill("The completed local factoring session used clear worked examples.");
      await form.getByLabel("I would recommend this tutor to other adult learners.", { exact: true }).check();
      await form.getByRole("button", { name: "Submit review", exact: false }).click();
      await expect(card.getByText(/review.*saved|review.*submitted/i)).toBeVisible();
    }
    await page.reload();
    await expect(card.getByTestId("submitted-review")).toBeVisible();
    await expect(form).toHaveCount(0);
    await expect(card.getByText("You recommended this tutor to other adult learners.", { exact: true })).toBeVisible();
    const review = JSON.parse(
      sql(`select row_to_json(r)::text from public.reviews r where booking_id='${f!.completedBookingId}'`),
    );
    expect(review.recommended).toBe(true);
    expect(sql(`select count(*) from public.reviews where booking_id='${f!.completedBookingId}'`)).toBe("1");
    const publicContext = await browser.newContext({ viewport: info.project.use.viewport });
    const publicPage = await publicContext.newPage();
    const base = new URL(page.url()).origin;
    const publicPath = `${base}/tutors/${f!.tutorListingId}`;
    const readCount = () =>
      Number(sql(`select rating_count from public.tutor_rating_summaries where tutor_id='${f!.tutorListingId}'`));
    const before = readCount();
    await publicPage.goto(publicPath);
    await expect(publicPage.getByText(review.comment, { exact: true })).toBeVisible();
    await expect(publicPage.getByText(/learner recommendation|learner recommends/i).first()).toBeVisible();
    const html = await publicPage.content();
    expect(html).not.toContain(f!.completedBookingId);
    expect(html).not.toContain(f!.studentEmail);
    expect(html.includes(f!.password), "Public content must not expose a credential").toBe(false);
    await publicPage.screenshot({ path: info.outputPath("public-factual-reputation.png"), fullPage: true });
    await login(page, "admin");
    let hidden = false;
    const reason = `Independent local review visibility ${info.project.name} ${Date.now()}`;
    async function moderate(status: "hidden" | "visible") {
      await page.goto("/admin/safety");
      const record = page
        .locator("li.workspace-record")
        .filter({ has: page.getByText(review.comment, { exact: true }) });
      await record.getByText("Change this review’s visibility", { exact: true }).click();
      const moderation = record.getByRole("form", { name: "Moderate review", exact: true });
      await moderation.getByLabel("Public review visibility", { exact: true }).selectOption(status);
      await moderation.getByLabel("Moderation reason", { exact: true }).fill(`${reason}: ${status}`);
      await moderation.getByLabel("I confirm this review visibility change", { exact: true }).check();
      await moderation.getByRole("button", { name: "Record moderation", exact: false }).click();
      await expect(moderation.getByRole("status")).toBeVisible();
      await page.reload();
      await expect(page.getByText(`${reason}: ${status}`, { exact: true })).toBeVisible();
    }
    try {
      await moderate("hidden");
      hidden = true;
      await publicPage.reload();
      await expect(publicPage.getByText(review.comment, { exact: true })).toHaveCount(0);
      expect(readCount()).toBe(before - 1);
      expect(sql(`select count(*) from public.reviews where id='${review.id}'`)).toBe("1");
      await page.screenshot({ path: info.outputPath("admin-review-hidden-audit.png"), fullPage: true });
    } finally {
      if (hidden) {
        await moderate("visible");
        expect(readCount()).toBe(before);
      }
      await publicContext.close();
    }
    await page.screenshot({
      path: info.outputPath(`review-restored-${createdHere ? "new-submit" : "persisted-read"}.png`),
      fullPage: true,
    });
  });
});
