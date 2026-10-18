import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { DomainError, providerError } from "../shared/errors";
import { PgErrorCode } from "../shared/postgres";
import { assertSessionAge, requireRole, resolveActor, type Actor } from "./policy";
import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  oauthProviders,
  parseEmail,
  parseOnboarding,
  parseOtp,
  parseProvider,
  parseRoleChange,
  parseSignup,
  parseStatusChange,
  type OAuthProvider,
} from "./validation";

export const AUTH_CALLBACK_PATH = "/auth/callback";

export type OnboardingStatus =
  { state: "required"; suggestedName: string } | { state: "complete" } | { state: "inactive" };

function callbackUrl(origin: string): string {
  return `${origin}${AUTH_CALLBACK_PATH}`;
}

async function requireVerifiedUser(client: SupabaseClient): Promise<User> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new DomainError("unauthenticated");
  if (!data.user.email_confirmed_at) throw new DomainError("unverified");
  return data.user;
}

/** The single authorization gate: every protected operation resolves its actor from current database state. */
export async function getActor(client: SupabaseClient): Promise<Actor> {
  const user = await requireVerifiedUser(client);
  const [profile, grants, session] = await Promise.all([
    client.from("profiles").select("status,adult_attested").eq("id", user.id).single(),
    client.from("user_roles").select("role").eq("user_id", user.id),
    client.rpc("current_session_started_at"),
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
    id: user.id,
    emailConfirmed: true,
    status: profile.data.status,
    adultAttested: profile.data.adult_attested,
    roles: (grants.data ?? []).map((grant) => grant.role),
    sessionStartedAt: session.data,
  });
}

export async function register(client: SupabaseClient, form: FormData, origin: string): Promise<void> {
  const { email, password, role_intent, ...profile } = parseSignup(form);
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { ...profile, initial_role: role_intent }, emailRedirectTo: callbackUrl(origin) },
  });
  if (error) throw providerError(error);
  // A session here means email confirmation is disabled, which this application does not support.
  if (data.session) {
    await client.auth.signOut({ scope: "local" });
    throw new DomainError("configuration");
  }
}

export async function changeRole(client: SupabaseClient, form: FormData): Promise<void> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  const { operation, ...parameters } = parseRoleChange(form);
  const { error } = await client.rpc(operation === "grant" ? "grant_user_role" : "revoke_user_role", parameters);
  if (error) throw new DomainError("unavailable");
}

export async function changeAccountStatus(client: SupabaseClient, form: FormData): Promise<void> {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  const parameters = parseStatusChange(form);
  if (parameters.target === actor.id) throw new DomainError("forbidden");
  const { error } = await client.rpc("set_user_status", parameters);
  if (error) throw new DomainError("unavailable");
}

function suggestDisplayName(metadata: Record<string, unknown>): string {
  const candidates = [metadata.display_name, metadata.full_name, metadata.name, metadata.user_name];
  const suggested = candidates.find(
    (value): value is string => typeof value === "string" && value.trim().length >= DISPLAY_NAME_MIN,
  );
  return suggested?.trim().slice(0, DISPLAY_NAME_MAX) ?? "";
}

export async function onboardingStatus(client: SupabaseClient): Promise<OnboardingStatus> {
  const user = await requireVerifiedUser(client);
  const { data: state, error } = await client.rpc("onboarding_state");
  if (error) throw new DomainError("unavailable");
  if (state === null) throw new DomainError("expired");
  if (state === "complete") return { state };
  if (state !== "required") return { state: "inactive" };
  return { state, suggestedName: suggestDisplayName(user.user_metadata ?? {}) };
}

export async function completeOnboarding(client: SupabaseClient, form: FormData): Promise<void> {
  const status = await onboardingStatus(client);
  if (status.state !== "required") throw new DomainError("forbidden");
  const { error } = await client.rpc("complete_onboarding", parseOnboarding(form));
  if (error) {
    throw new DomainError(error.code === PgErrorCode.invalidParameterValue ? "validation" : "unavailable");
  }
}

/** Reads Supabase Auth's public settings so provider buttons only appear once the provider is configured. */
export async function enabledProviders(config: { url: string; key: string } | null): Promise<OAuthProvider[]> {
  if (!config) return [];
  try {
    const response = await fetch(`${config.url}/auth/v1/settings`, {
      headers: { apikey: config.key },
      next: { revalidate: 60 },
    });
    if (!response.ok) return [];
    const settings = (await response.json()) as { external?: Record<string, unknown> } | null;
    return oauthProviders.filter((provider) => settings?.external?.[provider] === true);
  } catch {
    // Provider discovery is optional; password and email-code sign-in still work without it.
    return [];
  }
}

export async function startOAuth(
  client: SupabaseClient,
  form: FormData,
  origin: string,
  enabled: readonly OAuthProvider[],
): Promise<string> {
  const provider = parseProvider(form);
  if (!enabled.includes(provider)) throw new DomainError("unavailable");
  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: { redirectTo: callbackUrl(origin), skipBrowserRedirect: true },
  });
  if (error || !data.url) throw new DomainError("unavailable");
  return data.url;
}

/** Unknown or ineligible addresses are reported the same way as sent codes so accounts cannot be enumerated. */
const NON_ENUMERATING_OTP_ERRORS = new Set(["otp_disabled", "signup_disabled"]);

export async function requestEmailCode(client: SupabaseClient, form: FormData, origin: string): Promise<string> {
  const email = parseEmail(form);
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: callbackUrl(origin) },
  });
  if (error && error.status !== 422 && !NON_ENUMERATING_OTP_ERRORS.has(error.code ?? "")) {
    throw providerError(error);
  }
  return email;
}

export async function verifyEmailCode(client: SupabaseClient, form: FormData): Promise<void> {
  const email = parseEmail(form);
  const token = parseOtp(form);
  const { error } = await client.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw new DomainError("credentials");
}

export async function requestPasswordReset(client: SupabaseClient, form: FormData, origin: string): Promise<void> {
  const email = parseEmail(form);
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/reset-password` });
  if (error) throw providerError(error);
}

export async function resendVerification(client: SupabaseClient, form: FormData, origin: string): Promise<void> {
  const email = parseEmail(form);
  const { error } = await client.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: callbackUrl(origin) },
  });
  if (error) throw providerError(error);
}
