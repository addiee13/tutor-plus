# Tutor Plus — Group 11

Responsive tutoring marketplace and evidence-based learning-support platform for adults aged 18 or older. Client group: **Group 8**. Course: Software Engineering, Fall 2026; guide: Dr. Tushara Sadasivuni.

## Current state

**Sprint 3 (October 2026).** Coordinator: **Edu M. Okpok** (Sprint 1 Shadmaan Akhand, Sprint 2 Adam Dalwai). Sprint 3 adds:

- Database support for four more use cases — **UC-05 Diagnostic Assessment, UC-07 Reviews and Ratings, UC-08 Practice Tasks and Assignment Management, UC-09 Session Planner and Recap** — as versioned migrations `202610180001`–`202610180004` (12 tables plus public availability DTOs) with trigger-enforced invariants, RLS and least-privilege grants. Standalone replay: `sql/sprint2_tables.sql` then `sql/sprint3_tables.sql`.
- Working frontend and logic for **UC-09** (`/sessions/[bookingId]`: student goals, tutor agenda, delivery, recap, private reflection) and **UC-07** (`/reviews`: one review per completed session, database-computed tutor rating).
- Hosted at **https://tutorplus-one.vercel.app**. Demo-only accounts and fixture bookings come from `scripts/seed-sprint3-demo.mjs`; payments are still not implemented, so demo confirmations are labelled fixture events, not charges.

Implementation facts (tables, functions, routes, evidence, commands and limits) are in [`docs/sprint3/IMPLEMENTATION_HANDOFF.md`](docs/sprint3/IMPLEMENTATION_HANDOFF.md). Earlier Sprint 2 records under `docs/sprint2/` and `docs/planning/` are kept as history.

The public repository is **`addiee13/tutor-plus`** (renamed from `addiee13/tutor-plus-sprint2`; the old URL redirects). Project board: https://github.com/users/addiee13/projects/1. The original course PDFs/DOCX and lectures remain local and excluded from public Git history.

## Start here

| Need | Read |
| --- | --- |
| What the source documents say and what needs correction | [Source review](docs/planning/SOURCE_REVIEW.md) |
| How to deliver this sprint, dates, owners, and blockers | [Current execution plan](docs/planning/SPRINT2_EXECUTION.md) |
| Best-fit architecture, tradeoffs, and security boundaries | [Architecture](docs/architecture/ARCHITECTURE.md) |
| Database attributes, types, keys, and relationships | [Implementation dictionary](docs/architecture/SPRINT2_DATABASE.md) |
| Frontend/logic class responsibilities for the two UI flows | [Class design](docs/architecture/CLASS_DESIGN.md) |
| Revised problem statement and user requirements | [Problem statement](docs/sprint2/PROBLEM_STATEMENT.md) |
| Ten use cases in assignment/lecture format | [Use cases](docs/sprint2/USE_CASES.md) |
| Ten paired requirements in assignment/lecture format | [Requirements](docs/sprint2/REQUIREMENTS.md) |
| Client's three requirements and confirmation evidence | [Client requirements](docs/planning/CLIENT_REQUIREMENTS.md) |
| Section-to-artifact-to-test coverage | [Traceability](docs/planning/TRACEABILITY.md) |
| Figure notation, scope, and acceptance briefs | [Diagram plan](docs/diagrams/README.md) |
| Sprint 1-compatible report structure | [Report outline](docs/sprint2/REPORT_OUTLINE.md) |
| Grading, formatting, evidence, and submission gates | [Report checklist](docs/sprint2/REPORT_CHECKLIST.md) |
| What has actually passed and what remains open | [Independent review](docs/evidence/VALIDATION.md) |
| How the demo builds and runs without an IDE | [Implementation runbook](docs/sprint2/IMPLEMENTATION.md) |

## Architecture in one sentence

One **Next.js App Router + React + TypeScript modular monolith**, with **Supabase PostgreSQL and Auth**, feature-owned domain services, server authorization plus RLS, and provider adapters for later Stripe Test Mode and AI integration. This preserves SDD version 1.1 rather than introducing a second backend or microservices.

## Sprint boundaries

- Document UC-01–UC-10 and REQ-01–REQ-10; list the remaining five for the next sprint.
- Design and later implement database support for **UC-01, UC-02, UC-04, and UC-06**, including all supporting tables, constraints, and policies—not merely four individual tables.
- Demonstrate **UC-01 User Management** and **UC-02 own-profile persistence**; a bounded **UC-04 booking-reservation flow** is an additional implementation target, not a claim of completed Stripe payments.
- Preserve editable Mermaid/PlantUML context, activity, four use-case, four core ERD, and UC-01/UC-04 class figures. Rendering and independent review states live in `docs/diagrams/REVIEW.md`.
- Preserve all fifteen semester features; later payment, AI, matching, progress, assessment, and assignment work is not silently removed from the product.

## Repository layout

```text
AGENTS.md                  Agent workflow and guardrails
README.md                  Project entry point
docs/                      Original sources and authored documentation
  architecture/            Architecture, schema, and class design
  planning/                Scope, schedule, source audit, client confirmation, traceability
  sprint2/                 Report-ready text drafts and report assembly gates
  diagrams/                Figure specifications; editable sources/export folders
  testing/                 Acceptance and verification plan
  evidence/                Real screenshots/results when available
lec/                       Original lecture slides
src/
  app/                     Next.js routes and server actions
  components/              Accessible forms and navigation
  domains/                 Feature services, policies, and validation
  lib/                     User-scoped Supabase adapters
supabase/                  Local configuration, migrations, and SQL regression checks
sql/                       Standalone four-group DDL
tests/                     Unit, integration, and browser checks
scripts/                   Non-IDE build, bootstrap, verification, and report tooling
output/doc/                Generated DOCX/PDF and local visual QA
```

## Local build and run

Use Node.js 22 or newer and npm. Run `npm ci`, copy `.env.example` to the ignored `.env.local`, and configure a disposable intended Supabase project. Never put privileged keys or account passwords in command arguments or Git. The local CLI configuration keeps email confirmations enabled and uses a local capture mailbox, not external inbox delivery.

Run `npm run check` before committing; it runs the typecheck, ESLint, the Prettier format check and the unit tests. `npm run format` applies formatting, and `npm run test:integration` / `npm run test:e2e` run the suites that need a live Supabase stack.

Date/time entry uses the shared `DateTimeField` native picker by default. Its visible label states UTC, matching booking summaries; it submits ISO UTC to the server without requiring users to type timestamp syntax. Reuse this control for new date/time fields and keep server-side validation authoritative.

Run `supabase start --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor` and `supabase migration up --local` for this repository's local stack. Use `./scripts/build.sh` and `npm start -- --hostname 127.0.0.1 --port 3000` for a non-IDE production run. Integration/browser checks may require disposable test identities; skipped checks do not prove behavior. See the runbook for actual executed results and exact configuration.

Three Group 8 client confirmations, GitHub project authorization, individual submission receipts, and the coordinator's printed copy are external/human gates until evidence is recorded. Generated review estimates are not instructor grades.
