# Sprint 2 diagram review

**Review date:** September 30, 2026, America/New_York. **Author-role visual gate: PASS for all thirteen figures at the recorded print placements.** This is an internal diagram review, not an instructor grade, client approval, application test, SQL replay, payment transaction or completed tutoring-session claim. Independent reader/instructor review and final assembled-report inspection remain pending.

## Actual evidence and review method

1. Read workspace instructions, README, source review, sprint plan, architecture/database/class design, the available source extracts and the current use-case/traceability records.
2. Visually inspected supplied lecture context/activity notation plus fresh physical PDF renders of modeling pp16, 23 and 38, requirements p60 and database p36. Database pp20–23 were extracted for PK/candidate/FK/normalization notation. SDD sections supporting scope, actor capabilities, booking/payment state and provider boundaries were read from its source extract.
3. Rendered **13 SVG + 13 PNG** using the existing PlantUML 1.2026.8 / Graphviz 16.1.0 and Mermaid CLI 12.0.0 / system Chrome. No duplicate package installation. Original source PDFs remain unchanged.
4. Generated `print-proof.pdf`, thirteen complete Letter-size proof pages, with **6.5-inch portrait width**, **7.5-inch activity height cap**, and **9-inch landscape width / 7-inch height caps for classes**. Captions identify each editable source. Actual placements and SHA-256 hashes are in `review-metrics.json`.
5. Rendered the proof with Poppler at 120 dpi and opened **every complete figure/page with `view_image`**. Reopened both context and both class pages after the final label corrections; all other figure hashes remained unchanged. Checked full extent, endpoints, lane titles, conditions, system boundaries, multiplicities, compartment content and readable print-scale text.
6. Ran `.venv/bin/python docs/diagrams/verify.py`: PASS for all thirteen hashed source/PNG/SVG triples, XML/PNG integrity, minimum visible text estimate of at least 8 pt, both context providers/boundaries, four activity lanes/two retry loops/exact guards/one initial and final state, seventeen expected directed include/extend relationships, capability composition, and **93 ERD field occurrences matched against current migration table/column names**. This checker does not replace visual or database execution review.

`pdftoppm` reported nonwritable font-cache directories but exited successfully and produced the inspected complete pages. Mermaid's initial legacy `-w` invocation failed; the script now uses the installed CLI's `--size`. Chrome launch initially failed inside the restrictive sandbox; the successful exports used the approved renderer outside it. Early wide/cropped figures were replaced, not passed. `PLANTUML_LIMIT_SIZE=16000` prevents the observed default-limit cropping.

## Figure-by-figure gate

Minimum text is calculated from visible SVG font declarations and fitted print placement; for Mermaid it includes the 18 px title and 24 px node/edge text, not the invisible tooltip style. This is a layout estimate, not a physical-printer guarantee. Main-report placement must not further shrink these figures.

| Figure / trace label | Complete proof page | Actual print size (inches) | Minimum text (pt) | Visual result and key check |
| --- | --- | --- | --- | --- |
| `context-systems` / CTX-01 | 1 | 6.500 × 5.624 portrait | 14.32 | **PASS** — system-only; five real providers including Supabase; exact application boundary; plain lines meet edges without obscuring title |
| `context-stakeholders` / CTX-02 | 2 | 6.500 × 4.182 portrait | 8.45 | **PASS** — Student/Tutor/Admin explicitly human, mission interactions labeled; no human-as-system stereotype |
| `activity-booking-payment` / ACT-01 | 3 | 5.992 × 7.500 portrait | 8.11 | **PASS** — four full lanes; available/unavailable and approved/declined guards; two clear retry loops; one final state; verified payment before confirmation |
| `usecase-uc01` / UCD-01 | 4 | 6.500 × 8.329 portrait | 10.06 | **PASS** — stick humans/external actors outside boundary, mandatory validation/authority, conditional recovery points toward login |
| `usecase-uc03` / UCD-02 | 5 | 6.500 × 6.140 portrait | 11.16 | **PASS** — published safe discovery; conditional distance extension; required filtered/paginated result behavior |
| `usecase-uc04` / UCD-03 | 6 | 6.500 × 7.371 portrait | 11.14 | **PASS** — atomic reservation, payment association, conditional replacement-slot extension, separate policy-checked cancellation/reschedule |
| `usecase-uc06` / UCD-04 | 7 | 6.500 × 8.138 portrait | 10.73 | **PASS** — Stripe external; conditional retry; independent refund/reconciliation goals; signatures and idempotency required |
| `class-uc01` / CLASS-01 | 8 | 7.723 × 7.000 landscape | 9.13 | **PASS** — typed compartments/operations; role composition and multiplicities without role inheritance; managed identity and protected capability distinction |
| `class-uc04` / CLASS-02 | 9 | 6.471 × 7.000 landscape | 8.76 | **PASS** — service/persistence boundary, overlap exclusion, request key, optimistic versions, event history and verified-provider reconciliation |
| `erd-uc01` / ERD-01 sheet 1 | 10 | 6.500 × 8.549 portrait | 15.63 | **PASS** — identity/profile PK-FK, composite capability key, optional grantor/audit actor; audit entity reference not presented as an FK |
| `erd-uc02` / ERD-01 sheet 2 | 11 | 6.500 × 7.672 portrait | 14.44 | **PASS** — unique user/tutor association, subject hierarchy/link table and safe public snapshot; no alternate Student identity store |
| `erd-uc04` / ERD-01 sheet 3 | 12 | 6.500 × 8.380 portrait | 11.16 | **PASS** — rules/exceptions, participant/subject FKs, generated blocking range, private details/history, composite taught-subject FK and singleton policy note |
| `erd-uc06` / ERD-01 sheet 4 | 13 | 6.500 × 8.788 portrait | 11.70 | **PASS** — canonical booking/payment uniqueness, provider event identity/order, refund/payout references and nullable requestor |

