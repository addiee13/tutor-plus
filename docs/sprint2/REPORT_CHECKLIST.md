# Sprint 2 report and evidence checklist

Prepared September 30, 2026. Group 11 / Group 8; coordinator Adam Dalwai (user-designated September 30); due October 5 before class; exact class time pending. **Unchecked gates mean not verified by this reader, not that another role cannot have made progress.** A completed Markdown field set is not an implemented feature, passing test, client approval, submitted PDF or grade. Check a gate only after inspecting its referenced real evidence.

## Authority, continuation and planning

- [ ] Original mission/assignment wording and rubric weights checked directly; draft's quoted total of 105 flagged rather than normalized into an invented score.
- [ ] Current user-authorized implementation and Adam coordinator recorded in `../planning/SPRINT2_EXECUTION.md`; historical sources/older plan left unchanged. User designation is distinguished from any unrecorded team acknowledgement.
- [ ] All five Sprint 1 biographies preserved verbatim from DOCX XML; cover includes names, Group 11, Fall 2026, guide, actual report date and Adam as coordinator.
- [ ] Schedule is Sprint 2 only; exact seven columns preserved: Assignee Name, Email address, Task, Duration (hours), Dependency, Due Date, Evaluation.
- [ ] All five emails follow current explicit mission spelling: `sakhand2@student.gsu.edu`, `adalwai1@student.gsu.edu`, `eokpok1@student.gsu.edu`, `kduong10@student.gsu.edu`, `nrodrigo2@student.gsu.edu`; combined rows contain actual addresses, not "emails above". Historical DOCX capitalization is preserved only in the original evidence.
- [ ] S2-01–S2-11 dependencies are feasible; 46 estimated person-hours are labeled estimates; future actual effort/evaluation is TBD until recorded, not copied 100% grades or completion percentages.
- [ ] Problem statement genuinely continues Sprint 1; **only actual report refinements are bold**. Assessments, assignments, study plans, progress, matching, adults-only scope and stack already existed and are not mislabeled new features.
- [ ] Exactly three CR-01–CR-03 Group 8 candidates are explicitly unconfirmed unless each has a real representative/date/channel/exact wording/acceptance example/acknowledgement. SDD text alone does not satisfy elicitation.
- [ ] Sprint 1 95/100, minus 2 for DOCX-only and minus 3 for context, labeled **user-provided**; no invented grading artifact. Broken TOC error text is separately attributed to actual DOCX XML.

## Ten use-case records — physical lecture p64

- [ ] Exactly ten detailed UC-01–UC-10, including User Management, retain the draft order and each has one corresponding REQ; no UC-11–UC-15 detail counted as a Sprint 2 record.
- [ ] Every record contains Use Case #, Name of the Use Case, Actors (entity plus role), Inputs (origin and purpose), Use Case Description (numbered validations/decisions/responses), Exception Path, Alternate Path, Pre-condition (including reason), Post-condition and Outputs (data/UI/notices).
- [ ] Each described interaction is explicitly tagged **Actor-System**, **System-System** or **Actor-Actor** appropriately; tags are not vague mixed labels or undocumented system-to-actor variants.
- [ ] Actor-Actor means a real coordinated human interaction (UC-09 external/in-person teaching), not merely reading persisted goals or feedback; no direct chat, peer skill swap or native video is introduced.
- [ ] Alternate paths are permitted valid choices/entry points, not errors. Exceptions explain invalid input, authorization, provider/persistence failure and recovery without claiming successful writes.
- [ ] Inputs/preconditions/postconditions distinguish identity, capabilities, participant relationships and provider configuration; no compulsory existing tutor/no-match prerequisite incorrectly blocks a legitimate empty discovery result.
- [ ] No draft-only Google OAuth, five-attempt lockout, universal 24-hour idle expiration, advanced booking series, reciprocal Tutor-to-Student rating, seven-day assessment draft, fixed ten-minute hold or 48-hour recap rule is added without authority.
- [ ] UC-11–UC-15 backlog matches exact SDD feature/FR IDs: AI 8/FR-AI; admin 10/FR-AD; plans 13/FR-SP; progress 14/FR-PR; matching 15/FR-MT. UC-05 maps SDD feature 11, UC-08 feature 12; catalogs must not be conflated.

## Ten requirements — physical lecture pp65–68

