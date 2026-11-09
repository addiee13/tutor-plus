import { safeAuthReturn, withAuthReturn } from "@/lib/auth-return";
import { redirect } from "next/navigation";
import { AuthShell, SetupNotice } from "@/components/shell";
import { LogoutForm, OnboardingForm } from "@/components/forms";
import { publicConfig } from "@/lib/supabase/config";
import { createUserClient } from "@/lib/supabase/server";
import { onboardingStatus, type OnboardingStatus } from "@/domains/auth/service";
import { authRedirectFor } from "@/lib/protected-context";

export const dynamic = "force-dynamic";

export default async function Welcome({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const returnTo = safeAuthReturn((await searchParams).next);
  if (!publicConfig())
    return (
      <AuthShell
        eyebrow="Almost there"
        title="Finish setting up."
        step={3}
        description="Account services are needed for this step."
      >
        <SetupNotice />
      </AuthShell>
    );
  let status: OnboardingStatus;
  try {
    status = await onboardingStatus(await createUserClient());
  } catch (error) {
    redirect(withAuthReturn(authRedirectFor(error) ?? "/login", returnTo));
  }
  if (status.state === "complete") redirect(returnTo ?? "/dashboard");
  if (status.state === "inactive")
    return (
      <AuthShell
        eyebrow="Account unavailable"
        story="recover"
        title="We can’t continue."
        description="This account can’t be set up right now. If you think this is a mistake, contact an administrator."
      >
        <LogoutForm />
      </AuthShell>
    );
  return (
    <AuthShell
      eyebrow="Almost there"
      title="Finish setting up."
      step={3}
      description="Tell us how you’ll use Tutor Plus. You can change your name and time zone later; administrator access is only ever granted by an administrator."
    >
      <OnboardingForm suggestedName={status.suggestedName} returnTo={returnTo} />
      <div className="auth-switch">
        <span>Signed in with the wrong account?</span>
        <LogoutForm />
      </div>
    </AuthShell>
  );
}
