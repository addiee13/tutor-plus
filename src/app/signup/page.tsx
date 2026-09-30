import { AuthShell, SetupNotice } from "@/components/shell";
import { SignupForm } from "@/components/forms";
import { publicConfig } from "@/lib/supabase/config";

export default function Signup() {
  const configured = !!publicConfig();
  return <AuthShell eyebrow="A NEW BEGINNING" title="Join Tutor Plus." description="A few details, a verified email, and you’re on your way.">{!configured && <SetupNotice />}<SignupForm configured={configured} /></AuthShell>;
}
