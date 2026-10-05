import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.SUPABASE_TEST_EMAIL;
const password = process.env.SUPABASE_TEST_PASSWORD;
const enabled = !!(url && key && email && password);
const mutations = enabled && process.env.SUPABASE_TEST_ALLOW_MUTATIONS === "true";

describe.skipIf(!enabled)("LIVE UC-01/UC-02 Supabase: requires disposable configured verified identities", () => {
  let client: SupabaseClient;
  let anonymous: SupabaseClient;
  let ownerId: string;
  beforeAll(async () => {
    client = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
    anonymous = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await client.auth.signInWithPassword({ email: email!, password: password! });
    expect(login.error).toBeNull();
    expect(login.data.user?.email_confirmed_at).toBeTruthy();
    ownerId = login.data.user!.id;
  });
  afterAll(async () => { await client?.auth.signOut({ scope: "local" }); });

  it("loads its real provisioned active adult profile and database role", async () => {
    const profile = await client.from("profiles").select("id,status,adult_attested").eq("id", ownerId).single();
    expect(profile.error).toBeNull();
    expect(profile.data).toMatchObject({ id: ownerId, status: "active", adult_attested: true });
    const grants = await client.from("user_roles").select("role").eq("user_id", ownerId);
    expect(grants.error).toBeNull();
    expect(grants.data?.some((grant) => ["student", "tutor"].includes(grant.role))).toBe(true);
    expect(grants.data?.some((grant) => grant.role === "administrator")).toBe(false);
  });

  it("retains the same trusted session start through token refresh", async () => {
    const first = await client.rpc("current_session_started_at");
    expect(first.error).toBeNull(); expect(first.data).toBeTruthy();
    expect((await client.auth.refreshSession()).error).toBeNull();
    const second = await client.rpc("current_session_started_at");
    expect(second.error).toBeNull(); expect(second.data).toBe(first.data);
  });

  it("denies anonymous access to private profiles and role grants", async () => {
    for (const table of ["profiles", "user_roles"]) {
      const result = await anonymous.from(table).select("*");
      expect(result.error !== null || result.data?.length === 0).toBe(true);
    }
  });

  it.skipIf(!mutations)("persists and reloads an owner edit, restoring the test record", async () => {
    const original = await client.from("profiles").select("display_name,timezone").eq("id", ownerId).single();
    expect(original.error).toBeNull();
    try {
      const write = await client.from("profiles").update({ display_name: "Integration Learner", timezone: "Europe/London" }).eq("id", ownerId).select("display_name,timezone").single();
      expect(write.error).toBeNull();
      const reloaded = await client.from("profiles").select("display_name,timezone").eq("id", ownerId).single();
      expect(reloaded.data).toEqual({ display_name: "Integration Learner", timezone: "Europe/London" });
    } finally {
      const restored = await client.from("profiles").update(original.data!).eq("id", ownerId);
      expect(restored.error).toBeNull();
    }
  });

  it.skipIf(!mutations)("denies self-admin grants, role-table writes and protected profile fields", async () => {
    const role = await client.from("user_roles").insert({ user_id: ownerId, role: "administrator" });
    expect(role.error).not.toBeNull();
    const rpc = await client.rpc("grant_user_role", { target: ownerId, requested_role: "administrator" });
    expect(rpc.error).not.toBeNull();
    const profile = await client.from("profiles").update({ status: "inactive", adult_attested: false }).eq("id", ownerId);
    expect(profile.error).not.toBeNull();
  });

  it.skipIf(!mutations)("editable auth metadata never grants administrator authority", async () => {
    const identity = await client.auth.getUser();
    const original = identity.data.user?.user_metadata ?? {};
    try {
      expect((await client.auth.updateUser({ data: { role: "administrator", role_intent: "administrator" } })).error).toBeNull();
      const grants = await client.from("user_roles").select("role").eq("user_id", ownerId);
      expect(grants.data?.some((grant) => grant.role === "administrator")).toBe(false);
    } finally {
      expect((await client.auth.updateUser({ data: { ...original, role: original.role ?? null, role_intent: original.role_intent ?? null } })).error).toBeNull();
    }
  });

  it.skipIf(!(process.env.SUPABASE_OTHER_TEST_EMAIL && process.env.SUPABASE_OTHER_TEST_PASSWORD && mutations))("denies another account’s profile reads and writes", async () => {
    const other = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
    try {
      const login = await other.auth.signInWithPassword({ email: process.env.SUPABASE_OTHER_TEST_EMAIL!, password: process.env.SUPABASE_OTHER_TEST_PASSWORD! });
      expect(login.error).toBeNull();
      expect(login.data.user!.id).not.toBe(ownerId);
      const read = await other.from("profiles").select("id").eq("id", ownerId);
      expect(read.error !== null || read.data?.length === 0).toBe(true);
      const write = await other.from("profiles").update({ display_name: "Unauthorized" }).eq("id", ownerId).select("id");
      expect(write.error !== null || write.data?.length === 0).toBe(true);
    } finally { await other.auth.signOut({ scope: "local" }); }
  });

  it.skipIf(!(process.env.SUPABASE_UNVERIFIED_TEST_EMAIL && process.env.SUPABASE_UNVERIFIED_TEST_PASSWORD))("does not allow an unverified identity to sign in", async () => {
    const unverified = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await unverified.auth.signInWithPassword({ email: process.env.SUPABASE_UNVERIFIED_TEST_EMAIL!, password: process.env.SUPABASE_UNVERIFIED_TEST_PASSWORD! });
    expect(login.error).not.toBeNull(); expect(login.data.session).toBeNull();
  });

  it("logout removes this test session", async () => {
    expect((await client.auth.signOut({ scope: "local" })).error).toBeNull();
    expect((await client.auth.getUser()).data.user).toBeNull();
  });
});
