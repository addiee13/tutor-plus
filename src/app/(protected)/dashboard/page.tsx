import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { readOwnProfile } from "@/domains/profiles/service";
import { canBook } from "@/domains/auth/policy";

export default async function Dashboard() {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const profile = await readOwnProfile(client);
  return (
    <>
      <section className="page-heading">
        <span className="eyebrow">YOUR LEARNING SPACE</span>
        <h1>Hello, {profile.display_name}.</h1>
        <p>Your next chapter starts with the details that make you, you.</p>
      </section>
      <div className="dashboard-grid">
        <section className="panel profile-panel">
          <span className="tag">ACCOUNT & PROFILE</span>
          <h2>A good place to begin.</h2>
          <p>
            Your account is verified. Keep your name and time zone up to date so future learning tools fit around you.
          </p>
          <dl>
            <div>
              <dt>Display name</dt>
              <dd>{profile.display_name}</dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>{profile.timezone}</dd>
            </div>
            <div>
              <dt>Capabilities</dt>
              <dd>{actor.roles.join(" · ")}</dd>
            </div>
          </dl>
          <Link href="/profile" className="button primary">
            Edit your profile <span aria-hidden="true">↗</span>
          </Link>
        </section>
        <section className="panel next-panel">
          <span className="eyebrow">A REAL RESERVATION</span>
          <h2>Plan your next session.</h2>
          <p>
            Students can request an available time and read their saved reservation. The database protects competing
            time slots. Reservations remain payment-pending: checkout and charges are not connected.
          </p>
          {canBook(actor) && (
            <Link href="/bookings" className="button secondary">
              Open bookings <span aria-hidden="true">↗</span>
            </Link>
          )}
          <ul className="future-list">
            <li>
              Provider checkout <span>Planned</span>
            </li>
            <li>
              Learning goals <span>Planned</span>
            </li>
          </ul>
        </section>
      </div>
      <p className="session-note">
        For your security, sessions end 24 hours after sign-in—even if you stay active.{" "}
        <Link href="/update-password">Change password</Link>
      </p>
    </>
  );
}