- [ ] Exactly ten REQ-01–REQ-10; each contains Requirement number, Use Case number, **Name**, Introduction, Inputs, **Rationale**, functional/nonfunctional Requirements Description, Outputs, **Test cases: TBD**. Name/Rationale are present in physical p66 even if mission field shorthand omits them.
- [ ] Rationale includes prerequisite/precheck reasons as explained in pp67–68, not a generic slogan. Functional behavior and nonfunctional privacy/accessibility/reliability constraints are separately identifiable and actionable.
- [ ] Formal Test cases remain TBD for next sprint; actual implementation checks, if run, are separately reported in 7.2 with exact commands/results, not invented formal test passes.
- [ ] Ordinary authenticated-read p95 under 800 ms is stated only as SDD target excluding provider latency; no measured pass or two-second auth/payment guarantee without measurements.
- [ ] Adult attestation is not overstated as proven identity/age verification; Tutor credential text is not claimed verified certification. One account may have Student and Tutor capabilities.
- [ ] Payment/refund/payout state, assessment score/mastery evidence, draft/published profile and queued/delivered email remain distinct. Human confirmation and authorized evidence govern AI suggestions/mastery.

## Diagram and class gates

- [ ] CTX-01 main system-only external context matches modeling lecture physical pp15–17, especially p16, and ContextDiagram pp2–3: rectangular systems and connecting lines; no humans stereotyped as systems or internal modules among external peers.
- [ ] CTX-02 separate mission stakeholder companion has actual Student/Tutor/Administrator roles with labeled edges; it is clearly labeled a companion, not the lecture's system-only view.
- [ ] ACT-01 matches ActivityDiagram physical pp3–6: initial/final state, guards, swimlane ownership, valid retry/abandonment and synchronization. Draft's multiple stops are not falsely described as one final. Distinguish semester/planned branches from actually demonstrated flows.
- [ ] Four reviewed use-case diagrams include UCD-01 UC-01, UCD-02 UC-03, UCD-03 UC-04, UCD-04 UC-06; human stick actors, system boundary and use-case ovals follow modeling p23.
- [ ] Valid `<<include>>` points from including/base use case toward required included behavior; valid `<<extend>>` points from conditional extension to base behavior with its condition. No invented `<<exclude>>` stereotype.
- [ ] The include/extend instruction at requirements p60 is correctly identified as an in-class exercise excluding login/logout/registration; mission still requires a User Management diagram. Clarify whether both relationships are expected per figure or across the set rather than drawing invalid relationships to meet an inferred count.
- [ ] ERD-01 attributes/types/PK/FK/cardinality and constraints agree with actual four-group SQL; role capabilities are associations, not one editable user role/password store.
- [ ] CLASS-01 covers UC-01 and UC-02 implemented responsibilities with named compartments/attributes/types/operations/associations/multiplicities and service dependencies; role composition supports dual capabilities.
- [ ] Report 4.2 contains mission-required CLASS-02 UC-04 design, including availability rule/exception, booking/participants/state and booking/payment dependency. UC-02 implementation responsibilities stay in CLASS-01/4.3. Class design is not booking UI completion.
- [ ] Every figure has preserved editable source, readable complete rendered export, source/page caption and recorded actual visual review at final print scale; syntax/text extraction alone is insufficient.

## Database and real two-flow implementation

