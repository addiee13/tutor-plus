// Real GoTrue + local SMTP capture. Refuses every non-isolated service URL.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const directory = process.env.TUTORPLUS_NATIVE_RUNTIME_DIR || "/tmp/tutorplus-native-runtime";
const env = Object.fromEntries(
  (await readFile(`${directory}/app.env`, "utf8"))
    .trim()
    .split("\n")
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin, "http://127.0.0.1:55440");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const client = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const fixture = JSON.parse(await readFile(`${directory}/fixtures.json`, "utf8"));
const email = `native-mail-${Date.now()}@example.test`;
const results = [];
const pass = (caseId, observation) => {
  results.push({ caseId, observation, status: "pass", layer: "native Auth/SMTP/REST" });
  console.log(`PASS ${caseId}: ${observation}`);
};
const mailbox = "http://127.0.0.1:55446";
const getMessages = async () => (await (await fetch(`${mailbox}/api/v1/messages`)).json()).messages;
async function receivedLink(type, excluded = new Set()) {
  for (let attempt = 0; attempt < 30; attempt++) {
    for (const message of await getMessages()) {
      if (excluded.has(message.ID) || !message.To?.some((recipient) => recipient.Address === email)) continue;
      const content = await (await fetch(`${mailbox}/api/v1/message/${message.ID}`)).json();
      const body = `${content.HTML || ""}\n${content.Text || ""}`.replaceAll("&amp;", "&");
      for (const match of body.matchAll(/https?:\/\/[^\s<>"']+/g)) {
        let link;
        try {
          link = new URL(match[0]);
        } catch {
          continue;
        }
        if (
          link.hostname === "127.0.0.1" &&
          link.port === "55440" &&
          link.searchParams.get("type") === type &&
          link.searchParams.has("token")
        ) {
          return { token: link.searchParams.get("token"), messageId: message.ID };
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No actual local SMTP ${type} message captured`);
}

const owner = client();
const signup = await owner.auth.signUp({
  email,
  password: fixture.password,
  options: {
    data: { display_name: "Native Mail Learner", initial_role: "student", adult_attested: true, timezone: "UTC" },
  },
});
assert.equal(signup.error, null);
assert.ok(signup.data.user);
assert.equal(signup.data.session, null);
assert.equal(signup.data.user.email_confirmed_at, undefined);
const id = signup.data.user.id;
assert.match(id, /^[a-f0-9-]{36}$/i);
// The application deliberately gives service_role no blanket profile read grant.
// Inspect provisioning as the disposable database owner, never broaden application grants.
const provisioned = JSON.parse(
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
      "-Atc",
      `select json_build_object('id',id,'adult',adult_attested,'roles',(select json_agg(role order by role) from public.user_roles where user_id='${id}')) from public.profiles where id='${id}'`,
    ],
    { encoding: "utf8" },
  ),
);
assert.equal(provisioned.id, id);
assert.equal(provisioned.adult, true);
assert.deepEqual(provisioned.roles, ["student"]);
pass("1.1", "pending identity has one linked adult profile and Student capability without a session");
const confirmation = await receivedLink("signup");
const verified = await owner.auth.verifyOtp({ token_hash: confirmation.token, type: "signup" });
assert.equal(verified.error, null);
assert.equal(verified.data.user?.id, id);
assert.ok(verified.data.session);
const replay = await client().auth.verifyOtp({ token_hash: confirmation.token, type: "signup" });
assert.ok(replay.error);
assert.equal(replay.data.session, null);
pass("1.4", "actual SMTP verification link works once and replay creates no new session");
const start = await owner.rpc("current_session_started_at");
assert.equal(start.error, null);
assert.ok(start.data);
assert.equal((await owner.auth.refreshSession()).error, null);
const refreshed = await owner.rpc("current_session_started_at");
assert.equal(refreshed.data, start.data);
pass("1.6", "real token refresh preserves the trusted original session start");

const beforeRecovery = new Set((await getMessages()).map((message) => message.ID));
assert.equal(
  (await owner.auth.resetPasswordForEmail(email, { redirectTo: "http://localhost:3008/auth/reset-password" })).error,
  null,
);
const recovery = await receivedLink("recovery", beforeRecovery);
const recoveryClient = client();
assert.equal((await recoveryClient.auth.verifyOtp({ token_hash: recovery.token, type: "recovery" })).error, null);
const replacement = `${fixture.password}New1!`;
assert.equal((await recoveryClient.auth.updateUser({ password: replacement })).error, null);
assert.ok((await client().auth.signInWithPassword({ email, password: fixture.password })).error);
const changed = await recoveryClient.auth.signInWithPassword({ email, password: replacement });
assert.equal(changed.error, null);
assert.ok((await client().auth.verifyOtp({ token_hash: recovery.token, type: "recovery" })).error);
pass("1.9", "actual recovery mail changes only intended credentials; old password and reused link are denied");
const accessToken = changed.data.session.access_token;
assert.equal((await recoveryClient.auth.signOut({ scope: "local" })).error, null);
const replayClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  ...options,
  global: { headers: { Authorization: `Bearer ${accessToken}` } },
});
const afterLogout = await replayClient.from("profiles").select("id").eq("id", id);
assert.equal(afterLogout.error, null);
assert.deepEqual(afterLogout.data, []);
pass("1.8", "logout invalidates the authoritative session and stale access JWT cannot read private profile");
await owner.auth.signOut({ scope: "local" });
const beforeCode = new Set((await getMessages()).map((message) => message.ID));
const codeClient = client();
assert.equal((await codeClient.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })).error, null);
let receivedCode;
for (let attempt = 0; attempt < 30 && !receivedCode; attempt++) {
  for (const message of await getMessages()) {
    if (beforeCode.has(message.ID) || !message.To?.some((recipient) => recipient.Address === email)) continue;
    const content = await (await fetch(`${mailbox}/api/v1/message/${message.ID}`)).json();
    receivedCode = content.HTML?.match(/<strong>\s*(\d{6,8})\s*<\/strong>/i)?.[1];
    if (receivedCode) break;
  }
  if (!receivedCode) await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.ok(receivedCode, "Actual local SMTP message must contain the provider-issued numeric code");
const wrongCode = receivedCode === "000000" ? "111111" : "000000";
const wrongCodeResult = await client().auth.verifyOtp({ email, token: wrongCode, type: "email" });
assert.ok(wrongCodeResult.error);
assert.equal(wrongCodeResult.data.session, null);
const codeResult = await codeClient.auth.verifyOtp({ email, token: receivedCode, type: "email" });
assert.equal(codeResult.error, null);
assert.equal(codeResult.data.user?.id, id);
assert.ok(codeResult.data.session);
const codeReplay = await client().auth.verifyOtp({ email, token: receivedCode, type: "email" });
assert.ok(codeReplay.error);
assert.equal(codeReplay.data.session, null);
await codeClient.auth.signOut({ scope: "local" });
pass("1.11", "actual SMTP numeric code verifies once; wrong and reused codes cannot create sessions");
await writeFile(`${directory}/auth-mail-results.json`, JSON.stringify({ emailFixtureId: id, results }, null, 2), {
  mode: 0o600,
});
console.log(
  "Local provider/SMTP checks passed; browser variants, expiry boundaries and external delivery remain separate.",
);
