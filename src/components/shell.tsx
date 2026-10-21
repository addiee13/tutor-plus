import type { ReactNode } from "react";
import Link from "next/link";
import { LogoutForm } from "./forms";
import { AppNav, type NavItem } from "./nav-links";
import { canBook, hasRole, type Actor } from "@/domains/auth/policy";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Tutor Plus home">
      <span className="brand-word" aria-hidden="true">
        Tutor<span className="brand-plus">+</span>
      </span>
    </Link>
  );
}

export function PublicHeader() {
  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Brand />
        <nav aria-label="Main navigation" className="public-nav">
          <Link className="public-nav-link optional" href="/#how-it-works">
            How it works
          </Link>
          <Link className="public-nav-link optional" href="/#students">
            For students
          </Link>
          <Link className="public-nav-link optional" href="/#tutors">
            For tutors
          </Link>
          <Link className="public-nav-link" href="/login">
            Sign in
          </Link>
          <Link className="button primary compact" href="/signup">
            Get started <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SetupNotice() {
  return (
    <div className="notice warning" role="status">
      <strong>Account services aren’t connected yet.</strong>
      <br />
      You can explore this preview, but registration, login, and saved profiles need a real database connection. Nothing
      will be saved until setup is complete.
    </div>
  );
}

const SETUP_STEPS = ["Your details", "Verify email", "Set up profile"] as const;

/** Signup → verify email → welcome, shown as a three-step progress list. */
function SetupSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="setup-steps" aria-label={`Account setup, step ${current} of ${SETUP_STEPS.length}`}>
      {SETUP_STEPS.map((label, index) => {
        const step = index + 1;
        const state = step < current ? "done" : step === current ? "current" : "upcoming";
        return (
          <li key={label} className={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="setup-step-mark" aria-hidden="true">
              {state === "done" ? "✓" : step}
            </span>
            <span className="setup-step-label">
              {label}
              {state === "done" && <span className="visually-hidden"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

type Story = "join" | "return" | "recover";

const STORIES: Record<Story, { tone: string; kicker: string; display: string; tagline: string }> = {
  join: {
    tone: "forest",
    kicker: "For adult learners & tutors · 18+",
    display: "Learn. Teach. Grow.",
    tagline: "A little guidance. A lot of possibility.",
  },
  return: {
    tone: "clay",
    kicker: "Welcome back",
    display: "Pick up the thread.",
    tagline: "Your bookings, goals and recaps are right where you left them.",
  },
  recover: {
    tone: "ink",
    kicker: "Account help",
    display: "Back on track.",
    tagline: "Secure links and codes go only to the inbox on your account.",
  },
};

function StoryPanel({ story }: { story: Story }) {
  const { tone, kicker, display, tagline } = STORIES[story];
  return (
    <aside className={`auth-story tone-${tone}`} aria-label="About Tutor Plus">
      <span className="eyebrow">{kicker}</span>
      <p className="auth-story-display">{display}</p>
      <p className="auth-story-tagline">{tagline}</p>
      <div className="auth-story-vignette" aria-hidden="true">
        <div className="vignette-row">
          <span className="vignette-dot" />
          <span>Goals shared</span>
          <span className="vignette-chip">Before</span>
        </div>
        <div className="vignette-row">
          <span className="vignette-dot" />
          <span>Agenda ready</span>
          <span className="vignette-chip">Tutor</span>
        </div>
        <div className="vignette-row">
          <span className="vignette-dot" />
          <span>Recap &amp; reflection</span>
          <span className="vignette-chip">After</span>
        </div>
      </div>
      <span className="auth-story-note">Built for adults. Designed around your time zone.</span>
    </aside>
  );
}

export function AuthShell({
  eyebrow,
  title,
  description,
  step,
  story = "join",
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  /** Position in the signup → verify → welcome journey; omit for sign-in and recovery pages. */
  step?: 1 | 2 | 3;
  story?: Story;
  children: ReactNode;
}) {
  return (
    <>
      <PublicHeader />
      <main id="main" className="auth-layout">
        <div className="container auth-grid">
          <StoryPanel story={story} />
          <section className="auth-card">
            {step && <SetupSteps current={step} />}
            <span className="eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
            <p className="lede">{description}</p>
            {children}
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}

function navItems(actor: Actor): NavItem[] {
  const items: NavItem[] = [
    { href: "/dashboard", label: "Overview" },
    { href: "/profile", label: "My profile", also: ["/update-password"] },
  ];
  if (canBook(actor)) {
    items.push({ href: "/bookings", label: "Bookings", also: ["/sessions"] });
    items.push({ href: "/reviews", label: "Reviews" });
  }
  if (hasRole(actor, "administrator")) items.push({ href: "/admin", label: "Admin" });
  return items;
}

export function AppShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  return (
    <>
      <header className="app-header">
        <div className="container app-header-inner">
          <Brand />
          <AppNav items={navItems(actor)} />
          <LogoutForm />
        </div>
      </header>
      <main id="main" className="workspace container">
        {children}
      </main>
      <Footer variant="compact" />
    </>
  );
}

export function Footer({ variant = "full" }: { variant?: "full" | "compact" }) {
  if (variant === "compact") {
    return (
      <footer className="footer-compact">
        <div className="container footer-compact-inner">
          <span className="footer-compact-word" aria-hidden="true">
            Tutor+
          </span>
          <span>Adult learning, thoughtfully coordinated.</span>
          <span>Tutor Plus · Group 11</span>
        </div>
      </footer>
    );
  }
  return (
    <footer className="site-footer on-dark">
      <div className="container">
        <div className="footer-columns">
          <div>
            <span className="eyebrow">Tutor Plus</span>
            <p className="footer-tagline">Adult learning, thoughtfully coordinated.</p>
          </div>
          <nav aria-label="Footer">
            <span className="eyebrow">Explore</span>
            <ul>
              <li>
                <Link href="/#how-it-works">How it works</Link>
              </li>
              <li>
                <Link href="/#now-and-next">What’s available</Link>
              </li>
              <li>
                <Link href="/">Home</Link>
              </li>
            </ul>
          </nav>
          <div>
            <span className="eyebrow">Who it’s for</span>
            <p>Students and tutors aged 18 and up. One account can hold both capabilities.</p>
          </div>
          <div>
            <span className="eyebrow">Project</span>
            <p>Tutor Plus · Group 11</p>
          </div>
        </div>
        <p className="footer-wordmark" aria-hidden="true">
          Tutor Plus
        </p>
      </div>
    </footer>
  );
}
