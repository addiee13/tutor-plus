# Sprint 4 independent verification


Final local-demo handoff: **no known critical blocker remains** after the currency and multiline-text corrections. The final optimized local build and seven read/render smoke observations passed; all **218 unit tests in 15 files** passed. The app remains running at **http://localhost:3018** with native Auth/PostgREST/Storage/PostgreSQL. No hosted deployment or production-readiness claim is made.

The user explicitly requested a critical-fix finish because credits were ending and the app would never go to production. Further exhaustive matrices, the prepared performance benchmark and configured-provider extras were deferred. Historical findings below are retained; this final disposition supersedes their earlier open status.

Date: 2026-11-08. Reviewer: delegated GPT-6.1 Sol verifier. This is an initial runtime review while the backend completion and frontend integration are in progress. It does not close the 63 in-scope formal cases in [the acceptance register](../testing/SPRINT4_ACCEPTANCE.md). The ten UC-06 payment cases remain excluded. The separate Feature List confirms the same module/case scope.

The reviewer inspected the repository guide, README, architecture, source review, Sprint 2 plan/traceability, current domain services, migrations, browser tests and acceptance register. Existing unrelated report, diagram and application changes were preserved. No commit, branch, push, deployment, provider account change or runtime reset was performed.

## Environment and boundaries

The application runs at `http://localhost:3008` against isolated native GoTrue Auth, PostgREST and Supabase Storage through `http://127.0.0.1:55440`; PostgreSQL listens at port 55438. Fixture identities and credentials were read from the private files under `/tmp/tutorplus-native-runtime` and were not copied into this report. The confirmed booking is an explicit local fixture created through the existing fixture payment boundary; it is not evidence of a provider, charge or production booking.

Browser checks use installed Chrome (`PLAYWRIGHT_CHANNEL=chrome`). The unqualified Playwright launch failed because the packaged headless browser was not installed; that infrastructure failure did not exercise application behavior. Desktop is 1440 × 1000; phone is 390 × 844. Production and provider email delivery remain unverified by this pass.

## Reproduced findings and remediation status

| Cases | Observation and concrete boundary | State at this handoff |
| --- | --- | --- |
| 5.1, 5.2 | Valid Tutor authoring initially failed with SQL `42702`, `column reference "assessment_id" is ambiguous`. The left column in the question-position subquery conflicted with a local variable in `202611080002_learning.sql:170`. | Backend owner supplied an immediate runtime patch using a distinct local ID and explicit position counter. The complete desktop browser lifecycle passed after correcting the test locator. Phone and ordered migration replay remain required. |
| 5.1 | Objective payload validation declared `choice` as a local variable and reused it as an unqualified query column in `202611080002_learning.sql:110` and `129–134`; its broad exception handler converted the ambiguity into an invalid-payload result. | Backend owner supplied an immediate runtime patch with qualified aliases. Complete authoring variants and clean migration replay remain required. |
| 8.1, 8.2 | First upload failed before submission because the native Storage schema lacked `USAGE` for existing API roles. | Root added only the missing schema usage grants. No object policy or table grant was broadened for this environment fix. |
| 8.2 | Storage upload authorization probes carry `metadata.contentLength` before final `metadata.size` exists. The original upload policy required final size, rejecting every actual upload. | The first immediate patch still rejected exact 10 MiB because raw multipart length includes overhead. Root has since applied the owner's revised policy: final size remains capped at 10 MiB and the preflight request is bounded at 12 MiB. Real upload/download must now be rerun. |
| 8.2, 0.3 | A permitted 2 MiB file produced a real Server Action HTTP 500 with `Body exceeded` before domain validation. Local Next.js documentation states the default action limit is 1 MB of raw request body. | Reviewer changed only `next.config.ts:7` to a bounded 12 MB action cap, leaving room for multipart overhead. Domain and private bucket retain the 10 MiB file cap. Browser 10 MiB + 1 byte now reaches field validation and leaves no submission after reload. |
| 4.12 | The real Student-authenticated `reschedule_booking` call against the confirmed fixture returned `22023`, `Only an active payment-pending hold can be rescheduled`. The old booking remained unchanged. Source `202611080001_marketplace.sql:398` permits only pending holds, while the formal case explicitly uses a confirmed fixture. | Open and reported to root/owner. Pending-hold idempotence tests do not cover confirmed-booking rescheduling. Atomic conflict rollback, preserved booking/payment identity/state and updated notices require evidence after implementation. |

The learning creation actor check was already under repair when this verifier started: a stale runtime definition checked the caller's Student capability instead of the target learner's eligibility. Root applied current exact function definitions before the results above. This report does not present that earlier failure as a new independent diagnosis.

## Executed evidence

