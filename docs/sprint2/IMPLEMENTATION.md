# Sprint 2 implementation and reproducible execution

Prepared September 30, 2026. Current implementation is explicitly authorized by the mission. Historical architecture/scaffold notes remain preserved; this runbook and the actual database inventory describe the executed increment. This is a local application, not a deployed production service or an instructor-approved submission.

## Implemented flows

**UC-01 User Management.** The browser submits accessible registration and login forms to Next.js server actions. Signup validates the email, password, display name, IANA time zone, 18+ attestation, and Student/Tutor intent. Supabase Auth creates managed identity, and a transactional trigger provisions the private profile and permitted initial role. Choosing Tutor maps to `initial_role=tutor`; no Administrator option is accepted. A real verification email must be consumed before login reaches protected pages. The local demonstration uses a capture mailbox and real Auth links, not a simulated account or administrator-forced confirmation.

Login resolves provider-verified identity and queries current profile status, capabilities, and the authoritative Auth session origin. Ordinary operations use user-scoped clients. Cookies are HttpOnly and SameSite=Lax; production sets Secure. Application expiration is fixed at 24 hours from `auth.sessions.created_at`, even after token refresh. A missing, revoked, expired, inactive, unverified, or non-adult actor is denied by the server and database. Logout ends the current provider session and removes its cookies; database session checks also deny a replayed access token. Multiple sessions are supported; global password-change logout is distinct from ordinary current-session logout.

The recovery, verification-resend, and password-change controls use managed Auth. Actual browser evidence distinguishes views from completed recovery requests. Admin operations require the current `administrator` database capability and are audited through `grant_user_role`, `revoke_user_role`, and `set_user_status`. An account may hold both Student and Tutor. Initial Administrator bootstrap is a separate local/server-only command with a once-only database guard; no privileged provider key is used by the web application's ordinary flows. Status changes preserve financial and append-only history.

**UC-02 own-profile persistence.** A verified active user reads their own private profile, updates display name and IANA time zone, and reads persisted values after reload. The server derives the owner from verified identity; a browser cannot choose another owner or grant a role through metadata. The demonstrated editor is deliberately narrow. Tutor publication, expertise, rates, avatars, student learning-preference editing, and full profile-management scope are not claimed as delivered UI merely because their database columns exist.

**Supplementary UC-04 reservation slice.** The booking workspace shows real public tutor snapshots and approved subject/rate DTOs. Students submit explicit UTC start/end instants and mode. The transaction checks current authority, offered subject, publication readiness, availability, exceptions, lead time, buffers, and price. Tutor and student exclusion constraints are final concurrency guards; a request key makes a retry idempotent. A saved reservation displays its actual monetary snapshot, payment-pending state and hold deadline, survives reload, and can be cancelled through an authorized operation. Private schedule data is not exposed just to populate a selector; no guessed available slots are represented as real availability. A reservation is not a paid session: Stripe checkout, real refunds/transfers, automatic confirmation and session completion are outside this demonstrated UI slice.

| Route | UI and logic | Authorization / result boundary |
| --- | --- | --- |
| `/` | Landing, navigation and scope introduction | Public; no fabricated tutor/session statistics |
| `/signup` | Adult Student/Tutor registration | Validated server action; no admin intent |
| `/check-email` | Verification pending and resend | No protected access before confirmation |
| `/login` | Credentials and safe failure state | Auth identity plus current DB actor |
| `/reset-password` | Recovery-link request | Generic enumeration-resistant acknowledgement |
| `/auth/callback` | Verified provider code exchange | Safe local redirect; no visual page |
| `/dashboard` | Current private identity and navigation | Active verified 24-hour session |
| `/profile` | Read/edit/save display name and time zone | Own row only; real persistence |
| `/update-password` | Managed credential update | Authorized identity; no tokens in report |
| `/admin` | Role grant/revoke and account status | Current Administrator, audited RPC |
| `/bookings` | Reservation/list/cancel; Tutor view | Student/Tutor scope; RLS and transaction |
| Error and not-found states | Helpful recovery/navigation | No raw provider, password, or SQL detail |

Loading, missing-service, validation, error, pending-email and saved-result states are distinct. The screenshot manifest identifies which views and interactions were actually captured. A screenshot of a form is not proof that its action completed.

## Source excerpts

The following excerpts show the actual server-action and service boundaries, reformatted only for readability. Complete compilable implementations, validation, cookie handling and SQL accompany the report; snippets are not substitutes for the runnable application.

