import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { readOwnProfile } from "@/domains/profiles/service";
import { hasRole } from "@/domains/auth/policy";
import { describeRating } from "@/domains/reviews/policy";
import { getTutorRatingSummary } from "@/domains/reviews/service";
import type { TutorReputation } from "@/domains/reviews/types";

type Action = { key: string; kicker: string; title: string; body: string; href: string; cta: string; tone?: "clay" };

/** Next actions for the hub, chosen from the account's current capabilities. Only built features are linked. */
function nextActions(isStudent: boolean, isTutor: boolean, isAdmin: boolean): Action[] {
  const actions: Action[] = [];
  if (isStudent)
    actions.push({
      key: "request",
      kicker: "Learning",
      title: "Plan your next session.",
      body: "Request a time with a published tutor. Requests are saved as payment pending — payment isn’t implemented, so there is no charge.",
      href: "/bookings",
      cta: "Request a session",
    });
  if (isTutor)
    actions.push({
      key: "teach",
      kicker: "Teaching",
      title: "Prepare for your sessions.",
      body: "See the sessions students have booked with you, read their goals and add an agenda before each one.",
      href: "/bookings",
      cta: "See your bookings",
    });
  if (isStudent || isTutor)
    actions.push({
      key: "workspace",
      kicker: "Session workspace",
      title: isTutor && !isStudent ? "Recap a delivered session." : "Share goals before you meet.",
      body:
        isTutor && !isStudent
          ? "Open a confirmed booking to mark it delivered and publish a recap for your student."
          : "Open a confirmed booking to share goals, read the recap and keep a private reflection.",
      href: "/bookings",
      cta: "Open from a booking",
    });
  if (isStudent || isTutor)
    actions.push({
      key: "reviews",
      kicker: "Reviews",
      title: isStudent ? "Review a completed session." : "See what students say.",
      body: isStudent
        ? "Rate a completed session from one to five stars. Each session can be reviewed once."
        : "Your rating is calculated from students’ reviews of completed sessions.",
      href: "/reviews",
      cta: isStudent ? "Leave a review" : "Read your reviews",
      tone: "clay",
    });
  if (isAdmin)
    actions.push({
      key: "admin",
      kicker: "Administration",
      title: "Manage account capabilities.",
      body: "Grant or revoke roles and change account status, with a recorded reason.",
      href: "/admin",
      cta: "Open administration",
    });
  actions.push({
    key: "profile",
    kicker: "Account",
    title: "Keep your details current.",
    body: "Update your display name and time zone so times and greetings fit you.",
    href: "/profile",
    cta: "Edit your profile",
  });
  return actions;
}

export default async function Dashboard() {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const profile = await readOwnProfile(client);
  const isStudent = hasRole(actor, "student");
  const isTutor = hasRole(actor, "tutor");
  const isAdmin = hasRole(actor, "administrator");
  let reputation: TutorReputation[] | null = null;
  if (isTutor) {
    // The rating card is optional; a failed read hides it rather than showing an invented rating.
    reputation = await getTutorRatingSummary(client).catch(() => null);
  }
  const actions = nextActions(isStudent, isTutor, isAdmin);
  return (
    <>
      <section className="page-heading">
        <span className="eyebrow">Your learning space</span>
        <h1>Hello, {profile.display_name}.</h1>
        <p>Here’s where to pick up. Everything below links to something you can do today.</p>
      </section>
      <div className="hub">
        <section className="hub-main" aria-labelledby="next-heading">
          <h2 id="next-heading" className="hub-section-title">
            Next steps
          </h2>
          <ul className="action-grid">
            {actions.map((action, index) => (
              <li key={action.key} className={`action-card ${index === 0 ? "feature" : (action.tone ?? "")}`}>
                <span className="eyebrow">{action.kicker}</span>
                <h3>{action.title}</h3>
                <p>{action.body}</p>
                <Link href={action.href}>
                  {action.cta} <span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <aside className="hub-side" aria-label="Your account">
          <section className="panel account-card" aria-labelledby="account-heading">
            <span className="tag">Account &amp; profile</span>
            <h2 id="account-heading">Your account</h2>
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
            <p className="hint">
              Your email is verified. Roles can only be changed by an administrator, never from your profile.
            </p>
          </section>
          {reputation && (
            <section className="panel rating-card" aria-labelledby="rating-heading">
              <span className="eyebrow">Tutor rating</span>
              <h2 id="rating-heading">How students rate you</h2>
              {reputation.length ? (
                <ul className="rating-list">
                  {reputation.map((entry) => (
                    <li key={entry.tutorId} data-testid="dashboard-rating">
                      Your rating · {entry.tutorName} <span>{describeRating(entry.summary)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No published tutor listing yet, so there’s no rating to show.</p>
              )}
              <p>
                <Link href="/reviews">See recent reviews</Link>
              </p>
            </section>
          )}
        </aside>
      </div>
      <p className="session-note">
        For your security, sessions end 24 hours after sign-in—even if you stay active.{" "}
        <Link href="/update-password">Change password</Link>
      </p>
    </>
  );
}
