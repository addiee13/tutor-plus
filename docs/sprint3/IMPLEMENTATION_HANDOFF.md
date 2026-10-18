# Sprint 3 implementation handoff

Prepared by the implementor agent on 2026-10-18 for the document editor and validator. Everything below was run or captured on 2026-10-18; nothing is projected. Unknown or human-only items are marked **[confirm]**.

## 1. Scope delivered

| Item | State |
| --- | --- |
| Database tables for UC-05, UC-07, UC-08, UC-09 (12 tables) | Implemented as versioned migrations, applied to the linked Supabase project `lpuvrkmpfzoxtweagdcl` |
| Standalone reproducible SQL (dev/test/prod) | `sql/sprint3_tables.sql` (apply after `sql/sprint2_tables.sql`) |
| Frontend + logic: UC-09 Session Planner and Recap | Implemented, deployed, evidenced |
| Frontend + logic: UC-07 Reviews and Ratings | Implemented, deployed, evidenced |
| UC-05 and UC-08 | Database layer only (tables, triggers, RLS, RPCs, SQL tests). No UI this sprint |
| Payments (UC-06) | Still **not implemented**. Demo bookings are confirmed by *demo-fixture* provider events (see §6) |

## 2. Migrations and scripts

| File | Purpose |
| --- | --- |
| `supabase/migrations/202610180001_session_planner_reviews.sql` | UC-09 and UC-07 tables, triggers, RPCs, RLS, grants |
| `supabase/migrations/202610180003_learning_record_boundaries.sql` | End-time planner boundary and subjective-score limit correction |
| `supabase/migrations/202610180002_assessments_assignments.sql` | UC-05 and UC-08 tables, triggers, RPCs, RLS, grants |
| `sql/sprint3_tables.sql` | Concatenation of the three Sprint 3 migrations with a header. Apply with `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/sprint2_tables.sql -f sql/sprint3_tables.sql` |
| `supabase/tests/003_sprint3_learning_records.sql` | 61-check SQL regression (runs in one transaction, then rolls back) |
| `supabase/tests/run-isolated.sh` | Now replays `sql/sprint3_tables.sql` and runs test 003 after the Sprint 2 suite |
| `scripts/seed-sprint3-demo.mjs` | Demo fixture: demo-only accounts, tutor listing, bookings (see §6) |
| `scripts/capture-sprint3.mjs` | Playwright capture of the UI evidence from a running deployment |
| `scripts/render-db-evidence.mjs` | Read-only queries of the linked DB rendered as light HTML tables and screenshotted |
| `scripts/capture-github.mjs` | Screenshots of the public repo branch, PR and project board |

## 3. Database tables (exact)

Conventions: all timestamps are `timestamptz` (UTC); every table has RLS enabled; `anon`, `authenticated` and `service_role` lose all default privileges first and get back only what is listed. Foreign keys are `ON DELETE RESTRICT` unless stated. "PK" = primary key, "FK" = foreign key, "UQ" = unique.

### UC-09 Session Planner and Recap

**session_plans** — one shared planner per booking.

| Column | Type | Constraints |
| --- | --- | --- |
| booking_id | uuid | PK; FK → bookings.id |
| student_goals | text | NULL; length ≤ 2000 |
| student_questions | text | NULL; length ≤ 2000 |
| tutor_agenda | text | NULL; length ≤ 4000 |
| student_updated_at | timestamptz | NULL; CHECK (student_goals IS NULL) = (student_updated_at IS NULL) |
| tutor_updated_at | timestamptz | NULL; CHECK (tutor_agenda IS NULL) = (tutor_updated_at IS NULL) |
| created_at | timestamptz | NOT NULL default now() |
| updated_at | timestamptz | NOT NULL default now() (set by trigger) |

**session_recaps** — tutor's post-session recap.

| Column | Type | Constraints |
| --- | --- | --- |
| booking_id | uuid | PK; FK → bookings.id |
| tutor_id | uuid | NOT NULL; FK → tutor_profiles.id; trigger: must equal bookings.tutor_id |
| summary | text | NOT NULL; trimmed length 1–4000 |
| mastery_notes | text | NULL; length ≤ 2000 |
| next_steps | text | NULL; length ≤ 2000 |
| revision | integer | NOT NULL default 1; > 0; trigger increments on every edit |
| published_at | timestamptz | NOT NULL default now(); trigger keeps the first publication time |
| updated_at | timestamptz | NOT NULL default now(); CHECK updated_at ≥ published_at |

