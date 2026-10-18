import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname) || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error();
  const client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const additions = {};
  for (const prefix of ["SUPABASE_TEST", "SUPABASE_OTHER_TEST", "SUPABASE_ADMIN_TEST", "SUPABASE_UNVERIFIED_TEST"]) {
    const target = process.env[`${prefix}_USER_ID`];
    if (!target) throw new Error();
    const password = randomBytes(30).toString("base64url");
    const changed = await client.auth.admin.updateUserById(target, { password });
    if (changed.error) throw new Error();
    additions[`${prefix}_PASSWORD`] = password;
  }
  if (process.env.BOOKING_E2E_STUDENT_PASSWORD)
    additions.BOOKING_E2E_STUDENT_PASSWORD = additions.SUPABASE_TEST_PASSWORD;
  const original = await readFile(".env.local", "utf8");
  const updated = original
    .split("\n")
    .map((line) => {
      const key = line.split("=")[0];
      return Object.hasOwn(additions, key) ? `${key}=${additions[key]}` : line;
    })
    .join("\n");
  const patch = `*** Begin Patch\n*** Update File: .env.local\n@@\n${original
    .trimEnd()
    .split("\n")
    .map((line) => `-${line}`)
    .join("\n")}\n${updated
    .trimEnd()
    .split("\n")
    .map((line) => `+${line}`)
    .join("\n")}\n*** End Patch\n`;
  execFileSync("apply_patch", [], { input: patch, stdio: ["pipe", "ignore", "ignore"] });
  console.log(
    "All disposable local fixture passwords rotated. Booking copy synchronized. No credentials were printed; load .env.local afresh.",
  );
}

main().catch(() => {
  console.error(
    "Local credential rotation failed. Inspect Auth privately and synchronize .env.local before further fixture use.",
  );
  process.exitCode = 1;
});
