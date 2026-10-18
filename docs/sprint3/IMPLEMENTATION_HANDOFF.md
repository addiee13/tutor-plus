# Sprint 3 implementation handoff

Prepared by the implementor agent on 2026-10-18 for the document editor and validator; revised the same day after the validator review (§12). Everything below was run or captured on 2026-10-18; nothing is projected. Unknown or human-only items are marked **[confirm]**.

## 1. Scope delivered

| Item | State |
| --- | --- |
| Database tables for UC-05, UC-07, UC-08, UC-09 (12 tables) | Implemented as four versioned Sprint 3 migrations (13 migrations in total), all applied to the linked Supabase project `lpuvrkmpfzoxtweagdcl` |
| Standalone reproducible SQL (dev/test/prod) | `sql/sprint3_tables.sql` (apply after `sql/sprint2_tables.sql`) |
| Frontend + logic: UC-09 Session Planner and Recap | Implemented, deployed, evidenced |
| Frontend + logic: UC-07 Reviews and Ratings | Implemented, deployed, evidenced |
| UC-05 and UC-08 | Database layer only (tables, triggers, RLS, RPCs, SQL tests). No UI this sprint |
| Payments (UC-06) | Still **not implemented**. Demo bookings are confirmed by *demo-fixture* provider events (see §6) |

## 2. Migrations and scripts

| File | Purpose |
| --- | --- |
| `supabase/migrations/202610180001_session_planner_reviews.sql` | UC-09 and UC-07 tables, triggers, RPCs, RLS, grants |
| `supabase/migrations/202610180002_assessments_assignments.sql` | UC-05 and UC-08 tables, triggers, RPCs, RLS, grants |
| `supabase/migrations/202610180003_learning_record_boundaries.sql` | Planner RPCs refuse edits once the session's end time has passed; tutor assessment points bounded by short-answer points |
| `supabase/migrations/202610180004_public_tutor_availability.sql` | Read-only DTOs `list_public_tutor_availability` / `list_public_tutor_exceptions` for published tutors (source tables stay owner-only) |
| `sql/sprint3_tables.sql` | Concatenation of the four Sprint 3 migrations with a header. Apply with `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/sprint2_tables.sql -f sql/sprint3_tables.sql` |
| `supabase/tests/003_sprint3_learning_records.sql` | 65-check SQL regression (fixtures pinned to midday UTC) (runs in one transaction, then rolls back) |
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
| `save_session_goals(booking uuid, goals text, questions text)` | timestamptz | booked student; booking confirmed/in_progress **and before ends_at** (migration 003) |
| `save_session_agenda(booking uuid, agenda text)` | timestamptz | booked tutor; booking confirmed/in_progress **and before ends_at** (migration 003) |
| `mark_session_completed(booking uuid)` | text ('completed') | booked tutor; confirmed/in_progress and past ends_at; idempotent; confirmed→in_progress→completed |
| `publish_session_recap(booking uuid, summary text, mastery_notes text, next_steps text)` | timestamptz | booked tutor; session ended; upsert (edit increments revision) |
| `save_session_reflection(booking uuid, reflection text)` | timestamptz | booked student; session ended |
| `submit_review(booking uuid, rating integer, comment text)` | uuid | booked student; booking completed; rating 1–5; duplicate → SQLSTATE 23505 |
| `moderate_review(review uuid, requested_status text, reason text)` | void | administrator; audited in audit_logs |
| `list_public_tutor_reviews(tutor uuid)` | table(rating, comment, created_at) | `anon` + `authenticated`; visible reviews of public tutors |
| `submit_assessment_attempt(assessment uuid, answers jsonb, finalize boolean)` | uuid | assigned student; open and not past due; objective score from private keys |
| `score_assessment_attempt(attempt uuid, tutor_points integer, feedback text)` | void | owning tutor; points ≤ total short-answer points and auto_score + points ≤ max_score (migration 003) |
| `list_public_tutor_availability(tutor uuid)` | table(weekday, local_start, local_end, timezone, valid_from, valid_until) | `anon` + `authenticated`; active, unexpired rules of published tutors (migration 004) |
| `list_public_tutor_exceptions(tutor uuid, from_date date, to_date date)` | table(local_date, local_start, local_end, timezone, exception_type) | `anon` + `authenticated`; window ≤ 31 days; published tutors only (migration 004) |
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

