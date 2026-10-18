// Captures the Sprint 3 evidence screenshots from a running Tutor Plus deployment with real demo accounts.
// Every image is a screenshot of real application output; the script fails instead of capturing a wrong state.
//
//   BASE_URL=https://… SPRINT3_DEMO_PASSWORD='…' UPCOMING_BOOKING_ID=… COMPLETED_BOOKING_ID=… \
//     node scripts/capture-sprint3.mjs
// Run scripts/seed-sprint3-demo.mjs first; it prints the two booking IDs. The flow writes data (goals, agenda,
// recap, reflection and one review), so a second run needs a fresh completed booking from the seed script.
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const out = process.env.OUT_DIR ?? "docs/evidence/screenshots/sprint3";
const password = process.env.SPRINT3_DEMO_PASSWORD;
const upcoming = process.env.UPCOMING_BOOKING_ID;
const completed = process.env.COMPLETED_BOOKING_ID;
if (!password || !upcoming || !completed) {
  throw new Error("SPRINT3_DEMO_PASSWORD, UPCOMING_BOOKING_ID and COMPLETED_BOOKING_ID are required.");
}
const accounts = {
  student: "sprint3.student@example.com",
  tutor: "sprint3.tutor@example.com",
  other: "sprint3.other@example.com",
};
const captured = [];
// The aggregate text expected after this run's review (first review on a fresh tutor: "5.0 out of 5 · 1 review").
const expectedRating = process.env.EXPECTED_RATING ?? "5.0 out of 5 · 1 review";

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });

async function context(kind = "desktop") {
  const settings =
    kind === "phone"
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
  return browser.newContext({ ...settings, colorScheme: "light", locale: "en-US", timezoneId: "UTC" });
}

async function login(ctx, email) {
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  return page;
}

async function open(page, path) {
  await page.goto(`${base}${path}`);
  await page.waitForLoadState("networkidle");
}

async function shot(page, name, caption, fullPage = true) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    // Drop focus so the skip link and focus rings do not appear in evidence images.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.body.setAttribute("tabindex", "-1");
    document.body.focus({ preventScroll: true });
    document.body.removeAttribute("tabindex");
    await document.fonts?.ready;
  });
  await page.screenshot({ path: `${out}/${name}.png`, fullPage });
  captured.push({ file: `${out}/${name}.png`, caption });
  console.log(`captured ${name}`);
}

async function expectText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
}

const goals = "Get confident solving quadratic equations by factoring and by completing the square.";
const questions = "When is the quadratic formula faster than factoring?";
const agenda =
  "1. Warm-up: factoring review (10 min)\n2. Completing the square, worked example (20 min)\n3. Choosing a method (15 min)\n4. Practice set and questions (15 min)";

const desktop = await context();
const student = await login(desktop, accounts.student);
const tutorContext = await context();
const tutor = await login(tutorContext, accounts.tutor);

// UC-09 planner: before save, after save, after reload.
await open(student, `/sessions/${upcoming}`);
await shot(
  student,
  "s3-01-planner-before-save",
  "Student opens the UC-09 workspace of a confirmed upcoming booking (nothing saved yet).",
);
await student.getByLabel("Goals for this session", { exact: true }).fill(goals);
await student.getByLabel("Questions for your tutor", { exact: true }).fill(questions);
await student.getByRole("button", { name: "Save goals" }).click();
await expectText(student, "Goals and questions saved.");
await shot(
  student,
  "s3-02-planner-goals-saved",
  "Goals and questions saved through save_session_goals; success message and save time shown.",
);
await open(student, `/sessions/${upcoming}`);
await expectText(student, "Last saved");
if ((await student.getByLabel("Goals for this session", { exact: true }).inputValue()) !== goals)
  throw new Error("Goals did not persist.");
await shot(
  student,
  "s3-03-planner-persisted-after-reload",
  "After a full reload the goals are read back from session_plans in PostgreSQL.",
);

// Tutor reads the goals and saves an agenda.
await open(tutor, `/sessions/${upcoming}`);
await expectText(tutor, goals);
await tutor.getByLabel("Session agenda", { exact: true }).fill(agenda);
await tutor.getByRole("button", { name: "Save agenda" }).click();
await expectText(tutor, "Agenda saved.");
await shot(
  tutor,
  "s3-04-tutor-reads-goals-saves-agenda",
  "Tutor sees the student's saved goals (read-only) and saves the agenda.",
);
await open(student, `/sessions/${upcoming}`);
await expectText(student, "Completing the square, worked example");
await shot(
  student,
  "s3-05-student-sees-agenda",
  "Student reloads and reads the tutor's agenda; the student cannot edit it.",
);

// Recap on the completed session.
await open(tutor, `/sessions/${completed}`);
await tutor
  .getByLabel("What you covered", { exact: true })
  .fill("Reviewed GCF factoring, then worked through the AC method on four quadratics. Maya solved two independently.");
