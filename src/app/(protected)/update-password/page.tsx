import { PasswordForm } from "@/components/forms";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";

export default async function UpdatePassword() {
  if (!publicConfig()) return null;
  await protectedContext();
  return <section className="panel password-panel"><span className="eyebrow">A FRESH START</span><h1>Choose a new password.</h1><p className="panel-description">Use at least 12 characters. After saving, we’ll end your sessions and ask you to sign in again.</p><PasswordForm /></section>;
}
