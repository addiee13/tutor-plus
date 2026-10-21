import Link from "next/link";
import { ProfileForm } from "@/components/forms";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { readOwnProfile } from "@/domains/profiles/service";

export default async function Profile() {
  if (!publicConfig()) return null;
  const { client } = await protectedContext();
  const profile = await readOwnProfile(client);
  return (
    <>
      <section className="page-heading">
        <span className="eyebrow">A little more you</span>
        <h1>Your profile.</h1>
        <p>The basics that make your learning space feel right.</p>
      </section>
      <div className="profile-grid">
        <section className="panel">
          <h2>Personal details</h2>
          <p className="panel-description">
            These details belong to your account. They are not a public tutor listing.
          </p>
          <ProfileForm profile={profile} />
        </section>
        <aside className="panel quiet-panel">
          <span className="tag">Good to know</span>
          <h2>Your account, your details.</h2>
          <p>
            Your age confirmation and account capabilities are protected. Profile edits cannot change roles or grant
            administrator access.
          </p>
          <p>
            For now, this page saves your display name and time zone. Tutor listings, subjects, rates, availability,
            avatars, and learning preferences can’t be edited here yet.
          </p>
          <Link className="text-link" href="/update-password">
            Change your password <span aria-hidden="true">→</span>
          </Link>
        </aside>
      </div>
    </>
  );
}
