/** Display preferences never change the stored instant. Unknown zones use the explicit UTC fallback. */
export function viewerTimeZone(value: string | null | undefined): string {
  try {
    if (value) return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    // A missing or obsolete preference must not hide the canonical booking time.
  }
  return "UTC";
}

export function formatViewerInstant(value: string, timezone: string | null | undefined): string {
  const instant = new Date(value);
  if (!Number.isFinite(instant.valueOf())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: viewerTimeZone(timezone),
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}
