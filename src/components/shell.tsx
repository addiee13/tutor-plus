import type { ReactNode } from "react";
import Link from "next/link";
import { LogoutForm } from "./forms";
import { canBook, hasRole, type Actor } from "@/domains/auth/policy";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Tutor Plus home">
      <span className="brand-mark" aria-hidden="true">
        t<span>+</span>
      </span>
      <span>
        Tutor<span className="brand-light"> Plus</span>
      </span>
    </Link>
  );
}

export function PublicHeader() {
  return (
    <header className="header container">
      <Brand />
      <nav aria-label="Main navigation">
        <Link className="nav-link" href="/#how-it-works">
          How it works
        </Link>
        <Link className="nav-link" href="/login">
          Sign in
        </Link>
        <Link className="button primary compact" href="/signup">
          Get started <span aria-hidden="true">↗</span>
        </Link>
      </nav>
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

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <>
      <PublicHeader />
      <main id="main" className="auth-layout container">
        <aside className="auth-story">
          <span className="eyebrow">LEARNING, WITH DIRECTION</span>
          <h2>
            A little guidance.
            <br />A lot of possibility.
          </h2>
          <p>
            Your next chapter starts with the right support. Make room for clear goals, thoughtful guidance, and steady
            progress.
          </p>
          <div className="story-art" aria-hidden="true">
            <div className="art-circle" />
            <div className="art-page">
              <span />
              <span />
              <span />
              <b>Keep growing ↗</b>
            </div>
            <div className="art-dot" />
          </div>
          <span className="story-note">Built for adult learners. Designed around you.</span>
        </aside>
        <section className="auth-card">
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p className="lede">{description}</p>
          {children}
        </section>
      </main>
      <Footer />
    </>
  );
}

export function AppShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  return (
    <>
      <header className="header container">
        <Brand />
        <nav aria-label="Account navigation">
          <Link className="nav-link" href="/dashboard">
            Overview
          </Link>
          <Link className="nav-link" href="/profile">
            My profile
          </Link>
          {canBook(actor) && (
            <Link className="nav-link" href="/bookings">
              Bookings
            </Link>
          )}
          {hasRole(actor, "administrator") && (
            <Link className="nav-link" href="/admin">
              Admin
            </Link>
          )}
          <LogoutForm />
        </nav>
      </header>
      <main id="main" className="workspace container">
        {children}
      </main>
      <Footer />
    </>
  );
}

export function Footer() {
  return (
    <footer className="footer container">
      <span>Tutor Plus · Group 11</span>
      <span>Adult learning, thoughtfully coordinated.</span>
      <Link href="/">Back to home</Link>
    </footer>
  );
}
