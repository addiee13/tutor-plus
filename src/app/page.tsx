import Link from "next/link";
import { Footer, PublicHeader } from "@/components/shell";

export default function Home() {
  return (
    <>
      <PublicHeader />
      <main id="main">
        <section className="hero container">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="tiny-dot" /> YOUR NEXT CHAPTER STARTS HERE
            </span>
            <h1>
              Great learning
              <br />
              starts with
              <br />
              <em>the right support.</em>
            </h1>
            <p>
              Find your direction. Build your confidence. Take the next step with a space made for thoughtful tutoring
              and meaningful progress.
            </p>
            <div className="hero-actions">
              <Link href="/signup" className="button primary">
                Start your journey <span aria-hidden="true">↗</span>
              </Link>
              <Link href="/#how-it-works" className="button secondary">
                See how it works
              </Link>
            </div>
            <div className="hero-note">
              <span aria-hidden="true">✦</span> For students and tutors, ages 18 and up.
            </div>
          </div>
          <div className="hero-visual" aria-label="An illustration of a guided learning journey">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="visual-star" aria-hidden="true">
              ✳
            </div>
            <div className="learning-card">
              <div className="card-top">
                <span className="card-icon" aria-hidden="true">
                  ↗
                </span>
                <span className="eyebrow">YOUR LEARNING JOURNEY</span>
                <span aria-hidden="true">···</span>
              </div>
              <h2>
                Make space
                <br />
                for what’s next.
              </h2>
              <p>
                Small steps. Clear direction.
                <br />A little more confidence.
              </p>
              <div className="journey-steps">
                <span className="step-active">01</span>
                <i />
                <span>02</span>
                <i />
                <span>03</span>
              </div>
              <div className="card-bottom">
                Start with you <span aria-hidden="true">→</span>
              </div>
            </div>
            <div className="floating-note note-top">
              <span aria-hidden="true">✦</span> A fresh perspective
            </div>
            <div className="floating-note note-bottom">
              <span className="round-icon" aria-hidden="true">
                ✓
              </span>
              <span>
                Learning that fits.<small>At your pace. In your time zone.</small>
              </span>
            </div>
            <span className="visual-caption">A new way forward, together.</span>
          </div>
        </section>
        <section className="value-strip container" aria-label="Platform principles">
          <span>Thoughtful guidance</span>
          <span>Clear learning goals</span>
          <span>A space to grow</span>
          <span>Built for adults</span>
        </section>
        <section id="how-it-works" className="how-section container">
          <div className="section-heading">
            <span className="eyebrow">A SIMPLE PLACE TO START</span>
            <h2>
              Less friction.
              <br />
              More forward motion.
            </h2>
            <p>
              Account, profile, and session-reservation tools are the first steps. Reservations are held as payment
              pending; online payment, tutor discovery, and learning tools are planned next—not available in this Sprint
              2 release.
            </p>
          </div>
          <div className="steps-grid">
            <article>
              <span className="step-number">01 /</span>
              <h3>Make it official.</h3>
              <p>Create your student or tutor account and verify your email. One secure place to begin.</p>
              <Link href="/signup">
                Create an account <span aria-hidden="true">→</span>
              </Link>
            </article>
            <article>
              <span className="step-number">02 /</span>
              <h3>Make it yours.</h3>
              <p>Set your display name and time zone. Save your details and return to them whenever you need.</p>
              <Link href="/profile">
                Your profile <span aria-hidden="true">→</span>
              </Link>
            </article>
            <article className="planned-step">
              <span className="step-number">
                03 / <span className="tag">PLANNED</span>
              </span>
              <h3>Find your rhythm.</h3>
              <p>Future releases will connect tutor discovery, scheduled sessions, and structured learning support.</p>
              <span className="muted">Not yet available</span>
            </article>
          </div>
        </section>
        <section className="closing container">
          <div>
            <span className="eyebrow">THE FIRST STEP IS YOURS</span>
            <h2>Ready for your next chapter?</h2>
          </div>
          <Link href="/signup" className="button primary">
            Let’s get started <span aria-hidden="true">↗</span>
          </Link>
        </section>
      </main>
      <Footer />
    </>
  );
}
