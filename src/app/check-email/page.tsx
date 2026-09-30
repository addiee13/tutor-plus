import { AuthShell, SetupNotice } from "@/components/shell";
import { EmailForm } from "@/components/forms";
import { publicConfig } from "@/lib/supabase/config";

export default function CheckEmail() {
  const configured = !!publicConfig();
  return <AuthShell eyebrow="ONE MORE STEP" title="Check your email." description="If your registration is eligible, a verification link has been requested. Open the link to confirm your email before signing in."><div className="notice">Check your spam folder too. We can request an email, but only your inbox confirms delivery.</div>{!configured && <SetupNotice />}<EmailForm kind="resend" configured={configured} /></AuthShell>;
}
