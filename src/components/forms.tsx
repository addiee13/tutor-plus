"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction, loginAction, logoutAction, profileAction, roleAction, statusAction, resetAction, resendAction, passwordAction, oauthAction, codeRequestAction, codeVerifyAction, onboardingAction } from "@/app/actions";
import type { ActionState } from "@/domains/shared/errors";
import type { OAuthProvider } from "@/domains/auth/validation";

const initial: ActionState = { message: "" };
type FieldProps = { label: string; name: string; error?: string; type?: string; autoComplete?: string; defaultValue?: string; hint?: string; minLength?: number; maxLength?: number; inputMode?: "numeric" | "email" | "text"; pattern?: string };

function Field({ label, name, error, hint, ...props }: FieldProps) {
  return <div className="field"><label htmlFor={name}>{label}</label><input id={name} name={name} required aria-invalid={!!error} aria-describedby={error || hint ? `${name}-help` : undefined} {...props} />{(error || hint) && <span id={`${name}-help`} className={error ? "field-error" : "hint"}>{error || hint}</span>}</div>;
}

function Result({ state }: { state: ActionState }) {
  return state.message ? <div className={`notice ${state.success ? "success" : "warning"}`} role={state.success ? "status" : "alert"}>{state.message}</div> : null;
}

function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return <button className="button primary" disabled={pending} type="submit">{pending ? "Please wait…" : children}<span aria-hidden="true">→</span></button>;
}

export function SignupForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(signupAction, initial);
  return <form action={action} className="form"><fieldset disabled={!configured || pending} className="form-fields"><Field label="Display name" name="display_name" autoComplete="name" minLength={2} maxLength={80} error={state.fields?.display_name} /><Field label="Email address" name="email" type="email" autoComplete="email" error={state.fields?.email} /><Field label="Password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} hint="At least 12 characters. Use a unique password." error={state.fields?.password} /><div className="field"><label htmlFor="role_intent">I’m here to</label><select id="role_intent" name="role_intent" defaultValue="student"><option value="student">Learn as a student</option><option value="tutor">Teach as a tutor</option></select>{state.fields?.role_intent && <span className="field-error">{state.fields.role_intent}</span>}</div><Field label="Time zone" name="timezone" defaultValue="America/New_York" hint="IANA format, for example America/New_York or Europe/London." error={state.fields?.timezone} /><label className="checkbox"><input type="checkbox" name="adult_attested" required /><span>I confirm that I am at least 18 years old.</span></label>{state.fields?.adult_attested && <span className="field-error">{state.fields.adult_attested}</span>}<Submit pending={pending}>Create account</Submit></fieldset><Result state={state} /><p className="form-footer">Already have an account? <Link href="/login">Sign in</Link></p></form>;
}

export function LoginForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(loginAction, initial);
  return <form action={action} className="form"><fieldset disabled={!configured || pending} className="form-fields"><Field label="Email address" name="email" type="email" autoComplete="email" error={state.fields?.email} /><Field label="Password" name="password" type="password" autoComplete="current-password" maxLength={128} error={state.fields?.password} /><Link className="small-link" href="/reset-password">Forgot your password?</Link><Submit pending={pending}>Sign in</Submit></fieldset><Result state={state} /><p className="form-footer">New to Tutor Plus? <Link href="/signup">Create an account</Link></p><p className="hint">Still waiting for verification? <Link href="/check-email">Request a new link</Link></p></form>;
}

const providerNames: Record<OAuthProvider, string> = { github: "GitHub", google: "Google" };

export function AltSignIn({ configured, providers, showCode = true }: { configured: boolean; providers: readonly OAuthProvider[]; showCode?: boolean }) {
  const [state, action, pending] = useActionState(oauthAction, initial);
  if (!providers.length && !showCode) return null;
  return <div className="alt-signin"><p className="divider"><span>or</span></p><form action={action} className="form"><fieldset disabled={!configured || pending} className="form-fields alt-buttons">{providers.map((provider) => <button key={provider} className="button secondary" type="submit" name="provider" value={provider}>Continue with {providerNames[provider]}</button>)}{showCode && <Link className="button secondary" href="/login?method=code">Email me a code</Link>}</fieldset><Result state={state} /></form></div>;
}

export function CodeSignInForm({ configured }: { configured: boolean }) {
  const [sent, request, requesting] = useActionState(codeRequestAction, initial);
  const [verified, verify, verifying] = useActionState(codeVerifyAction, initial);
  const email = sent.values?.email ?? "";
  if (!sent.success) return <form action={request} className="form"><fieldset disabled={!configured || requesting} className="form-fields"><Field label="Email address" name="email" type="email" autoComplete="email" defaultValue={email} hint="We’ll email a one-time code to an existing Tutor Plus account." error={sent.fields?.email} /><Submit pending={requesting}>Email me a code</Submit></fieldset><Result state={sent} /><p className="form-footer"><Link href="/login">Sign in with a password instead</Link></p><p className="hint">New to Tutor Plus? <Link href="/signup">Create an account</Link></p></form>;
  return <form action={verify} className="form"><Result state={sent} /><input type="hidden" name="email" value={email} /><fieldset disabled={!configured || verifying} className="form-fields"><Field label="Sign-in code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" minLength={6} maxLength={8} hint={`Enter the code sent to ${email}. It expires in one hour; the link in the same email also works in this browser.`} error={verified.fields?.code} /><Submit pending={verifying}>Verify and sign in</Submit></fieldset><Result state={verified} /><p className="form-footer"><a href="/login?method=code">Use a different email</a></p></form>;
}

