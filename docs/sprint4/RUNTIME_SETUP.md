# Sprint 4 runtime setup

This implementation extends the existing Next.js/Supabase application. Payments remain excluded. The November 9 hosted release and its observed limits are recorded in [live release verification](../evidence/SPRINT4_LIVE_RELEASE.md). Earlier local evidence remains historical evidence.

## Database and application

Apply the versioned files in `supabase/migrations/` in filename order to the intended Supabase environment. Preserve managed Auth and Storage schemas. The historical `sql/sprint2_tables.sql` and `sql/sprint3_tables.sql` exports do not include the new workflows and are not a replacement for current migrations.

Use Node.js 22 or newer, `npm ci`, and a private `.env.local` copied from `.env.example`. Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_SITE_URL` for the same environment. Configure Supabase Auth redirect URLs and hosted verification/recovery templates separately. Repository templates alone do not change hosted templates. New accounts require email verification, adult attestation and a permitted application capability.

The application uses user-scoped clients for ordinary reads/writes. `SUPABASE_SERVICE_ROLE_KEY` is server-only and is also required for the explicitly privileged notification jobs and verified delivery webhook. Do not expose it through a `NEXT_PUBLIC_` variable. Administrative UI operations still authorize current database roles and retain audit provenance.

Run `npm run check`, `npm run build`, then `npm start -- --hostname 127.0.0.1 --port 3000`. Run integration/browser suites with disposable configured identities; a skipped test is not verification. `scripts/verify-native-db.sh` is a separate PostgreSQL/PostGIS regression runner using a temporary owned cluster and minimal Auth claims. It does not substitute for real Auth, Storage or browser verification.

## Optional provider adapters

| Configuration | Behavior |
| --- | --- |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Enable notification email submission. An accepted provider request is distinct from observed delivery. Missing configuration leaves truthful `not_configured` email state and preserves the in-app notice. |
| `RESEND_WEBHOOK_SECRET` | Resend/Svix signing secret for `/api/webhooks/resend`. The handler verifies the raw-body signature and timestamp before recording supported delivery events. Configure the provider to deliver its email lifecycle events to this route. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Enable the learning assistant and AI learning progress summaries through the same Responses API adapter. Missing either yields the configuration state. Responses are human-reviewed drafts and do not directly change grades, mastery, bookings or administrative decisions. |
| `OPENAI_BASE_URL` | Optional trusted server-only Responses API base; defaults to `https://api.openai.com/v1`. Keep the default for OpenAI. A loopback deterministic adapter may be used for explicitly labeled integration fixtures; those responses do not prove live AI behavior. |
| `ASSISTANT_PROMPT_LIMIT` | Prompt character limit; defaults to 100, with supported configured range 1–10000. The database enforces the supplied bounded limit as well as the service. |
| `ASSISTANT_DAILY_QUOTA` | Shared per-user daily request limit across both AI features; defaults to 2, supported range 1–100. Failed/refused requests are recorded with truthful outcomes. |
| `MAPBOX_ACCESS_TOKEN` | Enables manual city/postal-code geocoding. Without configuration or on failure, location-dependent filtering reports failure and retains the requested radius. Virtual search needs no location. |

Provider configuration is a separate deployment step. Local signed-event fixtures prove the webhook boundary without proving an actual Resend message or inbox receipt. Deterministic assistant tests prove adapter behavior without claiming a live model response.

The current local and hosted assistant configuration uses `OPENAI_BASE_URL=https://openrouter.ai/api/v1` and `OPENAI_MODEL=nvidia/nemotron-3.5-lightning:free`. Keep the key private. `ASSISTANT_TIMEOUT_MS=60000` permits slower free inference; the service bounds the setting to 1–60 seconds, and the assistant route reserves 90 seconds for authorization, inference and persistence. Free-provider availability and account rate limits still apply. Real local and production browser responses are recorded in [OpenRouter verification](../evidence/sprint4/openrouter-ai-verification.json).

## Catalogs, policy and private learning controls

Administrators manage notification templates at `/admin/templates`, versioned assessment templates at `/admin/assessment-templates`, and fact-based badge thresholds at `/admin/badges`. Assessment-template answer keys are restricted to current Administrators and authorized Tutors; a learner-facing assessment receives its own copied definition. Later template edits do not rewrite existing attempts. Policy/template edits require confirmation and a reason and retain audit provenance.

