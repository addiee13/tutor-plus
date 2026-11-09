import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
const runtime = "/tmp/tutorplus-native-runtime";
const fixturePath = process.env.WORKSPACE_E2E_FIXTURES;
const f = fixturePath ? (JSON.parse(readFileSync(fixturePath, "utf8")) as { password: string }) : null;
const env = fixturePath
  ? Object.fromEntries(
      readFileSync(`${runtime}/app.env`, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        }),
    )
  : null;
const sql = (query: string) =>
  execFileSync(
    "/opt/homebrew/opt/postgresql@17/bin/psql",
    [
      "-X",
      "-h",
      runtime,
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
async function mail(email: string, type: string) {
  let result: { token: string; code?: string } | undefined;
  await expect
    .poll(async () => {
      const inbox = await (await fetch("http://127.0.0.1:55446/api/v1/messages")).json();
      for (const item of inbox.messages || []) {
        if (!item.To?.some((recipient: { Address: string }) => recipient.Address === email)) continue;
        const detail = await (await fetch(`http://127.0.0.1:55446/api/v1/message/${item.ID}`)).json();
        const body = `${detail.HTML || ""}\n${detail.Text || ""}`.replaceAll("&amp;", "&");
        for (const match of body.matchAll(/https?:\/\/[^\s<>"']+/g)) {
          const url = new URL(match[0]);
          if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.searchParams.get("type") !== type) continue;
          const token = url.searchParams.get("token") || url.searchParams.get("token_hash");
          if (token) {
            result = { token, code: detail.HTML?.match(/<strong>\s*(\d{6,8})\s*<\/strong>/i)?.[1] };
            return true;
          }
        }
      }
      return false;
    })
    .toBe(true);
  return result!;
}
test.describe("Independent real browser Auth and local SMTP", () => {
  test.skip(!f || !env, "Requires explicit isolated real Auth/SMTP fixtures.");
  test.setTimeout(180000);
  test("pending signup, actual SMTP token through app callback, reload and fresh-browser replay denial", async ({
    page,
    browser,
  }, info) => {
    const email = `browser-verify-${info.project.name}-${Date.now()}@example.test`;
    const name = `Verified ${info.project.name} adult`;
    await page.goto("/signup");
    await page.getByLabel("Display name", { exact: true }).fill(name);
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(f!.password);
    await page.getByLabel("I’m here to", { exact: true }).selectOption("student");
    await page.getByLabel("I confirm that I am at least 18 years old.", { exact: true }).check();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page).toHaveURL(/\/check-email$/);
    const provisioned = JSON.parse(
      sql(
        `select json_build_object('confirmed',u.email_confirmed_at is not null,'profiles',(select count(*) from public.profiles p where p.id=u.id),'roles',(select json_agg(role order by role) from public.user_roles r where r.user_id=u.id)) from auth.users u where email='${email}'`,
      ),
    );
    expect(provisioned).toEqual({ confirmed: false, profiles: 1, roles: ["student"] });
    await page.goto("/login");
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(f!.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
    const issued = await mail(email, "signup");
    // Consume the actual SMTP-issued token through the supported app hash callback.
    // Native GoTrue's original redirect allowlist stays unchanged; no synthetic token is accepted.
    const base = new URL(page.url()).origin;
    const callback = `${base}/auth/callback?token_hash=${encodeURIComponent(issued.token)}&type=signup`;
    await page.goto(callback);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: `Hello, ${name}.`, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: `Hello, ${name}.`, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("actual-smtp-app-callback-verified.png"), fullPage: true });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(/\/login/);
    expect(
      (await page.context().cookies()).filter((cookie) => cookie.name.includes("auth-token") && cookie.value).length,
    ).toBe(0);
    const clean = await browser.newContext();
    const replay = await clean.newPage();
    await replay.goto(callback);
    await expect(replay).toHaveURL(/\/login\?notice=link-invalid$/);
    await replay.goto(`${base}/dashboard`);
    await expect(replay).toHaveURL(/\/login$/);
    await clean.close();
  });
  test("actual numeric SMTP code authenticates once and the real browser session obeys its original deadline", async ({
    page,
  }, info) => {
    expect(new URL(env!.NEXT_PUBLIC_SUPABASE_URL).origin).toBe("http://127.0.0.1:55440");
    const email = `browser-code-${info.project.name}-${Date.now()}@example.test`;
    const admin = createClient(env!.NEXT_PUBLIC_SUPABASE_URL, env!.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const created = await admin.auth.admin.createUser({
      email,
      password: f!.password,
      email_confirm: true,
      user_metadata: {
        display_name: "Code Browser Learner",
        timezone: "UTC",
        adult_attested: true,
        initial_role: "student",
      },
    });
    expect(created.error).toBeNull();
    const userId = created.data.user!.id;
    expect(userId).toMatch(/^[a-f0-9-]{36}$/i);
    await page.goto("/login?method=code");
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Email me a code", exact: true }).click();
    const issued = await mail(email, "email");
    expect(issued.code).toMatch(/^\d{6,8}$/);
    await page.getByLabel("Sign-in code", { exact: true }).fill(issued.code === "000000" ? "111111" : "000000");
    await page.getByRole("button", { name: "Verify and sign in", exact: true }).click();
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
    await page.getByLabel("Sign-in code", { exact: true }).fill(issued.code!);
    await page.getByRole("button", { name: "Verify and sign in", exact: true }).click();
    await page.waitForURL("**/dashboard");
    await expect(page.getByRole("heading", { name: "Hello, Code Browser Learner.", exact: true })).toBeVisible();
    const encoded = (await page.context().cookies())
      .filter((cookie) => /auth-token(?:\.\d+)?$/.test(cookie.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((cookie) => cookie.value)
      .join("");
    const stored = JSON.parse(Buffer.from(encoded.replace(/^base64-/, ""), "base64url").toString());
    const payload = JSON.parse(Buffer.from(stored.access_token.split(".")[1], "base64url").toString());
    expect(payload.sub).toBe(userId);
    expect(payload.session_id).toMatch(/^[a-f0-9-]{36}$/i);
    await page.screenshot({ path: info.outputPath("actual-smtp-code-browser-login.png"), fullPage: true });
    sql(
      `update auth.sessions set created_at=statement_timestamp()-interval '24 hours' where id='${payload.session_id}' and user_id='${userId}'`,
    );
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login\?notice=expired$/);
    await expect(page.getByRole("button", { name: "Save profile", exact: true })).toHaveCount(0);
  });
});
