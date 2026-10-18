import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions, publicConfig } from "@/lib/supabase/config";

function nextResponse(request: NextRequest): NextResponse {
  const response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** Refreshes the Supabase session cookie before account-aware routes render. */
export async function proxy(request: NextRequest) {
  const config = publicConfig();
  let response = nextResponse(request);
  if (!config) return response;

  const supabase = createServerClient(config.url, config.key, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = nextResponse(request);
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch {
    // A failed refresh leaves the request unauthenticated; protected pages enforce access themselves.
  }
  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/profile/:path*",
    "/admin/:path*",
    "/bookings/:path*",
    "/auth/:path*",
    "/login",
    "/signup",
    "/reset-password",
    "/update-password",
    "/welcome",
  ],
};
