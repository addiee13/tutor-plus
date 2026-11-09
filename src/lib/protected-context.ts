import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { AUTH_PATH_HEADER, withAuthReturn } from "./auth-return";
import { redirect } from "next/navigation";
import { createUserClient } from "./supabase/server";
import { getActor } from "@/domains/auth/service";
import { DomainError, type ErrorCode } from "@/domains/shared/errors";

const AUTH_REDIRECTS: Partial<Record<ErrorCode, string>> = {
  unverified: "/check-email",
  onboarding: "/welcome",
  unauthenticated: "/login",
  expired: "/login?notice=expired",
};

/** Where to send a visitor whose session cannot reach a protected page, or null when no redirect applies. */
export function authRedirectFor(error: unknown): string | null {
  return error instanceof DomainError ? (AUTH_REDIRECTS[error.code] ?? null) : null;
}

/** Resolves the signed-in actor once per request; redirects visitors who cannot use protected pages. */
export const protectedContext = cache(async () => {
  const client = await createUserClient();
  try {
    return { client, actor: await getActor(client) };
  } catch (error) {
    const destination = authRedirectFor(error);
    if (destination) {
      const requested = (await headers()).get(AUTH_PATH_HEADER);
      redirect(
        destination.startsWith("/login") || destination === "/welcome"
          ? withAuthReturn(destination, requested)
          : destination,
      );
    }
    throw error;
  }
});
