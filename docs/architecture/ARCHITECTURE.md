# Architecture decision — modular monolith

Status: **recommended design, not implemented**. Basis: SDD version 1.1 sections 10–12, 20–26; current official provider guidance summarized in `docs/planning/SOURCE_REVIEW.md`. Decision date: September 30, 2026. Team acceptance: pending.

## Decision and alternatives

Use **one Next.js App Router application with React and TypeScript**, organized by business capability, and **Supabase PostgreSQL/Auth** as managed persistence and identity. Use server-side domain services for business rules, RLS for data isolation, and explicit provider adapters. This is the best fit for this documented course scope and five-person team, not a universal claim about all systems.

| Option | Benefits | Costs for this project | Decision |
| --- | --- | --- | --- |
| Next.js modular monolith + Supabase | Matches SDD; one application deployment/language; relational transactions; managed identity; feature-owned boundaries | Requires disciplined server/client boundaries, RLS tests, provider configuration | Recommended |
| Next.js + separate FastAPI service | Good for a Python-heavy backend or independent compute workload | Second service/deployment, API contract, cookie/CORS boundary, duplicated validation; no current requirement justifies it | Revisit only if a real workload warrants it |
| Microservices | Independent scale and releases | Distributed transactions/events, network failure modes, operational overhead disproportionate to a semester team | Reject for this release |
| Custom password/session system | Full control | Reinvents high-risk security and recovery flows under a short deadline | Reject; use managed Auth |
| Document database as primary store | Flexible documents | Booking/identity/payment/learning relations and integrity are central here | Reject as system of record; JSONB only for bounded variable data |

## Logical architecture

```text
Student / Tutor / Administrator browser
        |
        | HTTPS, semantic forms, safe view models
        v
Next.js modular monolith
  Route layer: Server Components, bounded Client Components,
               authenticated Server Actions / Route Handlers
  Domain layer: validation -> actor/ownership/state checks -> use-case service
  Data layer:   user-scoped repositories / transactional database operations
  Adapters:     Supabase Auth/Storage, Stripe, AI, email, geocoding
        |
        v
Supabase PostgreSQL: constraints, migrations, grants, RLS

Later: verified provider webhooks and scheduled jobs enter through
       narrow server endpoints, not browser-controlled state updates.
```

This is an architectural view, **not the Section 3 context diagram**. The context figure shows only Tutor Plus and meaningful external systems, in lecture notation.

## Technology selection and timing

| Concern | Choice | Sprint 2 treatment |
| --- | --- | --- |
| Application | Next.js App Router, React, TypeScript | Pin compatible supported releases and a lockfile when implementation begins |
| Presentation | Tailwind CSS + accessible primitives | Keep a small reusable component set; semantic HTML first |
| Runtime validation | Zod or equivalent | One validation definition per feature; server revalidates every submitted payload |
| Database | PostgreSQL through Supabase | Name DBMS explicitly in Section 6; no MySQL replacement needed |
| Identity/session | Supabase Auth + supported SSR integration | Email/password, verification, login/logout, refresh, role-aware destinations |
| Authorization | Current application role/status checks + PostgreSQL RLS/grants | Prove allowed and denied reads/writes; a redirect is not security |
| Geographic search | PostGIS + geocoding adapter | Design now; defer discovery/geocoding runtime unless needed by an implemented flow |
| File storage | Supabase Storage with private access policies | Defer uploads if not demonstrated; never implement unrestricted public submissions |
| Payments | Stripe Connect, Test Mode | UC-06 tables now; checkout/webhooks/payout demonstration later |
| AI | Server-only adapter; SDD calls for Responses API | Later scope; model, quotas, data retention and keys are not selected here |
| Testing | Vitest, Testing Library, Playwright, database policy tests | Add once code exists; current files are test plans only |
| Hosting | Vercel application + Supabase services | Hosting optional for Sprint 2 if local non-IDE reproduction is reliable |
| Scheduled notices | Authenticated, idempotent server jobs | Later; no separate queue/broker infrastructure initially |

Verify actual account entitlements, supported versions, SMTP configuration, and provider limits at setup. Do not assume a free tier, 24-hour inactivity control, or successful mail delivery.

## Module ownership and dependency rules

| Domain | Owns | Allowed collaboration |
| --- | --- | --- |
| `auth` | Verified actor context, role/status checks, signup provisioning, session lifecycle | Auth adapter; profiles provisioning through a documented transaction/recovery boundary |
| `profiles` | Private profile preferences; tutor draft/publication readiness; public snapshots | Auth context, subject catalog, availability readiness query |
| `discovery` | Bounded public filters/results, approximate location | Public profile DTOs and availability queries; never private learning data |
| `availability` | Weekly rules, exceptions, time-zone conversion, candidate slots | Booking conflicts through a narrow read contract |
| `bookings` | Participants, transactional reservation, booking states, price snapshot | Availability validation; payment adapter/service through a defined operation |
| `payments` | Provider event verification, deduplication, monetary/refund/payout state | Booking transition service; provider adapter |
| Future learning modules | Assessments, assignments, plans, progress and evidence | Authorized relationship queries; explicit contracts, not arbitrary cross-table writes |
| Future safety/AI/notices | Moderation, resources, AI orchestration and event delivery | Narrow audited services, not privileged browser operations |

Routes assemble a use-case response; they do not contain duplicated business rules. Components receive safe DTOs and submit validated intent. A feature owns its service, validation, data mapping, and tests; keep abstractions proportional to real use. Start with one clear service per capability rather than a class/interface for every function. `CLASS_DESIGN.md` models responsibilities; TypeScript need not instantiate every diagram box as a class.