Index: `session_recaps_tutor_idx (tutor_id)`.

**session_reflections** — the student's private reflection.

| Column | Type | Constraints |
| --- | --- | --- |
| booking_id | uuid | PK part 1; FK → bookings.id |
| student_id | uuid | PK part 2; FK → profiles.id; trigger: must equal bookings.student_id |
| reflection | text | NOT NULL; trimmed length 1–4000 |
| created_at | timestamptz | NOT NULL default now() |
| updated_at | timestamptz | NOT NULL default now() |

Index: `session_reflections_student_idx (student_id)`.

Trigger `guard_session_record` (BEFORE INSERT/UPDATE on all three): booking must exist and be `confirmed`/`in_progress`/`completed`; booking_id immutable; recap and reflection only after the session has ended (`completed`, or confirmed/in-progress past `ends_at`); recap author = booked tutor; reflection owner = booked student.

RLS: plans and recaps readable only by the two booking participants (`private.booking_participant`). Reflections readable only where `student_id = auth.uid()` and the caller has the student role — the booked tutor has **no** read path. No table-level INSERT/UPDATE/DELETE grants: writes only through the RPCs below. `service_role` may SELECT plans/recaps but not reflections.

### UC-07 Reviews and Ratings

**reviews**

| Column | Type | Constraints |
| --- | --- | --- |
| id | uuid | PK default gen_random_uuid() |
| booking_id | uuid | NOT NULL; **UQ**; FK → bookings.id (one review per booking) |
| student_id | uuid | NOT NULL; FK → profiles.id; trigger: = bookings.student_id |
| tutor_id | uuid | NOT NULL; FK → tutor_profiles.id; trigger: = bookings.tutor_id |
| rating | smallint | NOT NULL; CHECK 1–5 |
| comment | text | NULL; length ≤ 2000 |
| status | text | NOT NULL default 'visible'; CHECK in ('visible','hidden') |
| moderation_reason | text | NULL; length ≤ 500; CHECK status = 'visible' OR moderation_reason IS NOT NULL |
| created_at | timestamptz | NOT NULL default now() |
| updated_at | timestamptz | NOT NULL default now() |

Indexes: `reviews_tutor_status_idx (tutor_id, status, created_at desc)`, `reviews_student_idx (student_id, created_at desc)`.
Triggers: `reviews_guard` (insert only for a **completed** booking, by its student/tutor pair, starting `visible`; afterwards booking/student/tutor/rating/comment/created_at are immutable — only moderation fields change); `reviews_no_delete` (append-only); `reviews_refresh_rating` (AFTER INSERT or UPDATE OF status → recomputes the summary).

**tutor_rating_summaries** — server-maintained aggregate.

| Column | Type | Constraints |
| --- | --- | --- |
| tutor_id | uuid | PK; FK → tutor_profiles.id |
| rating_count | integer | NOT NULL default 0; ≥ 0 |
| rating_sum | integer | NOT NULL default 0; CHECK between rating_count and rating_count × 5 |
| rating_avg | numeric(3,2) | NULL; CHECK 1–5; CHECK (rating_count = 0) = (rating_avg IS NULL) |
| updated_at | timestamptz | NOT NULL default now() |

Computed only from `visible` reviews, under a per-tutor advisory lock. No client can write it. RLS: `anon` reads summaries of public tutors; `authenticated` reads public tutors' summaries and its own listing's.
Reviews RLS: own reviews (student), visible reviews about the caller's listing (tutor), all (administrator). `anon` has no access to review rows; the public DTO is `list_public_tutor_reviews(tutor)` (rating, comment, created_at only).

### UC-05 Diagnostic Assessment

**assessments**

| Column | Type | Constraints |
| --- | --- | --- |
| id | uuid | PK |
| tutor_id | uuid | NOT NULL; FK → tutor_profiles.id |
| student_id | uuid | NOT NULL; FK → profiles.id |
| subject_id | uuid | NOT NULL; FK → subjects.id; composite FK (tutor_id, subject_id) → tutor_subjects |
| booking_id | uuid | NULL; FK → bookings.id (must belong to the same tutor and student) |
| title | text | NOT NULL; trimmed length 1–200 |
| instructions | text | NULL; ≤ 4000 |
| purpose | text | NOT NULL default 'diagnostic'; in ('diagnostic','pre_session','post_session','milestone') |
| status | text | NOT NULL default 'draft'; in ('draft','assigned','submitted','scored') |
| due_at | timestamptz | NULL; finite |
| assigned_at | timestamptz | NULL; CHECK (status = 'draft') = (assigned_at IS NULL) |
| created_at, updated_at | timestamptz | NOT NULL default now() |

