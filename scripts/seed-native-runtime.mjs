// Disposable local integration fixtures; never accepts a hosted Supabase URL.
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const directory = process.env.TUTORPLUS_NATIVE_RUNTIME_DIR || "/tmp/tutorplus-native-runtime";
const environment = Object.fromEntries(
  (await readFile(`${directory}/app.env`, "utf8"))
    .trim()
    .split("\n")
    .map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);
const url = environment.NEXT_PUBLIC_SUPABASE_URL;
if (new URL(url).origin !== "http://127.0.0.1:55440") throw new Error("Refusing non-isolated runtime");
const fixtures = JSON.parse(await readFile(`${directory}/fixtures.json`, "utf8"));
const privileged = createClient(url, environment.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
for (const [name, role] of [
  ["student", "student"],
  ["tutor", "tutor"],
  ["other", "student"],
  ["admin", "student"],
]) {
  const client = createClient(url, environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let signed = await client.auth.signInWithPassword({ email: fixtures[`${name}Email`], password: fixtures.password });
  if (signed.error) {
    const created = await privileged.auth.admin.createUser({
      email: fixtures[`${name}Email`],
      password: fixtures.password,
      email_confirm: true,
      user_metadata: { display_name: `Native ${name}`, initial_role: role, adult_attested: true, timezone: "UTC" },
    });
    if (created.error) throw new Error(`Local ${name} fixture creation failed: ${created.error.code}`);
    signed = await client.auth.signInWithPassword({ email: fixtures[`${name}Email`], password: fixtures.password });
  }
  if (signed.error || !signed.data.user) throw new Error(`Local ${name} password sign-in failed`);
  fixtures[`${name}Id`] = signed.data.user.id;
  const profile = await client.from("profiles").select("id,status,adult_attested").single();
  if (profile.error || profile.data.id !== signed.data.user.id || !profile.data.adult_attested) {
    throw new Error(`Local ${name} persisted profile authorization failed`);
  }
  const session = await client.rpc("current_session_started_at");
  if (session.error || !session.data) throw new Error(`Local ${name} verified session query failed`);
  await client.auth.signOut({ scope: "local" });
  console.log(`PASS: native Auth password login, profile isolation, session and logout (${name})`);
}
const bootstrap = await privileged.rpc("bootstrap_initial_admin", { target: fixtures.adminId });
if (bootstrap.error && bootstrap.error.code !== "22023") throw new Error("Local administrator fixture failed");
await writeFile(`${directory}/fixtures.json`, JSON.stringify(fixtures), { mode: 0o600 });
console.log("PASS: isolated fixtures ready; no payment events or hosted data changed.");
