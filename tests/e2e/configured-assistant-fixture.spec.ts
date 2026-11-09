import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
const enabled = process.env.CONFIGURED_AI_FIXTURE === "1";
const root = "/tmp/tutorplus-native-runtime";
const env = enabled
  ? Object.fromEntries(
      readFileSync(`${root}/app.env`, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        }),
    )
  : null;
const f = enabled
  ? (JSON.parse(readFileSync(`${root}/fixtures.json`, "utf8")) as { password: string; adminEmail: string })
  : null;
const sql = (query: string) =>
  execFileSync(
    "/opt/homebrew/opt/postgresql@17/bin/psql",
    ["-X", "-h", root, "-p", "55438", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", query],
    { encoding: "utf8" },
  ).trim();
const control = (mode = "success") =>
  writeFile(`${root}/responses-fixture-control.json`, JSON.stringify({ mode }), { mode: 0o600 });
async function observations() {
  const result = await (await fetch("http://127.0.0.1:55449/__observations")).json();
  expect(result.testDouble).toBe(true);
  expect(result.externalRequests).toBe(0);
  return result.observations as Array<{
    sequence: number;
    store: boolean;
    hasSelectedResourceContext: boolean;
    hasSessionContext: boolean;
    hasPlanContext: boolean;
    mode: string;
  }>;
}
async function createLearner(label: string) {
  expect(env!.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:55440");
  const admin = createClient(env!.NEXT_PUBLIC_SUPABASE_URL, env!.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `assistant-${label}-${Date.now()}@example.test`;
  const result = await admin.auth.admin.createUser({
    email,
    password: f!.password,
    email_confirm: true,
    user_metadata: {
      display_name: "Deterministic Assistant Fixture",
      timezone: "UTC",
      adult_attested: true,
      initial_role: "student",
    },
  });
  expect(result.error).toBeNull();
  expect(result.data.user?.id).toMatch(/^[a-f0-9-]{36}$/i);
  return { email, id: result.data.user!.id };
}
async function login(page: Page, email: string) {
  await page.goto("/login");
  expect(new URL(page.url()).origin).toBe("http://localhost:3019");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(f!.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
}
function counts() {
  return sql(
    "select json_build_object('bookings',(select count(*) from public.bookings),'attempts',(select count(*) from public.assessment_attempts),'mastery',(select count(*) from public.topic_mastery_observations),'plans',(select count(*) from public.study_plans));",
  );
}
test.use({ trace: "off", actionTimeout: 15000 });
test.describe("Configured assistant with explicit deterministic loopback provider", () => {
  test.skip(
    !enabled,
    "Requires separately configured localhost3019 and a loopback Responses fixture; never a live provider.",
  );
  test.setTimeout(180000);
  test.afterEach(async () => {
    await control();
  });
  test("selected resource,100-character multiline prompt,clear,owner report,admin decision and persistent quota", async ({
    page,
  }, info) => {
    await control();
    const beforeCalls = (await observations()).length;
    const learner = await createLearner(info.project.name);
    const beforeLearning = counts();
    await login(page, learner.email);
    await page.goto("/assistant");
    const ask = page.getByRole("form", { name: "Ask the learning assistant", exact: true });
    const question = ask.getByLabel("What would you like help understanding?", { exact: true });
    const prompt = "Explain\n" + "Q".repeat(92);
    expect(prompt.length).toBe(100);
    await question.fill(prompt);
    await ask.getByText("Add learning context", { exact: true }).click();
    const choice = ask.locator('input[name="resourceIds"]').first();
    const resourceId = (await choice.getAttribute("value"))!;
    expect(resourceId).toMatch(/^[a-f0-9-]{36}$/i);
    await choice.check();
    await ask.getByRole("button", { name: "Ask a learning question", exact: false }).click();
    const output = page.locator('section[aria-label="Assistant response"]');
    await expect(output.getByText(/Deterministic local adapter fixture/)).toBeVisible();
    await expect(output.getByRole("heading", { name: "Selected source resources", exact: true })).toBeVisible();
    await expect(output.getByText(/AI-generated study guidance can be incomplete or wrong/)).toBeVisible();
    expect(
      sql(
        `select question_chars from private.assistant_requests where user_id='${learner.id}' order by created_at limit 1`,
      ),
    ).toBe("100");
    const selected = JSON.parse(
      sql(
        `select selected_context::text from private.assistant_requests where user_id='${learner.id}' order by created_at limit 1`,
      ),
    );
    expect(selected).toEqual({ resourceIds: [resourceId] });
    await page.getByRole("button", { name: "Clear question & output", exact: true }).click();
    await expect(output).toHaveCount(0);
    await expect(question).toHaveValue("");
    expect(sql(`select count(*) from private.assistant_requests where user_id='${learner.id}'`)).toBe("1");
    await question.fill("Explain a second worked example.");
    await ask.getByText("Add learning context", { exact: true }).click();
    await ask.locator(`input[name="resourceIds"][value="${resourceId}"]`).check();
    await ask.getByRole("button", { name: "Ask a learning question", exact: false }).click();
    await expect(output.getByText(/Deterministic local adapter fixture/)).toBeVisible();
    await output.getByText("Report this assistant response", { exact: true }).click();
    const report = output.getByRole("form", { name: "Report assistant response", exact: true });
    const requestId = (await report.locator('input[name="requestId"]').getAttribute("value"))!;
    expect(requestId).toMatch(/^[a-f0-9-]{36}$/i);
    const reason = `Deterministic response concern ${info.project.name} ${Date.now()}`;
    await report.getByLabel("What should be reviewed about this response?", { exact: true }).fill(reason);
    await report.getByRole("button", { name: "Send response concern", exact: false }).click();
    await expect(report.getByText(/Your response concern was saved for review/)).toBeVisible();
    await page.screenshot({ path: info.outputPath("deterministic-assistant-owner-report.png"), fullPage: true });
    await page.getByRole("button", { name: "Clear question & output", exact: true }).click();
    await question.fill("A third question must remain over quota.");
    await ask.getByText("Add learning context", { exact: true }).click();
    await ask.locator(`input[name="resourceIds"][value="${resourceId}"]`).check();
    await ask.getByRole("button", { name: "Ask a learning question", exact: false }).click();
    await expect(ask.getByRole("alert")).toBeVisible();
    await expect(output).toHaveCount(0);
    expect(sql(`select count(*) from private.assistant_requests where user_id='${learner.id}'`)).toBe("2");
    const calls = (await observations()).slice(beforeCalls);
    expect(calls.length).toBe(2);
    expect(
      calls.every(
        (call) =>
          call.store === false && call.hasSelectedResourceContext && !call.hasSessionContext && !call.hasPlanContext,
      ),
    ).toBe(true);
    expect(counts()).toBe(beforeLearning);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(/\/login/);
    await login(page, f!.adminEmail);
    await page.goto("/admin/operations");
    const record = page.locator("li.workspace-record").filter({ has: page.getByText(reason, { exact: true }) });
    await expect(record).toBeVisible();
    expect((await record.innerText()).includes(prompt)).toBe(false);
    await record.getByText("Review this response concern", { exact: true }).click();
    const decision = record.getByRole("form", { name: "Resolve assistant response report", exact: true });
    await decision.getByLabel("Report state", { exact: true }).selectOption("resolved");
    await decision
      .getByLabel("Decision reason", { exact: true })
      .fill("Reviewed the explicitly labeled deterministic adapter fixture.");
    await decision.getByLabel("I confirm this assistant report decision", { exact: true }).check();
    await decision.getByRole("button", { name: "Record response review", exact: false }).click();
    await expect(decision.getByRole("status")).toBeVisible();
    await page.reload();
    await expect(record.getByText("Resolved", { exact: true })).toBeVisible();
    expect(sql(`select state from private.assistant_response_reports where request_id='${requestId}'`)).toBe(
      "resolved",
    );
    await record.screenshot({ path: info.outputPath("deterministic-assistant-admin-decision.png") });
    await writeFile(
      info.outputPath("configured-assistant-observations.json"),
      JSON.stringify(
        {
          testDouble: true,
          externalProviderVerified: false,
          externalRequests: 0,
          visiblePromptCharacters: 100,
          storedCanonicalPromptCharacters: 100,
          providerCalls: 2,
          clearRetainedQuota: true,
          recipientReportPersisted: true,
          adminDecisionPersisted: true,
          protectedLearningCountsUnchanged: true,
          calls,
        },
        null,
        2,
      ),
    );
  });
  test("actual deterministic provider outage leaves a failed metadata outcome and no answer", async ({
    page,
  }, info) => {
    const learner = await createLearner(`failure-${info.project.name}`);
    await control("unavailable");
    await login(page, learner.email);
    await page.goto("/assistant");
    const ask = page.getByRole("form", { name: "Ask the learning assistant", exact: true });
    await ask
      .getByLabel("What would you like help understanding?", { exact: true })
      .fill("Explain the selected reference.");
    await ask.getByText("Add learning context", { exact: true }).click();
    await ask.locator('input[name="resourceIds"]').first().check();
    await ask.getByRole("button", { name: "Ask a learning question", exact: false }).click();
    await expect(ask.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Draft guidance", exact: true })).toHaveCount(0);
    expect((await page.content()).includes("PRIVATE_PROVIDER_SENTINEL")).toBe(false);
    expect(sql(`select state from private.assistant_requests where user_id='${learner.id}'`)).toBe("failed");
    await page.screenshot({ path: info.outputPath("deterministic-assistant-provider-failure.png"), fullPage: true });
  });
});
