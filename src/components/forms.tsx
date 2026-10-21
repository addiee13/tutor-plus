"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  codeRequestAction,
  codeVerifyAction,
  loginAction,
  logoutAction,
  oauthAction,
  onboardingAction,
  passwordAction,
  profileAction,
  resendAction,
  resetAction,
  roleAction,
  signupAction,
  statusAction,
} from "@/app/actions";
import { initialActionState as initial } from "@/lib/action-state";
import { MailIcon, ProviderLogo } from "@/components/brand-icons";
import type { OAuthProvider } from "@/domains/auth/validation";
import {
  AdultAttestationField,
  Field,
  FieldError,
  FormResult,
  RoleIntentField,
  SubmitButton,
  TimeZoneField,
} from "./form-controls";

const DEFAULT_TIME_ZONE = "America/New_York";
const providerNames: Record<OAuthProvider, string> = { github: "GitHub", google: "Google" };

type ConfiguredProps = { configured: boolean };

export function SignupForm({ configured }: ConfiguredProps) {
  const [state, action, pending] = useActionState(signupAction, initial);
  return (
    <form action={action} className="form">
      <fieldset disabled={!configured || pending} className="form-fields">
        <Field
          label="Display name"
          name="display_name"
          autoComplete="name"
          minLength={2}
          maxLength={80}
          error={state.fields?.display_name}
        />
        <Field label="Email address" name="email" type="email" autoComplete="email" error={state.fields?.email} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          hint="At least 12 characters. Use a unique password."
          error={state.fields?.password}
        />
        <RoleIntentField error={state.fields?.role_intent} />
        <TimeZoneField defaultValue={DEFAULT_TIME_ZONE} error={state.fields?.timezone} />
        <AdultAttestationField error={state.fields?.adult_attested} />
        <SubmitButton pending={pending}>Create account</SubmitButton>
      </fieldset>
      <FormResult state={state} />
      <p className="form-footer">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}

export function LoginForm({ configured }: ConfiguredProps) {
  const [state, action, pending] = useActionState(loginAction, initial);
  return (
    <form action={action} className="form">
      <fieldset disabled={!configured || pending} className="form-fields">
        <Field label="Email address" name="email" type="email" autoComplete="email" error={state.fields?.email} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          error={state.fields?.password}
        />
        <Link className="small-link" href="/reset-password">
          Forgot your password?
        </Link>
        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </fieldset>
      <FormResult state={state} />
      <p className="form-footer">
        New to Tutor Plus? <Link href="/signup">Create an account</Link>
      </p>
      <p className="hint">
        Still waiting for verification? <Link href="/check-email">Request a new link</Link>
      </p>
    </form>
  );
}

type AltSignInProps = ConfiguredProps & { providers: readonly OAuthProvider[]; showCode?: boolean };

export function AltSignIn({ configured, providers, showCode = true }: AltSignInProps) {
  const [state, action, pending] = useActionState(oauthAction, initial);
  if (!providers.length && !showCode) return null;
  return (
    <div className="alt-signin">
      <p className="divider">
        <span>Or continue with</span>
      </p>
      <form action={action} className="form">
        <fieldset disabled={!configured || pending} className="form-fields alt-buttons">
          {providers.map((provider) => (
            <button key={provider} className="social-button" type="submit" name="provider" value={provider}>
              <ProviderLogo provider={provider} />
              <span>Continue with {providerNames[provider]}</span>
            </button>
          ))}
          {showCode && (
            <Link className="social-button" href="/login?method=code">
              <MailIcon />
              <span>Email me a code</span>
            </Link>
          )}
        </fieldset>
        <FormResult state={state} />
      </form>
    </div>
  );
}

/** Two steps: request a one-time code for an email, then verify the code for that same email. */
export function CodeSignInForm({ configured }: ConfiguredProps) {
  const [sent, request, requesting] = useActionState(codeRequestAction, initial);
  const [verified, verify, verifying] = useActionState(codeVerifyAction, initial);
  const email = sent.values?.email ?? "";

  if (!sent.success) {
    return (
      <form action={request} className="form">
        <fieldset disabled={!configured || requesting} className="form-fields">
          <Field
            label="Email address"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={email}
            hint="We’ll email a one-time code to an existing Tutor Plus account."
            error={sent.fields?.email}
          />
          <SubmitButton pending={requesting}>Email me a code</SubmitButton>
        </fieldset>
        <FormResult state={sent} />
        <p className="form-footer">
          <Link href="/login">Sign in with a password instead</Link>
        </p>
        <p className="hint">
          New to Tutor Plus? <Link href="/signup">Create an account</Link>
        </p>
      </form>
    );
  }

  return (
    <form action={verify} className="form">
      <FormResult state={sent} />
      <input type="hidden" name="email" value={email} />
      <fieldset disabled={!configured || verifying} className="form-fields">
        <Field
          label="Sign-in code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6,8}"
          minLength={6}
          maxLength={8}
          hint={`Enter the code sent to ${email}. It expires in one hour; the link in the same email also works in this browser.`}
          error={verified.fields?.code}
        />
        <SubmitButton pending={verifying}>Verify and sign in</SubmitButton>
      </fieldset>
      <FormResult state={verified} />
      <p className="form-footer">
        {/* A full navigation resets both action states, returning to the request step. */}
        <a href="/login?method=code">Use a different email</a>
      </p>
    </form>
  );
}

export function OnboardingForm({ suggestedName }: { suggestedName: string }) {
  const [state, action, pending] = useActionState(onboardingAction, initial);
  return (
    <form action={action} className="form">
      <fieldset disabled={pending} className="form-fields">
        <Field
          label="Display name"
          name="display_name"
          autoComplete="name"
          minLength={2}
          maxLength={80}
          defaultValue={state.values?.display_name ?? suggestedName}
          error={state.fields?.display_name}
        />
        <RoleIntentField defaultValue={state.values?.role_intent || "student"} error={state.fields?.role_intent} />
        <TimeZoneField defaultValue={state.values?.timezone ?? DEFAULT_TIME_ZONE} error={state.fields?.timezone} />
        <AdultAttestationField error={state.fields?.adult_attested} />
        <SubmitButton pending={pending}>Finish setting up</SubmitButton>
      </fieldset>
      <FormResult state={state} />
    </form>
  );
}

export function EmailForm({ kind, configured }: ConfiguredProps & { kind: "reset" | "resend" }) {
  const [state, action, pending] = useActionState(kind === "reset" ? resetAction : resendAction, initial);
  return (
    <form className="form" action={action}>
      <fieldset className="form-fields" disabled={!configured || pending}>
        <Field label="Email address" name="email" type="email" autoComplete="email" error={state.fields?.email} />
        <SubmitButton pending={pending}>
          {kind === "reset" ? "Request reset link" : "Resend verification link"}
        </SubmitButton>
      </fieldset>
      <FormResult state={state} />
      <Link href="/login" className="small-link">
        Back to sign in
      </Link>
    </form>
  );
}

export function ProfileForm({ profile }: { profile: { display_name: string; timezone: string } }) {
  const [state, action, pending] = useActionState(profileAction, initial);
  return (
    <form className="form" action={action}>
      <fieldset className="form-fields" disabled={pending}>
        <Field
          label="Display name"
          name="display_name"
          defaultValue={profile.display_name}
          minLength={2}
          maxLength={80}
          autoComplete="name"
          error={state.fields?.display_name}
        />
        <TimeZoneField
          defaultValue={profile.timezone}
          hint="We store your preference, not your location."
          error={state.fields?.timezone}
        />
        <SubmitButton pending={pending}>Save profile</SubmitButton>
      </fieldset>
      <FormResult state={state} />
    </form>
  );
}

export function RoleForm() {
  const [state, action, pending] = useActionState(roleAction, initial);
  return (
    <form className="form" action={action}>
      <fieldset className="form-fields" disabled={pending}>
        <Field
          label="Account user ID"
          name="target"
          hint="Use the verified account’s UUID. No email or password is needed."
          error={state.fields?.target}
        />
        <div className="field">
          <label htmlFor="requested_role">Capability</label>
          <select id="requested_role" name="requested_role">
            <option value="student">Student</option>
            <option value="tutor">Tutor</option>
            <option value="administrator">Administrator</option>
          </select>
          <FieldError message={state.fields?.requested_role} />
        </div>
        <div className="field">
          <label htmlFor="operation">Operation</label>
          <select id="operation" name="operation">
            <option value="grant">Grant role</option>
            <option value="revoke">Revoke role</option>
          </select>
          <FieldError message={state.fields?.operation} />
        </div>
        <SubmitButton pending={pending}>Record role change</SubmitButton>
      </fieldset>
      <FormResult state={state} />
    </form>
  );
}

export function LogoutForm() {
  const [state, action, pending] = useActionState(logoutAction, initial);
  return (
    <form action={action} className="logout-form">
      <button className="button subtle" type="submit" disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
      <FormResult state={state} />
    </form>
  );
}

export function AccountStatusForm() {
  const [state, action, pending] = useActionState(statusAction, initial);
  return (
    <form className="form" action={action}>
      <fieldset className="form-fields" disabled={pending}>
        <Field label="Account user ID" name="status_target" error={state.fields?.status_target} />
        <div className="field">
          <label htmlFor="requested_status">Account status</label>
          <select id="requested_status" name="requested_status">
            <option value="inactive">Deactivate account</option>
            <option value="active">Reactivate account</option>
          </select>
          <FieldError message={state.fields?.requested_status} />
        </div>
        <Field
          label="Reason for this change"
          name="reason"
          maxLength={500}
          error={state.fields?.reason}
          hint="Required for the audit trail. Your own account cannot be changed here."
        />
        <SubmitButton pending={pending}>Record status change</SubmitButton>
      </fieldset>
      <FormResult state={state} />
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(passwordAction, initial);
  return (
    <form className="form" action={action}>
      <fieldset className="form-fields" disabled={pending}>
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          error={state.fields?.password}
        />
        <SubmitButton pending={pending}>Update password</SubmitButton>
      </fieldset>
      <FormResult state={state} />
    </form>
  );
}
