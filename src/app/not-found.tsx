import Link from "next/link";

export default function NotFound() {
  return <main id="main" className="error-page container"><span className="eyebrow">A DIFFERENT DIRECTION</span><h1>This page isn’t here.</h1><p>Let’s take you back to a good place to start.</p><Link className="button primary" href="/">Back to home</Link></main>;
}
