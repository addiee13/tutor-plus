# Remaining-module implementation tracker

Started 2026-11-08. User explicitly authorized autonomous implementation of the audited remaining functionality, excluding payments. This supersedes the historical documentation-only phase for this work. No commit, push, deployment, or production database mutation is implied.

## Latest user priority

The user explicitly clarified that credits are ending, the app will never be deployed to production, and completion should prioritize major logical flaws and obvious visual bugs. Feature scope remains the fourteen non-payment modules. Exhaustive performance measurement, additional test matrices and external-provider validation are deferred under this instruction. Existing real database/Auth/Storage/browser evidence remains recorded; deferred checks must not be described as passed. The final essential correction is currency-aware budget eligibility, followed by a quick build and visual/read smoke check.

## Final local-demo result

The fourteen non-payment modules are implemented. The final local optimized build and critical read/visual smoke passed on `http://localhost:3018`; root inspected the final phone discovery screenshot. Build ID: `LsAzehHAIZUFP9UgElinP`; application/config source hash: `9b0abd1f57aaa95a93be5b47add29c35c1d9f12b7fe4004fd7d22eef2de708bf`.

- Independent Sol verification: 218 unit tests passed; application/test TypeScript, ESLint and scoped formatting passed. The unrelated report script formatting failure is preserved and recorded rather than silently changed.
- Database evidence: the preceding 37-migration chain passed 334 SQL observations plus the independent-client reservation race. Forward migration 024 is applied and its four targeted currency observations passed; this is separate from the earlier complete replay.
- Critical corrections include logical newline normalization before field-length checks, currency eligibility before budget comparison/pagination/ranking, private key/data access, truthful failed writes, preserved learning history, and safe development logging.
- Desktop/phone workflows and rendered evidence cover the new admin templates, badge policies, saved Tutors, dashboard, progress filters, assignments/cancellation, session coordination and private files. The independent accessibility review passed its five applicable checks; the desktop-only touch exclusion is not counted as a pass.
- The last smoke verified actual local login/dashboard, canonical booking/slot reads, USD-filtered discovery, positive matching, progress, truthful adapter-disabled AI state, and phone discovery without horizontal overflow. No booking was created by that smoke and no external provider was invoked.
- The proxy is in normal pass-through mode. Optional configured-AI test processes were stopped; the main local demo and native services remain available. Performance benchmarking and additional external-provider validation were deferred by the user's final instruction.

Actual evidence: [final smoke](../evidence/sprint4/final-demo-smoke.json), [quality/build results](../evidence/sprint4/quality-checks.json), [SQL replay](../evidence/sprint4/native-sql-summary.json), [currency correction](../evidence/sprint4/native-currency-fix.json), and [runtime setup](../sprint4/RUNTIME_SETUP.md).

## Team and ownership

The primary agent is the orchestrator and maintains this tracker. Backend implementation uses GPT-6 Luna at xhigh. All frontend implementation belongs exclusively to GPT-6.1 Sol. A separate GPT-6.1 Sol agent verifies integrated work after implementation.

| Work package | Owner/model | State | Acceptance evidence |
| --- | --- | --- | --- |
| Tutor listing, subjects, publication, schedules, public discovery, matching, meeting details/rescheduling | marketplace_backend / Luna xhigh | Complete for local demo | SQL, unit and browser evidence; final currency regression passed |
| Assessments, assignments, retakes, study plans/milestones, evidence-linked progress | learning_backend / Luna xhigh | Complete for local demo | Unit, SQL, desktop/phone workflow and field-boundary evidence |
| All screens, forms, actions, navigation, responsive integration | frontend / GPT-6.1 Sol xhigh | Complete for local demo | Desktop/phone captures, workflow checks and optimized build/read smoke |
| Notifications, resources/AI adapter, safety/admin expansion | marketplace_backend / Luna xhigh | Complete for local demo | Native jobs/webhook, SQL/provider-double tests and admin/browser evidence; external keys remain configurable |
| Independent integrated verification | Separate GPT-6.1 Sol | Essential checks passed; handoff recorded | 218 unit tests, scoped quality/build, real-service/browser/visual checks; exhaustive performance deferred by user |

The final result above supersedes the chronological work-in-progress notes below. Module counts are separate from formal-case and test-observation counts; deferred verification is recorded explicitly.

## Scope and completion rules

