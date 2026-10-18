import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

async function verifyMailbox(email) {
  const mailUrl = process.env.LOCAL_MAIL_URL || "http://127.0.0.1:54324";
  for (let attempt = 0; attempt < 40; attempt++) {
    const messages = await fetch(`${mailUrl}/api/v1/messages`).then((response) => response.json());
    const message = messages.messages?.find((entry) => entry.To?.some((recipient) => recipient.Address === email));
    if (message) {
      const body = await fetch(`${mailUrl}/api/v1/message/${message.ID}`).then((response) => response.json());
      const links = `${body.HTML || ""} ${body.Text || ""}`.match(/https?:\/\/[^"<>\s]+/g) || [];
      const link = links.find((value) => value.includes("/auth/v1/verify"));
      if (!link) throw new Error("Local verification message did not contain a supported link.");
      const response = await fetch(link.replaceAll("&amp;", "&"), { redirect: "manual" });
      if (response.status < 300 || response.status >= 400 || response.headers.get("location")?.includes("error="))
        throw new Error("Mailbox verification failed.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Local verification email was not received.");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Fixtures are allowed only on local Supabase.");
  const identity = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const accounts = [
    { prefix: "SUPABASE_TEST", name: "Alex Learner", role: "student", verify: true },
    { prefix: "SUPABASE_OTHER_TEST", name: "Jordan Tutor", role: "tutor", verify: true },
    { prefix: "SUPABASE_ADMIN_TEST", name: "Morgan Administrator", role: "student", verify: true },
    { prefix: "SUPABASE_UNVERIFIED_TEST", name: "Pending Learner", role: "student", verify: false },
  ];
  const additions = {};
  const ids = {};
  for (const account of accounts) {
    const email = `${account.prefix.toLowerCase()}-${suffix}@example.test`;
    const password = randomBytes(25).toString("base64url");
    const signup = await identity.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: account.name,
          timezone: "America/New_York",
          adult_attested: true,
          initial_role: account.role,
        },
        emailRedirectTo: "http://localhost:3000/auth/callback",
      },
    });
    if (signup.error || !signup.data.user || signup.data.session)
      throw new Error("Fixture signup or required verification configuration failed.");
    if (account.verify) {
      await verifyMailbox(email);
      const login = await identity.auth.signInWithPassword({ email, password });
      if (login.error || !login.data.user?.email_confirmed_at) throw new Error("Verified fixture login failed.");
      const grants = await identity.from("user_roles").select("role").eq("user_id", login.data.user.id);
      if (grants.error || !grants.data?.some((grant) => grant.role === account.role))
        throw new Error("Provisioned fixture capability did not match signup intent.");
      await identity.auth.signOut({ scope: "local" });
    }
    additions[`${account.prefix}_EMAIL`] = email;
    additions[`${account.prefix}_PASSWORD`] = password;
    additions[`${account.prefix}_USER_ID`] = signup.data.user.id;
    ids[account.prefix] = signup.data.user.id;
  }
  additions.BOOTSTRAP_ADMIN_USER_ID = ids.SUPABASE_ADMIN_TEST;
  additions.SUPABASE_TEST_ALLOW_MUTATIONS = "true";
  const original = await readFile(".env.local", "utf8");
  const updated =
    original
      .split("\n")
      .filter((line) => !Object.keys(additions).includes(line.split("=")[0]))
      .join("\n")
      .trimEnd() +
    "\n" +
    Object.entries(additions)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") +
    "\n";
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
    JSON.stringify({ verification: "Local Mailpit email links followed; not external inbox delivery", ids }, null, 2),
  );
}

main().catch(() => {
  console.error(
    "Local fixture creation failed; no secrets were printed. Check local Auth, migrations, and Mailpit privately.",
  );
  process.exitCode = 1;
});
