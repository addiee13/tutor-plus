import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, providerError } from "../shared/errors";
import { assertSessionAge, resolveActor, requireRole } from "./policy";
import { oauthProviders, parseEmail, parseOnboarding, parseOtp, parseProvider, parseRoleChange, parseSignup, parseStatusChange, type OAuthProvider } from "./validation";

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
  if (profile.error || !profile.data) {
    // RLS hides profiles that have not attested 18+; OAuth and code-only identities land here until onboarded.
    const { data: state } = await client.rpc("onboarding_state");
    throw new DomainError(state === "required" ? "onboarding" : "forbidden");
  }
  if (grants.error) throw new DomainError("forbidden");
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
  if (error) throw providerError(error, "sign-up");
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

export type OnboardingStatus = { state: "required"; suggestedName: string } | { state: "complete" } | { state: "inactive" };

export async function onboardingStatus(client: SupabaseClient): Promise<OnboardingStatus> {
  const { data: identity, error: identityError } = await client.auth.getUser();
  if (identityError || !identity.user) throw new DomainError("unauthenticated");
  if (!identity.user.email_confirmed_at) throw new DomainError("unverified");
  const { data: state, error } = await client.rpc("onboarding_state");
  if (error) throw new DomainError("unavailable");
  if (state === null) throw new DomainError("expired");
  if (state === "complete") return { state };
  if (state !== "required") return { state: "inactive" };
  const metadata = identity.user.user_metadata ?? {};
  const suggested = [metadata.display_name, metadata.full_name, metadata.name, metadata.user_name].find((value) => typeof value === "string" && value.trim().length >= 2);
  return { state, suggestedName: typeof suggested === "string" ? suggested.trim().slice(0, 80) : "" };
}

export async function completeOnboarding(client: SupabaseClient, form: FormData) {
  const status = await onboardingStatus(client);
  if (status.state !== "required") throw new DomainError("forbidden");
  const { error } = await client.rpc("complete_onboarding", parseOnboarding(form));
  if (error) throw new DomainError(error.code === "22023" ? "validation" : "unavailable");
}

// Reads Supabase Auth's public settings so provider buttons only appear once the provider is configured.
export async function enabledProviders(config: { url: string; key: string } | null): Promise<OAuthProvider[]> {
  if (!config) return [];
  try {
    const response = await fetch(`${config.url}/auth/v1/settings`, { headers: { apikey: config.key }, next: { revalidate: 60 } });
    if (!response.ok) return [];
    const settings = await response.json();
    return oauthProviders.filter((provider) => settings?.external?.[provider] === true);
  } catch { return []; }
}

export async function startOAuth(client: SupabaseClient, form: FormData, origin: string, enabled: readonly OAuthProvider[]): Promise<string> {
  const provider = parseProvider(form);
  if (!enabled.includes(provider)) throw new DomainError("unavailable");
  const { data, error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: `${origin}/auth/callback`, skipBrowserRedirect: true } });
  if (error || !data.url) throw new DomainError("unavailable");
  return data.url;
}

export async function requestEmailCode(client: SupabaseClient, form: FormData, origin: string): Promise<string> {
  const email = parseEmail(form);
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` } });
  // Unknown or ineligible addresses are reported the same way as sent codes so accounts cannot be enumerated.
  if (error && error.status !== 422 && error.code !== "otp_disabled" && error.code !== "signup_disabled") throw providerError(error, "email code");
  return email;
}

export async function verifyEmailCode(client: SupabaseClient, form: FormData) {
  const email = parseEmail(form);
  const token = parseOtp(form);
  const { error } = await client.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw new DomainError("credentials");
}