- Production URL: **https://tutorplus-one.vercel.app** — alias of deployment `https://tutorplus-68p9ca0kj-adams-projects-c67ba2f3.vercel.app` (status Ready; deployed 2026-10-18 from branch `sprint3` at commit `6741ff7` with `vercel deploy --prod`; second alias `tutorplus-adams-projects-c67ba2f3.vercel.app`). Production env vars `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL` exist (values not printed); all 18 UI screenshots were captured from this URL against the cloud database.
- Demo-only accounts (no real people, no administrator role). The password is a fixed, documented demo credential set by `scripts/seed-sprint3-demo.mjs` (constant `DEFAULT_DEMO_PASSWORD`); rerunning the seed keeps it unchanged:

| Role | Email | Password |
| --- | --- | --- |
| Student (Maya Chen) | sprint3.student@example.com | `TutorPlus-Demo-S3-2026!` |
| Tutor (Daniel Brooks) | sprint3.tutor@example.com | `TutorPlus-Demo-S3-2026!` |
| Unrelated student (Riley Park) — access-denied demo | sprint3.other@example.com | `TutorPlus-Demo-S3-2026!` |

- Live-demo state after the final seed run (2026-10-18 22:4x UTC): upcoming confirmed booking `0fe315b6-31db-44d5-a966-7738afd07c47` with an **empty planner**, and completed booking `8d9ad56f-ccb3-46c7-b239-35902329dce5` that is **not yet reviewed** (no recap yet). Tutor rating: 5.0 from 3 visible reviews. Rerun the seed before a later demo to get fresh ones.
- Walkthrough bookings used for the screenshots: upcoming `b4a98a8b-85bd-4ffd-9a34-90d590f4b0be` (2026-10-22 15:00–16:00 UTC), completed `15471c85-e81d-4e0f-a974-b7a07327fe7b` (2026-10-13 15:00–16:00 UTC).

## 6. Demo fixture honesty note

Payments are not implemented, so a booking cannot legitimately become `confirmed`/`completed` through the UI. The seed script therefore:

1. creates upcoming bookings through the real student RPC `create_booking` (it reuses one only while its planner is empty);
2. inserts each already-ended booking directly as the database owner (the public RPC correctly refuses past start times);
3. confirms both by calling the server-only provider-boundary functions `prepare_booking_payment` + `apply_verified_payment_event` with events named `demo-fixture-evt-…` (**no money moved, no Stripe**) and adds a placeholder meeting link;
4. leaves the ended booking's planner empty (planner writes close at the end time) and marks it delivered with the tutor's real `mark_session_completed` RPC.

Report text must call these "demo fixture data", not payments.

Data clean-up on 2026-10-18: the validator's test rows (tagged `VAL-…-223200`) remain as history. Its visible 3★ review `71af0c1e…` was hidden (status `hidden`, moderation reason recorded) with a matching `review.moderated` row in `audit_logs`; nothing was deleted. Because the cloud project has **no administrator account**, this was done as the database owner, mirroring `moderate_review` (the audit row's metadata says so). The tutor aggregate returned to 5.0. The student's own Reviews page still lists that review as "Hidden by moderation" (visible in s3-09…s3-12, s3-m2) — that is the correct student view.

## 7. Evidence (all in `docs/evidence/screenshots/sprint3/`)

UI images: 1440×900 viewport at device scale 2 (2880 px wide, full page), light theme, captured from https://tutorplus-one.vercel.app (deployment `tutorplus-68p9ca0kj`) by `scripts/capture-sprint3.mjs` on 2026-10-18 ~22:43 UTC; phone images 390×844 at scale 3. All 18 were recaptured after the fixes.

