import { DomainError } from "@/domains/shared/errors";

export function publicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (!(["http:", "https:"].includes(parsed.protocol))) return null;
    if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) return null;
  } catch { return null; }
  return { url, key };
}

export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) throw new DomainError("configuration");
  try {
    const url = new URL(raw);
    if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error();
    return url.origin;
  } catch { throw new DomainError("configuration"); }
}