await tutor
  .getByLabel("Mastery notes", { exact: true })
  .fill("Strong: identifying the GCF. Practise: sign errors when the constant term is negative.");
await tutor
  .getByLabel("Next steps", { exact: true })
  .fill("Complete practice set B (problems 1–8) before the next session.");
await tutor.getByRole("button", { name: /Publish recap|Update recap/ }).click();
await expectText(tutor, "Recap published.");
await shot(
  tutor,
  "s3-06-tutor-recap-published",
  "Tutor publishes the recap after the session is completed (publish_session_recap).",
);

// Student reads the recap and writes a private reflection.
await open(student, `/sessions/${completed}`);
await expectText(student, "Reviewed GCF factoring");
await student
  .getByLabel("Your private reflection", { exact: true })
  .fill("I still rush the signs when c is negative. Slow down and check each pair before writing the factors.");
await student.getByRole("button", { name: "Save reflection" }).click();
await expectText(student, "Private reflection saved.");
await shot(
  student,
  "s3-07-student-recap-and-private-reflection",
  "Student reads the published recap and saves a private reflection.",
);

// Tutor view of the same booking: the reflection is not shown and is not requested.
await open(tutor, `/sessions/${completed}`);
await expectText(tutor, "Student reflections are private to the student");
if ((await tutor.content()).includes("I still rush the signs")) throw new Error("Reflection leaked to tutor view.");
await shot(
  tutor,
  "s3-08-tutor-view-reflection-hidden",
  "Tutor's view of the same completed booking: the student's reflection is not shown.",
);

// UC-07 reviews.
await open(student, "/reviews");
await expectText(student, "READY FOR REVIEW");
const stale = await desktop.newPage();
await open(stale, "/reviews");
await shot(
  student,
  "s3-09-reviews-eligible",
  "Reviews page lists the student's completed session; the tutor has no reviews yet.",
);
const card = student.locator(`article[data-booking-id="${completed}"]`);
await card.locator('label[title^="5 "]').click();
await card
  .getByLabel("Comment (optional)", { exact: true })
  .fill("Clear explanations and a patient pace. The AC method finally makes sense.");
await card.getByRole("button", { name: "Submit review" }).click();
await expectText(student, "your 5-star review was saved");
await shot(
  student,
  "s3-10-review-submitted",
  "Review submitted through submit_review; the server confirms the saved rating.",
);
await open(student, "/reviews");
await expectText(student, expectedRating);
await shot(
  student,
  "s3-11-review-persisted-rating-updated",
  "After reload the review is read from the reviews table and the tutor's aggregate is 5.0 (1 review).",
);

// A second, stale tab still shows the form: submitting it is refused by the server.
const staleCard = stale.locator(`article[data-booking-id="${completed}"]`);
await staleCard.locator('label[title^="4 "]').click();
await staleCard.getByRole("button", { name: "Submit review" }).click();
await expectText(stale, "already reviewed this session");
await shot(
  stale,
  "s3-12-duplicate-review-refused",
  "A second submission for the same booking (from a stale tab) is refused: one review per completed session.",
);

await open(tutor, "/reviews");
await expectText(tutor, expectedRating);
await shot(
  tutor,
  "s3-13-tutor-rating-updated",
  "Tutor sees the database-computed rating (tutor_rating_summaries) and the new review.",
);
await open(tutor, "/dashboard");
await expectText(tutor, "Your rating");
await shot(tutor, "s3-14-tutor-dashboard-rating", "Tutor dashboard shows the updated rating summary.");

// Unrelated student is denied the booking workspace even with the booking ID.
const otherContext = await context();
const other = await login(otherContext, accounts.other);
await open(other, `/sessions/${upcoming}`);
await expectText(other, "This workspace isn’t available.");
if ((await other.content()).includes(goals)) throw new Error("Plan leaked to unrelated user.");
await shot(
  other,
  "s3-15-unauthorized-workspace-denied",
  "A different signed-in student opening the booking URL is denied; no session data is shown.",
  false,
);

await open(student, "/bookings");
await shot(
  student,
  "s3-16-bookings-workspace-link",
  "Bookings list links each confirmed or completed booking to its session workspace.",
);

// Phone layout.
const phone = await context("phone");
const phoneStudent = await login(phone, accounts.student);
await open(phoneStudent, `/sessions/${upcoming}`);
await shot(phoneStudent, "s3-m1-planner-phone", "Session workspace on a 390 px phone viewport.");
await open(phoneStudent, "/reviews");
await shot(phoneStudent, "s3-m2-reviews-phone", "Reviews page on a 390 px phone viewport with the submitted review.");

await browser.close();
console.log(JSON.stringify(captured, null, 2));
