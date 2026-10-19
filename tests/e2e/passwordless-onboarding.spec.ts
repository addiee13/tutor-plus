import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Local-only: creates disposable example.test accounts with the service key and reads codes from the local Mailpit inbox.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const local = (() => {
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(supabaseUrl).hostname);
  } catch {
    return false;
  }
})();
const ready =
  local &&
  !!(
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.LOCAL_MAIL_URL
  );
test.use({ trace: "off" });

const admin = () =>
  createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const address = (label: string) => `e2e-${label}-${Date.now()}-${randomBytes(3).toString("hex")}@example.test`;

async function readMessage(email: string): Promise<{ HTML?: string; Text?: string }> {
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
  return fetch(`${mailUrl}/api/v1/message/${messageId}`).then((response) => response.json());
}

async function readCode(email: string): Promise<string> {
  const code = String((await readMessage(email)).Text || "").match(/\b(\d{6,8})\b/)?.[1];
  expect(code, "the sign-in email contains a numeric code").toBeTruthy();
  return code!;
}

async function signInWithCode(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("link", { name: "Email me a code" }).click();
  await expect(page).toHaveURL(/\/login\?method=code$/);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status").filter({ hasText: "sign-in code is on its way" })).toBeVisible();
  await page.getByLabel("Sign-in code").fill(await readCode(email));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
}

async function accessToken(page: Page): Promise<string> {
  const chunks = (await page.context().cookies())
    .filter((cookie) => /auth-token(?:\.\d+)?$/.test(cookie.name))
    .sort((first, second) => first.name.localeCompare(second.name));
  const stored = JSON.parse(
    Buffer.from(
      chunks
        .map((cookie) => cookie.value)
        .join("")
        .replace(/^base64-/, ""),
      "base64url",
    ).toString(),
  );
  return stored.access_token;
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/login\?notice=signed-out/);
  expect(
    (await page.context().cookies()).filter((cookie) => cookie.name.includes("auth-token") && cookie.value).length,
  ).toBe(0);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
}

test("email code signs an existing verified account in to the dashboard and signs out", async ({ page }) => {
  test.skip(!ready, "Requires local Supabase, its service key, and the local mail viewer.");
  const email = address("otp");
  const created = await admin().auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      display_name: "Code Learner",
      timezone: "Europe/London",
      initial_role: "student",
      adult_attested: true,
    },
  });
  expect(created.error).toBeNull();
  await page.goto("/login?method=code");
  await page.getByLabel("Email address").fill(address("unknown"));
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status").filter({ hasText: "If an account uses this email" })).toBeVisible();
  await signInWithCode(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Hello, Code Learner." })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: /^student$/ })).toBeVisible();
  await signOut(page);
});

test("the link in the code email signs in through /auth/callback", async ({ page }) => {
  test.skip(!ready, "Requires local Supabase, its service key, and the local mail viewer.");
  const email = address("link");
  expect(
    (
      await admin().auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { display_name: "Link Learner", timezone: "UTC", initial_role: "student", adult_attested: true },
      })
    ).error,
  ).toBeNull();
  await page.goto("/login?method=code");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByLabel("Sign-in code")).toBeVisible();
  const message = await readMessage(email);
  const link = (`${message.HTML || ""} ${message.Text || ""}`.match(/https?:\/\/[^"<>\s)]+/g) || []).find((value) =>
    value.includes("/auth/callback"),
  );
  expect(link).toBeTruthy();
  await page.goto(link!.replaceAll("&amp;", "&"));
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Hello, Link Learner." })).toBeVisible();
  await signOut(page);
});

test("a wrong code is refused without creating a session", async ({ page }) => {
  test.skip(!ready, "Requires local Supabase, its service key, and the local mail viewer.");
  const email = address("wrong");
  expect(
    (
      await admin().auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { display_name: "Wrong Code", timezone: "UTC", initial_role: "student", adult_attested: true },
      })
    ).error,
  ).toBeNull();
  await page.goto("/login?method=code");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  const code = await readCode(email);
  await page.getByLabel("Sign-in code").fill(code === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "We couldn’t sign you in" })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("an account without signup metadata must onboard once and cannot choose administrator", async ({ page }) => {
  test.skip(!ready, "Requires local Supabase, its service key, and the local mail viewer.");
  const email = address("onboard");
  const created = await admin().auth.admin.createUser({ email, email_confirm: true });
  expect(created.error).toBeNull();
  const userId = created.data.user!.id;
  const before = await admin().from("profiles").select("adult_attested").eq("id", userId).single();
  expect(before.data?.adult_attested).toBe(false);

  await signInWithCode(page, email);
  await expect(page).toHaveURL(/\/welcome$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByLabel("I’m here to").locator("option")).toHaveText(["Learn as a student", "Teach as a tutor"]);

  await page.getByLabel("Display name").fill("Onboarded Tutor");
  await page.getByLabel("Time zone").selectOption("Europe/London");
  await page.getByLabel("I confirm that I am at least 18 years old.").check();
  await page.getByLabel("I’m here to").evaluate((select: HTMLSelectElement) => {
    select.add(new Option("Administrator", "administrator"));
    select.value = "administrator";
  });
  await page.getByRole("button", { name: "Finish setting up" }).click();
  await expect(page.getByText("Choose Student or Tutor.")).toBeVisible();
  await expect(page).toHaveURL(/\/welcome$/);

  const asUser = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${await accessToken(page)}` } },
  });
  const forged = await asUser.rpc("complete_onboarding", {
    chosen_name: "Forged Admin",
    chosen_timezone: "UTC",
    requested_role: "administrator",
  });
  expect(forged.error?.code).toBe("22023");

  await page.getByLabel("Display name").fill("Onboarded Tutor");
  await page.getByLabel("Time zone").selectOption("Europe/London");
  await page.getByLabel("I’m here to").selectOption("tutor");
  await page.getByLabel("I confirm that I am at least 18 years old.").check();
  await page.getByRole("button", { name: "Finish setting up" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Hello, Onboarded Tutor." })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: /^tutor$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);

  const again = await asUser.rpc("complete_onboarding", {
    chosen_name: "Second Try",
    chosen_timezone: "UTC",
    requested_role: "student",
  });
  expect(again.error?.code).toBe("42501");
  const [profile, roles, audit] = await Promise.all([
    admin().from("profiles").select("display_name,timezone,adult_attested").eq("id", userId).single(),
    admin().from("user_roles").select("role").eq("user_id", userId),
    admin().from("audit_logs").select("action").eq("entity_id", userId).eq("action", "account.onboarded"),
  ]);
  expect(profile.data).toEqual({ display_name: "Onboarded Tutor", timezone: "Europe/London", adult_attested: true });
  expect(roles.data?.map((row) => row.role)).toEqual(["tutor"]);
  expect(audit.data?.length).toBe(1);

  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/dashboard$/);
  await signOut(page);
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/login$/);
});
