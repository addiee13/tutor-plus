// Redact credential-bearing text artifacts before copying or sharing test evidence.
import assert from "node:assert/strict";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
const directory = path.resolve(process.argv[2] || "/tmp/tutorplus-production-final");
assert.ok(directory.startsWith("/tmp/tutorplus-"), "Only this task's temporary artifacts may be redacted");
const runtime = "/tmp/tutorplus-native-runtime";
const fixture = JSON.parse(await readFile(`${runtime}/fixtures.json`, "utf8"));
const settings = Object.fromEntries(
  (await readFile(`${runtime}/app.env`, "utf8"))
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
const secrets = [
  fixture.password,
  ...Object.entries(settings)
    .filter(([name]) => /KEY|SECRET|PASSWORD/.test(name))
    .map(([, value]) => value),
].filter((value) => typeof value === "string" && value.length > 5);
let files = 0;
async function walk(folder) {
  for (const name of await readdir(folder)) {
    const file = path.join(folder, name);
    const info = await lstat(file);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      await walk(file);
      continue;
    }
    if (!/\.(json|md|log|txt)$/.test(name)) continue;
    let content = await readFile(file, "utf8");
    for (const secret of secrets) content = content.replaceAll(secret, "[redacted]");
    content = content
      .replace(/(token_hash=|token=|code=|access_token=|refresh_token=)[^&\s"'<>`]+/g, "$1[redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
      .replace(/("(?:access_token|refresh_token)"\s*:\s*")[^"]+"/g, '$1[redacted]"')
      .replace(/("value"\s*:\s*")base64-[A-Za-z0-9_-]+"/g, '$1[redacted-cookie]"');
    await writeFile(file, content, { mode: 0o600 });
    files++;
  }
}
await walk(directory);
console.log(`PASS sanitized ${files} temporary text artifacts without printing their contents`);