- Preserve existing source/report changes and historical evidence. No branches or commits without user request.
- Maintain the modular monolith, user-scoped database access, authoritative database roles, RLS, least privilege, UTC instants and integer monetary units.
- Payments are excluded. Never fabricate paid confirmation to unblock session flows; validate such flows with explicitly identified test fixtures.
- Missing external keys do not stop implementation: provide server-only adapters, environment documentation, and honest configuration/failure states. Real external delivery remains unverified without credentials.
- The fifteen use-case identifiers remain stable. UC-11 through UC-15 remain outside historical Sprint 2 detailed deliverables, even while implemented now.
- Completion requires integrated persistence and denial tests, refresh/logout checks, narrow tests plus agreed quality suite, production build/run and rendered desktop/mobile evidence. Source or mocked tests alone are insufficient.

## Starting evidence

The read-only explorer audit found only auth, profiles, bookings, sessions and reviews domain modules. Assessments and assignments had schema/RPCs but no application workflow. Tutor profile UI edited name/time zone only. Public discovery, matching, notices, study plans/progress and AI/resources were absent. The existing booking UI honestly stopped at payment_pending. Existing unrelated modifications include next-env.d.ts and Sprint 3 report scripts; untracked reports/diagrams/prototypes must remain intact.

## Requirement-level acceptance register

All entries below are **open** until execution evidence is recorded; an implementation agent's handoff alone does not close them.

| Use case | Required outcome for this implementation |
| --- | --- |
| UC-01 | Preserve verified identity, dual capabilities, protected onboarding, refresh/logout and inactive-account denial. |
| UC-02 | Persist owner profile preferences and full tutor listing/subjects/rates/modes/approximate location; publication requires readiness; public DTOs omit private records. |
| UC-03 | Public bounded discovery/detail/reviews with subject, mode, price, rating, availability and optional distance filters; correct pagination, empty and failure states. |
| UC-04 | Tutor availability/exception CRUD, real slots, participant meeting details, safe rescheduling within unpaid scope, hold cleanup, denied unauthorized operations. Paid confirmation remains excluded. |
| UC-05 | Tutor author/assign, protected answer keys, student draft/finalize, objective/subjective scoring, authorized retakes with preserved attempts, results. |
| UC-06 | Excluded by explicit user instruction. Existing payment integrity must remain intact. |
| UC-07 | Preserve completed-session review eligibility and calculated ratings; public review display and audited moderation controls. |
| UC-08 | Tutor author/assign, student draft/submission/resubmission, late policy, tutor feedback/completion, private uploads/downloads and progress links. |
| UC-09 | Preserve student goals, tutor agenda/completion/recap, private reflections; connect authorized learning evidence and notices. |
| UC-10 | Recipient-only feed/read state/preferences, deduplicated domain events, current reminders, server dispatch/retries and truthful provider outcomes. |
| UC-11 | Approved resource catalog/linking, minimized authorized context, server-only configurable AI provider, bounded usage and human-confirmed suggestions. Missing keys produce truthful setup state. |
| UC-12 | Controlled reports/moderation, catalog/resource/template/badge administration and audit viewer; current DB roles authorize every operation. |
| UC-13 | Persisted goals/plans/ordered milestones, attributed revisions and explicit replanning. Session planners do not substitute for this feature. |
| UC-14 | Evidence-linked progress/mastery observations, dates/provenance and relationship-scoped dashboards; scores do not automatically become mastery. |
| UC-15 | Hard eligibility before ranking, bounded configurable weights, concrete factual explanations, explicit selection and private student preferences. |

## Validation log

- Baseline `npm test`: 6 files, 113 tests passed on 2026-11-08.
- Docker socket/API timed out. No Docker resources were restarted or removed.
- Added `scripts/verify-native-db.sh` and a minimal managed-Auth SQL compatibility fixture. Native PostgreSQL 17.11/PostGIS replays all 14 original migrations and passes existing SQL/RLS regression suites 001 and 003. Logs: `/tmp/tutorplus-native-check.rHIwZN`.
- Native SQL checks prove database constraints/RLS under fixture JWT claims; they do not prove Supabase Auth, REST, storage or browser integration. These remain separate gates.
- Extended native checks: four authorization regressions and two independent concurrent clients pass; exactly one competing reservation commits and the other fails with exclusion violation 23P01. Logs: `/tmp/tutorplus-native-check.1RQGND`.
- Read-only hosted integration attempt failed before assertions: AuthRetryableFetchError. Direct curl confirmed the configured Supabase hostname does not resolve. No provider configuration was changed; hosted integration remains unverified.
- Historical test/deployment claims are not current verification.

### First marketplace handoff