The `/admin/operations` console shows restricted operational snapshots and assistant response reports. Current backlog values are distinguished from time-window counts. Assistant reports reference opaque request metadata and the reporter's reason; they do not automatically copy full prompts, selected learning content or answers. Optional UI history/output clearing preserves security/quota metadata. Operational event coverage currently captures assistant request outcomes; template, badge and report mutations also retain durable actor/reason audit rows. This is not a claim of complete external analytics or monitoring coverage.

Students can save currently public Tutor listings and remove owned bookmarks. Saved-card reads recheck publication and use a bounded batch query for public subjects/rates. Smart matching scores only the supported teaching-method choices and factual, versioned factors; arbitrary demographic words are not accepted as scored preferences. Equal scores use a stable identifier tie break.

The current UI's budget bounds are USD. Discovery and matching check the budget currency before comparing minor-unit amounts or paginating results; there is no implicit currency conversion. Unpriced discovery can still show other-currency listings with their actual currency label.

Progress filters scope saved evidence by goal, subject/topic, Tutor and UTC dates. Current goal target dates remain visible when filtering historical evidence. If a query reaches its effective row limit, the coverage warning says that the displayed history may be incomplete; the summary does not claim an exhaustive history in that case. Booking/session summaries use the viewer's valid IANA time zone and retain canonical UTC instants; an unavailable zone falls back explicitly to UTC. Date entry still labels its UTC contract.

Development request and Server Function argument logging is disabled because URLs can contain verification credentials and prior action state can contain private learning text. Keep diagnostic logs limited to safe correlation/action/timing/outcome metadata.

## Notification scheduling

Set a high-entropy server-only `PLATFORM_JOB_SECRET`. An external scheduler must invoke these application routes with `Authorization: Bearer <PLATFORM_JOB_SECRET>`:

1. `/api/jobs/booking-reminders` enqueues currently feasible reminders (and the implemented learning reminder work).
2. `/api/jobs/notification-outbox` claims due work, persists recipient feed rows, and attempts eligible email dispatch.

Both accept GET or POST and return no-store JSON. The hosted release uses `.github/workflows/notifications.yml` every five minutes and on manual dispatch. It invokes reminder enqueueing before outbox processing, with `TUTORPLUS_PLATFORM_JOB_SECRET` stored as a private GitHub Actions secret. GitHub scheduled jobs can be delayed; this is not an exact-minute delivery guarantee. A manual hosted dispatch passed on November 9. Keep the scheduler secret out of public URLs and query strings.

Repeated invocations use deduplicated domain identities. The database rechecks booking version/status and cancels obsolete reminders after a move/cancellation. A reminder whose intended notification time is already past is not invented retroactively. The worker's `accepted`, `notConfigured`, `retrying` and `exhausted` counters are different outcomes; do not relabel any of them as delivered.

## Local verification boundary

The earlier integration environment uses isolated native PostgreSQL, GoTrue, PostgREST, Storage and Mailpit on loopback, with private credentials under `/tmp/tutorplus-native-runtime`. It is disposable test infrastructure, not deployment configuration. The November 9 hosted release separately applies the full migration chain and provider settings to the linked TutorPlus project. Fixture confirmations unlock learning tests through an explicitly labeled test boundary; no payment provider or charge is involved. Do not copy local fixture credentials or JWTs into hosted settings.

Assignments and preparation attachments upload directly to private Supabase Storage using a user-scoped, single-object signed URL. Only metadata and the final registration cross the application function, so the 10 MiB contract works within Vercel's request limit. Registration verifies ownership, path, actual stored MIME/size and current relationship/state. Migration `202611080025` permits the signed-URL preflight; `202611090001` restores the read-policy predicate permission. Auth session cookies remain HttpOnly.

For the running local demo, account details are in the private `/tmp/tutorplus-native-runtime/fixtures.json` file. Local verification emails are captured in Mailpit at `http://127.0.0.1:55446`; they are not sent to external inboxes.

### AI learning progress summary

Students open `/progress` and choose **Generate AI progress summary**. The action always resolves the student from the current authenticated actor, reuses the page filters, and reads through user-scoped learning/session services. It sends bounded filtered topic evidence and current goals to the configured provider after the student requests generation. Broader sidebar collections are not included. Empty evidence/goal selections return guidance without consuming a provider request. Goals describe intentions; recaps and scores do not establish mastery or improvement by themselves.

The response is transient, includes trusted source links and a generation timestamp, and can be cleared or regenerated. It never writes progress or mastery. Both AI features share the existing atomic database quota and outcome accounting. No new migration or provider key is required. Free inference can take a minute; errors preserve the source records and allow retry.
