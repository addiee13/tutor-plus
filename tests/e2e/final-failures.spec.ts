import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
const fixturePath = process.env.WORKSPACE_E2E_FIXTURES;
const f = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as {
      password: string;
      studentEmail: string;
      tutorListingId: string;
      subjectId: string;
      confirmedBookingId: string;
    })
  : null;
const proxy = process.env.NATIVE_FAULT_PROXY === "1";
const control = "/tmp/tutorplus-native-runtime/verifier-fault.json";
const fault = (path = "") => writeFile(control, JSON.stringify(path ? { path, method: "POST" } : {}), { mode: 0o600 });
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
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(f!.studentEmail);
  await page.getByLabel("Password", { exact: true }).fill(f!.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
}
test.describe("Independent Q0.3 isolated dependency faults", () => {
  test.skip(!f || !proxy, "Requires explicit local proxy-backed production run.");
  test.setTimeout(180000);
  test.afterEach(async () => {
    await fault();
  });
  test("signup and resend outage show failure without creating an identity or claiming email delivery", async ({
    page,
  }, info) => {
    const email = `failed-signup-${info.project.name}-${Date.now()}@example.test`;
    await page.goto("/signup");
    await page.getByLabel("Display name", { exact: true }).fill("Fault Boundary Learner");
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(f!.password);
    await page.getByLabel("I confirm that I am at least 18 years old.", { exact: true }).check();
    await fault("/auth/v1/signup");
    const response = page
      .waitForResponse((res) => new URL(res.url()).pathname === "/signup" && res.request().method() === "POST")
      .then((item) => item.text());
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    const body = await response;
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
    expect(body).not.toContain("PRIVATE_SQL_SENTINEL");
    expect(body.includes(f!.password), "Response must not expose a credential").toBe(false);
    expect(sql(`select count(*) from auth.users where email='${email}'`)).toBe("0");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Join Tutor Plus.", exact: true })).toBeVisible();
    const settings = Object.fromEntries(
      readFileSync("/tmp/tutorplus-native-runtime/app.env", "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        }),
    );
    expect(settings.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:55440");
    const pendingEmail = `pending-resend-${info.project.name}-${Date.now()}@example.test`;
    const admin = createClient(settings.NEXT_PUBLIC_SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const pending = await admin.auth.admin.createUser({
      email: pendingEmail,
      password: f!.password,
      email_confirm: false,
      user_metadata: {
        display_name: "Pending Resend Fixture",
        timezone: "UTC",
        adult_attested: true,
        initial_role: "student",
      },
    });
    expect(pending.error).toBeNull();
    await fault("/auth/v1/resend");
    await page.goto("/check-email");
    await page.getByLabel("Email address", { exact: true }).fill(pendingEmail);
    await page.getByRole("button", { name: /Request.*link|Resend|Send.*link/i }).click();
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(await page.content()).not.toContain("PRIVATE_SQL_SENTINEL");
    expect(sql(`select count(*) from auth.users where email='${email}'`)).toBe("0");
    expect(sql(`select email_confirmed_at is null from auth.users where email='${pendingEmail}'`)).toBe("t");
    await page.screenshot({ path: info.outputPath("resend-outage-honest.png"), fullPage: true });
  });
  test("failed reservation reports retry and leaves the canonical booking rows unchanged", async ({ page }, info) => {
    await login(page);
    await page.goto(`/bookings?tutor=${f!.tutorListingId}`);
    const form = page.getByRole("form", { name: "Request a booking", exact: true });
    await form.getByLabel("Published tutor", { exact: true }).selectOption(f!.tutorListingId);
    await form.getByLabel("Subject", { exact: true }).selectOption(f!.subjectId);
    await form.getByRole("button", { name: /^Soonest/ }).click();
    const before = sql(
      "select md5(coalesce(string_agg(row_to_json(b)::text,',' order by b.id),'')) from public.bookings b;",
    );
    await fault("/rest/v1/rpc/create_booking_with_notes");
    const response = page
      .waitForResponse((res) => new URL(res.url()).pathname === "/bookings" && res.request().method() === "POST")
      .then((item) => item.text());
    await form.getByRole("button", { name: "Request reservation — no charge", exact: true }).click();
    const body = await response;
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(form.getByRole("link", { name: /Review saved booking/ })).toHaveCount(0);
    expect(body).not.toContain("PRIVATE_SQL_SENTINEL");
    expect(body.includes(f!.password), "Response must not expose a credential").toBe(false);
    expect(
      sql("select md5(coalesce(string_agg(row_to_json(b)::text,',' order by b.id),'')) from public.bookings b;"),
    ).toBe(before);
    await fault();
    await page.reload();
    expect(
      sql("select md5(coalesce(string_agg(row_to_json(b)::text,',' order by b.id),'')) from public.bookings b;"),
    ).toBe(before);
    await page.screenshot({ path: info.outputPath("reservation-after-rejected-write.png"), fullPage: true });
  });
  test("failed session planner save retains the old canonical goals after reload", async ({ page }, info) => {
    expect(f!.confirmedBookingId).toMatch(/^[a-f0-9-]{36}$/i);
    await login(page);
    await page.goto(`/sessions/${f!.confirmedBookingId}`);
    const form = page.getByRole("form", { name: "Save session goals", exact: true });
    const field = form.getByLabel("Goals for this session", { exact: true });
    const original = await field.inputValue();
    const before = sql(
      `select row_to_json(p)::text from public.session_plans p where booking_id='${f!.confirmedBookingId}'`,
    );
    await field.fill(`Rejected planner write ${info.project.name}`);
    await fault("/rest/v1/rpc/save_session_preparation");
    const response = page
      .waitForResponse(
        (res) =>
          new URL(res.url()).pathname === `/sessions/${f!.confirmedBookingId}` && res.request().method() === "POST",
      )
      .then((item) => item.text());
    await form.getByRole("button", { name: "Save goals", exact: false }).click();
    const body = await response;
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(form.getByText("Goals and questions saved. Your tutor can now read them.")).toHaveCount(0);
    expect(body).not.toContain("PRIVATE_SQL_SENTINEL");
    expect(body.includes(f!.password), "Response must not expose a credential").toBe(false);
    expect(
      sql(`select row_to_json(p)::text from public.session_plans p where booking_id='${f!.confirmedBookingId}'`),
    ).toBe(before);
    await fault();
    await page.reload();
    await expect(field).toHaveValue(original);
    await page.screenshot({ path: info.outputPath("planner-after-rejected-write.png"), fullPage: true });
  });
});
