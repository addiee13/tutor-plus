import Link from "next/link";
import { HeroHeadline } from "@/components/motion/HeroHeadline";
import { HeroScene } from "@/components/motion/HeroScene";
import { LandingMotion } from "@/components/motion/LandingMotion";
import { ReviewScene, SessionWorkspaceScene } from "@/components/motion/ProductScenes";
import { TiltCard } from "@/components/motion/TiltCard";
import { Footer, PublicHeader } from "@/components/shell";

const NOW = [
  [
    "Verified accounts",
    "Sign up with email verification, then sign in by password, emailed code, or a connected provider.",
  ],
  [
    "Tutor discovery & matching",
    "Explore published profiles by subject, budget, mode and session time, with visible matching factors.",
  ],
  ["Tutor studio", "Manage your public teaching profile, subject offerings, rates and availability."],
  ["Assessments & practice", "Keep assigned questions, submissions, scoring and tutor feedback together."],
  ["Plans & progress", "Set structured goals and milestone dates, then follow dated evidence and tutor observations."],
  ["Session workspace & reviews", "Share goals, prepare an agenda, publish a recap and review a completed session."],
  [
    "Resources & guidance",
    "Read curated learning material and ask the learning assistant when its provider is connected.",
  ],
] as const;

export default function Home() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="landing">
        <section className="masthead" aria-labelledby="hero-heading">
          <HeroScene />
          <div className="container">
            <p className="masthead-word" aria-hidden="true">
              Tutor Plus
            </p>
          </div>
          <div className="container hero">
            <div className="hero-copy">
              <span className="eyebrow">For adult students &amp; tutors · 18+</span>
              <HeroHeadline />
              <p className="hero-lede">
                Find a tutor, request a time that fits your time zone, and keep every session’s goals, agenda and recap
                in one calm, shared place.
              </p>
              <div className="hero-actions">
                <Link href="/signup" className="button primary">
                  Start your journey <span aria-hidden="true">↗</span>
                </Link>
                <Link href="/login" className="button secondary">
                  I already have an account
                </Link>
              </div>
            </div>
            <div className="hero-block on-dark" aria-hidden="true">
              <span className="hero-block-kicker">Your next session</span>
              <div className="mini-card">
                <div className="mini-card-top">
                  <span className="mini-avatar">AM</span>
                  <span>
                    <b>Statistics</b>
                    <small>with a published tutor</small>
                  </span>
                  <span className="mini-chip">Planning</span>
                </div>
                <div className="mini-lines">
                  <span>Goal · Feel ready for regression questions</span>
                  <span>Agenda · Warm-up, two worked examples, practice</span>
                </div>
              </div>
              <span className="hero-block-foot">Plan · Meet · Recap</span>
            </div>
          </div>
        </section>

        <section className="statement" aria-labelledby="statement-heading">
          <div className="container statement-inner">
            <span className="eyebrow">Why Tutor Plus</span>
            <h2 id="statement-heading" className="statement-text">
              Tutoring works best when both people arrive prepared. Tutor Plus gives adult learners and their tutors one
              place to <em>agree on the goal</em>, plan the hour, and remember what was learned.
            </h2>
            <ul className="statement-rules">
              <li>Built for adults</li>
              <li>Your time zone, always</li>
              <li>Private where it matters</li>
            </ul>
          </div>
        </section>

        <section id="how-it-works" className="how" aria-labelledby="how-heading">
          <div className="container">
            <div className="section-head">
              <span className="eyebrow">How it works</span>
              <h2 id="how-heading">Three steps to a better session.</h2>
            </div>
            <ol className="how-steps">
              <li>
                <span className="how-numeral" aria-hidden="true">
                  1
                </span>
                <div className="how-step-copy">
                  <h3>Create your account.</h3>
                  <p>Sign up, confirm your email, and choose whether you’re here to learn, to teach, or both.</p>
                  <Link href="/signup" className="text-link">
                    Create an account <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </li>
              <li>
                <span className="how-numeral" aria-hidden="true">
                  2
                </span>
                <div className="how-step-copy">
                  <h3>Request a time.</h3>
                  <p>
                    Choose a published tutor, a subject, and a time. Your request is saved as payment pending; no charge
                    is taken.
                  </p>
                </div>
              </li>
              <li>
                <span className="how-numeral" aria-hidden="true">
                  3
                </span>
                <div className="how-step-copy">
                  <h3>Plan, meet, reflect.</h3>
                  <p>
                    Share goals beforehand, read your tutor’s recap afterwards, keep a private reflection, and leave a
                    review.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section className="split" aria-label="Who Tutor Plus is for">
          <div id="students" className="split-panel tone-forest on-dark">
            <span className="eyebrow">For students</span>
            <h2>Arrive with a goal. Leave with a plan.</h2>
            <ul>
              <li>Request sessions with published tutors</li>
              <li>Share goals and questions before you meet</li>
              <li>Read recaps and keep a private reflection</li>
              <li>Review completed sessions</li>
            </ul>
            <Link href="/signup" className="button light">
              Join as a student <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div id="tutors" className="split-panel tone-clay">
            <span className="eyebrow">For tutors</span>
            <h2>Know the goal before the hour begins.</h2>
            <ul>
              <li>See the sessions booked with you</li>
              <li>Read student goals and prepare an agenda</li>
              <li>Mark sessions delivered and publish recaps</li>
              <li>Build a rating from real, completed sessions</li>
            </ul>
            <Link href="/signup" className="button dark">
              Join as a tutor <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>

        <section className="peek" aria-labelledby="peek-heading">
          <div className="container">
            <div className="section-head">
              <span className="eyebrow">A look inside</span>
              <h2 id="peek-heading">The real product, in miniature.</h2>
              <p>Illustrations of screens that exist today, shown with sample data.</p>
            </div>
            <div className="peek-grid">
              <TiltCard>
                <div className="vignette" aria-hidden="true">
                  <div className="vignette-head">
                    <b>Statistics · Virtual</b>
                    <span className="status-chip pending">payment pending</span>
                  </div>
                  <dl className="vignette-facts">
                    <div>
                      <dt>Starts (UTC)</dt>
                      <dd>Tue 14:00</dd>
                    </div>
                    <div>
                      <dt>Saved price</dt>
                      <dd>$45.00</dd>
                    </div>
                  </dl>
                  <span className="vignette-note">No charge — payment not implemented</span>
                </div>
                <figcaption>
                  <b>Bookings.</b> Request a reservation and see its saved price, status and hold.
                </figcaption>
              </TiltCard>
              <TiltCard>
                <SessionWorkspaceScene />
                <figcaption>
                  <b>Session workspace.</b> Goals, agenda, recap and a private reflection for each booking.
                </figcaption>
              </TiltCard>
              <TiltCard>
                <ReviewScene />
                <figcaption>
                  <b>Reviews.</b> One to five stars, once per completed session.
                </figcaption>
              </TiltCard>
            </div>
          </div>
        </section>

        <section id="now-and-next" className="now-next" aria-labelledby="now-heading">
          <div className="container now-next-grid">
            <div>
              <span className="eyebrow">One shared workspace</span>
              <h2 id="now-heading">Your learning toolkit.</h2>
              <ul className="now-list">
                {NOW.map(([title, body]) => (
                  <li key={title}>
                    <b>{title}</b>
                    <span>{body}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="next-col">
              <span className="eyebrow">Before you book</span>
              <h2>A request is the first step.</h2>
              <p>
                You can choose an open time and save a reservation request. Payment and checkout are unavailable, so a
                request does not charge you or confirm a session.
              </p>
              <p>
                Existing confirmed sessions retain their session workspace, private meeting details and learning
                records.
              </p>
              <Link className="button secondary" href="/tutors">
                Explore published tutors →
              </Link>
            </div>
          </div>
        </section>

        <section className="closing on-dark" aria-labelledby="closing-heading">
          <div className="container closing-inner">
            <h2 id="closing-heading">Ready for your next chapter?</h2>
            <div className="hero-actions">
              <Link href="/signup" className="button light">
                Create your account <span aria-hidden="true">↗</span>
              </Link>
              <Link href="/login" className="button ghost-light">
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <LandingMotion />
    </>
  );
}
