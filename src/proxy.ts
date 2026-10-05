import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicConfig } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  const config = publicConfig();
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  if (!config) return response;
  const supabase = createServerClient(config.url, config.key, {
    cookieOptions: { sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", httpOnly: true },
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        response.headers.set("Cache-Control", "private, no-store");
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });
  try { await supabase.auth.getUser(); } catch { }
  return response;
}

export const config = { matcher: ["/dashboard/:path*", "/profile/:path*", "/admin/:path*", "/bookings/:path*", "/auth/:path*", "/login", "/signup", "/reset-password", "/update-password", "/welcome"] };
