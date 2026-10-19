import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const live = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_TEST_EMAIL &&
  process.env.SUPABASE_TEST_PASSWORD
);
test.use({ trace: "off" });

test("real login, own profile save, refresh persistence, and cookie logout", async ({ page }, testInfo) => {
  test.skip(!live, "Requires real verified local Supabase fixtures; not a simulated account.");
  const prefix = testInfo.project.name === "phone" ? "SUPABASE_OTHER_TEST" : "SUPABASE_TEST";
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env[`${prefix}_EMAIL`]!);
  await page.getByLabel("Password", { exact: true }).fill(process.env[`${prefix}_PASSWORD`]!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "My profile" }).click();
  const originalName = await page.getByLabel("Display name").inputValue();
  const originalZone = await page.getByLabel("Time zone").inputValue();
  const name = `Verified ${testInfo.project.name} Learner`;
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Time zone").selectOption("Europe/London");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toContainText("Your profile is saved");
  await page.reload();
  await expect(page.getByLabel("Display name")).toHaveValue(name);
  await expect(page.getByLabel("Time zone")).toHaveValue("Europe/London");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel("Display name").fill(originalName);
  await page.getByLabel("Time zone").selectOption(originalZone);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toContainText("Your profile is saved");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login\?notice=signed-out/);
  const cookies = await page.context().cookies();
  expect(cookies.filter((cookie) => cookie.name.includes("auth-token") && cookie.value).length).toBe(0);
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login$/);
});

test("real Tutor signup requires mailbox verification and preserves Tutor intent", async ({ page }) => {
  test.skip(!live || !process.env.LOCAL_MAIL_URL, "Requires local mail viewer and real configured Auth.");
  const email = `browser-tutor-${Date.now()}-${randomBytes(4).toString("hex")}@example.test`;
  const password = randomBytes(22).toString("base64url");
  await page.goto("/signup");
  await page.getByLabel("Display name").fill("Browser Tutor");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("I’m here to").selectOption("tutor");
  await page.getByLabel("I confirm that I am at least 18 years old.").check();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/check-email$/);
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Check your details and verify your email" })).toBeVisible();
  const mailUrl = process.env.LOCAL_MAIL_URL!;
  let messageId: string | undefined;
  await expect
    .poll(async () => {
      const inbox = await fetch(`${mailUrl}/api/v1/messages`).then((response) => response.json());
      messageId = inbox.messages?.find((entry: { ID: string; To: { Address: string }[] }) =>
        entry.To?.some((recipient) => recipient.Address === email),
      )?.ID;
      return !!messageId;
    })
    .toBe(true);
  const message = await fetch(`${mailUrl}/api/v1/message/${messageId}`).then((response) => response.json());
  const links: string[] = `${message.HTML || ""} ${message.Text || ""}`.match(/https?:\/\/[^"<>\s]+/g) || [];
  const link = links.find((value) => value.includes("/auth/callback?token_hash=") || value.includes("/auth/v1/verify"));
  expect(link).toBeTruthy();
  await page.goto(link!.replaceAll("&amp;", "&"));
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Hello, Browser Tutor." })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: /^tutor$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login\?notice=signed-out/);
});

test("unprivileged verified account cannot open administrator operations", async ({ page }) => {
  test.skip(!live, "Requires real Supabase identity.");
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.SUPABASE_TEST_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.SUPABASE_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "We couldn’t open this page." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record role change" })).toHaveCount(0);
});

test("24-hour session expiry redirects the real cookie-authenticated browser", async ({ page }) => {
  test.skip(
    !live || process.env.SUPABASE_TEST_SESSION_DB_MUTATIONS !== "true",
    "Requires explicit local-only session manipulation permission.",
  );
  test.skip(
    !["localhost", "127.0.0.1"].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname),
    "Never manipulate remote sessions.",
  );
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.SUPABASE_TEST_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.SUPABASE_TEST_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const chunks = (await page.context().cookies())
    .filter((cookie) => /auth-token(?:\.\d+)?$/.test(cookie.name))
    .sort((first, second) => first.name.localeCompare(second.name));
  const encoded = chunks.map((cookie) => cookie.value).join("");
  const stored = JSON.parse(Buffer.from(encoded.replace(/^base64-/, ""), "base64url").toString());
  const payload = JSON.parse(Buffer.from(stored.access_token.split(".")[1], "base64url").toString());
  expect(payload.session_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(payload.sub).toBe(process.env.SUPABASE_TEST_USER_ID);
  execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_TutorPlus", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    {
      input: `update auth.sessions set created_at = statement_timestamp() - interval '24 hours' where id = '${payload.session_id}'::uuid and user_id = '${payload.sub}'::uuid;`,
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login\?notice=expired$/);
  await expect(page.getByText("Your 24-hour session has ended. Please sign in again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save profile" })).toHaveCount(0);
});
