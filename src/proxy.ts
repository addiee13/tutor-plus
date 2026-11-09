import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_PATH_HEADER } from "@/lib/auth-return";
import { authCookieOptions, publicConfig } from "@/lib/supabase/config";

function nextResponse(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  // Overwrite any client-supplied value: only this request URL defines the return destination.
  headers.set(AUTH_PATH_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.next({ request: { headers } });
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
    "/sessions/:path*",
    "/reviews/:path*",
    "/study-plans/:path*",
    "/assessments/:path*",
    "/assignments/:path*",
    "/progress/:path*",
    "/matching/:path*",
    "/resources/:path*",
    "/assistant/:path*",
    "/notifications/:path*",
    "/support/:path*",
    "/tutor-studio/:path*",
    "/auth/:path*",
    "/login",
    "/signup",
    "/reset-password",
    "/update-password",
    "/welcome",
  ],
};
