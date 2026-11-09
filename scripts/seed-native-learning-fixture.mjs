// Explicit local-only booking fixture for learning tests. No payment provider is called.
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const directory = process.env.TUTORPLUS_NATIVE_RUNTIME_DIR || "/tmp/tutorplus-native-runtime";
const environment = Object.fromEntries(
  (await readFile(`${directory}/app.env`, "utf8"))
    .trim()
    .split("\n")
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
const url = environment.NEXT_PUBLIC_SUPABASE_URL;
if (new URL(url).origin !== "http://127.0.0.1:55440") throw new Error("Refusing non-isolated runtime");
const fixtures = JSON.parse(await readFile(`${directory}/fixtures.json`, "utf8"));
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const tutor = createClient(url, environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const student = createClient(url, environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const privileged = createClient(url, environment.SUPABASE_SERVICE_ROLE_KEY, options);
for (const [name, client] of [
  ["tutor", tutor],
  ["student", student],
]) {
  const login = await client.auth.signInWithPassword({ email: fixtures[`${name}Email`], password: fixtures.password });
  if (login.error) throw new Error(`Local ${name} sign-in failed`);
}
const listing = await tutor
  .from("tutor_profiles")
  .select("id,publication_state")
  .eq("user_id", fixtures.tutorId)
  .single();
if (listing.error || listing.data.publication_state !== "published")
  throw new Error("First publish the local tutor listing through the UI");
const subjects = await tutor.from("tutor_subjects").select("subject_id").eq("tutor_id", listing.data.id).limit(1);
if (subjects.error || !subjects.data?.length) throw new Error("Local listing needs a subject");
const start = new Date();
start.setUTCHours(12, 0, 0, 0);
let days = (1 - start.getUTCDay() + 7) % 7;
if (days === 0 && start.getTime() < Date.now() + 3600000) days = 7;
start.setUTCDate(start.getUTCDate() + days);
const end = new Date(start.getTime() + 3600000);
const requestKey = `native-learning-fixture-${start.toISOString().slice(0, 10)}`;
const booking = await student.rpc("create_booking", {
  tutor: listing.data.id,
  subject: subjects.data[0].subject_id,
  starts_at: start.toISOString(),
  ends_at: end.toISOString(),
  mode: "virtual",
  request_key: requestKey,
});
if (booking.error) throw new Error(`Local fixture reservation failed: ${booking.error.code}`);
const state = await student.from("bookings").select("status").eq("id", booking.data).single();
if (state.error) throw new Error("Local fixture state read failed");
if (state.data.status === "payment_pending") {
  const prepared = await privileged.rpc("prepare_booking_payment", { booking: booking.data, request_key: requestKey });
  if (prepared.error) throw new Error(`Local fixture preparation failed: ${prepared.error.code}`);
  const confirmed = await privileged.rpc("apply_verified_payment_event", {
    payment: prepared.data,
    event_id: `${requestKey}-explicit-fixture`,
    requested_state: "paid",
    occurred_at: new Date().toISOString(),
    provider_payment_id: "native-fixture-no-provider-no-charge",
  });
  if (confirmed.error) throw new Error(`Local fixture event failed: ${confirmed.error.code}`);
}
const details = await tutor.rpc("save_booking_private_details", {
  booking: booking.data,
  meeting_url: "https://meet.example.invalid/native-learning-fixture",
  meeting_place: null,
});
if (details.error) throw new Error(`Local meeting fixture failed: ${details.error.code}`);
fixtures.confirmedBookingId = booking.data;
fixtures.tutorListingId = listing.data.id;
fixtures.subjectId = subjects.data[0].subject_id;
await writeFile(`${directory}/fixtures.json`, JSON.stringify(fixtures), { mode: 0o600 });
await Promise.all([tutor.auth.signOut({ scope: "local" }), student.auth.signOut({ scope: "local" })]);
console.log(
  "PASS: explicit local fixture confirmed for learning tests; no provider or charge; ID retained in local fixtures.json.",
);
