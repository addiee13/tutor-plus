import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const email = process.env.SUPABASE_TEST_EMAIL;
  const password = process.env.SUPABASE_TEST_PASSWORD;
  if (!url || !key || !email || !password) {
    console.log(
      "SKIP: real Supabase URL, publishable key, and verified disposable test identity are required. Authentication and persistence are NOT verified.",
    );
    return;
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error || !login.data.user?.email_confirmed_at)
      throw new Error("Live sign-in or email verification check failed.");
    const ownerId = login.data.user.id;
    const [profile, roles, anchor] = await Promise.all([
      client.from("profiles").select("id,display_name,timezone,status,adult_attested").eq("id", ownerId).single(),
      client.from("user_roles").select("role").eq("user_id", ownerId),
      client.rpc("current_session_started_at"),
    ]);
    if (
      profile.error ||
      profile.data?.status !== "active" ||
      profile.data?.adult_attested !== true ||
      roles.error ||
      !roles.data?.length ||
      anchor.error ||
      !anchor.data
    )
      throw new Error("Live database authorization/provisioning/session check failed.");
    const started = Date.parse(anchor.data);
    if (!Number.isFinite(started) || started > Date.now() || Date.now() - started >= 86_400_000)
      throw new Error("Live session is outside the absolute 24-hour boundary.");
    const refreshed = await client.auth.refreshSession();
    const afterRefresh = await client.rpc("current_session_started_at");
    if (refreshed.error || afterRefresh.error || afterRefresh.data !== anchor.data)
      throw new Error("Refresh changed the trusted session anchor.");
    console.log(
      "PASS: verified login, persisted own profile read, current roles, and non-sliding session anchor. No profile writes or email delivery were tested by this read-only check.",
    );
  } finally {
    const logout = await client.auth.signOut({ scope: "local" });
    if (logout.error) throw new Error("Live logout could not be confirmed.");
  }
}

main().catch(() => {
  console.error(
    "FAIL: live account check could not complete. Review provider configuration privately; no authentication/persistence success is claimed.",
  );
  process.exitCode = 1;
});
