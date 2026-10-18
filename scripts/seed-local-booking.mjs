import { appendFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const endpoint = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!endpoint || !["127.0.0.1", "localhost"].includes(new URL(endpoint).hostname)) {
  throw new Error("This fixture command is restricted to the local disposable Supabase stack.");
}
if (process.env.SUPABASE_TEST_ALLOW_MUTATIONS !== "true") {
  throw new Error("Disposable-test mutation authorization is required.");
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const catalog = createClient(endpoint, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const tutorClient = createClient(endpoint, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const login = await tutorClient.auth.signInWithPassword({
  email: process.env.SUPABASE_OTHER_TEST_EMAIL,
  password: process.env.SUPABASE_OTHER_TEST_PASSWORD,
});
if (login.error || !login.data.user?.email_confirmed_at) throw new Error("Verified local Tutor fixture is required.");
async function checked(operation) {
  const result = await operation;
  if (result.error) throw new Error(`Local fixture operation failed: ${result.error.code}`);
  return result.data;
}
const subject = await checked(catalog.from("subjects").select("id").eq("slug", "math").eq("active", true).single());
let tutor = await checked(
  tutorClient.from("tutor_profiles").select("id").eq("user_id", login.data.user.id).maybeSingle(),
);
if (!tutor) {
  tutor = await checked(
    tutorClient
      .from("tutor_profiles")
      .insert({
        user_id: login.data.user.id,
        public_display_name: "Local demonstration tutor",
        headline: "Mathematics fixture for Sprint 2 verification",
        bio: "Disposable local fixture, not a real tutor or a certification claim.",
        hourly_rate_minor: 2500,
        currency: "USD",
        supports_virtual: true,
        supports_in_person: false,
      })
      .select("id")
      .single(),
  );
}
const linked = await checked(
  tutorClient.from("tutor_subjects").select("subject_id").eq("tutor_id", tutor.id).eq("subject_id", subject.id),
);
if (!linked.length)
  await checked(tutorClient.from("tutor_subjects").insert({ tutor_id: tutor.id, subject_id: subject.id }));
const rules = await checked(tutorClient.from("availability_rules").select("weekday").eq("tutor_id", tutor.id));
const today = new Date().toISOString().slice(0, 10);
for (let weekday = 0; weekday < 7; weekday += 1) {
  if (!rules.some((rule) => rule.weekday === weekday)) {
    await checked(
      tutorClient.from("availability_rules").insert({
        tutor_id: tutor.id,
        weekday,
        local_start: "08:00:00",
        local_end: "22:00:00",
        timezone: "UTC",
        valid_from: today,
      }),
    );
  }
}
await checked(tutorClient.from("tutor_profiles").update({ publication_state: "published" }).eq("id", tutor.id));
const start = new Date();
start.setUTCDate(start.getUTCDate() + 1);
start.setUTCHours(18, 0, 0, 0);
const end = new Date(start.getTime() + 60 * 60 * 1000);
const fields = {
  BOOKING_E2E: "1",
  BOOKING_E2E_STUDENT_EMAIL: process.env.SUPABASE_TEST_EMAIL,
  BOOKING_E2E_STUDENT_PASSWORD: process.env.SUPABASE_TEST_PASSWORD,
  BOOKING_E2E_TUTOR_ID: tutor.id,
  BOOKING_E2E_SUBJECT_ID: subject.id,
  BOOKING_E2E_STARTS_AT: start.toISOString(),
  BOOKING_E2E_ENDS_AT: end.toISOString(),
  BOOKING_E2E_MODE: "virtual",
};
await appendFile(
  ".env.local",
  "\n" +
    Object.entries(fields)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join("\n") +
    "\n",
  { mode: 0o600 },
);
await tutorClient.auth.signOut({ scope: "local" });
console.log(
  JSON.stringify({
    fixture: "local only",
    tutor_id: tutor.id,
    subject_id: subject.id,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
  }),
);
