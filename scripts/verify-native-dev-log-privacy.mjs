// Harmless canaries verify that development URL and action-argument logs stay disabled.
import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
const runtime = "/tmp/tutorplus-native-runtime";
const fixture = JSON.parse(await readFile(`${runtime}/fixtures.json`, "utf8"));
const path = `${runtime}/next.log`;
const offset = (await stat(path)).size;
const callbackCanary = "harmless-verifier-callback-canary";
const queryCanary = "harmless-verifier-learning-query-canary";
const browserCanary = "harmless-verifier-browser-warning-canary";
const callback = await fetch(`http://localhost:3008/auth/callback?token_hash=${callbackCanary}&type=signup`, {
  redirect: "manual",
});
assert.ok([302, 303, 307, 308].includes(callback.status), "Invalid callback must leave no authenticated-success page");
await fetch(`http://localhost:3008/matching?goal=${queryCanary}`);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:3008/login");
  await page.getByLabel("Email address", { exact: true }).fill(fixture.studentEmail);
  await page.getByLabel("Password", { exact: true }).fill("harmless-verifier-invalid-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await page.evaluate((canary) => console.warn(canary), browserCanary);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const added = (await readFile(path)).subarray(offset).toString();
  assert.ok(!added.includes(callbackCanary), "Callback token canary must be absent from dev log");
  assert.ok(!added.includes(queryCanary), "Learner query canary must be absent from dev log");
  assert.ok(!/ƒ\s+loginAction|loginAction\(/.test(added), "Server Action name/arguments must be suppressed");
  assert.ok(!added.includes("harmless-verifier-invalid-password"), "Form credential canary must not be logged");
  assert.ok(!added.includes(browserCanary), "Browser warning canary must not be forwarded to the terminal");
  await writeFile(
    "docs/evidence/sprint4/native-dev-log-privacy.json",
    `${JSON.stringify({ layer: "actual Next development requests and browser action", observations: ["Invalid callback token canary absent from new development log bytes", "Learner query canary absent from new development log bytes", "Actual failed login action name and arguments suppressed", "Credential canary absent", "Browser warning canary is not forwarded to the terminal"], logBytesInspected: Buffer.byteLength(added), externalEmailSent: false }, null, 2)}\n`,
  );
  console.log("PASS actual development callback/query/action canaries remain absent from logs");
} finally {
  await browser.close();
}
