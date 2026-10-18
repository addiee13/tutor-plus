// Render draw.io sources to PNG with the official diagrams.net viewer.
// Usage: node docs/diagrams/render-drawio.mjs source/usecase-uc01-sprint2.drawio [...]
// Requires network access to viewer.diagrams.net and the project's Playwright package.
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const diagramDir = dirname(fileURLToPath(import.meta.url));
const renderedDir = join(diagramDir, "rendered");
const files = process.argv.slice(2).map((file) => resolve(diagramDir, file));

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2.5, viewport: { width: 1600, height: 1200 } });
for (const file of files) {
  const config = JSON.stringify({ xml: readFileSync(file, "utf8"), toolbar: "", border: 24, nav: false, resize: false });
  await page.setContent(
    `<html><body style="margin:0;background:#fff"><div id="graph" class="mxgraph" data-mxgraph='${config.replace(/&/g, "&amp;").replace(/'/g, "&#39;")}'></div>` +
      `<script src="https://viewer.diagrams.net/js/viewer-static.min.js"></script></body></html>`,
    { waitUntil: "networkidle" },
  );
  const figure = page.locator("#graph svg");
  await figure.waitFor();
  const output = join(renderedDir, basename(file, ".drawio") + ".png");
  await figure.screenshot({ path: output, omitBackground: false });
  console.log("rendered", output);
}
await browser.close();
