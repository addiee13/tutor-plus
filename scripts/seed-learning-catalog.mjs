import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

// Run with Node's --env-file option. Never place provider credentials or account emails in this file.
const apply = process.argv.includes("--apply");
const adminId = process.argv[process.argv.indexOf("--admin-user-id") + 1];
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url !== "https://lpuvrkmpfzoxtweagdcl.supabase.co") throw new Error("Expected the linked TutorPlus project.");
if (!publicKey || !serviceKey || !/^[0-9a-f-]{36}$/i.test(adminId ?? ""))
  throw new Error("Set the Supabase environment and pass --admin-user-id UUID.");
const catalog = JSON.parse(await readFile(new URL("./seed-data/learning-catalog.json", import.meta.url), "utf8"));
const check = (response, operation) => {
  if (response.error) throw new Error(`${operation} failed (${response.error.code ?? "provider_error"}).`);
  return response.data;
};
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const user = check(await admin.auth.admin.getUserById(adminId), "Resolve catalog administrator").user;
if (!user?.email || !user.email_confirmed_at) throw new Error("Use an existing verified administrator account.");
// Generates a verification token without sending email or changing a password.
const link = check(
  await admin.auth.admin.generateLink({ type: "magiclink", email: user.email }),
  "Create verification session",
);
const client = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
check(
  await client.auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token }),
  "Verify administrator session",
);
try {
  const roles = check(await client.from("user_roles").select("role").eq("user_id", adminId), "Read actor roles");
  if (!roles.some((row) => row.role === "administrator")) throw new Error("Administrator capability required.");
  const subjects = check(await client.from("subjects").select("id,name").eq("active", true), "Read active subjects");
  const subjectId = (name) => {
    const subject = subjects.find((row) => row.name === name);
    if (!subject) throw new Error(`Missing active subject: ${name}`);
    return subject.id;
  };
  const resources = check(await client.from("resources").select("id,url,active"), "Read existing resources");
  const templates = check(
    await client.rpc("admin_read_assessment_templates", { page_size: 200, page_offset: 0 }),
    "Read assessment templates",
  );
  const result = {
    mode: apply ? "apply" : "preview",
    resourcesCreated: 0,
    templatesCreated: 0,
    resourcesSkipped: 0,
    templatesSkipped: 0,
  };
  const reason =
    "Populate shared learning catalog at user request: verified publisher links and original calculus practice; no learner records created.";
  for (const resource of catalog.resources) {
    const subject = subjectId(resource.subject);
    if (resources.some((row) => row.url === resource.url)) {
      result.resourcesSkipped++;
      continue;
    }
    if (apply)
      check(
        await client.rpc("save_resource", {
          resource: null,
          subject,
          resource_title: resource.title,
          resource_description: resource.description,
          resource_url: resource.url,
          resource_type: resource.resourceType,
          resource_attribution: resource.attribution,
          is_active: true,
          confirmed: true,
          reason,
        }),
        "Save curated resource",
      );
    result.resourcesCreated++;
  }
  for (const template of catalog.assessmentTemplates) {
    const subject = subjectId(template.subject);
    if (templates.some((row) => row.title === template.title && row.subject_id === subject)) {
      result.templatesSkipped++;
      continue;
    }
    if (apply)
      check(
        await client.rpc("save_assessment_template", {
          p_template: null,
          p_expected_version: null,
          p_title: template.title,
          p_description: template.description,
          p_subject: subject,
          p_purpose: template.purpose,
          p_questions: template.questions,
          p_active: true,
          p_confirmed: true,
          p_reason: reason,
        }),
        "Save original assessment template",
      );
    result.templatesCreated++;
  }
  if (!apply) {
    result.resourcesPlanned = result.resourcesCreated;
    result.templatesPlanned = result.templatesCreated;
    result.resourcesCreated = 0;
    result.templatesCreated = 0;
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.auth.signOut({ scope: "local" });
}
