# Sprint 2 report assembly outline

Prepared September 30, 2026. Group 11; client Group 8; guide Dr. Tushara Sadasivuni; Fall 2026. Coordinator: **Adam Dalwai, designated by the user September 30, 2026**. Implementation is explicitly authorized; this reader/drafting role does not establish implementation completion. Due October 5, 2026, before class; exact class time remains to be confirmed. Internal freeze: October 4.

## Assembly contract and source precedence

Preserve the Sprint 1 main numbering and cover identity from `docs/Dalwai_Group11_Sprint1.docx`; rebuild, rather than copy, its broken TOC fields. The actual DOCX XML contains one scheduling table with seven columns and two embedded drawings. Its TOC includes the later modeling, implementation, testing, architecture, and GitHub headings even where Sprint 1 body content is absent. Do not treat those TOC entries as completed work.

The supplied mission/assignment governs deliverables; SDD version 1.1 governs behavior; lectures govern templates/notation. The standalone assignment is not a file in the inspected source inventory: verify its exact wording and rubric weights against the original supplied assignment before final export. The old Sprint 2 PDF is draft material, not evidence. `../planning/SPRINT2_EXECUTION.md` records the new coordinator/authorization without rewriting the historical scaffold plan.

## Cover and contents

- Project title: Tutor Plus: Smart Platform for Academic Progress; Software Engineering Project; Group 11; Fall 2026; all five names; guide; Adam Dalwai as coordinator; actual report date.
- Every member exports/submits their own `YourName_Group11_Sprint2.pdf`; Adam's example is `Dalwai_Group11_Sprint2.pdf`. Coordinator prints the inspected report before class October 5.
- Generate a real TOC from heading styles after final pagination. No invented page numbers or `Error! Bookmark not defined.` entries.

## Primary heading hierarchy

| Heading | Required content / source | Evidence state and assembly instruction |
| --- | --- | --- |
| **1.0 INTRODUCTION** | Continue Sprint 1 introduction | Preserve heading; update sprint-specific material, not prior achievements |
| 1.1 Software Engineers' information | All five biographies verbatim from the original Sprint 1 DOCX; names/emails from its roster | Builder extracts original biography text without paraphrasing or invented skills |
| 1.2 Planning and Scheduling | Sprint 2-only seven-column table from `../planning/SPRINT2_EXECUTION.md` | Estimates and pending actuals; Adam coordinator; no copied 100% evaluations |
| 1.3 Teamwork basics | Continue Sprint 1 communication/review arrangements | Separate team communication tools from product capabilities; Discord/iMessage are not an in-app chat feature |
| 1.4 Problem Statement | `PROBLEM_STATEMENT.md`, including user requirements and three Group 8 candidates | Bold only actual Sprint 2 refinements; candidates remain unconfirmed |
| 1.5 System Requirements | Adult users, role capabilities, functional and nonfunctional scope | Cite SDD FR identifiers and quality sections; no implementation claim |
| 1.5.1 Context Diagram | CTX-01: main system-only context; CTX-02: stakeholder companion | CTX-01 follows modeling lecture physical p16: Tutor Plus and external SYSTEM peers only. CTX-02 separately shows Student/Tutor/Administrator with labeled interactions; do not stereotype humans as systems |
| 1.5.2 Activity Diagram | ACT-01: student booking/learning cycle | Initial/final, guarded decisions, correct swimlanes, retry/abandonment, truthful payment state. Identify later-sprint portions |
| **2.0 REQUIREMENTS** | Exactly ten detailed pairs plus a separate five-item backlog | Do not count the backlog as detailed Sprint 2 records |
| 2.1 Use Cases | UC-01–UC-10 in `USE_CASES.md` | Physical lecture p64 fields; tag individual interactions; alternatives differ from failures |
| 2.2 Requirements | REQ-01–REQ-10 in `REQUIREMENTS.md` | Name and Rationale are mandatory alongside mission fields; `Test cases: TBD` in each record |
| 2.3 Use Case Diagrams | UCD-01 UC-01; UCD-02 UC-03; UCD-03 UC-04; UCD-04 UC-06 | Stick actors, ovals, system boundary, valid include/extend; do not invent an exclude relationship |
| **3.0 DATABASE TABLES** | PostgreSQL DBMS; `../architecture/DATABASE_DESIGN.md`; four implemented groups UC-01/02/04/06 | Describe every attribute/type/PK/FK, constraints, relation and RLS policy; table groups are not just four tables |
| 3.1 Database design and ERD | ERD-01, relationship/cardinality and dictionary | Match migration names; provider-managed `auth.users`, application `profiles` and `user_roles` |
| 3.2 SQL and database communication | Actual migration/seed paths, replay command and result, authorized/denied operations | Populate only from builder evidence; no SQL placeholders described as implemented |
| **4.0 CLASS DIAGRAM** | `../architecture/CLASS_DESIGN.md` | Preserve Sprint 1 main heading and trace to selected flows |
| 4.1 UC-01 User Management classes | CLASS-01 identity/session/role responsibilities | Composition for capabilities, not mutually exclusive Student/Tutor subclasses |
| 4.2 UC-04 Availability and Booking class design | Mission-required UC-04 design: availability rules/exceptions, booking, participants, price/state and booking service | Distinguish design from implementation; show attributes/operations/multiplicities and payment dependency. The older class-design file's UC-02 selection does not waive this mission requirement |
| 4.3 Frontend and logic implementation | Actual UC-01 and identified UC-02 subflows; CLASS-01 includes UC-02 responsibilities; supplementary UC-04 reservation subset if evidenced | Match actual code and show persisted state, verification/session behavior, ownership denials and desktop/mobile navigation; list omissions. User-reported UC-04 worker is not full booking/payment completion; Stripe confirmation deferred |
| **5.0 BEHAVIORAL MODELING** | ACT-01 reference and relevant state/interaction explanation | Do not duplicate figures or invent extra assignment obligations; reference 1.5.2 and explain planned vs demonstrated branches |
| **6.0 IMPLEMENTATION** | Reproducible environment/build/run narrative | 6.1 prerequisites/configuration; 6.2 exact terminal commands; 6.3 actual fresh non-IDE results. Reference 4.3 for flow implementation, avoiding duplicated claims |
| **7.0 TESTING** | 7.1 formal test cases; 7.2 actual implementation validation | Formal cases remain TBD for next sprint per lecture. Record actual smoke/integration/security/build commands separately if run; do not call TBD a pass |
| **8.0 ARCHITECTURAL MODELING** | 8.1 architectural views; 8.2 architectural model | One Next.js/TypeScript modular monolith plus Supabase; internal modules belong here, not among CTX-01 external peers |
| **9.0 GITHUB** | Verified repository/project links, board and implemented-page screenshots | Reuse Sprint 1 board if accessible; otherwise document approved replacement. Show To Do/In Progress/Done and evidence-driven movement; no fabricated URLs |
| **REFERENCES** | Assignment, SDD sections, actual Sprint 1 DOCX, physical lecture pages, technical references actually used | Distinguish assignment evidence, user-provided feedback, proposed decisions and executed results |