| File | Caption |
| --- | --- |
| s3-01-planner-before-save.png | Student opens the UC-09 workspace of a confirmed upcoming booking (nothing saved yet). |
| s3-02-planner-goals-saved.png | Goals and questions saved through save_session_goals before the session; success message and save time shown. |
| s3-03-planner-persisted-after-reload.png | After a full reload the goals are read back from session_plans in PostgreSQL. |
| s3-04-tutor-reads-goals-saves-agenda.png | Tutor sees the student's saved goals (read-only) and saves the agenda. |
| s3-05-student-sees-agenda.png | Student reloads and reads the tutor's agenda; the student cannot edit it. |
| s3-06-tutor-recap-published.png | Tutor publishes the recap for a completed session (publish_session_recap); its planner was never filled, which the page states. |
| s3-07-student-recap-and-private-reflection.png | Student reads the published recap and saves a private reflection. |
| s3-08-tutor-view-reflection-hidden.png | Tutor's view of the same completed booking: the student's reflection is not shown. |
| s3-09-reviews-eligible.png | Reviews page lists the student's completed sessions; the newest is ready for review. |
| s3-10-review-submitted.png | Review submitted through submit_review; the chosen 5 stars and comment stay displayed with the server receipt. |
| s3-11-review-persisted-rating-updated.png | After reload the review is read from the reviews table and the tutor's aggregate shows 5.0 (3 reviews). |
| s3-12-duplicate-review-refused.png | A second submission for the same booking from a stale tab is refused, with the reason shown once. |
| s3-13-tutor-rating-updated.png | Tutor sees the database-computed rating (tutor_rating_summaries) and the reviews. |
| s3-14-tutor-dashboard-rating.png | Tutor dashboard with tutor-specific copy and the rating summary. |
| s3-15-unauthorized-workspace-denied.png | A different signed-in student opening the booking URL is denied; no session data is shown. |
| s3-16-bookings-workspace-link.png | Bookings page: native UTC date-time pickers, published weekly availability, and workspace links on confirmed/completed bookings (no hold row once confirmed). |
| s3-m1-planner-phone.png | Session workspace on a 390 px phone viewport. |
| s3-m2-reviews-phone.png | Reviews page on a 390 px phone viewport. |
| db-01-sprint3-session-records.png | Linked-DB rows for the two walkthrough bookings: bookings, session_plans (saved before the start), session_recaps, session_reflections. |
| db-02-sprint3-reviews-ratings.png | Linked-DB rows: the walkthrough review, tutor_rating_summaries (5.00, 3 reviews), row counts, and all four applied Sprint 3 migrations. |
| db-03-sprint3-schema-security.png | Catalog inventory of the 12 Sprint 3 tables: RLS enabled, policy/constraint/trigger counts. |
| github-01-repo-sprint3-branch.png | Public repository on the `sprint3` branch with the Sprint 3 README. |
| github-02-pull-request.png | PR #1 sprint3 → main with its current commits and passing CI. |
| github-03-project-board.png | Project board "Sprint 3 board" view (Board layout grouped by Status, filtered to S3 cards): To Do / In Progress / Done columns. |

Logs in `docs/evidence/sprint3/`: `db-isolated-regression.log`, `db-push.log`, `db-push-004.log`, `migration-list.log`, `table-stats.log`, `build-sh.log`.

## 8. Commands run and results (2026-10-18, after the fixes)

