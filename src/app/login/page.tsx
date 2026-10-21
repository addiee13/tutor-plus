import { AuthShell, SetupNotice } from "@/components/shell";
import { AltSignIn, CodeSignInForm, LoginForm } from "@/components/forms";
import { publicConfig } from "@/lib/supabase/config";
import { enabledProviders } from "@/domains/auth/service";

const notices: Record<string, string> = {
  "signed-out": "You’re signed out. See you next time.",
  "password-updated": "Your password is updated. Please sign in again.",
  expired: "Your 24-hour session has ended. Please sign in again.",
  "link-invalid": "That link couldn’t be used. Request a fresh link and try again.",
  verified: "If you just opened your verification link, your email is confirmed. Please sign in to continue.",
  "link-other-browser": "Open the reset link in the same browser where you requested it, or request a new link.",
  "provider-failed":
    "Sign-in with that provider was cancelled or couldn’t be completed. Try again or use another sign-in method.",
  "access-denied": "This account can’t sign in right now. If you think this is a mistake, contact an administrator.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ notice?: string; method?: string }> }) {
  const { notice, method } = await searchParams;
  const config = publicConfig();
  const configured = !!config;
  const providers = await enabledProviders(config);
  const code = method === "code";
  return (
    <AuthShell
      eyebrow="Your space to grow"
      title="Welcome back."
      story="return"
      description={
        code ? "We’ll email you a one-time code. No password needed." : "Sign in and pick up where you left off."
      }
    >
      {notice && notices[notice] && (
        <div className="notice" role="status">
          {notices[notice]}
        </div>
      )}
      {!configured && <SetupNotice />}
      {code ? <CodeSignInForm configured={configured} /> : <LoginForm configured={configured} />}
      <AltSignIn configured={configured} providers={providers} showCode={!code} />
    </AuthShell>
  );
}
