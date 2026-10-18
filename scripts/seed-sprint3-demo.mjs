// Sprint 3 DEMO FIXTURE. Creates clearly labelled demo-only accounts and bookings so the UC-09 planner/recap and
// UC-07 review flows can be demonstrated end to end. It is NOT a payment: Stripe/checkout is not implemented, so
// each booking is confirmed by applying a "demo-fixture" event through the same server-only provider-boundary
// functions a verified webhook would use, and the already-ended booking is inserted by the database owner because
// the public booking RPC (correctly) refuses past start times. Everything else uses the real user-scoped RPCs.
//
// Usage (never commit the env file; the password is supplied at run time and never printed):
//   SEED_DEMO_CONFIRM=sprint3-demo SPRINT3_DEMO_PASSWORD='…' node --env-file=.env.cloud scripts/seed-sprint3-demo.mjs
// Optional: SEED_DB_URL=postgresql://… to target a local stack instead of the linked project (`supabase db query`).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SPRINT3_DEMO_PASSWORD;
if (process.env.SEED_DEMO_CONFIRM !== "sprint3-demo") {
  throw new Error("Set SEED_DEMO_CONFIRM=sprint3-demo to create Sprint 3 demo fixture data.");
}
if (!url || !publishable || !serviceKey) throw new Error("Supabase URL, publishable key and service key are required.");
if (!password || password.length < 12) throw new Error("SPRINT3_DEMO_PASSWORD (12+ characters) is required.");

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, options);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const ACCOUNTS = {
  student: { email: "sprint3.student@example.com", name: "Maya Chen", role: "student" },
  tutor: { email: "sprint3.tutor@example.com", name: "Daniel Brooks", role: "tutor" },
  other: { email: "sprint3.other@example.com", name: "Riley Park", role: "student" },
};

function checked(result, step) {
  if (result.error)
    throw new Error(
      `${step} failed: ${result.error.code ?? result.error.status ?? "error"} ${result.error.message ?? ""}`,
    );
  return result.data;
}

function sql(statement) {
  const directory = mkdtempSync(join(tmpdir(), "tutorplus-seed-"));
  const file = join(directory, "fixture.sql");
  writeFileSync(file, statement, { mode: 0o600 });
  const target = process.env.SEED_DB_URL ? ["--db-url", process.env.SEED_DB_URL] : ["--linked"];
  const output = execFileSync("supabase", ["db", "query", ...target, "-f", file, "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)).rows ?? [];
}

async function findUser(email) {
  for (let page = 1; page < 50; page += 1) {
    const { users } = checked(await admin.auth.admin.listUsers({ page, perPage: 200 }), "list users");
    const match = users.find((user) => user.email === email);
    if (match || users.length < 200) return match ?? null;
  }
  return null;
}

async function ensureAccount({ email, name, role }) {
  const existing = await findUser(email);
  if (existing) {
    checked(
      await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true }),
      "reset demo password",
    );
    return existing.id;
  }
  const created = checked(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name, timezone: "America/New_York", adult_attested: true, initial_role: role },
    }),
    "create demo account",
  );
  return created.user.id;
}

async function signIn(email) {
  const client = createClient(url, publishable, options);
  const session = checked(await client.auth.signInWithPassword({ email, password }), `sign in ${email}`);
  if (!session.user?.email_confirmed_at) throw new Error("Demo account is not email-confirmed.");
  return client;
}

async function confirmWithDemoPaymentEvent(bookingId) {
  const payment = checked(
    await admin.rpc("prepare_booking_payment", { booking: bookingId, request_key: `demo-fixture-pay-${bookingId}` }),
    "prepare demo payment",
  );
  checked(
    await admin.rpc("apply_verified_payment_event", {
      payment,
      event_id: `demo-fixture-evt-${bookingId}`,
      requested_state: "paid",
      occurred_at: new Date().toISOString(),
      provider_payment_id: `demo_fixture_${bookingId}`,
    }),
    "apply demo payment event",
  );
  const details = await admin.from("booking_private_details").select("booking_id").eq("booking_id", bookingId);
  if (!checked(details, "read meeting details").length) {
    checked(
      await admin.from("booking_private_details").insert({
        booking_id: bookingId,
        meeting_url: "https://meet.example.com/tutorplus-sprint3-demo",
      }),
      "add demo meeting link",
    );
  }
}

function utcSlot(daysFromToday, hour) {
  const start = new Date();
  start.setUTCHours(hour, 0, 0, 0);
  start.setTime(start.getTime() + daysFromToday * DAY);
  return { starts: start, ends: new Date(start.getTime() + HOUR) };
}

const ids = {};
for (const [key, account] of Object.entries(ACCOUNTS)) ids[key] = await ensureAccount(account);

