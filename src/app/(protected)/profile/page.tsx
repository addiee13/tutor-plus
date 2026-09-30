import { ProfileForm } from "@/components/forms";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { readOwnProfile } from "@/domains/profiles/service";

export default async function Profile() {
  if (!publicConfig()) return null;
  const { client } = await protectedContext();
  const profile = await readOwnProfile(client);
  return <><section className="page-heading"><span className="eyebrow">A LITTLE MORE YOU</span><h1>Your profile.</h1><p>The basics that make your learning space feel right.</p></section><div className="profile-grid"><section className="panel"><h2>Personal details</h2><p className="panel-description">These details belong to your account. They are not a public tutor listing.</p><ProfileForm profile={profile} /></section><aside className="panel quiet-panel"><span className="eyebrow">GOOD TO KNOW</span><h2>Your account,<br />your details.</h2><p>Your age confirmation and account capabilities are protected. Profile edits cannot change roles or grant administrator access.</p><p>This sprint saves your display name and time zone. Tutor publication, subjects, rates, availability, avatars, and learning preferences are not part of this profile editor yet.</p></aside></div></>;
}