- [ ] DBMS explicitly PostgreSQL via Supabase; actual version/configuration recorded, not assumed from design.
- [ ] Actual migrations implement all UC-01/02/04/06 groups/dependencies, types/PK/FK/uniqueness/check/exclusion/transaction invariants; clean replay/seed logs exist. Four groups are not four isolated tables.
- [ ] Identity is managed `auth.users`, profile is `profiles`, capabilities are `user_roles`; passwords/privileged keys are not in application/client data. Initial role intent is validated by trusted provisioning/recovery.
- [ ] Source/implementation role/status vocabulary differences are explicitly mapped: SDD `admin` / `deactivated,suspended` versus earlier design `administrator` / `inactive`; equivalent denial semantics retained, not silently dropped.
- [ ] User-scoped server operations and least-privilege RLS/grants protect exposed private tables; actual allowed and denied operations tested under distinct real identities, not only UI routes or service-role bypass.
- [ ] UC-04 interval/time-zone/concurrent conflict and UC-06 integer-money/uniqueness/event/refund-bound/state invariants have actual positive/negative evidence. Financial database records alone are not a real charge/refund/payout.
- [ ] UC-01 real registration/verification/recovery/login/logout/refresh/current capabilities work against actual identity/database state; fixture-preverified accounts do not substitute for registration/verification demonstration.
- [ ] Verification uses an actual configured local mail viewer or permitted real inbox, clearly named; provider acknowledgement and observed receipt distinguish delivery. Local capture is not public email delivery.
- [ ] Logout scope/cookies/refresh behavior documented and observed; do not claim universal instantaneous revocation of unexpired JWTs. Current status/removed-role checks deny privileged replay where required.
- [ ] UC-02 specified subflows save and reload actual owned profile data, deny other-user writes, handle invalid/stale input, and demonstrate public/private readiness boundary where claimed; omitted avatar/upload/publication/availability subflows explicitly listed.
- [ ] Supplementary UC-04 reservation UI, if supplied, has actual SQL-persistence/denial evidence and is labeled only the demonstrated reservation subset. No Stripe/provider confirmation or completed full booking/payment flow is claimed from a payment-pending reservation. User-reported admin/metadata fixes need actual rerun results.
- [ ] No provider/network/persistence failure fabricates booking/payment/progress/email success; mocks/design/table placeholders cannot satisfy these gates.

## Build, GitHub and screenshot evidence

- [ ] Actual fresh non-IDE dependency/configuration/database setup and build/start executed, with exact commands, exit status, date/environment and result; no secret values in report/logs.
- [ ] Build/run covers frontend-to-database read/write and denied access plus refresh/logout, not just a running server/container, health endpoint or compilation.
- [ ] All implemented routes/pages inventoried with navigation; complete desktop/mobile screenshots include required pending/error/validation/authenticated states and genuinely persisted results.
- [ ] Screenshots have source route/state/date and readable captions; no generated mockups called real UI evidence and no exposed tokens/passwords/private student data.
- [ ] Real repository/project URLs verified; full readable To Do/In Progress/Done board captured, with detailed cards if necessary. Auth access/repo-creation underway does not establish these links/screenshots.
- [ ] Cards move Done only with their own actual evidence. Reuse/approved replacement of Sprint 1 board documented; no manufactured GitHub success or future commit SHA.
- [ ] Any internal validator's structural estimate is labeled a local check, **not instructor acceptance or a grade**.

## Report formatting and submission

- [ ] Original hierarchy preserved: 1.0 INTRODUCTION (1.1 info, 1.2 schedule, 1.3 teamwork, 1.4 problem, 1.5 system requirements with context/activity), 2.0 REQUIREMENTS (2.1/2.2/2.3), 3.0 DATABASE TABLES, 4.0 CLASS DIAGRAM (4.1/4.2/4.3), then original 5.0–9.0 and REFERENCES.
- [ ] Seven mission sections crosswalk to those headings; 4.3 contains frontend/logic evidence, 6.0 fresh build/run, 7.2 actual checks, 9.0 GitHub/pages. No duplicate inconsistent implementation claims.
- [ ] Body paragraphs justified; tables and diagrams centered; all pages numbered; heading styles/TOC refreshed after final pagination; no broken bookmarks/placeholders disguised as done results.
- [ ] PDF visually inspected in full at readable/print scale: no clipped rows, illegible figures, missing Greek/UML symbols, blank pages, overflow or invalid field text; actual review state recorded.
- [ ] Sources/captions use verified physical lecture pages and actual SDD FR IDs; reported source versus user feedback versus proposed scope versus executed evidence remains explicit.
- [ ] Every member exports/submits their own `YourName_Group11_Sprint2.pdf` (Adam: `Dalwai_Group11_Sprint2.pdf`); real submission receipts recorded, not inferred from a generated PDF.
- [ ] Adam prints the inspected coordinator copy before class October 5, 2026; actual print acknowledgement and class time recorded. Future delivery/printing is not marked complete in advance.

## Reader handoff

This role verifies content/field/ID/source consistency in its seven Markdown files only. The builder must populate implementation/render/build/GitHub/PDF evidence from actual results and leave unresolved gates explicit. Candidate client requirements, unverified original rubric, unknown class time and missing submission receipts cannot be cured by a local structural validator. Keep source PDFs/DOCX/lectures unchanged.
