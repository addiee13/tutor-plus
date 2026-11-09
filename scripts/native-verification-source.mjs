import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
/** Identical build/benchmark source scope; generated docs/evidence do not affect it. */
export async function sourceDigest() {
  const files = execFileSync("rg", ["--files", "src", "supabase/migrations"], { encoding: "utf8" }).trim().split("\n");
  files.push("next.config.ts", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.verification.json");
  const digest = createHash("sha256");
  for (const file of files.sort())
    digest
      .update(file)
      .update("\0")
      .update(await readFile(file))
      .update("\0");
  return digest.digest("hex");
}
