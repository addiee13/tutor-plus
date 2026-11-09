// Local-only ended lesson fixture. No real provider, payment or charge is involved.
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
const directory = process.env.TUTORPLUS_NATIVE_RUNTIME_DIR || "/tmp/tutorplus-native-runtime";
const env = Object.fromEntries(
  (await readFile(`${directory}/app.env`, "utf8"))
    .trim()
    .split("\n")
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin !== "http://127.0.0.1:55440")
  throw new Error("Refusing non-isolated runtime");
const fixture = JSON.parse(await readFile(`${directory}/fixtures.json`, "utf8"));
for (const key of ["tutorListingId", "studentId", "subjectId"]) {
  if (!/^[0-9a-f-]{36}$/i.test(fixture[key])) throw new Error("Missing validated local fixture identifier");
}
const end = new Date(Date.now() - 3600000);
end.setUTCSeconds(0, 0);
const start = new Date(end.getTime() - 3600000);
if (start.getUTCDate() !== end.getUTCDate() || start.getUTCHours() < 1 || end.getUTCHours() > 22) {
  throw new Error("Use a same-day non-midnight ended fixture interval for this local run");
}
const sql = `
begin;
set local timezone='UTC';
insert into public.availability_exceptions(tutor_id,local_date,local_start,local_end,timezone,exception_type,reason)
 select :'tutor'::uuid, :'start'::timestamptz::date,'00:00','23:59','UTC','additional','Explicit native ended-lesson test fixture'
 where not exists(select 1 from public.bookings where student_id=:'student'::uuid and request_key='native-ended-fixture');
insert into public.bookings(student_id,tutor_id,subject_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
 mode,price_minor,platform_fee_minor,currency,status,hold_expires_at,policy_snapshot,request_key)
 select :'student'::uuid,t.id,:'subject'::uuid,:'start'::timestamptz,:'end'::timestamptz,
 :'start'::timestamptz-interval '10 minutes',:'end'::timestamptz+interval '10 minutes','virtual',t.hourly_rate_minor,0,t.currency,
 'payment_pending',statement_timestamp()+interval '15 minutes','{"fixture":true,"provider":"none","charge":false}'::jsonb,'native-ended-fixture'
 from public.tutor_profiles t where t.id=:'tutor'::uuid
 and not exists(select 1 from public.bookings where student_id=:'student'::uuid and request_key='native-ended-fixture');
select id from public.bookings where student_id=:'student'::uuid and request_key='native-ended-fixture';
commit;`;
const output = execFileSync(
  "/opt/homebrew/opt/postgresql@17/bin/psql",
  [
    "-X",
    "-q",
    "-t",
    "-A",
    "-h",
    directory,
    "-p",
    "55438",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-v",
    `tutor=${fixture.tutorListingId}`,
    "-v",
    `student=${fixture.studentId}`,
    "-v",
    `subject=${fixture.subjectId}`,
    "-v",
    `start=${start.toISOString()}`,
    "-v",
    `end=${end.toISOString()}`,
  ],
  { input: sql, encoding: "utf8" },
).trim();
if (!/^[0-9a-f-]{36}$/i.test(output)) throw new Error("Ended fixture identifier was not returned");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const privileged = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);
const tutor = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const login = await tutor.auth.signInWithPassword({ email: fixture.tutorEmail, password: fixture.password });
if (login.error) throw new Error("Local tutor sign-in failed");
const state = await tutor.from("bookings").select("status").eq("id", output).single();
if (state.error) throw new Error("Ended fixture state cannot be read");
if (state.data.status === "payment_pending") {
  const prepared = await privileged.rpc("prepare_booking_payment", {
    booking: output,
    request_key: "native-ended-fixture",
  });
  if (prepared.error) throw new Error("Ended fixture preparation failed");
  const event = await privileged.rpc("apply_verified_payment_event", {
    payment: prepared.data,
    event_id: "native-ended-explicit-fixture",
    requested_state: "paid",
    occurred_at: new Date().toISOString(),
    provider_payment_id: "native-ended-no-provider-no-charge",
  });
  if (event.error) throw new Error("Ended fixture confirmation failed");
}
if (state.data.status !== "completed") {
  const meeting = await tutor.rpc("save_booking_private_details", {
    booking: output,
    meeting_url: "https://meet.example.invalid/native-ended-fixture",
    meeting_place: null,
  });
  if (meeting.error) throw new Error("Ended fixture meeting setup failed");
  const completed = await tutor.rpc("mark_session_completed", { booking: output });
  if (completed.error) throw new Error("Local booked tutor completion failed");
}
fixture.completedBookingId = output;
await writeFile(`${directory}/fixtures.json`, JSON.stringify(fixture), { mode: 0o600 });
await tutor.auth.signOut({ scope: "local" });
console.log("PASS: ended fixture completed by its booked tutor; ID retained privately; no provider or charge.");
