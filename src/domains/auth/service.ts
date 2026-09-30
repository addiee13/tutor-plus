import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError } from "../shared/errors";
import { assertSessionAge, resolveActor, requireRole } from "./policy";
import { parseRoleChange, parseSignup, parseStatusChange } from "./validation";

export async function getActor(client: SupabaseClient) {
  const { data: identity, error: identityError } = await client.auth.getUser();
  if (identityError || !identity.user) throw new DomainError("unauthenticated");
  if (!identity.user.email_confirmed_at) throw new DomainError("unverified");
  const [profile, grants, session] = await Promise.all([
    client.from("profiles").select("status,adult_attested").eq("id", identity.user.id).single(),
    client.from("user_roles").select("role").eq("user_id", identity.user.id),
    client.rpc("current_session_started_at")
  ]);
  if (session.error) throw new DomainError("unavailable");
  assertSessionAge(session.data);
  if (profile.error || grants.error || !profile.data) throw new DomainError("forbidden");
  return resolveActor({
    id: identity.user.id,
    emailConfirmed: !!identity.user.email_confirmed_at,
    status: profile.data.status,
    adultAttested: profile.data.adult_attested,
    roles: (grants.data ?? []).map((grant) => grant.role),
    sessionStartedAt: session.data
  });
}

export async function register(client: SupabaseClient, form: FormData, origin: string) {
  const { email, password, role_intent, ...profile } = parseSignup(form);
  const { data, error } = await client.auth.signUp({ email, password, options: { data: { ...profile, initial_role: role_intent }, emailRedirectTo: `${origin}/auth/callback` } });
  if (error) throw new DomainError("unavailable");
  if (data.session) {
    await client.auth.signOut({ scope: "local" });
    throw new DomainError("configuration");
  }
}

export async function changeRole(client: SupabaseClient, form: FormData) {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  const { operation, ...parameters } = parseRoleChange(form);
  const { error } = await client.rpc(operation === "grant" ? "grant_user_role" : "revoke_user_role", parameters);
  if (error) throw new DomainError("unavailable");
}

export async function changeAccountStatus(client: SupabaseClient, form: FormData) {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  const parameters = parseStatusChange(form);
  if (parameters.target === actor.id) throw new DomainError("forbidden");
  const { error } = await client.rpc("set_user_status", parameters);
  if (error) throw new DomainError("unavailable");
}
