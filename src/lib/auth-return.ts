/** Only application pages may be used as post-auth destinations; never accept external or auth-action URLs. */
const RETURN_ROOTS = new Set([
  "dashboard",
  "profile",
  "bookings",
  "sessions",
  "reviews",
  "study-plans",
  "assessments",
  "assignments",
  "progress",
  "matching",
  "resources",
  "assistant",
  "notifications",
  "support",
  "tutor-studio",
  "admin",
]);

export const AUTH_RETURN_COOKIE = "tutorplus_auth_return";

export const AUTH_PATH_HEADER = "x-tutorplus-auth-return";

export function safeAuthReturn(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) return;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return;
  const path = value.split(/[?#]/, 1)[0];
  if (path.includes("%") || path.includes("..")) return;
  try {
    const url = new URL(value, "https://tutorplus.invalid");
    if (url.origin !== "https://tutorplus.invalid" || !RETURN_ROOTS.has(url.pathname.split("/")[1])) return;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return;
  }
}

export function withAuthReturn(path: string, returnTo: unknown): string {
  const next = safeAuthReturn(returnTo);
  if (!next) return path;
  const url = new URL(path, "https://tutorplus.invalid");
  url.searchParams.set("next", next);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function admittedDestination(destination: string, returnTo: unknown): string {
  if (destination === "/dashboard") return safeAuthReturn(returnTo) ?? destination;
  return destination === "/welcome" ? withAuthReturn(destination, returnTo) : destination;
}
