// Captures the public GitHub repository (sprint3 branch), pull request and project board pages for the report.
import { chromium } from "@playwright/test";

const out = process.env.OUT_DIR ?? "docs/evidence/screenshots/sprint3";
const pages = [
  ["github-01-repo-sprint3-branch", "https://github.com/addiee13/tutor-plus/tree/sprint3"],
  ["github-02-pull-request", "https://github.com/addiee13/tutor-plus/pull/1"],
  ["github-03-project-board", "https://github.com/users/addiee13/projects/1?filterQuery=S3-"],
];
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
for (const [name, url] of pages) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log(`captured ${name} from ${url}`);
}
await browser.close();
