export default function Loading() {
  return (
    <main id="main" className="error-page container" role="status">
      <span className="eyebrow">One moment</span>
      <h1>Opening your space…</h1>
      <div className="loading-bar" aria-hidden="true" />
    </main>
  );
}
