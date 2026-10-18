import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.SUPABASE_TEST_EMAIL;
const password = process.env.SUPABASE_TEST_PASSWORD;
const enabled = !!(
  url &&
  key &&
  email &&
  password &&
  process.env.SUPABASE_TEST_SESSION_DB_MUTATIONS === "true" &&
  ["localhost", "127.0.0.1"].includes(new URL(url).hostname)
);

async function session() {
  const client = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email: email!, password: password! });
  expect(login.error).toBeNull();
  const token = login.data.session!.access_token;
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  const sessionId: string = payload.session_id;
  const ownerId = login.data.user!.id;
  expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(ownerId).toMatch(/^[0-9a-f-]{36}$/);
  return { client, token, sessionId, ownerId };
}

async function assertPrivateDataDenied(client: SupabaseClient, ownerId: string) {
  const anchor = await client.rpc("current_session_started_at");
  expect(anchor.error !== null || anchor.data === null).toBe(true);
  const profile = await client.from("profiles").select("id").eq("id", ownerId);
  expect(profile.error !== null || profile.data?.length === 0).toBe(true);
}

describe.skipIf(!enabled)("LIVE local-only session manipulation: no reset, isolated disposable sessions", () => {
  it("24-hour-old session cannot read private data, even with its unexpired access token", async () => {
    const current = await session();
    try {
      execFileSync(
        "docker",
        ["exec", "-i", "supabase_db_TutorPlus", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
        {
          input: `update auth.sessions set created_at = statement_timestamp() - interval '24 hours' where id = '${current.sessionId}'::uuid and user_id = '${current.ownerId}'::uuid;`,
          stdio: ["pipe", "ignore", "pipe"],
        },
      );
      await assertPrivateDataDenied(current.client, current.ownerId);
      const refresh = await current.client.auth.refreshSession();
      if (!refresh.error) await assertPrivateDataDenied(current.client, current.ownerId);
    } finally {
      await current.client.auth.signOut({ scope: "local" });
    }
  });

  it("revoked session cannot read private data when its access token is replayed", async () => {
    const current = await session();
    expect((await current.client.auth.signOut({ scope: "local" })).error).toBeNull();
    const replay = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${current.token}` } },
    });
    await assertPrivateDataDenied(replay, current.ownerId);
  });
});
