"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="error-page container">
      <span className="eyebrow">LET’S TRY THAT AGAIN</span>
      <h1>We couldn’t open this page.</h1>
      <p>
        Your account may not have access, or a service may be temporarily unavailable. No changes have been confirmed.
      </p>
      <div className="hero-actions">
        <button className="button primary" onClick={reset}>
          Try again
        </button>
        <Link className="button secondary" href="/login">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
