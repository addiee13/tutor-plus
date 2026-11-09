// Local job integration only. The owned native server must use this private, email-disabled configuration.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const env = Object.fromEntries(
  (await readFile("/tmp/tutorplus-native-runtime/app.env", "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin, "http://127.0.0.1:55440");
assert.equal(new URL(env.NEXT_PUBLIC_SITE_URL).origin, "http://localhost:3008");
assert.ok(env.PLATFORM_JOB_SECRET);
assert.ok(!env.RESEND_API_KEY && !env.RESEND_FROM_EMAIL, "Native verification must not send external email");
const paths = ["/api/jobs/booking-reminders", "/api/jobs/notification-outbox"];
const observations = [];
async function call(path, token) {
  const response = await fetch(`http://localhost:3008${path}`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { status: response.status, body: await response.json() };
}
for (const path of paths) {
  for (const token of [undefined, "invalid-local-fixture"]) {
    const result = await call(path, token);
    assert.equal(result.status, 403);
    observations.push({ path, variant: token ? "wrong token" : "missing token", status: result.status });
  }
}
const fixture = JSON.parse(await readFile("/tmp/tutorplus-native-runtime/fixtures.json", "utf8"));
assert.match(fixture.studentId, /^[a-f0-9-]{36}$/i);
const fixtureKey = `native-job-proof:${randomUUID()}`;
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
    "-v",
    "ON_ERROR_STOP=1",
    "-Atc",
    `select private.enqueue_notification('${fixtureKey}','${fixture.studentId}','system',
      'Local job integration fixture','This isolated queue fixture sends no external email.','/notifications',
      statement_timestamp()-interval '100 days');`,
  ],
  { encoding: "utf8" },
);
const reminders = await call(paths[0], env.PLATFORM_JOB_SECRET);
assert.equal(reminders.status, 200);
assert.ok(Number.isSafeInteger(reminders.body.queued) && reminders.body.queued >= 0);
observations.push({ path: paths[0], variant: "authorized local reminders", ...reminders });
const dispatch = await call(paths[1], env.PLATFORM_JOB_SECRET);
assert.equal(dispatch.status, 200);
for (const field of ["claimed", "accepted", "notConfigured", "retrying", "exhausted"])
  assert.ok(Number.isSafeInteger(dispatch.body[field]) && dispatch.body[field] >= 0);
assert.equal(dispatch.body.accepted, 0, "Email-disabled integration cannot report provider acceptance");
assert.ok(dispatch.body.claimed >= 1 && dispatch.body.notConfigured >= 1, "Seeded required notice must be processed");
observations.push({ path: paths[1], variant: "authorized email-disabled local dispatch", ...dispatch });
await writeFile(
  "docs/evidence/sprint4/native-platform-jobs.json",
  `${JSON.stringify({ layer: "native HTTP/REST/PostgreSQL", externalEmailSent: false, explicitLocalQueueFixture: true, observations }, null, 2)}\n`,
);
console.log("PASS four scheduler-token denials and two authorized local jobs; zero provider acceptances");
