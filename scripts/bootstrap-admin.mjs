import { stat } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

async function main() {
  if (!process.argv.includes("--confirm")) throw new Error("Use npm run bootstrap:admin -- --confirm only after reviewing the bootstrap RPC. Load secrets from a protected .env.local, never command arguments.");
  const envFile = await stat(new URL("../.env.local", import.meta.url));
  if ((envFile.mode & 0o077) !== 0) throw new Error("Protect .env.local with chmod 600 before privileged bootstrap.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const target = process.env.BOOTSTRAP_ADMIN_USER_ID;
  if (!url || !key || !target || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) throw new Error("Set the Supabase URL, server-only service role key, and target UUID in .env.local.");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.admin.getUserById(target);
  if (error || !data.user?.email_confirmed_at) throw new Error("Bootstrap requires an existing email-verified adult account.");
  const profile = await client.from("profiles").select("status,adult_attested").eq("id", target).single();
  if (profile.error || profile.data?.status !== "active" || profile.data?.adult_attested !== true) throw new Error("Bootstrap target must be an active provisioned adult account.");
  const result = await client.rpc("bootstrap_initial_admin", { target });
  if (result.error) throw new Error("Initial administrator bootstrap was denied. Check the migration and server audit privately; no grant is confirmed.");
  const verified = await client.from("user_roles").select("role").eq("user_id", target).eq("role", "administrator").single();
  if (verified.error || verified.data?.role !== "administrator") throw new Error("Could not confirm the initial administrator grant.");
  console.log("Initial administrator grant recorded and read back. Remove the bootstrap key from the application environment when finished.");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Bootstrap failed; no administrator grant is confirmed."); process.exitCode = 1; });