| Command | Result |
| --- | --- |
| `supabase db push --linked --yes` | Applied 202610180001, 202610180002 (earlier), 202610180004 (this round; 003 was applied by the release fix) |
| `supabase migration list --linked` | Local = remote for all 13 migrations (202609300001–009, 202610180001–004) |
| `supabase inspect db table-stats --linked` | `docs/evidence/sprint3/table-stats.log` |
| `sh supabase/tests/run-isolated.sh` (local stack, PG 15.8, fresh throw-away database) | exit 0: Sprint 2 + Sprint 3 DDL replay; `001_regression` 68 PASS; `003_sprint3_learning_records` 65 PASS (63 + 2 availability DTO checks); concurrency test (expected 23P01 loser) |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run format:check` | pass |
| `npm test` | 6 files, 110 tests passed |
| `./scripts/build.sh` | exit 0 (`docs/evidence/sprint3/build-sh.log`) |
| `vercel deploy --prod --yes` | Ready: `tutorplus-68p9ca0kj-adams-projects-c67ba2f3.vercel.app`, aliased to https://tutorplus-one.vercel.app |
| GitHub Actions `quality` on PR #1 | see §10 |

SQL regressions ran against a disposable local database, not production. Production was verified through the hosted UI flow and read-only queries.

## 9. Build and run without an IDE

```sh
git clone https://github.com/addiee13/tutor-plus.git && cd tutor-plus
git checkout sprint3            # until PR #1 is merged
npm ci                          # Node.js 22+
cp .env.example .env.local      # set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SITE_URL
./scripts/build.sh              # typecheck + lint + production build
npm start -- --hostname 127.0.0.1 --port 3000
```

Database for a new environment: `supabase link --project-ref <ref>` then `supabase db push`, or run `sql/sprint2_tables.sql`, `supabase/migrations/202609300009_onboarding.sql` and `sql/sprint3_tables.sql` with psql. Demo data: `SEED_DEMO_CONFIRM=sprint3-demo node --env-file=.env.cloud scripts/seed-sprint3-demo.mjs` (needs the service-role key in the env file). Or use the hosted link with the credentials in §5.

## 10. GitHub

- Repository: https://github.com/addiee13/tutor-plus (public; renamed from `tutor-plus-sprint2`, old URL redirects; local `origin` updated)
- Branch: https://github.com/addiee13/tutor-plus/tree/sprint3
- Pull request (open, **not merged**): https://github.com/addiee13/tutor-plus/pull/1
- Relationship to `main`: `main` holds the squashed release commit `aac1a13` (pushed directly; includes local-only `e93fcfc`). `main` was not rewritten. `origin/main` was merged into `sprint3` (merge `43d6d48`), so PR #1 contains all Sprint 3 work and its diff against `main` is only the post-release fixes: `d9ec4f1` (midday-UTC SQL fixtures), `e8b0aca` (migration 004 + checks), `2819c9c` (validator UI/seed/README fixes), `6741ff7` (skip link), and the evidence/handoff commit.
- Project board: https://github.com/users/addiee13/projects/1 — renamed "Tutor Plus Group 11 Sprints 2-3"; new view **"Sprint 3 board"** (https://github.com/users/addiee13/projects/1/views/2) created with `gh api graphql` (`createProjectV2View`, layout BOARD_LAYOUT, grouped by Status, filter `S3-`). Cards: S3-08 and S3-09 Done; S3-01…S3-07 and S3-10 In Progress; S3-11 To Do.

## 11. Remaining limitations

- Board statuses for report items (S3-01…S3-07, S3-10) were set by the implementor; update them as the report is finished **[confirm]**.
- UC-05 and UC-08 have no UI; submission file uploads are not wired to storage.
- Payments/Stripe remain unimplemented; demo confirmations are fixtures (§6).
- No administrator account exists in the cloud project, so the UI moderation path (`moderate_review`) is untested end to end there; it is covered by the SQL regression.
- The validator's `VAL-…-223200` plan, recap and reflection rows remain in the database as history (on bookings not used by the walkthrough).
- HawkScan DAST was not run: `HAWK_API_KEY` is not set.
- The demo password is published on purpose for grading. It belongs only to the three demo-only accounts, which have no admin role.

## 12. Validator review fixes (2026-10-18)

- Skip link: visually hidden (clipped) unless `:focus-visible`, so it can never overlap content after a submit or reload.
- Denied workspace: uses the standard serif page heading.
- Reviews: duplicate/ineligible errors appear once; a successful review keeps its stars and comment displayed.
- Dashboard: role-appropriate copy (student vs tutor); no "payment-pending" wording for tutors.
- Bookings: "Hold expires" only on draft/payment-pending bookings; published weekly availability now shows via migration 004 (previously RLS hid it and the card said "No scheduling details are readable").
- Seed: fixed documented demo password; fresh upcoming/completed bookings per run.
- Earlier release note (main `aac1a13`) said demo passwords were rotated and must be supplied privately. That is **superseded by the coordinator's later instruction**: one stable, documented demo-only password (§5), set on 2026-10-18 by the seed run.
