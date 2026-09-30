import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { DomainError } from "@/domains/shared/errors";
import { publicConfig } from "./config";

export async function createUserClient() {
  const config = publicConfig();
  if (!config) throw new DomainError("configuration");
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: { sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", httpOnly: true },
    cookies: {
      getAll() { return store.getAll(); },
      setAll(values) {
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { }
      }
    }
  });
}