Indexes on (tutor_id, status), (student_id, status), subject_id, (tutor_id, subject_id), booking_id. Trigger `assessments_guard`: tutor and student need a confirmed/in-progress/completed booking relationship; starts as draft; ownership immutable; content frozen after assignment; transitions only draft→assigned (requires ≥1 question and a key for every choice question), assigned→submitted (requires a finalized attempt), submitted→scored (requires a scored attempt). `assessments_delete_guard`: only drafts can be deleted.

**assessment_questions**: id uuid PK; assessment_id uuid NOT NULL FK → assessments.id ON DELETE CASCADE; position smallint 1–100; prompt text 1–2000; kind text in ('single_choice','short_answer'); choices jsonb (single_choice: array of 2–10; short_answer: NULL); points smallint 1–100 default 1; created_at. UQ (assessment_id, position). Frozen once the parent is assigned.

**assessment_answer_keys**: question_id uuid PK FK → assessment_questions.id ON DELETE CASCADE; correct_choice text 1–500 (trigger: must be one of the question's choices); created_at. **Tutor-only RLS policy; there is no student policy**, so students can never read keys.

**assessment_attempts**: id uuid PK; assessment_id FK → assessments; student_id FK → profiles; answers jsonb object ≤ 64 KB; status in ('in_progress','submitted','scored'); auto_score int ≥ 0; tutor_score int ≥ 0; score int (0–max_score); max_score int > 0; tutor_feedback text ≤ 4000; submitted_at; scored_at; created_at; updated_at. **UQ (assessment_id, student_id)**; CHECK (status='in_progress') = (submitted_at IS NULL); CHECK (status='scored') = (score and scored_at not null). Finalized answers immutable.

### UC-08 Practice Tasks and Assignment Management

**assignments**: id uuid PK; tutor_id FK → tutor_profiles; student_id FK → profiles; booking_id NULL FK → bookings; title 1–200; instructions 1–4000; submission_type in ('text','link','file') default 'text'; due_at timestamptz NOT NULL finite; accepts_late boolean NOT NULL default false; status in ('draft','assigned','submitted','returned','completed','cancelled') default 'draft'; cancellation_reason ≤ 500 with CHECK (status='cancelled') = (cancellation_reason IS NOT NULL); created_at; updated_at. Trigger `assignments_guard`: relationship check; transitions draft→assigned|cancelled, assigned→submitted|cancelled, submitted→returned|completed, returned→submitted|completed|cancelled; "submitted" requires an unreviewed submission; returning/completing requires feedback.

**assignment_submissions** (append-only): id uuid PK; assignment_id FK → assignments; student_id FK → profiles; attempt_no smallint 1–20 (set by trigger); body ≤ 8000; link_url https ≤ 1000; file_path ≤ 500; file_mime in ('application/pdf','image/png','image/jpeg','text/plain'); file_size_bytes 1–10,485,760; is_late boolean; submitted_at. UQ (assignment_id, attempt_no); at least one of body/link/file; file metadata all-or-none. Trigger `guard_submission`: only the assignee; only while assigned/returned; **refused after due_at unless accepts_late**; must match submission_type. Storage upload is not wired yet (file columns are metadata only).

**assignment_feedback** (append-only): id uuid PK; submission_id uuid **UQ** FK → assignment_submissions; tutor_id FK → tutor_profiles (= assigning tutor); feedback 1–4000; score smallint 0–100 NULL; outcome in ('returned','completed'); created_at. Applies to the latest submission only; inserting it moves the assignment to `outcome`.

RLS: tutor owner full access to own assessments/questions/keys/assignments; students read their non-draft assessments, questions, own attempts, non-draft assignments, own submissions and their feedback. Student writes only through RPCs.

### Relationships and multiplicity

| Relationship | Multiplicity |
| --- | --- |
| bookings — session_plans | 1 — 0..1 |
| bookings — session_recaps | 1 — 0..1 |
| bookings — session_reflections | 1 — 0..1 (one per booked student) |
| tutor_profiles — session_recaps | 1 — 0..* |
| profiles (student) — session_reflections | 1 — 0..* |
| bookings — reviews | 1 — 0..1 (UQ booking_id; only `completed` bookings) |
| profiles (student) — reviews | 1 — 0..* |
| tutor_profiles — reviews | 1 — 0..* |
| tutor_profiles — tutor_rating_summaries | 1 — 0..1 |
| tutor_profiles — assessments; profiles (student) — assessments; subjects — assessments | 1 — 0..* each |
| bookings — assessments | 0..1 — 0..* |
| assessments — assessment_questions | 1 — 1..* (≥1 required before assigning) |
| assessment_questions — assessment_answer_keys | 1 — 0..1 (exactly 1 for single_choice before assigning) |
| assessments — assessment_attempts | 1 — 0..1 per student (UQ assessment_id, student_id) |
| tutor_profiles — assignments; profiles (student) — assignments | 1 — 0..* |
| bookings — assignments | 0..1 — 0..* |
| assignments — assignment_submissions | 1 — 0..20 |
| assignment_submissions — assignment_feedback | 1 — 0..1 |

### RPCs (SECURITY DEFINER, `search_path=''`, EXECUTE granted to `authenticated` unless noted)

| Function | Returns | Rule |
| --- | --- | --- |
| `save_session_goals(booking uuid, goals text, questions text)` | timestamptz | booked student; booking confirmed/in_progress |
| `save_session_agenda(booking uuid, agenda text)` | timestamptz | booked tutor; booking confirmed/in_progress |
| `mark_session_completed(booking uuid)` | text ('completed') | booked tutor; confirmed/in_progress and past ends_at; idempotent; confirmed→in_progress→completed |
| `publish_session_recap(booking uuid, summary text, mastery_notes text, next_steps text)` | timestamptz | booked tutor; session ended; upsert (edit increments revision) |
| `save_session_reflection(booking uuid, reflection text)` | timestamptz | booked student; session ended |
| `submit_review(booking uuid, rating integer, comment text)` | uuid | booked student; booking completed; rating 1–5; duplicate → SQLSTATE 23505 |
| `moderate_review(review uuid, requested_status text, reason text)` | void | administrator; audited in audit_logs |
| `list_public_tutor_reviews(tutor uuid)` | table(rating, comment, created_at) | `anon` + `authenticated`; visible reviews of public tutors |
| `submit_assessment_attempt(assessment uuid, answers jsonb, finalize boolean)` | uuid | assigned student; open and not past due; objective score from private keys |
| `score_assessment_attempt(attempt uuid, tutor_points integer, feedback text)` | void | owning tutor; bounded by max_score |
| `submit_assignment(assignment uuid, body text, link_url text)` | uuid | assignee; trigger enforces due date and state |
| `give_assignment_feedback(submission uuid, feedback text, score integer, outcome text)` | uuid | owning tutor; latest submission |

Error contract: `42501` = not authorized, `22023` = rule refused (state/time/eligibility), `23505` = duplicate.

## 4. Domain layer and routes (implemented names)

Each service module exports functions plus a named object used as the class-diagram name. All services resolve the actor through `getActor(client)` (current DB state), authorize, validate, and use the user-scoped Supabase client (`createUserClient`), so RLS also applies.

**`src/domains/sessions/service.ts` — `SessionPlanService`**

| Method | Parameters → return |
| --- | --- |
| `getWorkspace` | `(client: SupabaseClient, bookingId: string) → Promise<SessionWorkspace>` (role, phase, permissions, booking, tutorName, subjectName, plan, recap, reflection — reflection always `null` for the tutor and never queried) |
| `saveStudentPlan` | `(client, form: FormData) → Promise<string>` (saved-at timestamp) → RPC `save_session_goals` |
| `saveTutorAgenda` | `(client, form) → Promise<string>` → `save_session_agenda` |
| `markSessionCompleted` | `(client, form) → Promise<void>` → `mark_session_completed` |
| `publishRecap` | `(client, form) → Promise<string>` → `publish_session_recap` |
| `saveReflection` | `(client, form) → Promise<string>` → `save_session_reflection` |

`src/domains/sessions/policy.ts`: `resolveSessionRole(actor, booking, ownedTutorIds): SessionRole`, `sessionPhase(booking, now): SessionPhase` ('planning' | 'ended' | 'completed' | 'unavailable'), `sessionPermissions(role, phase): SessionPermissions` (editGoals, editAgenda, markCompleted, publishRecap, writeReflection), `requireSessionPermission(permissions, action)`.
`src/domains/sessions/validation.ts`: `parseSessionTarget`, `parseStudentPlan`, `parseTutorAgenda`, `parseRecap`, `parseReflection`.
`src/domains/sessions/types.ts`: `SessionRole`, `SessionPhase`, `SessionPermissions`, `SessionPlan`, `SessionRecap`, `SessionReflection`, `SessionWorkspace`, `SessionActionState`.

**`src/domains/reviews/service.ts` — `ReviewService`**

| Method | Parameters → return |
| --- | --- |
| `listEligibleBookings` | `(client) → Promise<ReviewableBooking[]>` (student's completed bookings with existing review and tutor rating) |
| `submitReview` | `(client, form: FormData) → Promise<Review>` → RPC `submit_review`; duplicate pre-check + 23505 mapping |
| `getTutorRatingSummary` | `(client) → Promise<TutorReputation[]>` (tutor's summary row + recent visible reviews) |

`src/domains/reviews/policy.ts`: `requireReviewAuthor(actor, booking)`, `isReviewable(booking)`, `canReview(actor)`, `canViewReputation(actor)`, `describeRating(summary)`.
`src/domains/reviews/validation.ts`: `parseReview(form) → { booking, rating, comment }`.
`src/domains/reviews/types.ts`: `Review`, `TutorRatingSummary`, `ReviewableBooking`, `TutorReputation`, `ReviewActionState`, `RATING_MIN`, `RATING_MAX`.

**Server actions** (call the services only): `src/app/(protected)/sessions/[bookingId]/actions.ts` — `saveGoalsAction`, `saveAgendaAction`, `markCompletedAction`, `publishRecapAction`, `saveReflectionAction`; `src/app/(protected)/reviews/actions.ts` — `submitReviewAction`.

**Routes**: `/sessions/[bookingId]` (UC-09 workspace; linked from each confirmed/in-progress/completed booking card on `/bookings`), `/reviews` (UC-07; "Reviews" added to the signed-in navigation), `/dashboard` (tutor rating line). `src/proxy.ts` matcher now includes `/sessions/:path*` and `/reviews/:path*`.

## 5. Hosted deployment and demo credentials

- Production URL: **https://tutorplus-one.vercel.app** (Vercel deployment `tutorplus-pwmz0rvtq-adams-projects-c67ba2f3.vercel.app`, status Ready, deployed 2026-10-18 with `vercel deploy --prod`). Production env vars `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL` exist (values not printed); the hosted login → planner → review flow worked against the cloud database (all 18 UI screenshots were captured from this URL).
- Demo-only accounts (created by `scripts/seed-sprint3-demo.mjs`; no real people; credentials provided privately for the class demo):

| Role | Email | Password |
| --- | --- | --- |
| Student (Maya Chen) | sprint3.student@example.com | Supplied privately at demo time |
| Tutor (Daniel Brooks) | sprint3.tutor@example.com | Supplied privately at demo time |
| Unrelated student (Riley Park) — for the access-denied demo | sprint3.other@example.com | Supplied privately at demo time |

- Demo bookings: upcoming confirmed `23f6a1c8-67a7-4394-b484-e15190fae7de` (2026-10-20 15:00–16:00 UTC); completed `4920dfaf-40b2-4bd2-9208-d59b1b0915db` (2026-10-16 15:00–16:00 UTC). The completed booking is now reviewed (5★); to demo a fresh review live, rerun the seed script, which adds a new unreviewed completed booking.

## 6. Demo fixture honesty note

Payments are not implemented, so a booking cannot legitimately become `confirmed`/`completed` through the UI. The seed script therefore: creates the upcoming booking through the real student RPC `create_booking`; inserts the already-ended booking directly as the database owner (the public RPC correctly refuses past start times); confirms both by calling the server-only provider-boundary functions `prepare_booking_payment` + `apply_verified_payment_event` with events named `demo-fixture-evt-…` (**no money moved, no Stripe**); adds a placeholder meeting link; leaves historical preparation empty because planner writes close at session end; and marks it delivered via the tutor's real `mark_session_completed` RPC. Report text must call these "demo fixture data", not payments.

## 7. Evidence (all in `docs/evidence/screenshots/sprint3/`)

UI images: 1440×900 viewport at device scale 2 (2880 px wide, full page), light theme, captured from https://tutorplus-one.vercel.app by `scripts/capture-sprint3.mjs`; phone images 390×844 at scale 3.

| File | Caption |
| --- | --- |
| s3-01-planner-before-save.png | Student opens the UC-09 workspace of a confirmed upcoming booking (nothing saved yet). |
| s3-02-planner-goals-saved.png | Goals and questions saved through save_session_goals; success message and save time shown. |
| s3-03-planner-persisted-after-reload.png | After a full reload the goals are read back from session_plans in PostgreSQL. |
| s3-04-tutor-reads-goals-saves-agenda.png | Tutor sees the student's saved goals (read-only) and saves the agenda. |
| s3-05-student-sees-agenda.png | Student reloads and reads the tutor's agenda; the student cannot edit it. |
| s3-06-tutor-recap-published.png | Tutor publishes the recap after the session is completed (publish_session_recap). |
| s3-07-student-recap-and-private-reflection.png | Student reads the published recap and saves a private reflection. |
| s3-08-tutor-view-reflection-hidden.png | Tutor's view of the same completed booking: the student's reflection is not shown. |
| s3-09-reviews-eligible.png | Reviews page lists the student's completed session; the tutor has no reviews yet. |
| s3-10-review-submitted.png | Review submitted through submit_review; the server confirms the saved rating. |
| s3-11-review-persisted-rating-updated.png | After reload the review is read from the reviews table and the tutor's aggregate is 5.0 (1 review). |
| s3-12-duplicate-review-refused.png | A second submission for the same booking (from a stale tab) is refused: one review per completed session. |
| s3-13-tutor-rating-updated.png | Tutor sees the database-computed rating (tutor_rating_summaries) and the new review. |
| s3-14-tutor-dashboard-rating.png | Tutor dashboard shows the updated rating summary. |
| s3-15-unauthorized-workspace-denied.png | A different signed-in student opening the booking URL is denied; no session data is shown. |
| s3-16-bookings-workspace-link.png | Bookings list links each confirmed or completed booking to its session workspace. |
| s3-m1-planner-phone.png | Session workspace on a 390 px phone viewport. |
| s3-m2-reviews-phone.png | Reviews page on a 390 px phone viewport with the submitted review. |
| db-01-sprint3-session-records.png | Linked-DB rows: demo bookings, session_plans, session_recaps, session_reflections (light HTML table). |
| db-02-sprint3-reviews-ratings.png | Linked-DB rows: reviews, tutor_rating_summaries (5.00, 1), row counts, applied Sprint 3 migrations. |
| db-03-sprint3-schema-security.png | Catalog inventory of the 12 Sprint 3 tables: RLS enabled, policy/constraint/trigger counts. |
| github-01-repo-sprint3-branch.png | Public repository on the `sprint3` branch. |
| github-02-pull-request.png | PR #1 sprint3 → main (open, CI passing). |
| github-03-project-board.png | Project board filtered to Sprint 3 cards (S3-01…S3-11) with To Do / In Progress / Done status (table view). |

Logs in `docs/evidence/sprint3/`: `db-isolated-regression.log`, `db-push.log`, `migration-list.log`, `table-stats.log`, `build-sh.log`.

## 8. Commands run and results (2026-10-18)

| Command | Result |
| --- | --- |
| `supabase db push --linked --yes` | Applied 202610180001 and 202610180002 |
| `supabase migration list --linked` | Local = remote for all 11 migrations (202609300001–009, 202610180001–002) |
| `supabase inspect db table-stats --linked` | Lists the new tables (e.g. reviews 1 row, assessments 0) — `docs/evidence/sprint3/table-stats.log` |
| `psql … < supabase/tests/001_regression.sql` (isolated local PG 17 stack) | 68 PASS, 0 FAIL |
| `psql … < supabase/tests/003_sprint3_learning_records.sql` (same) | 61 PASS, 0 FAIL |
| `TUTORPLUS_TEST_CONTAINER=… sh supabase/tests/run-isolated.sh` | exit 0: Sprint 2 + Sprint 3 DDL replay, both regressions, concurrency test (expected 23P01 loser) |
| `npm run typecheck` | pass |
| `npm run lint` | pass (no findings) |
| `npm run format:check` | pass |
| `npm test` | 5 files, 106 tests passed (19 new in `tests/unit/sessions-reviews.test.ts`) |
| `./scripts/build.sh` | exit 0 (typecheck, lint, `next build`; routes include `/reviews`, `/sessions/[bookingId]`) |
| `vercel deploy --prod --yes` | Ready; aliased to https://tutorplus-one.vercel.app |
| GitHub Actions `quality` on PR #1 | pass (2 runs) |

The SQL regressions ran against a disposable local Supabase stack (PG 17, copied config in a scratch directory), not against production. Production was verified through the hosted UI flow and read-only queries.

## 9. Build and run without an IDE

```sh
git clone https://github.com/addiee13/tutor-plus.git && cd tutor-plus
git checkout sprint3            # until PR #1 is merged
npm ci                          # Node.js 22+
cp .env.example .env.local      # set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SITE_URL
./scripts/build.sh              # typecheck + lint + production build
npm start -- --hostname 127.0.0.1 --port 3000
```

Database for a new environment: `supabase link --project-ref <ref>` then `supabase db push`, or run `sql/sprint2_tables.sql`, `supabase/migrations/202609300009_onboarding.sql` and `sql/sprint3_tables.sql` with psql. Demo data: `SEED_DEMO_CONFIRM=sprint3-demo SPRINT3_DEMO_PASSWORD='…' node --env-file=.env.cloud scripts/seed-sprint3-demo.mjs`. Or skip all of this and use the hosted link and obtain demo credentials privately.

## 10. GitHub

- Repository: https://github.com/addiee13/tutor-plus (public; renamed from `tutor-plus-sprint2`, old URL redirects)
- Branch: https://github.com/addiee13/tutor-plus/tree/sprint3
- Pull request (open, not merged): https://github.com/addiee13/tutor-plus/pull/1
- Project board: https://github.com/users/addiee13/projects/1 (renamed to "Tutor Plus Group 11 Sprints 2-3"; Sprint 3 cards: S3-01…S3-07 and S3-10 In Progress, S3-08 and S3-09 Done, S3-11 To Do)
- Commits on `sprint3`: `06fd136` post–Sprint 2 working-tree changes; `dde8b1e` DB schema; `bd6e307` UC-09/UC-07 app; `efe7f38` seed/capture scripts; `062f628` evidence; plus a final docs commit with this file.

## 11. Blocked, not verified, or for the team

- Board statuses for report items (S3-01…S3-07, S3-10) are set to In Progress by the implementor; update them as the document editor finishes **[confirm]**.
- The project board has only a table view ("View 1"); the GitHub CLI cannot create a Board-layout view. If the report needs columns, switch the view layout to Board in the web UI and recapture **[confirm]**.
- UC-05 and UC-08 have no UI; file uploads for submissions are not wired to storage.
- Payments/Stripe remain unimplemented; demo confirmations are fixtures (§6).
- The end-time planner/database rule difference was corrected in migration `202610180003`; direct RPC calls and UI permissions now agree.
- HawkScan DAST was not run: `HAWK_API_KEY` is not set.
- Demo identities have no admin role. Their previously published passwords have been rotated and sessions invalidated; supply new credentials privately only when needed.


## Release review corrections (October 18, 2026)

- Added `202610180003_learning_record_boundaries.sql` and appended the same changes to the standalone Sprint 3 SQL. Planner RPCs now refuse edits after the scheduled end time and lock the booking while checking it. Tutor assessment scores are bounded by short-answer points, preserving objective results.
- Applied this corrective migration to the linked hosted database and recorded version `202610180003` as applied. Ran the complete `003_sprint3_learning_records.sql` inside its rollback-only transaction through `supabase db query --linked` after removing its psql-only `\set` directive; all assertions passed.
- Rotated passwords for the three named demo identities and invalidated their sessions. Credentials previously included here are obsolete. Credentials must be provided privately at demo time; do not put them in report source or committed documents.
- Ported the pending email rate-limit handling into the current auth services. Provider rate limits now produce an actionable safe message for signup, email-code requests, password reset, and verification resend. Provider-error, service, and session/review unit suites passed (30 tests).
- The separate untracked Sprint 3 report builder and its generated PDF remain draft artifacts: its `HANDOFF` fields and generated placeholder manifest are incomplete. They are not validated submission evidence and are excluded from this release.
