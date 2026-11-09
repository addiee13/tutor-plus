# Sprint 4 hosted release — November 9, 2026

Live application: **https://tutor-plus.me**. Latest Vercel deployment `dpl_AjcNTudGFqPDPGzmCK6LwNvhQ4ut` is Ready; aliases include `tutorplus-one.vercel.app` and `www.tutor-plus.me`. Latest application source is commit `ec735f5`; the database permission correction is commit `92f0d2c`. Both are on `main` and pushed to `origin/main`. The 66 core browser observations and upload workflows ran on the preceding `e152228` deployment; the final release adds assistant validation clarity and truthful application identification, followed by a targeted live assistant check.

## Changes delivered

- Committed the fourteen non-payment modules and their local verification artifacts; merged upstream booking range display while preserving the accessible picker IDs.
- Applied all 26 new versioned migrations to the existing TutorPlus Supabase project, through `202611090001`. Managed Storage already enables RLS, so migrations no longer attempt an owner-only redundant ALTER on its managed table.
- Changed assignment/session files to user-scoped signed uploads directly to private Storage. The application receives metadata, verifies the actual object and saves the authorized submission. This preserves the 10 MiB contract under Vercel's function request limit and keeps Auth cookies HttpOnly.
- Fixed a hosted-only session page failure: a later migration had revoked the booking ownership predicate needed by the attachment read policy. The correction grants only that predicate to authenticated users. A scan of direct policy references found no other missing authenticated helper permission.
- Configured the server-only notification worker key, restricted TutorPlus Resend sending key, verified delivery webhook and provider settings. Owner account Adam now has the initial audited Administrator capability.
- Configured a five-minute GitHub Actions notification schedule and proved a manual run. This is a best-effort schedule, not an exact-minute delivery guarantee.

## Executed checks

