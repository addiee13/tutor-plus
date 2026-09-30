# Sprint 2 execution addendum

Prepared September 30, 2026; all dates/times use America/New_York unless explicitly stated. Due Monday, October 5, 2026, before class; exact class start time still needs confirmation. Internal freeze: October 4. The reported assignment allows a 24-hour late window with a 10% deduction; this plan does not target it.

## Current authority and scope

- The user explicitly authorized implementation and designated **Adam Dalwai as Sprint 2 coordinator on September 30, 2026**. Sprint 1 coordinator was Shadmaan Akhand. This addendum supersedes the older scaffold's unapproved-implementation assumption and proposed Edu coordinator for current execution only; original planning/source files remain historical and unchanged.
- This role writes only the five report drafts, `TRACEABILITY.md` and this new addendum. Implementation, original sources, existing planning and diagrams are outside this role's write scope. Authorization is not implementation evidence.
- Exactly ten detailed UC-01–UC-10 / REQ-01–REQ-10 records; UC-11–UC-15 remain next-sprint detailed backlog without deleting any semester feature.
- Database implementation covers UC-01, UC-02, UC-04, UC-06 and supporting constraints/policies; selected UI/logic demonstrations are UC-01 and identified UC-02 subflows. A supplementary UC-04 reservation UI/SQL-persistence worker is underway per user update; partial reservation is not completed booking/payment, and Stripe confirmation remains deferred. Mission-required UC-04 class design is placed at report 4.2, while UC-02 responsibilities belong with CLASS-01/4.3 implementation.
- GitHub authentication reportedly works outside the sandbox and repository creation is underway; real local Supabase is being attempted (user update September 30). These are progress reports, not a verified repository URL, completed database startup or working application.

## Planning and scheduling

This table is **Sprint 2 only** and keeps all seven Sprint 1 column names. Task IDs S2-01–S2-11 and names retain source identity. All five email spellings use the user's explicit current lowercase mission form, overriding the capitalized first letters in the historical DOCX. Assignments other than the user-designated coordinator remain proposed work allocations until members acknowledge them. Duration is estimated person-hours, not elapsed hours or claimed actual effort. Evaluation records pending actuals/evidence; no 100% scores are copied from Sprint 1.

| Assignee Name | Email address | Task | Duration (hours) | Dependency | Due Date | Evaluation |
| --- | --- | --- | --- | --- | --- | --- |
| Adam Dalwai (coordinator) | adalwai1@student.gsu.edu | S2-01: Record coordinator designation, confirm class time/mission and Group 8 requirement evidence; verify repository/project access | 2 estimated | User designation and team/client availability; original assignment access | Sep 30, 2026 | Coordinator designated by user; remaining results/actual hours TBD |
| Edu M. Okpok | eokpok1@student.gsu.edu | S2-02: Continue problem statement, complete ten use-case records and client-candidate labels; review scope | 3 estimated | Source review; S2-01 evidence needed for final client claims, not to draft candidates | Oct 1, 2026 | Draft specification, not approval; actual hours/review evidence TBD |
| Adam Dalwai | adalwai1@student.gsu.edu | S2-03: Establish authorized application/Auth foundation; review architecture; coordinate context/activity and UC-01/UC-04 class design | 5 estimated | S2-02 scope; environment access; mission clarification | Oct 2, 2026 | Foundation/figures require builder evidence; actual hours TBD |
| Kien Duong | kduong10@student.gsu.edu | S2-04: Finalize ten paired requirements, four use-case diagrams and traceability | 5 estimated | S2-02; class/context boundaries from S2-03 for final diagram review | Oct 2, 2026 | Text is specification only; actual hours/rendered review TBD |
| Nikhil Rodrigo | nrodrigo2@student.gsu.edu | S2-05: Implement/review four-use-case migration groups, supporting tables, keys/invariants/RLS and deterministic fixtures | 6 estimated | S2-04 requirement records; usable actual PostgreSQL/Auth environment | Oct 2, 2026 | Replay/database/denial evidence and actual hours TBD |
| Shadmaan Akhand | sakhand2@student.gsu.edu | S2-06: Implement registration/verification/recovery/login/logout/session refresh and current-role/account handling | 6 estimated | S2-03 foundation; S2-05 identity/profile/role policies; actual verification channel | Oct 3, 2026 | No end-state completion claimed; actual hours/checks TBD |
| Adam Dalwai | adalwai1@student.gsu.edu | S2-07: Implement identified Student/Tutor profile editor/read-back, ownership/DTO boundary and publication-readiness subset | 4 estimated | S2-05 profile data/policies; S2-06 usable identity; availability facts for publication, if demonstrated | Oct 3, 2026 | Identify omitted subflows; actual hours/end-state evidence TBD |
| Kien Duong; Nikhil Rodrigo | kduong10@student.gsu.edu; nrodrigo2@student.gsu.edu | S2-08: Independent positive/negative authorization/database checks, concurrency/invariants and clean setup verification | 4 estimated combined | S2-05, S2-06, S2-07 actual artifacts and runnable environment | Oct 4, 2026, morning | Command/output/runtime evidence and actual hours TBD |
| Shadmaan Akhand; Adam Dalwai | sakhand2@student.gsu.edu; adalwai1@student.gsu.edu | S2-09: Fresh non-IDE build/run, actual page/navigation screenshots and evidence manifest | 3 estimated combined | S2-08 results resolved; working application/database; actual routes inventoried | Oct 4, 2026, afternoon | Build/render/persistence evidence and actual hours TBD |
| Edu M. Okpok; Adam Dalwai | eokpok1@student.gsu.edu; adalwai1@student.gsu.edu | S2-10: Assemble report with original biographies, inspect all figures/table fields, rebuild TOC and visually review exported PDF | 3 estimated combined | S2-02–S2-09 deliverables/evidence; verified GitHub board/page screenshots; client evidence or explicit unresolved gate | Oct 4, 2026, evening | Internal checks are not a grade; actual hours/PDF review TBD |
| Shadmaan Akhand; Adam Dalwai; Edu M. Okpok; Kien Duong; Nikhil Rodrigo | sakhand2@student.gsu.edu; adalwai1@student.gsu.edu; eokpok1@student.gsu.edu; kduong10@student.gsu.edu; nrodrigo2@student.gsu.edu | S2-11: Each member submits correctly named PDF; Adam prints coordinator copy before class | 5 estimated total (1 per member) | S2-10 inspected final artifact; confirmed class time/submission destination; available printing | Oct 5, 2026, before class | Future submission/print receipts and actual hours TBD |