```typescript
export async function signupAction(
  _previous: ActionState, form: FormData
): Promise<ActionState> {
  try {
    await register(await createUserClient(), form, siteUrl());
  } catch (error) {
    return failed(error);
  }
  redirect("/check-email");
}
```

Source: `src/app/actions.ts`. The provider adapter must report success before navigation; account verification is still pending on the destination page.

```typescript
export async function changeRole(
  client: SupabaseClient, form: FormData
) {
  const actor = await getActor(client);
  requireRole(actor, "administrator");
  const { operation, ...parameters } = parseRoleChange(form);
  const procedure = operation === "grant"
    ? "grant_user_role" : "revoke_user_role";
  const { error } = await client.rpc(procedure, parameters);
  if (error) throw new DomainError("unavailable");
}
```

Source: `src/domains/auth/service.ts`. The database rechecks current authority, locks administrative transitions, rejects removal of the final active administrator, and records changes. Client role labels are not authority.

```text
src/
  app/                         Routes and server actions
    (protected)/               Verified account pages
      admin/ bookings/         Role and reservation flows
      dashboard/ profile/      Private account workspace
    auth/callback/             Provider verification exchange
  components/                  Accessible forms and navigation
  domains/
    auth/                      Actor, session, role validation
    profiles/                  Own-profile persistence
    bookings/                  Reservation and cancellation
    shared/                    Safe typed errors
  lib/                         User-scoped Supabase adapters
supabase/migrations/           Versioned schema and policies
sql/sprint2_tables.sql         Standalone DDL
tests/                        Unit, integration and browser
scripts/build.sh               Non-IDE quality/build entry
```

## Database execution

The managed local engine reports PostgreSQL 15.8 with PostGIS. Versioned migrations install private profiles/roles/audit, tutor profiles/catalog/public snapshot/scheduling, bookings/private details/history, and payments/events/refunds/payout references. The implementation dictionary records exact installed attributes, types, nullability, primary/foreign keys and indexes; later learning/trust entities are labeled design-only.

The rollback-only SQL suite exercises permitted and denied actors, authoritative session boundaries, current roles, audit behavior, publication privacy, immutable booking/financial state, provider-event deduplication and refund limits. A separate disposable database replays the standalone DDL against a fresh managed Auth schema. Two independent SQL processes race the same tutor/time window; exactly one committed reservation is required. These isolated checks do not reset the application's verified user fixtures.

Provider-boundary functions run only for scoped privileged processing. Naming a function `apply_verified_payment_event` does not itself verify a Stripe signature; a later provider adapter must verify and translate the event before invoking it. SQL fixtures exercise state invariants, not live Stripe charge/refund delivery. Local email capture is likewise not external-inbox evidence.

Authoritative logs: `docs/evidence/database-regression.log` and `docs/evidence/database-isolated.log`. Their actual final results, including corrections found by API-level checks, are summarized in the execution ledger. An earlier passing test subset is not the final schema gate.

## Environment and build

Prerequisites: Node.js 22 or newer, npm, Docker and Supabase CLI for the local database; PostgreSQL 15 is specified in `supabase/config.toml`. Installed application versions are pinned in `package-lock.json`. A hosted Supabase project is optional for later deployment and was not provisioned here. Stripe, AI, external email and geocoding accounts are not needed to demonstrate the local identity/profile/reservation slice.

Use `.env.example` as the key-name contract. Store actual values in ignored `.env.local`, with restricted permissions. The public URL/publishable key are separate from the server-only bootstrap provider key. Test identities and passwords are disposable local fixtures and are never copied into the report, repository, screenshots of completed password fields, or shell arguments. A test skip means that the corresponding external/configuration gate was not exercised.

```bash
npm ci
supabase start --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
supabase migration up --local
bash scripts/build.sh --fresh
npm start -- --hostname 127.0.0.1 --port 3000
```

Configure the Auth callback/site URL for the selected local origin before the verification demo. Do not reset an existing database to reproduce a report without explicit disposable-environment authorization. `scripts/bootstrap-admin.mjs --confirm` requires an already verified eligible target and explicit bootstrap configuration; it is not an ordinary signup path. The fixture seed command is restricted to localhost and uses the Tutor's scoped client, not a general service-role bypass.

Actual clean-build, unit/integration, browser, and screenshot results appear in `docs/evidence/results.json`, `application-validation.log`, and the screenshot manifest. Formal per-requirement test cases remain TBD for the next sprint, as the lecture requests. No IDE, fabricated deployed URL, or third-party payment success is required or implied by these terminal commands.
