/** Keeps the loading region substantial while the surrounding route shell remains visible. */
export function PageLoading({ title = "Opening your space…" }: { title?: string }) {
  return (
    <section className="workspace-stack" role="status" aria-live="polite">
      <div className="page-heading">
        <span className="eyebrow">One moment</span>
        <h1>{title}</h1>
        <p>We’re getting the latest details ready.</p>
      </div>
      <div className="loading-bar" aria-hidden="true" />
      <div className="workspace-grid equal" aria-hidden="true">
        <div className="workspace-record" style={{ minHeight: "12rem" }} />
        <div className="workspace-record" style={{ minHeight: "12rem" }} />
      </div>
    </section>
  );
}
