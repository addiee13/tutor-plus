import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="error-page container">
      <span className="error-code" aria-hidden="true">
        404
      </span>
      <span className="eyebrow">A different direction</span>
      <h1>This page isn’t here.</h1>
      <p>The link may be out of date, or the page may have moved. Let’s take you back to a good place to start.</p>
      <div className="hero-actions">
        <Link className="button primary" href="/">
          Back to home
        </Link>
        <Link className="button secondary" href="/dashboard">
          Go to your overview
        </Link>
      </div>
    </main>
  );
}