export function OnboardingForm({ suggestedName }: { suggestedName: string }) {
  const [state, action, pending] = useActionState(onboardingAction, initial);
  return <form action={action} className="form"><fieldset disabled={pending} className="form-fields"><Field label="Display name" name="display_name" autoComplete="name" minLength={2} maxLength={80} defaultValue={state.values?.display_name ?? suggestedName} error={state.fields?.display_name} /><div className="field"><label htmlFor="role_intent">I’m here to</label><select id="role_intent" name="role_intent" defaultValue={state.values?.role_intent || "student"}><option value="student">Learn as a student</option><option value="tutor">Teach as a tutor</option></select>{state.fields?.role_intent && <span className="field-error">{state.fields.role_intent}</span>}</div><Field label="Time zone" name="timezone" defaultValue={state.values?.timezone ?? "America/New_York"} hint="IANA format, for example America/New_York or Europe/London." error={state.fields?.timezone} /><label className="checkbox"><input type="checkbox" name="adult_attested" required /><span>I confirm that I am at least 18 years old.</span></label>{state.fields?.adult_attested && <span className="field-error">{state.fields.adult_attested}</span>}<Submit pending={pending}>Finish setting up</Submit></fieldset><Result state={state} /></form>;
}

export function EmailForm({ kind, configured }: { kind: "reset" | "resend"; configured: boolean }) {
  const [state, action, pending] = useActionState(kind === "reset" ? resetAction : resendAction, initial);
  return <form className="form" action={action}><fieldset className="form-fields" disabled={!configured || pending}><Field label="Email address" name="email" type="email" autoComplete="email" error={state.fields?.email} /><Submit pending={pending}>{kind === "reset" ? "Request reset link" : "Resend verification link"}</Submit></fieldset><Result state={state} /><Link href="/login" className="small-link">Back to sign in</Link></form>;
}

export function ProfileForm({ profile }: { profile: { display_name: string; timezone: string } }) {
  const [state, action, pending] = useActionState(profileAction, initial);
  return <form className="form" action={action}><fieldset className="form-fields" disabled={pending}><Field label="Display name" name="display_name" defaultValue={profile.display_name} minLength={2} maxLength={80} autoComplete="name" error={state.fields?.display_name} /><Field label="Time zone" name="timezone" defaultValue={profile.timezone} hint="Use an IANA time zone. We store your preference, not your location." error={state.fields?.timezone} /><Submit pending={pending}>Save profile</Submit></fieldset><Result state={state} /></form>;
}

export function RoleForm() {
  const [state, action, pending] = useActionState(roleAction, initial);
  return <form className="form" action={action}><fieldset className="form-fields" disabled={pending}><Field label="Account user ID" name="target" hint="Use the verified account’s UUID. No email or password is needed." error={state.fields?.target} /><div className="field"><label htmlFor="requested_role">Capability</label><select id="requested_role" name="requested_role"><option value="student">Student</option><option value="tutor">Tutor</option><option value="administrator">Administrator</option></select></div><div className="field"><label htmlFor="operation">Operation</label><select id="operation" name="operation"><option value="grant">Grant role</option><option value="revoke">Revoke role</option></select></div><Submit pending={pending}>Record role change</Submit></fieldset><Result state={state} /></form>;
}

export function LogoutForm() {
  const [state, action, pending] = useActionState(logoutAction, initial);
  return <form action={action} className="logout-form"><button className="button subtle" type="submit" disabled={pending}>{pending ? "Signing out…" : "Sign out"}</button><Result state={state} /></form>;
}

export function AccountStatusForm() {
  const [state, action, pending] = useActionState(statusAction, initial);
  return <form className="form" action={action}><fieldset className="form-fields" disabled={pending}><Field label="Account user ID" name="status_target" error={state.fields?.status_target} /><div className="field"><label htmlFor="requested_status">Account status</label><select id="requested_status" name="requested_status"><option value="inactive">Deactivate account</option><option value="active">Reactivate account</option></select></div><Field label="Reason for this change" name="reason" maxLength={500} error={state.fields?.reason} hint="Required for the audit trail. Your own account cannot be changed here." /><Submit pending={pending}>Record status change</Submit></fieldset><Result state={state} /></form>;
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(passwordAction, initial);
  return <form className="form" action={action}><fieldset className="form-fields" disabled={pending}><Field label="New password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} error={state.fields?.password} /><Submit pending={pending}>Update password</Submit></fieldset><Result state={state} /></form>;
}