- Marketplace worker reports 12 unit tests, narrow ESLint and Prettier checks passed; independent verifier has not yet reviewed them.
- Native replay plus `004_remaining_modules.sql` proved student/tutor ownership, publication readiness, safe public discovery, hard rate/mode filters, partial/NaN coordinate rejection, participant-only meeting details, failed-reschedule rollback and idempotent unpaid replacement. Evidence: `/tmp/tutorplus-native-check.jnbLcq`.
- Root built native GoTrue from official `supabase/auth` source and downloaded official PostgREST 16.5 outside the checkout for isolated runtime testing. Auth source revision: `35307ce6c1ca59016fd820f1d77d9b6201dc2e15`. Gateway binds 127.0.0.1:55440; PostgreSQL 55438; Next dev 3008. Real local password login, profile isolation, live-session RPC and logout passed for four disposable identities.
- Local runtime configuration and disposable passwords remain only under `/tmp/tutorplus-native-runtime`, with restricted file permissions. Hosted `.env.local` is unchanged. Auto-confirmed local fixture accounts do not prove external verification-email delivery.

## User-supplied Sprint 4 acceptance floor

On 2026-11-08 the user required the features in `output/doc/sprint4/TutorPlus_Group11_Sprint4_Section10.pdf` as a mandatory minimum. The PDF has 73 formal cases; ten payment cases remain excluded. [SPRINT4_ACCEPTANCE.md](../testing/SPRINT4_ACCEPTANCE.md) records all cases and expected behavior without inventing passes. Source extraction and visual review exposed additional gaps in structured goals/milestones, dated mastery evidence, reflection deletion, geocoding, stale-write handling, ranking-factor provenance, review badges, notifications/AI/admin breadth. Backend and frontend owners received explicit follow-up work; the earlier handoffs are not full-scope completion.

The second user-supplied PDF, `TutorPlus_Group11_Sprint4_FeatureList.pdf`, was read and rendered. Its extracted content exactly matches Section 10 page 4 and confirms all fifteen UC identifiers. The mandatory register includes both sources; no duplicate tasks were created. UC-06 remains excluded under the user's earlier explicit instruction.

### Independent verification and Sprint 4 follow-up

- Separate GPT-6.1 Sol xhigh verifier started after the first frontend handoff. Frontend Sol is available for the next UI wave; two Luna xhigh implementers continue platform/marketplace and learning additions.
- Current unit rerun: `npm test`, 9 files and 142 tests passed. This does not establish formal Sprint 4 case completion.
- Real local browser evidence: tutor listing saved/reloaded, incomplete publication denied, availability added and listing published; anonymous discovery reflects it. First desktop/mobile screenshots were inspected. Production captures remain pending.
- Actual HTTP verification caught marketplace meeting-detail upsert column-privilege failure. A narrow authorizing RPC replaced direct upsert; actual HTTP fixture save now passes. Fresh SQL regression checks use the same RPC.
- Real native Storage is running, with private assignment bucket and owner/relationship policies. The verifier identified a preflight metadata mismatch and the original Next.js 1 MB request cap. A Sol-authored 12 MB server-action cap now supports a 10 MiB file plus multipart overhead; storage policy correction and successful file round-trip are still pending.
- Assessment creation exposed SQL variable/column ambiguity, and the latest SQL retake checks fail before creation. Corrections are assigned to Luna and remain pending actual replay/HTTP verification.
- Existing native runtime data has not been reset. Local test accounts are auto-confirmed fixtures, and the confirmed learning booking is explicitly fixture-created with no payment provider or charge.

### Integrated runtime follow-up

- Platform 003, learning completion 004 and learning contract correction 007 are applied to the disposable native runtime with original UI data retained. PostgREST schema cache was refreshed. Marketplace 005 and platform 006 are still in progress.
- Independent verifier's corrected desktop assessment lifecycle passed end to end (author/assign, learner submit, tutor score, reload, unrelated denial). The Sol frontend repeated a real 10 MiB upload/reload/download and verified exactly 10,485,760 bytes. The 10 MiB + 1 byte negative path was rejected without persistence.
- Local Mailpit SMTP capture is running on loopback only; GoTrue now requires verification for new signups. Existing confirmed fixture accounts are unchanged. Actual signup confirmation/replay, refresh, password recovery/old-password denial, logout/stale-JWT private-data denial and numeric OTP valid/wrong/reused variants passed at provider/SMTP/REST layers. Evidence: `sprint4/native-auth-mail.json` (browser and clock-expiry variants remain separate).
- Original read-only integration suite against the native services: 4 passed, 8 skipped. No skipped mutation/Docker/session case is counted as a pass.
- Applying platform 003 exposed a blanket private-function privilege revoke that broke original RLS reads. Root restored only the pre-existing explicit helper grants in the test runtime. Durable restoration and preference/outbox fixes belong to 006; fresh ordered replay is not yet passing.
- Source-backed native SQL tests now include fractional-duration rejection, assessment retake/history and notification ownership/preferences/admin-denial checks. Their full passing run remains pending the durable 005/006 corrections.
- Sol frontend reports desktop reflection save/delete/progress-read passed. Structured-goal creation still needs correction and remains open. Root retains separate inspected native development screenshots; final production captures remain required.

