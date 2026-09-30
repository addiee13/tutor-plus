# Sprint 2 delivery plan

Prepared September 30, 2026. Target: a complete, evidenced submission before class on **October 5, 2026**. Internal freeze: **October 4**. Exact class start time: pending confirmation. A 24-hour late submission incurs 10% deduction under the supplied assignment.

## Scope and present status

This change creates documentation and scaffold only. The following implementation work is **planned, not performed**.

| Layer | Sprint 2 minimum | End-of-semester target |
| --- | --- | --- |
| Requirements | Ten detailed use cases + ten paired requirements; all fifteen listed | All fifteen fully specified and delivered at controlled depth |
| Modeling | Revised context/activity; four use-case diagrams including user management; schema/ERD; class design | Additional sequence/state/architectural refinements as required by later assignments |
| Database | Reproducible SQL migrations for UC-01, UC-02, UC-04, UC-06 table groups and dependencies | Entire relational model supporting all features |
| UI and logic | Complete core user management; start a real persisted profiles flow | Booking/payment/learning/AI/admin breadth in later phases |
| Delivery | Non-IDE build/run; real database communication; GitHub board; every implemented page screenshot; formatted PDF | Hardened deployed product and semester demonstration |

**Why UC-01 + UC-02 for frontend/logic:** they prove real identity, session, roles, ownership, validation, and database persistence with fewer external-service dependencies than checkout. This refines the existing draft's UC-01 + UC-04 class/UI proposal. Four-use-case database scope is unchanged. Do not claim UC-04/UC-06 UI or provider payment flows are implemented merely because their tables exist. Obtain instructor clarification if two "major use cases" must instead include booking; keep the current plan unless that instruction changes it.

## Section 1: Planning and Scheduling table

These are **proposed assignments and estimates**, not completed work or confirmed team commitments. Preserve the Sprint 1 column format. Sprint 1 coordinator: Shadmaan Akhand. Proposed Sprint 2 coordinator: **Edu M. Okpok**, pending team acceptance. The coordinator must be someone other than Shadmaan.

| Assignee Name | Email address | Task | Duration (hours) | Dependency | Due Date | Evaluation |
| --- | --- | --- | --- | --- | --- | --- |
| Edu M. Okpok (proposed coordinator) | Eokpok1@student.gsu.edu | S2-01: Confirm coordinator, Group 8 requirements, exact class time, and Sprint 1 feedback | 2 | Team/client availability | Sep 30, 2026 | Pending acceptance/evidence |
| Edu M. Okpok | Eokpok1@student.gsu.edu | S2-02: Refine Section 2 and review UC-01–UC-10 with client scope | 3 | S2-01, source review | Oct 1, 2026 | Draft prepared; approval pending |
| Adam Dalwai | Adalwai1@student.gsu.edu | S2-03: Architecture, revised context/activity and class diagram; establish environment once code is authorized | 5 | S2-02, architecture decision | Oct 2, 2026 | Specs prepared; diagrams/runtime pending |
| Kien Duong | Kduong10@student.gsu.edu | S2-04: Finalize ten requirement records, four use-case diagrams, and traceability | 5 | S2-02, S2-03 | Oct 2, 2026 | Text drafts prepared; figure/review pending |
| Nikhil Rodrigo | Nrodrigo2@student.gsu.edu | S2-05: Four-use-case schema, reviewed SQL migrations, keys/constraints/RLS, deterministic fixtures | 6 | S2-04; real Supabase environment | Oct 2, 2026 | Design prepared; SQL/database pending |
| Shadmaan Akhand | Sakhand2@student.gsu.edu | S2-06: Registration, email verification, login/logout, session refresh, and role handling | 6 | S2-03 foundation, S2-05 auth/profile tables | Oct 3, 2026 | Not implemented |
| Adam Dalwai | Adalwai1@student.gsu.edu | S2-07: Student/tutor profile form, persisted edits, public/private DTOs and readiness checks | 4 | S2-05, S2-06 usable identity | Oct 3, 2026 | Not implemented |
| Kien Duong + Nikhil Rodrigo | Team emails above | S2-08: Positive/negative auth, role, ownership and database tests; independent clean setup | 4 combined | S2-05, S2-06, S2-07 | Oct 4, 2026, morning | Test plan only |
| Shadmaan Akhand + Adam Dalwai | Team emails above | S2-09: Non-IDE build/run instructions, real page/navigation screenshots and demo evidence | 3 combined | S2-08 passed, working application | Oct 4, 2026, afternoon | Contract only |
| Edu M. Okpok + all reviewers | Team emails above | S2-10: Report assembly, justified paragraphs, centered figures/tables, page numbers, refreshed TOC | 3 combined | S2-02–S2-09 | Oct 4, 2026, evening | Outline only |
| All five members; confirmed coordinator prints | Team emails above | S2-11: Final PDF inspection, individual naming/submission, printed coordinator copy | 1 per member | S2-10; actual final PDF | Oct 5, 2026, before class | Not submitted |

Email spellings and names are copied from Sprint 1; each member should verify them. Replace estimates with actuals and the Evaluation field with honest results before submission. Combined effort is not hours charged independently to each co-owner.

