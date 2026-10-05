import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/supabase/config";
import { getActor } from "@/domains/auth/service";
import { DomainError } from "@/domains/shared/errors";

export async function GET(request: NextRequest) {
  let origin: string;
  try { origin = siteUrl(); } catch { return NextResponse.json({ message: "Account services are not connected yet." }, { status: 503 }); }
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const tokenType = request.nextUrl.searchParams.get("type");
  const recovery = request.nextUrl.searchParams.get("flow") === "recovery" || tokenType === "recovery";
  // OAuth providers report a cancelled or failed consent as ?error=… with no code.
  if (!code && !tokenHash && request.nextUrl.searchParams.get("error")) return NextResponse.redirect(`${origin}/login?notice=provider-failed`);
  try {
    const client = await createUserClient();
    const result = code
      ? await client.auth.exchangeCodeForSession(code)
      : tokenHash && (tokenType === "signup" || tokenType === "recovery" || tokenType === "email" || tokenType === "magiclink")
        ? await client.auth.verifyOtp({ token_hash: tokenHash, type: tokenType })
        : null;
    // Supabase only returns a code after it has verified the email. The exchange still fails when the
    // link opens in a browser without the PKCE verifier cookie (another device or mail app), so the
    // account is verified but this browser has no session yet.
    if (code && result?.error?.code === "pkce_code_verifier_not_found") return NextResponse.redirect(`${origin}/login?notice=${recovery ? "link-other-browser" : "verified"}`);
    if (!result || result.error) return NextResponse.redirect(`${origin}/login?notice=link-invalid`);
    if (recovery) return NextResponse.redirect(`${origin}/update-password`);
    try { await getActor(client); } catch (error) {
      if (error instanceof DomainError && error.code === "onboarding") return NextResponse.redirect(`${origin}/welcome`);
      if (error instanceof DomainError && error.code === "forbidden") {
        await client.auth.signOut({ scope: "local" });
        return NextResponse.redirect(`${origin}/login?notice=access-denied`);
      }
    }
    return NextResponse.redirect(`${origin}/dashboard`);
  } catch { return NextResponse.redirect(`${origin}/login?notice=link-invalid`); }
}
