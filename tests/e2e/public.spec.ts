import { expect, test } from "@playwright/test";

test("public learning journey is responsive and honest about future scope", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Great learning starts with the right support/ })).toBeVisible();
  await page.getByRole("link", { name: /Start your journey/ }).click();
  await expect(page.getByRole("heading", { name: "Join Tutor Plus." })).toBeVisible();
  await expect(page.getByLabel("I’m here to")).toHaveValue("student");
  await expect(page.getByLabel("I’m here to").locator("option")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("login and password reset routes have meaningful controls", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Request reset link/ })).toBeVisible();
});

test("missing environment does not simulate account or persistence success", async ({ page }) => {
  test.skip(!!process.env.NEXT_PUBLIC_SUPABASE_URL, "Missing-environment state requires an unconfigured application.");
  await page.goto("/signup");
  await expect(page.getByText("Account services aren’t connected yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Create account/ })).toBeDisabled();
  await page.goto("/dashboard");
  await expect(page.getByText("Account services aren’t connected yet.")).toBeVisible();
});
