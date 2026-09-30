import { AuthShell, SetupNotice } from "@/components/shell";
import { LoginForm } from "@/components/forms";
import { publicConfig } from "@/lib/supabase/config";

const notices: Record<string, string> = {
  "signed-out": "You’re signed out. See you next time.",
  "password-updated": "Your password is updated. Please sign in again.",
  "expired": "Your 24-hour session has ended. Please sign in again.",
  "link-invalid": "That link couldn’t be used. Request a fresh link and try again."
};

export default async function Login({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const configured = !!publicConfig();
  return <AuthShell eyebrow="YOUR SPACE TO GROW" title="Welcome back." description="Sign in and pick up where you left off.">{notice && notices[notice] && <div className="notice" role="status">{notices[notice]}</div>}{!configured && <SetupNotice />}<LoginForm configured={configured} /></AuthShell>;
}