## Execution order and exit gates

### Gate A — agree scope and models (Sep 30–Oct 1)

Confirm the new coordinator, client requirements, GitHub repository/project, class time, and actual feedback. Review the ten UC/REQ pairs. Freeze architecture and canonical table/route names. Exit: no undocumented scope conflicts; three approved client requirements or an explicitly recorded blocker.

### Gate B — foundation and database (Oct 1–2; only after code authorization)

Create one Next.js application with pinned compatible dependencies and a lockfile. Configure real local/test Supabase, Auth verification callbacks, reviewed migrations, least-privilege grants/RLS, and deterministic demo accounts/data. Commit no secrets. Implement schema groups in dependency order: identity/profiles/roles/catalog → availability/bookings → payment references/audit. Exit: migrations replay on an empty intended environment and permitted/denied access tests pass.

### Gate C — vertical user flows (Oct 2–3)

Implement UC-01 end-to-end, then UC-02's profile read/edit/save flow. One request travels form → server authorization/validation → domain service → database → persisted confirmation. Verify logout, refresh, inactive-account denial, and role tampering. Implement loading/error/empty/success and keyboard/mobile states while building, not after screenshot capture. Exit: real seeded identities and new signup both work; reloading proves saved profile state.

### Gate D — verification and evidence (Oct 4)

Run unit/component and auth/database-policy checks, production build, then focused E2E. Perform a clean setup without any IDE. Capture each implemented page plus navigation and key error states with commit/environment/role provenance. Four database use-case groups must be installed even when their UI is deferred. Exit: reproducible results and actual screenshots, not source-only assertions.

### Gate E — report/submission (Oct 4–5)

Assemble under the Sprint 1 TOC, with a rubric crosswalk. Refresh fields, export PDF, inspect every page, verify figures and page numbers, and produce member-specific filenames. Confirm actual GitHub board state. Print before class; every member submits. Exit: final PDF and receipts/print confirmation, with no missing required item.

## GitHub board plan

Reuse the **existing Sprint 1 repository and project**, whose URLs are pending. Do not create a substitute project or mark remote cards Done from this local document. Each card has ID, assignee, requirement IDs, due date, checklist, current status, and evidence links.

| Card | Initial honest status | Done evidence |
| --- | --- | --- |
| S2-01 Coordinator/client/feedback confirmation | To Do | Accepted rotation, three client approvals, class time, feedback record |
| S2-02 Problem statement + ten use cases | In Progress | Team-reviewed and source-consistent text |
| S2-03 Context/activity/class models + architecture | In Progress | Reviewed editable figures and inspected exports; architecture approved |
| S2-04 Ten requirements + four use-case diagrams | In Progress | Ten complete field sets, four rendered diagrams, correct relationships |
| S2-05 Database groups/migrations/RLS | To Do | Clean replay and constraint/policy test output |
| S2-06 User management | To Do | Working signup/login/logout/session/roles + denial tests |
| S2-07 Profiles UI/logic | To Do | Saved data read back after reload + ownership tests |
| S2-08 Verification | To Do | Logged actual commands/results and independent fresh setup |
| S2-09 Build/run + page/navigation screenshots | To Do | Non-IDE reproduction and complete evidence manifest |
| S2-10 Final PDF | To Do | All checklist gates, visually inspected PDF |
| S2-11 Individual submissions + print | To Do | Submission receipts and printed copy confirmation |

Capture a full board screenshot showing **To Do, In Progress, Done** plus readable card screenshots if the full view is too small. A task may move to Done only when its own evidence exists.

## Blockers and risk decisions

| Risk/blocker | Action | Fallback without misrepresentation |
| --- | --- | --- |
| No explicit implementation authorization in current request | Deliver docs/scaffold only | Section 7 remains planned, not completed |
| Supabase/project/verification email unavailable | Resolve before Gate B; prove delivery to a real permitted test inbox | Local Supabase environment with clearly identified local email viewer, subject to class expectations |
| GitHub project/repository URL missing | Ask team for Sprint 1 links and inspect actual board | Local card plan only; screenshot/link requirement remains open |
| Client or coordinator unconfirmed | Arrange Sep 30 meeting/acknowledgement | Record open approval; do not fill with fictional agreement |
| Signup provisioning fails | Use reviewed transactionally coupled trigger or explicit recovery path; test failure | Do not claim Auth + a later unrelated insert is atomic |
| Payment/AI credentials cause schedule pressure | Keep provider runtime out of the selected two UI flows | Implement UC-06 schema, not pretend test charges |
| Profile publication lacks availability | Validate readiness and keep draft hidden | Persist editable draft; identify implemented subset rather than claiming full UC-02 |
| Deadline threatens quality | Freeze extras; prioritize graded core and genuine evidence | No mocked login, public private data, fake screenshots, or “Done” inflation |

## After Sprint 2

Specify UC-11–UC-15 and their requirements next sprint. Then deliver remaining SDD phases incrementally: discovery/availability/booking → test payments/reputation → session workspaces/plans → assessments/assignments → progress/explainable matching → AI/resources/admin → hardening. The semester MVP still includes all fifteen features.
