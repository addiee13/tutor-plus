import { AuthShell, SetupNotice } from "@/components/shell";
import { EmailForm } from "@/components/forms";
import { publicConfig } from "@/lib/supabase/config";

export default function ResetPassword() {
  const configured = !!publicConfig();
  return <AuthShell eyebrow="LET’S GET YOU BACK IN" title="Reset your password." description="Enter your account email to request a secure reset link.">{!configured && <SetupNotice />}<EmailForm kind="reset" configured={configured} /></AuthShell>;
}
