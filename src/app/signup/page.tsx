import { AuthShell, SetupNotice } from "@/components/shell";
import { AltSignIn, SignupForm } from "@/components/forms";
import { publicConfig } from "@/lib/supabase/config";
import { enabledProviders } from "@/domains/auth/service";

export default async function Signup() {
  const config = publicConfig();
  const configured = !!config;
  const providers = await enabledProviders(config);
  return (
    <AuthShell
      eyebrow="A new beginning"
      title="Join Tutor Plus."
      step={1}
      description="A few details, a verified email, and you’re on your way."
    >
      {!configured && <SetupNotice />}
      <SignupForm configured={configured} />
      <AltSignIn configured={configured} providers={providers} />
      <p className="hint">
        {providers.length ? "New GitHub or Google sign-ins finish a short setup step. " : ""}Email codes work for
        existing accounts.
      </p>
    </AuthShell>
  );
}