| Check | Observed result |
| --- | --- |
| Unit tests after merge/upload changes | **230 passed, 17 files** |
| ESLint | Passed |
| Clean GitHub typecheck/lint/optimized build | [Passed for application commit](https://github.com/addiee13/tutor-plus/actions/runs/42572717416); [passed after permission migration](https://github.com/addiee13/tutor-plus/actions/runs/42573101324) |
| Vercel optimized build and canonical alias | Ready; HTTPS `/tutors` returned 200 |
| Live Chrome desktop/phone route, role, refresh and logout checks | **66 passed**, [recorded observations](sprint4/live-release-browser.json), including actual content after loading placeholders disappear |
| Live assignment file boundary | Exact 10 MiB upload, persisted submission, refresh and byte-matching private download passed; 10 MiB + 1 byte rejected without a submission (2/2 desktop browser tests) |
| Live phone session workflow | [Passed](sprint4/live-session-storage.json): preparation persists, private upload, tutor download denied before approval (403), approval persists, approved download bytes match |
| Notification jobs | [Manual workflow passed](https://github.com/addiee13/tutor-plus/actions/runs/42572917775): queued 4, claimed 4, provider accepted 4, retries/exhaustion 0. Missing worker authorization returned 403. |
| Actual Resend webhook | Hosted database recorded four signed `email.sent` events and one `email.delivery_delayed` event. These do not prove inbox delivery. |
| Assistant provider refusal | [Actual live UI failure](sprint4/live-assistant-provider.json); no generated answer claimed |

Screenshots are under [release-20261109](screenshots/sprint4/release-20261109/). Desktop dashboard and phone discovery/session images were visually inspected. Protected workspaces, administrator routes and responsive layouts were checked against the live canonical domain, not localhost.

## Remaining external limits

**Update, November 9:** OpenRouter replaced AgentRouter after real local and production assistant responses passed. The active model is `nvidia/nemotron-3.5-lightning:free`; the configured provider timeout is bounded at 60 seconds. See [OpenRouter verification](sprint4/openrouter-ai-verification.json). Location lookup remains the outstanding provider setup.

Historical initial provider finding: the supplied AgentRouter key was tried against the configured endpoint. It returned HTTP 401 with `unauthorized_client_error` and “unauthorized client detected.” A key/endpoint permitted for this custom application is required for generated answers. The new key is configured server-side; it is not in Git. No client impersonation was added to evade the provider restriction.

`MAPBOX_ACCESS_TOKEN` is not available. Manual city/postal geocoding and location-based search need that configuration; virtual discovery and the remaining learning workflows do not. The implementation requests permanent geocoding because tutor locations are persisted, so the Mapbox account must permit that use.

Payments remain excluded from the authorized implementation scope. Ordinary new reservations remain payment pending and create no charge. Hosted browser tests use two explicitly labelled deployment accounts and a no-provider/no-charge fixture relationship; these do not prove a payment integration. Their credentials remain in a private local file, outside Git. Administrator browser access was verified through a one-time provider verification link for the verified owner; no owner password was changed and no external verification email was sent by the test.

Unrelated pre-existing report, diagram, generated typing and local Supabase configuration changes were preserved outside these commits. Exhaustive performance benchmarking and every historical acceptance variant were not rerun for this release; the earlier acceptance register retains its evidence and limits.

## Assistant thinking state

The live assistant now shows a Motion Primitives text shimmer adapted to TutorPlus styling, a restrained activity indicator, and a 15-second longer-wait message. The state follows the actual Server Action, hides stale output, disables repeat submission, and remains readable without animation when reduced motion is requested. MIT attribution is preserved in `licenses/motion-primitives.txt`.

Desktop, phone and reduced-motion checks passed locally and live. Browser interception held real Server Action requests to inspect initial/long-wait states, then continued them to actual context validation; these controlled delays are not provider timing measurements. Separate real free-model responses verified success cleanup and suppression of old answers during a new request. Full-card viewport visibility and no horizontal overflow passed. Local TypeScript/lint and the [clean GitHub quality build](https://github.com/addiee13/tutor-plus/actions/runs/42579762163) passed. See [actual observations](sprint4/assistant-loading.json) and [screenshots](screenshots/sprint4/assistant-loading/).

## AI learning progress summary — November 9, 2026

App commit `081f4bed5a7a069e4aa0142a830c07142fafcf2f` is live on **https://tutor-plus.me/progress**. Vercel deployment `dpl_AzAgYYibQY2vkgtTnwsjC3gsHsCu` is **Ready** and holds the canonical domain. This adds a second model-backed feature alongside the learning assistant; tutor matching remains rule-based.

Students generate a summary of their own filtered learning evidence, with source links, three suggested next steps, evidence limitations, loading/error states, and clear/regenerate controls. It uses the same private API configuration, atomic daily quota, and truthful request outcome tracking as the assistant. Source reads use the current user's authorized learning/session services. No new schema migration is required; generation does not change learning or mastery records. Current goals remain intentions rather than proof of achievement.

Validation: **236 unit tests in 18 files**, TypeScript, ESLint, and changed-source Prettier checks passed. GitHub quality/build run **42584340237** and the Vercel optimized build passed. Real local and production browser requests returned summaries of an authorized calculus demo record, preserved its sample label, and explicitly declined to infer improvement from one session. Desktop 1440×1000 and phone 390×844 renderings were inspected; no horizontal overflow or browser page errors were observed. Source links, pending/duplicate-submit protection, clearing, refresh, empty date-filter results, tutor-view UI restrictions, and logout denial passed. Unit tests separately prove the role boundary, current-actor target, filtered source selection, empty-evidence early return, provider failure propagation, and bounded/incomplete context handling. The existing learning assistant also returned a real production response and passed stale-output/error-recovery checks after the shared provider refactor.

An initial real summary exhausted its response budget during optional reasoning and correctly returned an error. Progress summaries now disable optional reasoning; subsequent real requests succeeded. Free-provider availability and shared quotas still apply. Output uses safe text and recognized section headings; a full Markdown/math renderer is not included. AI content remains a draft and must be checked against its linked records. Summary text clears on refresh; only minimal request/quota/outcome metadata is retained by the existing boundary.

Evidence: [verification results](sprint4/progress-summary-verification.json), [desktop](screenshots/sprint4/progress-summary/desktop.png), [phone](screenshots/sprint4/progress-summary/phone.png), [loading](screenshots/sprint4/progress-summary/loading.png). Screenshots show explicitly labeled sample learning content; credentials and account contact details are excluded.

## Desktop/shared audit fixes — November 9, 2026

App commit **`51b2a8a5988722979a25c6d9770ea9ed9cfacb01`** is live at **https://tutor-plus.me** through Ready deployment **`dpl_8zYFNLNGqjGSETDaE61aXiaDn4G4`**. The user explicitly excluded phone-specific audit work. Implementation is in `adb2a99` plus the filter-reset correction in `51b2a8a`.

Changes cover explicit hiding of closed disclosure children, empty tutor-pagination removal, full-width desktop resource filters, submit-arrow spacing, stable public loading chrome plus a protected loading boundary inside AppShell, an updating status/disabled controls for progress filters, visible empty-chart grids, and optional display-font loading to avoid late condensed-font replacement. Guest sign-in now preserves validated internal destinations and selected tutor queries across password, code/OAuth callback and onboarding paths; fixed-template magic-link callbacks can use a short-lived HttpOnly same-browser return cookie. Login error summaries are above fields, focused on failure, and both credential fields receive generic errors and `aria-invalid`.

The reported critical disclosure collision did not reproduce as visible/clickable overlap in Chrome: closed controls had measurable phantom boxes but were not painted, focusable, or hit-testable. Explicit author CSS now gives those children zero layout geometry. The audit's assistant-loading finding was stale: the existing pending card and disabled fieldset were already present and were verified without replacing that implementation.

Validation: **251 unit tests in 19 files**, TypeScript, ESLint, changed-source Prettier and the production optimized build passed. GitHub quality job/run **42596770534** passed. The new return-destination tests reject external URLs, protocol-relative paths, encoded path tricks, traversal and auth-action destinations while preserving booking queries and admission gates. Final local and production desktop browser checks passed the guest tutor → login → selected booking flow, invalid-login error placement/focus, closed/open disclosures across discovery/booking/matching/assistant/admin, resource-row geometry, empty-chart grids, pending/clear filter behavior, persistent header/footer through held RSC navigation, assistant pending controls/error recovery, and real same-browser magic-link return-cookie consumption. No email was sent or OAuth consent performed. No browser page errors were observed in the final runs. The live loading screenshot was visually inspected with authenticated navigation and footer intact; the empty chart and resource row were also inspected.

A first live assistant page navigation exceeded the browser's 30-second deadline; the complete final run passed with a 60-second navigation deadline. A new transition initially retained edited date inputs when clearing filters; this was reproduced and corrected before the final production run. Font policy was changed to avoid late replacement; this release does not claim a measured numerical CLS improvement. Phone touch targets, mobile overflow, notification layout and other phone-specific findings remain outside this release.

Evidence: [machine-readable checks](sprint4/desktop-audit-fixes.json), [loading shell](screenshots/sprint4/desktop-audit-fixes/loading.png), [empty chart](screenshots/sprint4/desktop-audit-fixes/empty-chart.png), [desktop resource filters](screenshots/sprint4/desktop-audit-fixes/resources.png), [login error](screenshots/sprint4/desktop-audit-fixes/login-error.png). Screenshots exclude account contact details and credentials.