## Seven-section rubric crosswalk

This is a location crosswalk, not a replacement numbering scheme or a verified score calculation. The old draft's quoted weights total 105; do not normalize them or claim a grade without the original rubric.

| Assignment section | Primary report location | Deliverable |
| --- | --- | --- |
| 1 Planning and Scheduling | 1.2 | Sprint 2-only schedule, five emails, new coordinator, estimates/dependencies/actual evaluation |
| 2 Problem statement and user requirements | 1.4–1.5 | Continued statement, bold refinements, three genuinely evidenced client requirements or explicitly unresolved candidates |
| 3 Improved context diagram | 1.5.1 | Lecture-compliant system-only CTX-01 plus mission stakeholder/labeled-edge CTX-02 |
| 4 Improved activity diagram | 1.5.2, supporting 5.0 | Reviewed ACT-01 and correct branching/swimlanes |
| 5 Requirements: 5.1 use cases, 5.2 requirements, 5.3 diagrams | 2.1, 2.2, 2.3 respectively | Ten full pairs and four diagrams including User Management |
| 6 Database design and implementation | 3.0–3.2 | DBMS/dictionary/ERD and real SQL/table groups for four use cases |
| 7 Frontend/logic, classes, execution | 4.0–4.3 and 6.0; evidence in 7.2 and 9.0 | Two demonstrated flows, class design, non-IDE build/run, database persistence and all implemented-page screenshots |

GitHub/screenshots and PDF/print rules are additional cross-cutting gates, not an invented eighth mission section.

## Source-specific requirements and conflicts

- Requirements lecture physical p64: Use Case #, Name of the Use Case, Actors with roles, Inputs with origin/purpose, stepwise Use Case Description, Exception Path, Alternate Path, Pre-condition with rationale, Post-condition, Outputs.
- Physical pp65–66: Requirement #, Use Case #, Name, Introduction, Rationale, Input, Requirement Description, Output, Test Cases TBD. Physical pp67–68 repeat the fuller generic field guidance and next-sprint test-case instruction. Include the union of fields; do not copy the sample's Login/"sign up" wording inconsistency.
- Physical p60's include/extend instruction is an in-class exercise that excludes login/logout/registration, not an override of the mission's required User Management diagram. Apply valid UML relationships where meaningful; confirm whether the instructor expects both on every sprint figure or across the set. The mission's reported "includes/excludes" is not a UML exclude stereotype.
- Modeling physical pp15–17 define external context; p23 illustrates actors/ovals/boundary; pp38–40 introduce static classes and compartments. Context lecture pp2–3 adds rectangular systems and connecting lines. Activity lecture pp3–6 supplies notation/swimlanes. Validate figures visually, not only extracted text.
- The earlier scaffold names Edu as proposed coordinator and says implementation lacks authorization. The user's September 30 designation of Adam and explicit authorization supersede only those current-state assumptions; the old files are intentionally preserved.
- The mission/user clarification requires UC-04 design at 4.2. Keep UC-02 responsibilities with CLASS-01/4.3 for the second implemented flow; preserve the older architecture document rather than silently treating its UC-01/UC-02-only diagram selection as sufficient.
- Sprint 1 already includes assessments, assignments, plans, progress and matching. Bold operational refinements, not their feature names as supposedly new additions.
- Sprint 1 score 95/100 and deductions of 2 for DOCX-only and 3 for context are **user-provided, not independently verified grading evidence**. Broken TOC text is independently observable in DOCX XML.

## Handoff gates

Before assembly, request actual client acknowledgement, original rubric/mission wording, verified GitHub URLs, actual environment/migration/test logs, rendered diagrams and complete screenshot manifest. This outline supplies locations, not proof. Apply `REPORT_CHECKLIST.md`, inspect the complete exported PDF at readable print scale, then record each submission/print result without predicting success.
