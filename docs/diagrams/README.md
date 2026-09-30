# Tutor Plus Sprint 2 diagrams

Editable Mermaid (`.mmd`) and PlantUML (`.puml`) sources are in `source/`; every figure has a matching full-size PNG and SVG in `rendered/`. These are design models, not application or provider execution evidence. Review evidence and exceptions are recorded in `REVIEW.md`.

## Stable report handoff

| Trace label | Figure basename | Report section | Print placement |
| --- | --- | --- | --- |
| CTX-01 | `context-systems` | 1.5.1 primary context | Portrait, at most 6.5 inches wide / 7.3 inches high |
| CTX-02 | `context-stakeholders` | 1.5.1 companion context | Portrait, at most 6.5 inches wide / 7.3 inches high |
| ACT-01 | `activity-booking-payment` | 1.5.2; reference in 5.0 | Portrait, at most 6.5 inches wide / 7.5 inches high |
| UCD-01 | `usecase-uc01` | 2.3 | Portrait, 6.5 inches wide |
| UCD-02 | `usecase-uc03` | 2.3 | Portrait, 6.5 inches wide |
| UCD-03 | `usecase-uc04` | 2.3 | Portrait, 6.5 inches wide |
| UCD-04 | `usecase-uc06` | 2.3 | Portrait, 6.5 inches wide |
| CLASS-01 | `class-uc01` | 4.1; reference in 4.3 | Landscape, at most 9 inches wide / 7 inches high |
| CLASS-02 | `class-uc04` | 4.2 | Landscape, at most 9 inches wide / 7 inches high |
| ERD-01, sheet 1 | `erd-uc01` | 3.1 | Portrait, 6.5 inches wide |
| ERD-01, sheet 2 | `erd-uc02` | 3.1 | Portrait, 6.5 inches wide |
| ERD-01, sheet 3 | `erd-uc04` | 3.1 | Portrait, 6.5 inches wide |
| ERD-01, sheet 4 | `erd-uc06` | 3.1 | Portrait, 6.5 inches wide |

Use **four ERD sheets**, not a later-backlog ERD. Shared reference tables recur intentionally; they are the same tables, not duplicates. Key-focused ERD sheets omit descriptive columns; migrations and the full database dictionary remain authoritative. Never stretch images to change their aspect ratios. Captions should repeat the editable source filename and describe planned vs. implemented scope accurately.

## Context boundary and notation

The heavy central rectangle labeled `<<Tutor Plus System>>` is the **explicit application boundary**, not an internal module. Its connector endpoints are on the rectangle edge, so no line crosses the title. Supabase Platform is outside that application boundary because it provides managed Auth/PostgreSQL. Stripe Connect, OpenAI API, Email Service and Geocoding Service are also external providers. No dashboard, booking, session, moderation or matching module is presented as an external system.

`context-systems` is the primary lecture-conformant system-only model: plain connectors without process/data-flow semantics. `context-stakeholders` is explicitly a companion view, with Student, Tutor and Admin marked human actors and mission interactions labeled. Human actor nodes in the companion are not UML use-case ovals; the four use-case figures separately use stick actors, use-case ovals and rectangular system boundaries.

## Behavioral scope

The activity is the **planned successful booking/payment/tutoring scenario**, with alternative-slot and declined-payment retries and one final state. Cancellation/abandonment, hold expiry, absent/pending events, and late-payment reconciliation are separate UC-04/UC-06 alternate paths, not hidden success branches. Retry is permitted only while the hold remains valid; after expiry a fresh booking must rerun availability checks. A pending or missing provider event cannot traverse `[approved]`. Tutoring occurs externally/in person or through a provided meeting URL, not native platform video. Private meeting details must exist before the scheduled start. No inbox delivery, completed lesson or real Stripe outcome is claimed by this model.

For use-case relationships, dashed `<<include>>` arrows point from the base use case to required behavior; dashed `<<extend>>` arrows point from conditional behavior to its base, with explicit conditions. Refund requests and asynchronous webhook reconciliation are independently initiated goals rather than mandatory included UI payment steps. UC-04 depicts the paid-booking path; other valid paths remain in the textual use-case record.

Capabilities compose through `user_roles`; Student/Tutor/Admin are not mutually exclusive subclasses. Class figures model responsibilities, not a claim that TypeScript defines an identical class per box. UC-04 persistence shows SQL overlap exclusion, request deduplication, stale-version checks and verified-provider reconciliation.

## Render and repeat the print proof

Prerequisites already supplied for this workspace: PlantUML 1.2026.8, Graphviz 16.1.0, Mermaid CLI at `/private/tmp/tutorplus-diagrams/node_modules/.bin/mmdc`, and system Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. No package/network installation is performed by the renderer. Run Chrome-enabled rendering outside a restrictive sandbox when required.

```sh
sh docs/diagrams/render.sh
.venv/bin/python docs/diagrams/print-proof.py
.venv/bin/python docs/diagrams/verify.py
pdftoppm -r 120 -png docs/diagrams/print-proof.pdf /private/tmp/tutorplus-print-proof
```

`MERMAID_CLI` may override the local CLI path; edit `source/puppeteer-config.json` if the browser path differs. This installed Mermaid CLI uses `--size`, not legacy `-w`/`-H` options. `PLANTUML_LIMIT_SIZE=16000` prevents silent export cropping. `print-proof.pdf` and `review-metrics.json` record report-scale placements and artifact hashes; independently inspect all thirteen proof pages after a change. The final assembled report still requires its own complete visual review.

## Source mapping

- SDD version 1.1 §§6.1–6.5, 10–13 and 16: account capabilities, profile privacy, discovery, booking, payments, provider boundaries and integrity.
- `lec/5_System_Modeling_SWE.pdf`, physical pp15–17 and 23: system-only context, external actors, use-case ovals and system boundary; class relationship material beginning p38.
- `lec/4_Requirement_ENgineering_SWE-5.pdf`, physical p60: standard include/extend directions; its classroom exercise exclusion of login examples is not a ban on the assignment-required UC-01 diagram.
- `lec/ActivityDiagram.pdf`, physical pp3–6: initial/final state, guarded decision and swimlanes. No fork/join is added to a sequential scenario just for decoration.
- `lec/DatabaseFundamentals.pdf`, physical pp20–23 and 36: keys, normalization and whole-scenario relationships.
- `docs/planning/SOURCE_REVIEW.md`, `TRACEABILITY.md`, `docs/sprint2/USE_CASES.md` and `docs/architecture/{ARCHITECTURE,DATABASE_DESIGN,CLASS_DESIGN}.md`: documented scope and trace labels.
- `supabase/migrations/202609300001_identity.sql` through `202609300004_provider_boundary.sql`: actual current identity, profile/scheduling, booking/payment and server-provider SQL names and constraints. SQL reading is not database replay or policy-test evidence.
