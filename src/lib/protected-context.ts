import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createUserClient } from "./supabase/server";
import { getActor } from "@/domains/auth/service";
import { DomainError } from "@/domains/shared/errors";

export const protectedContext = cache(async () => {
  const client = await createUserClient();
  try { return { client, actor: await getActor(client) }; } catch (error) {
    if (error instanceof DomainError) {
      if (error.code === "unverified") redirect("/check-email");
      if (error.code === "onboarding") redirect("/welcome");
      if (error.code === "unauthenticated") redirect("/login");
      if (error.code === "expired") redirect("/login?notice=expired");
    }
    throw error;
  }
});
