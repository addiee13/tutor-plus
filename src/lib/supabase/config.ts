import { DomainError } from "@/domains/shared/errors";
import type { CookieOptions } from "@supabase/ssr";

export type PublicConfig = { url: string; key: string };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** HTTPS everywhere, with plain HTTP allowed only for local development. */
function isAllowedOrigin(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

export const authCookieOptions: CookieOptions = {
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  httpOnly: true,
};

/** Returns null when Supabase is not configured, so pages can render a setup notice instead of failing. */
export function publicConfig(): PublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    return isAllowedOrigin(new URL(url)) ? { url, key } : null;
  } catch {
    return null;
  }
}

/** The canonical public origin used for every emailed or OAuth redirect link. */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) throw new DomainError("configuration");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DomainError("configuration");
  }
  if (url.username || url.password || !isAllowedOrigin(url)) throw new DomainError("configuration");
  return url.origin;
}