### Current integration evidence and remaining additions

- Fresh native SQL replay through migrations 001–009 and 012–015 passed all original/new suites with 214 PASS observations and a two-client reservation race (one commit, one 23P01 conflict). These observations do not equal 214 formal cases. Summary: `docs/evidence/sprint4/native-sql-summary.json`; raw retained run: `/tmp/tutorplus-native-check.MthouZ`. Migrations 010/011 are subsequent work and need a fresh complete replay.
- Migrations 005/006 now support and preserve actual confirmed-fixture rescheduling, version history and notification invariants. Real browser move/history/restoration and matching passed on desktop. The fixture returned to its canonical future instant; no payment was performed.
- Migration 009 and corrections 013–015 enabled Student personal study plans before any Tutor/booking, structured goals, explicit Student confirmation of Tutor proposals, retained missed-date history and evidence-backed mastery. The Sol frontend's six learning tests passed across desktop/phone; output `/tmp/tutorplus-sprint4-learning-final`.
- Real private assignment upload/reload/download passed at exactly 10,485,760 bytes; one extra byte was rejected without persistence. Production rendering and remaining privacy/phone variants remain separate gates.
- Actual local reminder and outbox routes queued two feasible booking reminders and processed 29 notices, with zero email accepted and twenty `notConfigured` outcomes. No external email was sent. Recipient notice mark-read/reload and admin/preference persistence passed on desktop and phone according to executed Sol browser runs.
- Root's actual signed delivery-webhook HTTP test found SQL 42702 (`event_id` ambiguity) after invalid/stale signatures were correctly refused. A backend correction and rerun are required; this route is not complete merely because signature unit tests pass. Reproducer: `scripts/verify-native-delivery-webhook.mjs` (isolated signed fixtures, no email).
- Root added seven database assistant request-limit/outcome checks to `supabase/tests/005_platform.sql`: prompt limit, quota including failed requests, immutable failed outcome, unrelated finish denial and canonical record count/state. The expanded suite passed against native PostgreSQL in a rolled-back transaction. Selected-context/provider-failure adapter evidence remains separate.
- Source review of pending 011 found a nonexistent PostgreSQL JSON helper hidden by broad exception handling, which would reject all booking notes. The owner is correcting it. Source review of 010 found link replacement blocked by its own immutable trigger, an unescaped SQL string and inactive-account attachment-read concerns; the owner is correcting these before runtime acceptance.
- Current session UI/backend integration temporarily has missing service exports while the learning owner completes them. This is a known work-in-progress compile failure; current quality gates must be rerun after the coherent handoff.
- [Runtime setup](../sprint4/RUNTIME_SETUP.md) documents provider keys, privileged job boundaries, explicit scheduler setup and truthful missing-provider states. No hosted migration, scheduler, deployment or external email delivery has been performed.

### Independent baseline review and final implementation pass

The independent Sol verifier inspected the original SDD as well as the PDF minimum. Its sections 5.1, 9.2 and 17.2 explicitly include several capabilities absent from the first integrated pass. These remain in scope; the PDF case list does not silently remove them.

| Requirement | Owner and remaining work |
| --- | --- |
| Assessment-template administration and reuse | Luna marketplace: versioned validated templates, current Admin/Tutor-only key access, confirmed audited administration, Tutor copy into an authorized assessment with pinned content. Sol frontend: admin and Tutor reuse controls. |
| Badge-policy management | Luna marketplace: versioned policies restricted to supported public facts, confirmed audit and explainable public award DTO. Sol frontend: administration and factual policy explanations. |
| AI optional history and response reporting | Sol frontend: clear optional local output/drafts. Luna marketplace: opaque request identity and owner-authorized report linked to minimal metadata. Preserve quota/security records; do not retain full prompts or answers for reports. |
| Progress filters | Sol frontend: goal, topic, Tutor and date filters over authorized evidence, with honest empty state and consistent chart/table filtering. |
| Data-backed dashboard and saved Tutors | Luna marketplace: bounded actor-booking summary and owner-only saved Tutor persistence. Sol frontend: actual upcoming/due/active/recent summaries plus saved Tutor controls, without per-record detail-query fanout or fabricated recommendations. |
| Distinct optional recap notes | Luna learning: durable migration 020 and service validation. Sol frontend: optional 2000-character notes distinct from strengths/practice/next steps. |
| Privacy-safe observability | Luna marketplace: correlation/action/timing/outcome categories and restricted aggregate health metrics, without sensitive content or an external analytics dependency. |