Estimated total: **46 person-hours**; combined rows mean total effort across named participants, not that each spends the listed hours. These are planning estimates without member acceptance or measured elapsed time. Record actual start/end, person-hours, command/evidence reference and remaining issue only after each task occurs; update evaluation rather than predicting completion or grade.

## Dependencies and review gates

| Gate | Required actual evidence | Meaning of an open gate |
| --- | --- | --- |
| A Scope/approval | Original mission/rubric, user coordinator designation, three dated Group 8 acknowledgements and accepted wording | Specs can be drafted; client confirmations/grades cannot be invented |
| B Environment/database | Actual repository/project URLs and board access; Supabase/PostgreSQL/Auth startup; clean migration/seed replay for four groups; RLS/invariant results | Starting setup/repository creation is not a completed environment |
| C Two flows | Real registration/verification/login/logout/refresh/current roles; profile save read back after reload; unauthorized actor denied; explicitly identified omitted subflows | A placeholder/fixture bypass is not real signup/persistence |
| D Model/render | Lecture-compliant context plus stakeholder companion, activity, four use-case diagrams, ERD, UC-01/UC-04 class design and UC-02 implementation responsibility view | Editable source or syntactically valid XML alone is not visually reviewed completion |
| E Reproduction/evidence | Fresh non-IDE build/start, actual navigation and desktop/mobile states, route inventory/page screenshots, verified board screenshot | Local health/start alone does not prove flows or clean reproduction |
| F Submission | All report fields/sections, updated TOC, print-scale PDF inspection, each receipt and Adam's printed copy | Export alone is not submission/printing or instructor acceptance |

The critical implementation path is S2-02 scope → S2-03 foundation / S2-04 records → S2-05 schema → S2-06 identity → S2-07 profiles → S2-08 checks → S2-09 evidence → S2-10 PDF → S2-11 submission. Diagram specification/elicitation can proceed in parallel, but final model review uses actual schema/code and confirmed mission constraints. If environment setup fails, record the blocker; do not replace real database/Auth obligations with a fabricated demo.

## Current evidence gaps and decisions

- Group 8 CR-01–CR-03 are explicitly candidate/unconfirmed in `../sprint2/PROBLEM_STATEMENT.md`; representative/date/exact wording/acknowledgement are missing. Baseline SDD feature text is not elicitation evidence.
- The supplied mission is referenced by older planning/draft, but no standalone original assignment file was inspected. Verify exact weights: the draft's quoted weights total 105, not an independently verified 100-point rubric. No normalization, predicted grade or validator-derived score is allowed.
- User reports Sprint 1 95/100, minus 2 for DOCX-only and minus 3 for context. Label this user-provided; no grading artifact has been independently verified. DOCX XML independently confirms broken TOC fields.
- Lecture physical p16 is system-only context. Mission human/labeled-edge needs are met by a **separate stakeholder companion**, not humans mislabeled as systems or internal modules as external peers.
- Requirement physical p66 includes Name/Rationale; p64 fixes use-case fields; pp67–68 leave formal Test cases TBD. Runtime validation is still necessary for implementation, recorded separately from formal next-sprint cases.
- Report numbering preserves original 1.0–9.0 hierarchy. Use `../sprint2/REPORT_OUTLINE.md` crosswalk instead of replacing the original headings with mission section numbers. This file's exact schedule extraction heading is `## Planning and scheduling`; filename is `SPRINT2_EXECUTION.md` (with the T in SPRINT).
- Current scaffold documents may have old authorization/coordinator/UI-vs-class assumptions. This addendum records current changes without modifying those historical originals; report claims must follow the newer user instructions and actual evidence.
- Core graph/ERD editable sources are reported built by the user. Their actual filenames/render/review evidence still must be mapped by the builder; source generation alone does not establish complete visual review. Critical admin/metadata validator drift is reported being fixed; no successful result is inferred.

## Recording actual outcomes

For each S2 task, record actor/date, actual hours, repository SHA if available, exact command/environment/result, evidence path and remaining scope. For visual work include editable source, rendered export and actual review state. For delivery include actual member submission/print acknowledgement. This is a record format, not a statement that any of those events has happened.