// Tutor listing, subject, weekly availability and publication through the tutor's own RLS-scoped session.
const tutorClient = await signIn(ACCOUNTS.tutor.email);
const subject = checked(
  await tutorClient.from("subjects").select("id,name").eq("slug", "math").eq("active", true).single(),
  "read subject",
);
let tutor = checked(
  await tutorClient.from("tutor_profiles").select("id").eq("user_id", ids.tutor).maybeSingle(),
  "read tutor listing",
);
if (!tutor) {
  tutor = checked(
    await tutorClient
      .from("tutor_profiles")
      .insert({
        user_id: ids.tutor,
        public_display_name: "Daniel Brooks",
        headline: "Algebra and pre-calculus coaching (Sprint 3 demo listing)",
        bio: "Demo fixture tutor created for the Tutor Plus Sprint 3 walkthrough. Not a real tutor or credential claim.",
        hourly_rate_minor: 4500,
        currency: "USD",
        supports_virtual: true,
        supports_in_person: false,
      })
      .select("id")
      .single(),
    "create tutor listing",
  );
}
const links = checked(
  await tutorClient.from("tutor_subjects").select("subject_id").eq("tutor_id", tutor.id),
  "read tutor subjects",
);
if (!links.some((link) => link.subject_id === subject.id)) {
  checked(
    await tutorClient.from("tutor_subjects").insert({ tutor_id: tutor.id, subject_id: subject.id }),
    "link subject",
  );
}
const rules = checked(
  await tutorClient.from("availability_rules").select("weekday").eq("tutor_id", tutor.id),
  "read availability",
);
const validFrom = new Date(Date.now() - 21 * DAY).toISOString().slice(0, 10);
for (let weekday = 0; weekday < 7; weekday += 1) {
  if (!rules.some((rule) => rule.weekday === weekday)) {
    checked(
      await tutorClient.from("availability_rules").insert({
        tutor_id: tutor.id,
        weekday,
        local_start: "08:00:00",
        local_end: "22:00:00",
        timezone: "UTC",
        valid_from: validFrom,
      }),
      "add availability",
    );
  }
}
checked(
  await tutorClient.from("tutor_profiles").update({ publication_state: "published" }).eq("id", tutor.id),
  "publish listing",
);

const studentClient = await signIn(ACCOUNTS.student.email);
const studentBookings = checked(
  await studentClient.from("bookings").select("id,status,starts_at,ends_at").eq("tutor_id", tutor.id),
  "read student bookings",
);

// 1. Upcoming confirmed session for the planner, requested through the real student RPC.
let upcoming = studentBookings.find(
  (b) => ["confirmed", "payment_pending"].includes(b.status) && Date.parse(b.starts_at) > Date.now() + HOUR,
);
if (!upcoming) {
  const slot = utcSlot(2, 15);
  const id = checked(
    await studentClient.rpc("create_booking", {
      tutor: tutor.id,
      subject: subject.id,
      starts_at: slot.starts.toISOString(),
      ends_at: slot.ends.toISOString(),
      mode: "virtual",
      request_key: `sprint3-demo-upcoming-${slot.starts.toISOString().slice(0, 10)}`,
    }),
    "request upcoming booking",
  );
  upcoming = { id, status: "payment_pending" };
}
if (upcoming.status === "payment_pending") await confirmWithDemoPaymentEvent(upcoming.id);

// 2. An already-ended session for the recap and the review. Reuse one that has not been reviewed yet.
const reviewed = checked(await studentClient.from("reviews").select("booking_id"), "read reviews").map(
  (r) => r.booking_id,
);
let past = studentBookings.find(
  (b) =>
    Date.parse(b.ends_at) < Date.now() && ["confirmed", "completed"].includes(b.status) && !reviewed.includes(b.id),
);
if (!past) {
  const taken = new Set(studentBookings.map((b) => b.starts_at.slice(0, 10)));
  let offset = -2;
  while (taken.has(utcSlot(offset, 15).starts.toISOString().slice(0, 10)) && offset > -14) offset -= 1;
  const slot = utcSlot(offset, 15);
  const [row] = sql(`
    insert into public.bookings(student_id, tutor_id, subject_id, starts_at, ends_at, blocking_starts_at, blocking_ends_at,
      mode, price_minor, platform_fee_minor, currency, status, hold_expires_at, policy_snapshot, request_key)
    values ('${ids.student}', '${tutor.id}', '${subject.id}', '${slot.starts.toISOString()}', '${slot.ends.toISOString()}',
      '${new Date(slot.starts.getTime() - 10 * 60000).toISOString()}', '${new Date(slot.ends.getTime() + 10 * 60000).toISOString()}',
      'virtual', 4500, 0, 'USD', 'payment_pending', now() + interval '15 minutes',
      '{"hourly_rate_minor":4500,"buffer_minutes":10,"hold_minutes":15,"fee_basis_points":0,"fixture":"sprint3-demo-past-session"}',
      'sprint3-demo-past-${slot.starts.toISOString().slice(0, 10)}')
    returning id;`);
  past = { id: row.id, status: "payment_pending" };
}
if (past.status === "payment_pending") await confirmWithDemoPaymentEvent(past.id);
if (past.status !== "completed") {
  // Preparation saved through the real planner RPCs while the ended session is still confirmed.
  checked(
    await studentClient.rpc("save_session_goals", {
      booking: past.id,
      goals: "Get comfortable factoring quadratics with a leading coefficient.",
      questions: "How do I decide between factoring and the quadratic formula?",
    }),
    "save past goals",
  );
  checked(
    await tutorClient.rpc("save_session_agenda", {
      booking: past.id,
      agenda: "1. Warm-up: GCF factoring\n2. AC method walkthrough\n3. Choosing a method\n4. Five practice problems",
    }),
    "save past agenda",
  );
  checked(await tutorClient.rpc("mark_session_completed", { booking: past.id }), "mark session delivered");
}

await Promise.all([tutorClient.auth.signOut({ scope: "local" }), studentClient.auth.signOut({ scope: "local" })]);
console.log(
  JSON.stringify(
    {
      fixture:
        "Sprint 3 demo data (demo-only accounts; confirmations use demo-fixture provider events, not real payments)",
      accounts: Object.fromEntries(
        Object.entries(ACCOUNTS).map(([key, value]) => [key, { email: value.email, id: ids[key] }]),
      ),
      tutor_profile_id: tutor.id,
      subject: subject.name,
      upcoming_booking_id: upcoming.id,
      completed_booking_id: past.id,
    },
    null,
    2,
  ),
);