The Sol verifier prepared a 29-route performance harness and desktop/phone keyboard/accessibility/fault/reputation checks. These were not executed yet; the verifier yielded its slot for the final backend pass and will resume after a coherent source freeze. Its actual Auth expiry/duplicate-signup checks passed, and the full unit suite at that handoff passed 175 tests in 12 files.

Root additionally extended actual SQL coverage for exact discovery bounds (3000/4000 included, 2999/4001 excluded, 4.00 included and 3.99 excluded), three-Tutor two-page pagination, conflicting/scoped request keys, cancellation reason boundaries/retry/released slots, and expired versus unexpired unpaid holds. These tests passed in rolled-back transactions against the native runtime. Rating aggregates in those filter cases are explicitly synthetic fixtures; original review regression tests independently exercise real aggregate calculation.

The notification retry RPC checks passed all five bounded attempts/backoff states, preserved one recipient notice after exhaustion, and refused a sixth claim. No external provider was contacted. Root applied forward migration 017 after a real moderation UI failure and added audit/authorization regressions; learning corrections 018/019 repair tagged assignment creation and completion after an editable returned feedback result.

Root visually inspected and retained development screenshots of phone consented notes, phone private-avatar persistence, and the desktop structured recap. These demonstrate those rendered development states; production screenshots remain a separate gate.

Further review found arbitrary teaching-preference strings could match demographic words in Tutor biographies and affect ranking. The marketplace owner is restricting scored preferences to a fixed vocabulary of non-sensitive teaching methods, with adversarial protected-text tests; the frontend will offer explicit method choices. This is required for FR-MT06 and formal case 15.2, rather than relying on omitted demographic DTO fields alone.

Forward migration 020 is applied locally and provides separate optional recap notes without conflating them with strengths. Root's read-only development diagnostic found `/progress` complete responses around 1.1–1.4 seconds on the current fixture set, while `/dashboard` was around 106–120 ms. These are not production acceptance measurements. The learning owner is addressing progress read fanout before the final 200-sample production benchmark.

### Learning handoff and final verifier preparation

- Learning backend handed off batched, relationship-scoped progress reads and subject/goal/Tutor/date filters, with strict UTC calendar-date validation and a 200-character topic bound. Dates filter evidence, while current goal target dates remain visible. `coverage` identifies query sets that reach configured/effective row limits; the UI must describe those as potentially incomplete rather than exhaustive history.
- Learning/session unit checks passed 34/34. Root applied independent migration 023 locally and ran the current full learning SQL suite against the populated runtime in a rolled-back transaction: 59 PASS observations. Its cancellation reason/idempotence/denial/history checks, distinct optional notes and completion-after-feedback-edit checks passed. Root retains all targeted 004/005/006 observations in `docs/evidence/sprint4/native-boundary-observations.txt` (153 observations, not formal-case totals).
- Marketplace migrations 021/022 remain held until the owner's frozen-source validation. They include versioned assessment templates, factual badge policies, owner bookmarks, minimal assistant reports, operational snapshots and authoritative outbox-completion outcomes. The final complete sorted replay must include their latest definitions and the new 007 suite; an earlier draft replay is not final proof.
- Sol frontend reports the requested dashboard summaries, saved Tutor controls, approved-method matching choices, admin editors, AI controls, progress warning/filters and task cancellation are wired. Actual new admin/platform browser workflows still await 021/022 runtime application.
- Independent Sol now owns viewer-local time presentation for formal case 4.5, preserving canonical UTC/ISO instants, plus supported isolated production output and privacy-safe Next development logging. The local Next documentation confirms default development Server Function logs include arguments and incoming requests include URLs; these defaults could expose prior form values or callback credentials, so the verifier disabled those logs.
- Root prepared a restricted private production-test environment for loopback proxy 55448/site 3018 with external adapters explicitly disabled. The verifier confirmed the old proxy handle was terminal before restarting it. No deployment or hosted change occurred.
- `scripts/verify-native-platform-jobs.mjs` is prepared but not yet executed after the pending 022 change. It checks four missing/wrong-token denials and two authorized local jobs with an explicitly labeled queue fixture; external email remains disabled. Final execution will produce its artifact only after actual assertions pass.
- A second development diagnostic overlapped HMR and UI changes and returned much slower results; the verifier and learning owner were notified. Neither diagnostic is accepted as the final p95 result. Production measurement after source freeze remains required.
