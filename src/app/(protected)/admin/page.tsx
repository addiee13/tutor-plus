import { redirect } from "next/navigation";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { requireRole } from "@/domains/auth/policy";
export default async function Admin() {
  if (!publicConfig()) return null;
  const { actor } = await protectedContext();
  requireRole(actor, "administrator");
  redirect("/admin/accounts");
}
