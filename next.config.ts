import type { NextConfig } from "next";

const config: NextConfig = {
  // Keep independent production verification separate from the active dev output.
  distDir: process.env.TUTORPLUS_DIST_DIR || ".next",
  typescript: process.env.TUTORPLUS_DIST_DIR ? { tsconfigPath: "tsconfig.verification.json" } : undefined,
  // Server Action state and request URLs can contain private learning text or Auth tokens.
  logging: { serverFunctions: false, incomingRequests: false, browserToTerminal: false },
  turbopack: { root: process.cwd() },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  poweredByHeader: false,
  experimental: {
    // Assignment files are bounded at 10 MiB in the domain and private Storage bucket.
    // Leave room for multipart boundaries and the other submitted form fields.
    serverActions: { bodySizeLimit: "12mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
