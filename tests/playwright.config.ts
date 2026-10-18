import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 2,
  testDir: "./e2e",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true },
});