## Internal quality score

**Author self-assessment: 95/100. Not an instructor grade or an independent review result.** It is justified by the actual artifact checks above, not by a requested target score.

| Criterion | Earned / possible | Evidence / deduction |
| --- | --- | --- |
| Source trace and honest system boundary | 20/20 | Actual lecture p16 primary, stakeholder separation, managed Supabase and provider boundaries, no externalized internal modules |
| Activity control/payment correctness | 19/20 | Exact lanes/guards/retries/one ending; −1 because cancellation/expiry alternatives remain textual rather than on this successful-scenario sheet |
| Use-case notation/relationships | 19/20 | Correct include/extend direction and conditional predicates; −1 for remaining nonambiguous actor-association crossings in UC-01 |
| Capability/class/SQL consistency | 20/20 | Composition, concurrency/persistence, actual migration names, keys/cardinalities/types and four selected groups checked |
| Readability/export/reproducibility | 17/20 | Every complete print proof inspected and hashed; −3 for denser activity/class text at approximately 8–9 pt despite accepted readable placements |
| **Total** | **95/100** | Independent reader/instructor may disagree and request revisions |

No known clipping, unreadable condition, false provider success, reversed relationship, role inheritance or obscured context title remains at these placements. Minor density/crossing deductions are disclosed rather than called perfect. All required generated filenames remain stable for the report builder.

## Source conflicts / handoff decisions

1. **Context scope:** lecture system-only context governs the primary; mission human participation is a clearly identified companion. Supabase is external to the Next.js application boundary, not a fake internal peer. Hosting is not added as a decorative dependency.
2. **Classes vs. existing draft:** `CLASS_DESIGN.md` still selects UC-01 + UC-02; this mission explicitly requires UC-01 + UC-04. Delivered exactly the two mission figures. `class-uc01` does **not** claim to diagram UC-02 profile-editor responsibilities. Report §4.3/traceability should identify UC-02 implemented responsibilities separately or request a later profile-class figure rather than relabel this one. Architecture-draft edits are outside this role's scope.
3. **Current SQL beats the older dictionary where names differ:** the diagram uses `profiles.status`, `adult_attested` and nullable `adult_attested_at`, not the stale `account_status`/mandatory timestamp-only definition. Current migration includes `public_tutor_snapshots`, generated `bookings.blocking_range`, `request_key`, UQ `(student_id, request_key)`, a composite taught-subject FK, both Student and Tutor overlap exclusions, nonnullable `booking_events.to_state`, `payments.last_provider_event_at`, `payment_events.provider_occurred_at` and `private.booking_policy`. These refinements are represented or explicitly annotated; the main role must reconcile the full database dictionary. This scope does not edit SQL or architecture documents.
4. **Activity scope:** ACT-01 is a planned successful booking/payment/tutoring scenario, not proof of implemented booking, Stripe, notices or teaching. A user may abandon/cancel through the textual UC-04 alternate path; expired holds require a new availability check, and late paid events enter reconciliation/refund review. Missing/pending events cannot mean approved. No fork is inserted into the deliberately sequential meeting/session scenario.
5. **Course wording:** use standard `<<include>>` / `<<extend>>`, not invented `<<exclude>>`. The p60 classroom exercise says not to use login/logout/registration examples; the Sprint 2 assignment specifically requires user management, so its UC-01 deliverable takes precedence over that exercise topic restriction.
6. **Publication and review status:** these models are rendered, reviewed designs. Actual SQL migration/policy/concurrency execution, code correspondence, Group 8 approval, coordinator confirmation, final report layout and instructor evaluation require separate evidence. No commits, branches or services were created by this role.

## Independent reviewer checklist

- Open `print-proof.pdf` and the final assembled report; independently inspect all thirteen complete figures at the recorded placements. Do not reduce the two class pages to portrait without rerunning the visual gate.
- Confirm system-only CTX-01 and stakeholder CTX-02 are separately captioned; exact central label is `<<Tutor Plus System>>` and Supabase is present.
- Trace every activity guard/loop and verify authoritative provider state; check textual cancellation/expiry boundaries and only one terminal node.
- Read all seventeen use-case relationships in their arrow direction and distinguish independently initiated refund/webhook goals from mandatory UI includes.
- Reconcile dictionary/migration differences and the UC-02 class/report coverage note; run `.venv/bin/python docs/diagrams/verify.py` against final artifacts and SQL names.
- Record an actual independent result/date/issues; author PASS and 95/100 do not stand in for reader acceptance or a course grade.