Cross-domain mutations go through the owning service or a reviewed database transaction, never another module's arbitrary repository. Avoid a large generic “utils” or “service” bag. Add a new process or broker only after a measured requirement defeats the single-application design.

## Identity, roles, and sessions

1. Managed `auth.users` is the identity source; application `profiles.id` references it. Keep passwords and provider session secrets out of application tables.
2. `user_roles` stores capabilities. An account may be Student, Tutor, or both; Administrator is provisioned through a controlled privileged path, never a self-signup checkbox or user-editable metadata.
3. Registration collects 18+ attestation and role intent. A reviewed Auth-user provisioning trigger can create the profile and permitted roles in the provider's database transaction; otherwise define compensation/retry and do not claim an Auth API call plus later insert is atomic. Persist initial role intent as untrusted input only until the trusted provisioning path validates it.
4. Ordinary server operations use a verified Supabase actor and user-scoped database access. The role/status source is authoritative database state, not a stale browser flag. Middleware/proxy navigation checks and role-specific dashboards are convenience layers, not the only permission checks.
5. Use the current supported SSR cookie/refresh pattern and request-specific clients. Do not cache one user's session or private response for other users. Document the actual configured cookie/security behavior instead of promising a universal HttpOnly setting incompatible with the chosen SDK.
6. Logout clears application cookies and revokes refresh capability at the intended scope. Supabase access JWTs can remain valid until expiry; do not claim instantaneous invalidation of every previously issued token. Define local-vs-global signout deliberately and test the chosen behavior.
7. An inactive user or removed role must be denied privileged application actions using current database state even if an old JWT remains unexpired. If the threat model requires immediate denial of all replayed logged-out access tokens, add and test an authoritative session-existence/revocation check; do not infer it from cookie removal.
8. Pending verification has a clear “check your email/resend” state; verified identity and complete readiness are prerequisites for protected publishing/booking/submission operations. A deterministic demo fixture is not a substitute for proving real signup.

## Data access and privacy

- Enable RLS and least-privilege grants on every exposed private table. Test positive and negative access under real anonymous/student/tutor/admin identities.
- Keep ordinary service-role bypass out of user flows. Admin bootstrap and provider jobs may use scoped privileged server operations, with validation, minimal permissions and audit records.
- Own profile data, student reflections, learning evidence, private meeting information, and provider identifiers must not appear in public DTOs.
- Maintain a deliberately public tutor snapshot, published only after readiness checks. It avoids granting anonymous access to the private `profiles` table. Public fields are tutor-approved; credentials are assertions unless separately verified.
- Tutor access to student learning data requires the documented relationship/assignment/booking, not merely holding a Tutor role. Admin moderation authority is not blanket access to private reflections or answer keys.
- Logs carry request ID, operation, timing and safe error category, not passwords, tokens, full prompts, answer keys, private reflections, or file contents.

## Transactional business invariants

Booking uses a PostgreSQL transaction to revalidate availability and reserve one non-overlapping active interval. An exclusion constraint over tutor plus half-open UTC range is the final guard; optionally guard student overlaps too. Account for buffers in the blocking range. Availability changes must not race past reservation validation: lock the relevant scheduling owner/rules consistently, or use a reviewed equivalent isolation strategy. UI slot checks alone are insufficient.

Use integer minor units and ISO currency, snapshot prices/policies, and maintain payment state separately from booking state. Stripe events are signature-verified, deduplicated by event identity, and processed transactionally with permitted transitions; stale events must not regress state. Retry without duplicate charges. Pending holds have explicit expiry/release behavior; deadline values are configuration decisions, not invented source requirements.

Learning progress is a projection from dated evidence. An assessment score is not automatic mastery. Tutor-scored answers and private answer keys stay behind their own authorization boundary. Future AI may suggest drafts; humans confirm persisted changes and AI cannot mutate booking/payment/mastery or admin decisions.

## Delivery and maintainability

- One repository and application initially; scaffold folders are not separate deployable services or npm packages.
- Versioned SQL migrations are the schema source of truth. Use managed Auth rather than manually recreating `auth.users`; keep seeds repeatable and passwords outside SQL/history.
- Separate local, test/preview, and production services/secrets. Prefer a disposable database for policy/concurrency tests; never destructive-reset an unknown production database.
- Keep migrations reviewable, coordinate ordering across team members, and use PRs with narrow feature scope. CI can be a provider pipeline or equivalent non-IDE command sequence; its actual configuration is future work.
- A feature PR must identify UC/REQ IDs, schema/policy changes, tests, implemented vs. deferred subflows, and rendered evidence.
- At each milestone, reproduce the demo from a clean intended environment. Runbook and report claims must match that exact state.

## Decision log

| Decision | Reason | Revisit trigger |
| --- | --- | --- |
| Keep SDD modular monolith and Supabase | Minimizes architecture churn and infrastructure burden | Independent scaling/compute needs with measured evidence |
| UC-01 + UC-02 UI first; UC-01/02/04/06 DB | Delivers graded identity + real persistence without blocking on payment integration | Instructor requires booking as the second UI feature |
| Private profile + explicit public tutor snapshot | Avoids anonymous exposure of private account information | New public fields require a privacy review |
| Database capabilities rather than one mutable `users.role` | Preserves SDD dual Student/Tutor accounts | A later approved role simplification changes the SDD |
| No custom auth, direct chat, or skill swap | Security/scope discipline and SDD 1.1 non-goals | Explicitly approved later requirements |
| No providers provisioned or versions pinned in this change | User requested no code; accounts/access remain unknown | Implementation authorization and environment setup |
