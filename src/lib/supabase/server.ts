import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { DomainError } from "@/domains/shared/errors";
import { authCookieOptions, publicConfig } from "./config";

/** A Supabase client scoped to the signed-in user, so RLS applies to every query. */
export async function createUserClient() {
  const config = publicConfig();
  if (!config) throw new DomainError("configuration");
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; the proxy refreshes the session on the next request.
        }
      },
    },
  });
}

export type UserClient = Awaited<ReturnType<typeof createUserClient>>;
