import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const enabled = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  process.env.SUPABASE_ADMIN_TEST_EMAIL &&
  process.env.SUPABASE_ADMIN_TEST_PASSWORD &&
  process.env.SUPABASE_TEST_USER_ID &&
  process.env.SUPABASE_TEST_ALLOW_MUTATIONS === "true"
);

describe.skipIf(!enabled)("LIVE verified administrator narrow audited RPCs", () => {
  it("current administrator role grants and revokes a capability with audit records", async () => {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const target = process.env.SUPABASE_TEST_USER_ID!;
    const started = new Date().toISOString();
    const login = await client.auth.signInWithPassword({
      email: process.env.SUPABASE_ADMIN_TEST_EMAIL!,
      password: process.env.SUPABASE_ADMIN_TEST_PASSWORD!,
    });
    expect(login.error).toBeNull();
    try {
      const authority = await client.from("user_roles").select("role").eq("user_id", login.data.user!.id);
      expect(authority.data?.some((grant) => grant.role === "administrator")).toBe(true);
      expect((await client.rpc("grant_user_role", { target, requested_role: "tutor" })).error).toBeNull();
      const grants = await client
        .from("user_roles")
        .select("role,granted_by")
        .eq("user_id", target)
        .eq("role", "tutor");
      expect(grants.error).toBeNull();
      expect(grants.data).toEqual([{ role: "tutor", granted_by: login.data.user!.id }]);
      expect((await client.rpc("revoke_user_role", { target, requested_role: "tutor" })).error).toBeNull();
      const removed = await client.from("user_roles").select("role").eq("user_id", target).eq("role", "tutor");
      expect(removed.data).toEqual([]);
      const audit = await client
        .from("audit_logs")
        .select("action")
        .eq("actor_id", login.data.user!.id)
        .eq("entity_id", target)
        .gte("created_at", started);
      expect(audit.error).toBeNull();
      expect(audit.data?.map((entry) => entry.action)).toEqual(
        expect.arrayContaining(["role.granted", "role.revoked"]),
      );
    } finally {
      await client.rpc("revoke_user_role", { target, requested_role: "tutor" });
      await client.auth.signOut({ scope: "local" });
    }
  });
});
