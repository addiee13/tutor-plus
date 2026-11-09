// Isolated Auth clock partitions; only fresh example.test identities are modified.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
const directory = "/tmp/tutorplus-native-runtime";
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
const fixture = JSON.parse(await readFile(`${directory}/fixtures.json`, "utf8"));
const client = () =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const mailbox = "http://127.0.0.1:55446";
const results = [];
const pass = (caseId, observation) => {
  results.push({ caseId, observation, layer: "native GoTrue/SMTP/PostgreSQL clock fixture", status: "pass" });
  console.log(`PASS ${caseId}: ${observation}`);
};
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
async function message(email, type) {
  for (let i = 0; i < 40; i++) {
    const messages = (await (await fetch(`${mailbox}/api/v1/messages`)).json()).messages;
    for (const item of messages) {
      if (!item.To?.some((recipient) => recipient.Address === email)) continue;
      const detail = await (await fetch(`${mailbox}/api/v1/message/${item.ID}`)).json();
      const text = `${detail.HTML || ""}\n${detail.Text || ""}`.replaceAll("&amp;", "&");
      for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
        const url = new URL(match[0]);
        if (
          ["127.0.0.1", "localhost"].includes(url.hostname) &&
          ["55440", "3008"].includes(url.port) &&
          url.searchParams.get("type") === type &&
          (url.searchParams.has("token") || url.searchParams.has("token_hash"))
        ) {
          return {
            token: url.searchParams.get("token") || url.searchParams.get("token_hash"),
            code: detail.HTML?.match(/<strong>\s*(\d{6,8})\s*<\/strong>/i)?.[1],
          };
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Actual local SMTP message was not captured");
}
const stamp = Date.now();
const pendingEmail = `native-expired-signup-${stamp}@example.test`;
const pending = await client().auth.signUp({
  email: pendingEmail,
  password: fixture.password,
  options: { data: { display_name: "Expiry Learner", timezone: "UTC", initial_role: "student", adult_attested: true } },
});
assert.ok(!pending.error && pending.data.user && !pending.data.session, "Fresh signup must remain pending");
const pendingId = pending.data.user.id;
assert.match(pendingId, /^[a-f0-9-]{36}$/i);
const link = await message(pendingEmail, "signup");
sql(`update auth.users set confirmation_sent_at=statement_timestamp()-interval '1 day' where id='${pendingId}';`);
const expired = await client().auth.verifyOtp({ token_hash: link.token, type: "signup" });
assert.ok(expired.error && !expired.data.session, "Expired SMTP confirmation must not create a session");
assert.equal(sql(`select email_confirmed_at is null from auth.users where id='${pendingId}'`), "t");
const pendingLogin = await client().auth.signInWithPassword({ email: pendingEmail, password: fixture.password });
assert.ok(pendingLogin.error && !pendingLogin.data.session, "Pending identity cannot log in");
pass(
  "1.5/1.7",
  "Expired actual SMTP signup token is refused; pending identity stays unverified and password login establishes no session",
);

const verifiedEmail = `native-expired-recovery-${stamp}@example.test`;
const created = await admin.auth.admin.createUser({
  email: verifiedEmail,
  password: fixture.password,
  email_confirm: true,
  user_metadata: { display_name: "Boundary Learner", timezone: "UTC", initial_role: "student", adult_attested: true },
});
assert.ok(!created.error && created.data.user, "Disposable verified identity must be created");
const verifiedId = created.data.user.id;
assert.match(verifiedId, /^[a-f0-9-]{36}$/i);
const before = sql(
  `select json_build_object('users',(select count(*) from auth.users where email='${verifiedEmail}'),'profiles',(select count(*) from public.profiles where id='${verifiedId}'),'roles',(select json_agg(role order by role) from public.user_roles where user_id='${verifiedId}'));`,
);
for (let i = 0; i < 2; i++) {
  const duplicate = await client().auth.signUp({
    email: verifiedEmail,
    password: fixture.password,
    options: {
      data: { display_name: "Duplicate Tutor", timezone: "UTC", initial_role: "tutor", adult_attested: true },
    },
  });
  assert.equal(duplicate.data.session, null, "Duplicate signup must not authenticate");
}
const after = sql(
  `select json_build_object('users',(select count(*) from auth.users where email='${verifiedEmail}'),'profiles',(select count(*) from public.profiles where id='${verifiedId}'),'roles',(select json_agg(role order by role) from public.user_roles where user_id='${verifiedId}'));`,
);
assert.equal(after, before, "Duplicate signup must preserve identity/profile/grants");
pass(
  "1.3",
  "Two real duplicate signups preserve one identity/profile and original Student capability without adding requested Tutor capability",
);
assert.equal((await client().auth.resetPasswordForEmail(verifiedEmail)).error, null);
const recovery = await message(verifiedEmail, "recovery");
sql(`update auth.users set recovery_sent_at=statement_timestamp()-interval '1 day' where id='${verifiedId}';`);
const expiredRecovery = await client().auth.verifyOtp({ token_hash: recovery.token, type: "recovery" });
assert.ok(
  expiredRecovery.error && !expiredRecovery.data.session,
  "Expired actual recovery token must not establish authority",
);
const originalLogin = await client().auth.signInWithPassword({ email: verifiedEmail, password: fixture.password });
assert.ok(!originalLogin.error && originalLogin.data.session, "Rejected recovery must preserve original credential");
pass("1.9", "Expired actual SMTP recovery link is refused without changing the original password");
const otpEmail = `native-expired-otp-${stamp}@example.test`;
const otpUser = await admin.auth.admin.createUser({
  email: otpEmail,
  password: fixture.password,
  email_confirm: true,
  user_metadata: {
    display_name: "Code Expiry Learner",
    timezone: "UTC",
    initial_role: "student",
    adult_attested: true,
  },
});
assert.ok(!otpUser.error && otpUser.data.user, "Fresh OTP identity must be created");
assert.equal(
  (await client().auth.signInWithOtp({ email: otpEmail, options: { shouldCreateUser: false } })).error,
  null,
);
const otp = await message(otpEmail, "email");
assert.match(otp.code || "", /^\d{6,8}$/, "Actual SMTP numeric code is required");
const otpId = otpUser.data.user.id;
assert.match(otpId, /^[a-f0-9-]{36}$/i);
sql(
  `update auth.users set confirmation_sent_at=statement_timestamp()-interval '1 day',recovery_sent_at=statement_timestamp()-interval '1 day' where id='${otpId}';`,
);
const expiredCode = await client().auth.verifyOtp({ email: otpEmail, token: otp.code, type: "email" });
assert.ok(expiredCode.error && !expiredCode.data.session, "Expired actual numeric code cannot create a session");
pass("1.11", "Expired actual provider-issued numeric SMTP code is refused with no new session");
await writeFile(
  "docs/evidence/sprint4/native-auth-boundaries.json",
  `${JSON.stringify({ externalEmailSent: false, clockFixture: "Only sent-at fields on freshly created example.test identities are backdated one day; real provider verifies actual SMTP tokens.", results }, null, 2)}\n`,
);
