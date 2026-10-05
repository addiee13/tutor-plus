import { redirect } from "next/navigation";
import { AuthShell, SetupNotice } from "@/components/shell";
import { LogoutForm, OnboardingForm } from "@/components/forms";
import { publicConfig } from "@/lib/supabase/config";
import { createUserClient } from "@/lib/supabase/server";
import { onboardingStatus, type OnboardingStatus } from "@/domains/auth/service";
import { DomainError } from "@/domains/shared/errors";

export const dynamic = "force-dynamic";

export default async function Welcome() {
  if (!publicConfig()) return <AuthShell eyebrow="ALMOST THERE" title="Finish setting up." description="Account services are needed for this step."><SetupNotice /></AuthShell>;
  let status: OnboardingStatus;
  try { status = await onboardingStatus(await createUserClient()); } catch (error) {
    if (error instanceof DomainError && error.code === "unverified") redirect("/check-email");
    if (error instanceof DomainError && error.code === "expired") redirect("/login?notice=expired");
    redirect("/login");
  }
  if (status.state === "complete") redirect("/dashboard");
  if (status.state === "inactive") return <AuthShell eyebrow="ACCOUNT UNAVAILABLE" title="We can’t continue." description="This account can’t be set up right now. If you think this is a mistake, contact an administrator."><LogoutForm /></AuthShell>;
  return <AuthShell eyebrow="ALMOST THERE" title="Finish setting up." description="Tell us how you’ll use Tutor Plus. You can change your name and time zone later; administrator access is only ever granted by an administrator."><OnboardingForm suggestedName={status.suggestedName} /><LogoutForm /></AuthShell>;
}
