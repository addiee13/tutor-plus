// Renders real query results from the linked Supabase project into a light, print-friendly HTML page and
// screenshots it, as database evidence for the Sprint 3 report. Queries run with `supabase db query --linked`
// (read-only SELECTs); nothing is written. Long text is truncated for display only.
//   node scripts/render-db-evidence.mjs        (requires a linked Supabase CLI session)
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const out = process.env.OUT_DIR ?? "docs/evidence/screenshots/sprint3";
const directory = mkdtempSync(join(tmpdir(), "tutorplus-db-evidence-"));

function query(sql) {
  const file = join(directory, "query.sql");
  writeFileSync(file, sql);
  const target = process.env.SEED_DB_URL ? ["--db-url", process.env.SEED_DB_URL] : ["--linked"];
  const output = execFileSync("supabase", ["db", "query", ...target, "-f", file, "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)).rows ?? [];
}

const escape = (value) =>
  String(value ?? "NULL").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function table(title, note, rows) {
  if (!rows.length) return `<section><h2>${title}</h2><p class="note">${note}</p><p class="empty">0 rows</p></section>`;
  const columns = Object.keys(rows[0]);
  return `<section><h2>${title}</h2><p class="note">${note}</p><table><thead><tr>${columns
    .map((c) => `<th>${escape(c)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${columns.map((c) => `<td>${escape(row[c])}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></section>`;
}

const short = (column, length = 60) =>
  `case when length(${column}) > ${length} then left(${column}, ${length}) || '…' else ${column} end as ${column.split(".").pop()}`;
const id = (column) => `left(${column}::text, 8) || '…' as ${column.split(".").pop()}`;
const when = (column) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC' as ${column.split(".").pop()}`;

const observed = query("select to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || ' UTC' as at")[0].at;
const rows = {
  bookings:
    query(`select ${id("b.id")}, b.status, ${when("b.starts_at")}, ${when("b.ends_at")}, p.display_name as student,
    t.public_display_name as tutor from public.bookings b join public.profiles p on p.id = b.student_id
    join public.tutor_profiles t on t.id = b.tutor_id where p.display_name = 'Maya Chen' order by b.starts_at`),
  plans: query(`select ${id("booking_id")}, ${short("student_goals", 48)}, ${short("student_questions", 40)},
    ${short("tutor_agenda", 40)}, ${when("student_updated_at")}, ${when("tutor_updated_at")} from public.session_plans order by updated_at`),
  recaps: query(`select ${id("booking_id")}, ${id("tutor_id")}, ${short("summary", 50)}, ${short("mastery_notes", 40)},
    ${short("next_steps", 36)}, revision, ${when("published_at")} from public.session_recaps`),
  reflections: query(`select ${id("booking_id")}, ${id("student_id")}, ${short("reflection", 70)}, ${when("updated_at")}
    from public.session_reflections`),
  reviews: query(`select ${id("id")}, ${id("booking_id")}, ${id("student_id")}, ${id("tutor_id")}, rating,
    ${short("comment", 50)}, status, ${when("created_at")} from public.reviews`),
  summaries:
    query(`select ${id("s.tutor_id")}, t.public_display_name, s.rating_count, s.rating_sum, s.rating_avg, ${when("s.updated_at")}
    from public.tutor_rating_summaries s join public.tutor_profiles t on t.id = s.tutor_id`),
  inventory: query(`select c.relname as table_name, c.relrowsecurity as rls_enabled,
    (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
    (select count(*) from pg_constraint k where k.conrelid = c.oid) as constraints,
    (select count(*) from pg_trigger g where g.tgrelid = c.oid and not g.tgisinternal) as triggers,
    c.reltuples::bigint as est_rows
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('session_plans','session_recaps','session_reflections',
      'reviews','tutor_rating_summaries','assessments','assessment_questions','assessment_answer_keys','assessment_attempts',
      'assignments','assignment_submissions','assignment_feedback') order by c.relname`),
  counts: query(`select 'session_plans' as table_name, count(*) as rows from public.session_plans union all
    select 'session_recaps', count(*) from public.session_recaps union all
    select 'session_reflections', count(*) from public.session_reflections union all
    select 'reviews', count(*) from public.reviews union all
    select 'tutor_rating_summaries', count(*) from public.tutor_rating_summaries union all
    select 'assessments', count(*) from public.assessments union all
    select 'assignments', count(*) from public.assignments`),
  migrations: query(
    `select version, name from supabase_migrations.schema_migrations where version >= '202610180000' order by version`,
  ),
};

const style = `
  body { margin: 0; background: #fcfaf6; color: #193d39; font: 14px/1.5 Arial, Helvetica, sans-serif; }
  main { padding: 36px 44px; }
  h1 { font: 400 34px Georgia, serif; margin: 0 0 6px; letter-spacing: -0.5px; }
  h2 { font: 400 22px Georgia, serif; margin: 30px 0 4px; }
  .eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 2px; }
  .note, .empty { color: #536d68; margin: 0 0 10px; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dce3dc; }
  th { background: #e6eee5; text-align: left; font-size: 12px; padding: 8px 10px; border-bottom: 1px solid #cbd7cd; }
  td { padding: 8px 10px; border-top: 1px solid #edf0e9; font-size: 13px; vertical-align: top; }
  tr:nth-child(even) td { background: #fbfcf9; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }`;

function page(title, subtitle, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${style}</style></head><body><main>
    <span class="eyebrow">TUTOR PLUS · SPRINT 3 · DATABASE EVIDENCE</span><h1>${title}</h1>
    <p class="note">${subtitle} Queried from the linked Supabase PostgreSQL project at ${observed}. IDs shortened and long
    text truncated for display only.</p>${body}</main></body></html>`;
}

const pages = {
  "db-01-sprint3-session-records": page(
    "UC-09 records written by the application",
    "Rows written by the save_session_goals, save_session_agenda, publish_session_recap and save_session_reflection RPCs: the 23f6a1c8 plan, the recap and the reflection through the web UI; the 4920dfaf plan by the demo seed script before that session was completed.",
    table(
      "bookings (demo student)",
      "Upcoming confirmed session and completed session used in the walkthrough. Confirmations come from demo-fixture provider events, not real payments.",
      rows.bookings,
    ) +
      table(
        "session_plans",
        "Student goals/questions and tutor agenda, one row per booking (PK booking_id).",
        rows.plans,
      ) +
      table(
        "session_recaps",
        "Published by the booked tutor after the session ended; revision increments on edit.",
        rows.recaps,
      ) +
      table(
        "session_reflections",
        "Private to the student (RLS: student_id = auth.uid()); shown here only through the database owner role.",
        rows.reflections,
      ),
  ),
  "db-02-sprint3-reviews-ratings": page(
    "UC-07 review and server-computed rating",
    "The review row comes from submit_review; the summary row is maintained by the reviews_refresh_rating trigger.",
    table("reviews", "UNIQUE(booking_id): one review per completed booking; rating CHECK 1–5.", rows.reviews) +
      table("tutor_rating_summaries", "Derived from visible reviews only; not writable by clients.", rows.summaries) +
      `<div class="grid"><div>${table("Row counts", "Assessment and assignment tables are deployed; their UI is next sprint.", rows.counts)}</div><div>${table("Applied Sprint 3 migrations", "supabase_migrations.schema_migrations on the linked project.", rows.migrations)}</div></div>`,
  ),
  "db-03-sprint3-schema-security": page(
    "Sprint 3 tables: RLS, policies, constraints, triggers",
    "Catalog inventory for the twelve tables added for UC-05, UC-07, UC-08 and UC-09.",
    table(
      "public tables added in Sprint 3",
      "est_rows is the planner estimate (pg_class.reltuples; -1 means never analyzed).",
      rows.inventory,
    ),
  ),
};

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
for (const [name, html] of Object.entries(pages)) {
  const file = join(directory, `${name}.html`);
  writeFileSync(file, html);
  const tab = await context.newPage();
  await tab.goto(`file://${file}`);
  await tab.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log(`captured ${out}/${name}.png`);
}
await browser.close();