| Check | Actual result | Limits |
| --- | --- | --- |
| Real Auth/PostgREST assessment scoring and privacy variants | Assigned Student sees zero answer-key rows; unrelated Student sees zero assessment questions and receives `42501` on submission. Correct objective answer gives 2/5 points with `submitted` status and `score = null` while written work is pending. Repeated finalization is safely refused with `22023`. Tutor 4/3 points is refused; unrelated scorer receives `42501`; authorized 3/3 produces canonical 5/5. | Fixture used the existing supported direct authoring interface to reach the scoring boundary while the authoring RPC was broken. This is not full UI authoring acceptance or human-confirmed mastery evidence. Redacted results: `/tmp/tutorplus-verifier-scoring-results.json`. |
| Desktop assessment lifecycle | `workspaces.spec.ts --project=desktop --grep 'tutor authors'`: **1 passed**. Tutor created/assigned through UI, Student submitted, Tutor scored, Student saw persisted 5/5 after reload, unrelated user was denied. Sign-out/sign-in separated each participant view. | Written-answer assessment path only; the objective/mixed variants above were checked separately at the real API boundary. Screenshot files were captured under `/tmp/tutorplus-verifier-assessment-fixed-run`; phone and visual inspection remain separate gates. |
| Confirmed reschedule negative path | Real participant RPC is refused; before/after status and timestamps are identical. | Demonstrates the required positive-path gap and rollback on refusal, not successful rescheduling. Results: `/tmp/tutorplus-verifier-reschedule-results.json`. |
| Browser oversized upload | `assignment-file-boundaries.spec.ts` desktop, 10 MiB + 1 byte: **1 passed**. HTTP 200 returns the labeled file error, no success notice appears, and reload shows no private file/submission. | Exact-limit upload/download remains blocked by the preflight policy. Results directory: `/tmp/tutorplus-verifier-boundary-run`. |
| Formatting and focused lint | `npx prettier --check next.config.ts tests/e2e/assignment-file-boundaries.spec.ts` passed; `npx eslint tests/e2e/assignment-file-boundaries.spec.ts` passed. | Applies only to the reviewer's focused changes. |
| Type checking during concurrent integration | `npm run typecheck` failed because the queued platform service was not yet present and the newly extended study-plan types were not yet connected to current frontend/service returns. | Work in progress, not a passing quality gate. No error identified in the bounded action-cap configuration. Rerun after integration. |

Primary browser command, using private local fixture files without printing their contents:

```sh
WORKSPACE_E2E_FIXTURES=/tmp/tutorplus-native-runtime/fixtures.json \
PLAYWRIGHT_CHANNEL=chrome \
PLAYWRIGHT_BASE_URL=http://localhost:3008 \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
npm run test:e2e -- tests/e2e/workspaces.spec.ts tests/e2e/assignment-file-boundaries.spec.ts \
  --workers=1 --output=/tmp/tutorplus-verifier-retake-upload-run
```

The new boundary tests exercise both 10,485,760 and 10,485,761 bytes through browser forms, Server Actions and the real private-file route. Their explicit fixture skip is not a passing runtime result.

The existing assessment test had an exact-label mismatch: written answer labels include `(optional)`. The reviewer changed only that test locator to include the actual accessible label. An obsolete run compiled before this correction was intentionally interrupted; its incomplete aggregate must not be reported as a complete test result.

## Pending acceptance gates

After the backend patch is preserved and applied, rerun the complete assessment lifecycle and private file lifecycle on desktop and phone, including actual download bytes, unrelated-user denial, refresh and logout. Inspect captured screenshots before treating rendered evidence as reviewed. Structured study-plan/progress and platform modules are actively changing; their required formal variants remain pending rather than inferred from the first-wave scaffold. No ordinary-read 200-sample p95 measurement, full keyboard/reduced-motion audit, provider delivery test or production validation has been performed by this verifier.

## Final critical-fix handoff

- **Currency correctness:** forward migration024 and the service/matching currency hard filter exclude EUR3000 from a USD3000 budget before pagination/ranking. Actual targeted SQL preserves unpriced EUR visibility and the legacy USD contract. This does not implement payment or foreign exchange. Evidence: [currency correction](sprint4/native-currency-fix.json).
- **Multiline boundaries:** the real browser transported4000 visible agenda characters as4001 CRLF characters. Session and corresponding learning/marketplace/platform long-text helpers now normalize line endings before limits. Actual desktop/phone agenda, goals and recap boundary checks passed; focused helper units cover the corrected family. Evidence: [numeric transport observation](sprint4/session-transport-boundary.json).
- **Privacy:** actual development callback/query/action/credential/browser-warning canaries remained absent from new terminal logs after disabling content-bearing framework logs. Provider keys and fixture passwords stay private. Evidence: [logging canaries](sprint4/native-dev-log-privacy.json).
- **Core UI:** actual local browser signup/SMTP callback/replay, numeric-code/deadline, injected write failures/canonical reload, verified review/moderation, session text and viewer-local/UTC flows were exercised. The separate quality run passed five checks with one desktop touch variant not applicable, covering25route/actor views at1440×1000 and390×844. Earlier harness/infrastructure failures are retained and are not represented as a green aggregate matrix. Evidence: [browser run summary](sprint4/browser-summary.json).
- **Final build/read/visual smoke:** full application/test TypeScript passed in the isolated optimized build. Seven actual reads covered login/dashboard, canonical availability, USD discovery, positive matching/factor explanations, dated progress, truthful assistant setup state and anonymous phone rendering. The final phone discovery capture was visually inspected: readable controls and profile content, explicit USD budget labels, and no clipping or horizontal overflow. Evidence: [build provenance](sprint4/production-build.json), [final smoke](sprint4/final-demo-smoke.json), [phone image](screenshots/sprint4/final-demo/phone-discovery.png).
- **Quality suite:** final `npm test` passed218tests/15files. TypeScript, application/test ESLint and scoped formatting passed. The full `npm run check` attempt was stopped by formatting warnings; the six in-scope files were formatted, while the unrelated pre-existing `scripts/render_section10_concise_sprint4.mjs` was preserved. Evidence: [actual check outcomes](sprint4/quality-checks.json).

The existing fresh SQL replay has334PASS observations and the independent-client booking race; the subsequent four currency observations are a separate targeted run. Neither count is a formal-case total. The acceptance register maps executed variants to their actual layers.

No performance p95 was measured. Live OpenAI/Mapbox and external email delivery remain unverified; real native SMTP/API and deterministic adapter units are labeled separately. The optional configured-AI secondary instance3019 and Responses fixture55449 were stopped before handoff. Main3018, its pass-through data proxy55448 and the native services remain alive. Keep that proxy while using3018. No commit, branch, push, hosted migration, deployment or runtime reset was performed.
