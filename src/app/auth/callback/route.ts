import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  let origin: string;
  try { origin = siteUrl(); } catch { return NextResponse.json({ message: "Account services are not connected yet." }, { status: 503 }); }
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const tokenType = request.nextUrl.searchParams.get("type");
  const recovery = request.nextUrl.searchParams.get("flow") === "recovery" || tokenType === "recovery";
  try {
    const client = await createUserClient();
    const result = code
      ? await client.auth.exchangeCodeForSession(code)
      : tokenHash && (tokenType === "signup" || tokenType === "recovery" || tokenType === "email")
        ? await client.auth.verifyOtp({ token_hash: tokenHash, type: tokenType })
        : null;
    if (!result || result.error) return NextResponse.redirect(`${origin}/login?notice=link-invalid`);
    return NextResponse.redirect(`${origin}${recovery ? "/update-password" : "/dashboard"}`);
  } catch { return NextResponse.redirect(`${origin}/login?notice=link-invalid`); }
}
