"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createUserClient } from "@/lib/supabase/server";
import { publicConfig, siteUrl } from "@/lib/supabase/config";
import { changeAccountStatus, changeRole, completeOnboarding, enabledProviders, getActor, register, requestEmailCode, startOAuth, verifyEmailCode } from "@/domains/auth/service";
import { InputError, parseEmail, parsePassword } from "@/domains/auth/validation";
import { DomainError, providerError, safeMessage, type ActionState } from "@/domains/shared/errors";
import { saveOwnProfile } from "@/domains/profiles/service";

function failed(error: unknown, values?: Record<string, string>): ActionState {
  return { message: safeMessage(error), fields: error instanceof InputError ? error.fields : undefined, values };
}

export async function signupAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try { await register(await createUserClient(), form, siteUrl()); } catch (error) { return failed(error); }
  redirect("/check-email");
}

// Every completed sign-in passes the same getActor gate; un-onboarded identities keep their session for /welcome.
async function admit(client: Awaited<ReturnType<typeof createUserClient>>): Promise<"/dashboard" | "/welcome"> {
  try { await getActor(client); return "/dashboard"; } catch (actorError) {
    if (actorError instanceof DomainError && actorError.code === "onboarding") return "/welcome";
    await client.auth.signOut({ scope: "local" });
    throw actorError;
  }
}

export async function loginAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  let destination: string;
  try {
    const email = parseEmail(form);
    const password = parsePassword(form, false);
    const client = await createUserClient();
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new DomainError("credentials");
    destination = await admit(client);
  } catch (error) { return failed(error); }
  redirect(destination);
}

export async function oauthAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  let url: string;
  try { url = await startOAuth(await createUserClient(), form, siteUrl(), await enabledProviders(publicConfig())); } catch (error) { return failed(error); }
  redirect(url);
}

export async function codeRequestAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const email = await requestEmailCode(await createUserClient(), form, siteUrl());
    return { success: true, message: "If an account uses this email, a sign-in code is on its way. Check your inbox and spam folder.", values: { email } };
  } catch (error) { return failed(error); }
}

export async function codeVerifyAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const values = { email: String(form.get("email") ?? "") };
  let destination: string;
  try {
    const client = await createUserClient();
    await verifyEmailCode(client, form);
    destination = await admit(client);
  } catch (error) { return failed(error, values); }
  redirect(destination);
}

export async function onboardingAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const values = { display_name: String(form.get("display_name") ?? ""), timezone: String(form.get("timezone") ?? ""), role_intent: String(form.get("role_intent") ?? "") };
  try {
    const client = await createUserClient();
    await completeOnboarding(client, form);
    await getActor(client);
    revalidatePath("/dashboard");
  } catch (error) { return failed(error, values); }
  redirect("/dashboard");
}

export async function logoutAction(): Promise<ActionState> {
  try {
    const client = await createUserClient();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw new DomainError("unavailable");
  } catch (error) { return failed(error); }
  redirect("/login?notice=signed-out");
}

export async function profileAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const values = { display_name: String(form.get("display_name") ?? ""), timezone: String(form.get("timezone") ?? "") };
  try {
    const saved = await saveOwnProfile(await createUserClient(), form);
    revalidatePath("/profile");
    revalidatePath("/dashboard");
    return { success: true, message: "Your profile is saved. These details will still be here when you return.", values: { display_name: saved.display_name, timezone: saved.timezone } };
  } catch (error) { return failed(error, values); }
}

export async function roleAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await changeRole(await createUserClient(), form);
    revalidatePath("/admin");
    revalidatePath("/dashboard");
    return { success: true, message: "Role change recorded. Access is checked again on each protected operation." };
  } catch (error) { return failed(error); }
}

export async function statusAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await changeAccountStatus(await createUserClient(), form);
    revalidatePath("/admin");
    return { success: true, message: "Account status change recorded. Inactive accounts are denied access; existing records are retained." };
  } catch (error) { return failed(error); }
}

export async function resetAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const email = parseEmail(form);
    const client = await createUserClient();
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl()}/auth/reset-password` });
    if (error) throw providerError(error, "password reset email");
    return { success: true, message: "If an eligible account exists, a reset link has been requested. Check your inbox and spam folder." };
  } catch (error) { return failed(error); }
}

export async function resendAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const email = parseEmail(form);
    const client = await createUserClient();
    const { error } = await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${siteUrl()}/auth/callback` } });
    if (error) throw providerError(error, "verification resend");
    return { success: true, message: "If verification is still needed, a new link has been requested. Delivery may take a few minutes." };
  } catch (error) { return failed(error); }
}

export async function passwordAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const password = parsePassword(form);
    const client = await createUserClient();
    await getActor(client);
    const { error } = await client.auth.updateUser({ password });
    if (error) throw new DomainError("unavailable");
    const { error: logoutError } = await client.auth.signOut({ scope: "global" });
    if (logoutError) return { success: true, message: "Your password changed, but we couldn’t end every session. Please sign out and sign in again." };
  } catch (error) { return failed(error); }
  redirect("/login?notice=password-updated");
}
