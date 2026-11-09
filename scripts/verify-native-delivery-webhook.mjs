// Signed fixture events against isolated services; this never sends email.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const directory = "/tmp/tutorplus-native-runtime";
const env = Object.fromEntries(
  (await readFile(`${directory}/app.env`, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin, "http://127.0.0.1:55440");
assert.ok(env.RESEND_WEBHOOK_SECRET?.startsWith("whsec_"));
const fixture = JSON.parse(await readFile(`${directory}/fixtures.json`, "utf8"));
assert.match(fixture.studentId, /^[a-f0-9-]{36}$/i);
const sql = (query) =>
  execFileSync(
    "/opt/homebrew/opt/postgresql@17/bin/psql",
    [
      "-X",
      "-h",
      directory,
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
const notice = randomUUID();
const provider = randomUUID();
const eventId = `native_${randomUUID()}`;
sql(`insert into private.notification_outbox(id,dedup_key,recipient_id,category,title,body,state,email_state,provider_email_id)
values('${notice}','native-webhook:${notice}','${fixture.studentId}','system','Local signed event fixture','No email was sent.','accepted','accepted','${provider}');`);
const observations = [];
async function send(type, id, valid = true, ageSeconds = 0) {
  const body = JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: provider } });
  const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds);
  const signature = createHmac("sha256", Buffer.from(env.RESEND_WEBHOOK_SECRET.slice(6), "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return fetch("http://localhost:3008/api/webhooks/resend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${valid ? signature : "invalid"}`,
    },
    body,
  });
}
const state = () => sql(`select email_state from private.notification_outbox where id='${notice}'`);
try {
  const oversized = await fetch("http://localhost:3008/api/webhooks/resend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "x".repeat(64_001),
  });
  assert.equal(oversized.status, 413);
  const chunked = await fetch("http://localhost:3008/api/webhooks/resend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    duplex: "half",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(32_001)));
        controller.enqueue(new TextEncoder().encode("x".repeat(32_001)));
        controller.close();
      },
    }),
  });
  assert.equal(chunked.status, 413);
  assert.equal(state(), "accepted");
  observations.push("Oversized fixed-length and chunked payloads rejected at the 64000-byte route cap");
  assert.equal((await send("email.delivered", eventId, false)).status, 401);
  assert.equal(state(), "accepted");
  observations.push("Invalid signature denied without delivery-state mutation");
  assert.equal((await send("email.delivered", eventId, true, 601)).status, 401);
  assert.equal(state(), "accepted");
  observations.push("Stale signed request denied without mutation");
  assert.equal((await send("email.delivered", eventId)).status, 200);
  assert.equal(state(), "delivered");
  assert.equal((await send("email.delivered", eventId)).status, 200);
  assert.equal(sql(`select count(*) from private.notification_delivery_events where event_id='${eventId}'`), "1");
  observations.push("Valid signed fixture persisted; replay retained one event");
  assert.equal((await send("email.sent", `native_${randomUUID()}`)).status, 200);
  assert.equal(state(), "delivered");
  observations.push("Delayed sent event did not regress delivered state");
  await writeFile(
    "docs/evidence/sprint4/native-delivery-webhook.json",
    `${JSON.stringify({ layer: "isolated signed HTTP/REST/PostgreSQL fixture", externalEmailSent: false, observations }, null, 2)}\n`,
  );
  for (const observation of observations) console.log(`PASS ${observation}`);
} finally {
  sql(
    `delete from private.notification_delivery_events where provider_email_id='${provider}'; delete from private.notification_outbox where id='${notice}';`,
  );
}
