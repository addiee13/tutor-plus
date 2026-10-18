import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createUserClient, type UserClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/supabase/config";
import { getActor } from "@/domains/auth/service";
import { isDomainError } from "@/domains/shared/errors";

const LINK_OTP_TYPES: readonly EmailOtpType[] = ["signup", "recovery", "email", "magiclink"];

function isLinkOtpType(value: string | null): value is EmailOtpType {
  return LINK_OTP_TYPES.includes(value as EmailOtpType);
}

/** Exchanges an OAuth/PKCE code or an emailed token hash for a session; null when the link carries neither. */
async function establishSession(client: UserClient, params: URLSearchParams) {
  const code = params.get("code");
  if (code) return client.auth.exchangeCodeForSession(code);
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (tokenHash && isLinkOtpType(type)) return client.auth.verifyOtp({ token_hash: tokenHash, type });
  return null;
}

/** Sends a freshly signed-in identity to the right place, ending sessions the account may not use. */
async function destinationAfterSignIn(client: UserClient): Promise<string> {
  try {
    await getActor(client);
  } catch (error) {
    if (isDomainError(error, "onboarding")) return "/welcome";
    if (isDomainError(error, "forbidden")) {
      await client.auth.signOut({ scope: "local" });
      return "/login?notice=access-denied";
    }
    // Other states (expired, unavailable, …) are handled by the protected layout on the next request.
  }
  return "/dashboard";
}

export async function GET(request: NextRequest) {
  let origin: string;
  try {
    origin = siteUrl();
  } catch {
    return NextResponse.json({ message: "Account services are not connected yet." }, { status: 503 });
  }
  const redirectTo = (path: string) => NextResponse.redirect(`${origin}${path}`);

  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const recovery = params.get("flow") === "recovery" || params.get("type") === "recovery";

  // OAuth providers report a cancelled or failed consent as ?error=… with no code.
  if (!code && !params.get("token_hash") && params.get("error")) return redirectTo("/login?notice=provider-failed");

  try {
    const client = await createUserClient();
    const result = await establishSession(client, params);
    // Supabase only returns a code after it has verified the email. The exchange still fails when the
    // link opens in a browser without the PKCE verifier cookie (another device or mail app), so the
    // account is verified but this browser has no session yet.
    if (code && result?.error?.code === "pkce_code_verifier_not_found") {
      return redirectTo(`/login?notice=${recovery ? "link-other-browser" : "verified"}`);
    }
    if (!result || result.error) return redirectTo("/login?notice=link-invalid");
    if (recovery) return redirectTo("/update-password");
    return redirectTo(await destinationAfterSignIn(client));
  } catch {
    return redirectTo("/login?notice=link-invalid");
  }
}
