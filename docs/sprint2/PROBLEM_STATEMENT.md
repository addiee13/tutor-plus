# Sprint 2 problem statement and user requirements

Prepared September 30, 2026. Report location: 1.4, with supporting system requirements in 1.5. This continues the actual Sprint 1 DOCX problem statement and SDD version 1.1; it is not a claim that the product is implemented. Bold text below marks **new Sprint 2 report refinements/operational commitments**, not features newly invented this sprint. Existing adults-only scope, assessments, assignments, plans, progress, matching, AI and managed-service stack are not mislabeled as new.

## Continued problem statement

Tutor Plus is a responsive tutoring marketplace and learning-support web application designed to connect adult students with tutors for virtual and in-person sessions. It supports a continuing learning process rather than only a tutor directory: students discover tutors, schedule and pay for sessions, prepare goals, complete assessments and practice work, receive feedback and follow progress toward academic goals. Tutors manage expertise, availability, bookings, assignments and student learning evidence; Administrators manage permitted users, reports, reviews, subjects, resources and platform policy. The shared identity system supports role-based Student, Tutor and Administrator experiences.

Students may otherwise coordinate tutor discovery, scheduling, payment, study material and progress in separate tools, making dated goals, completed work and feedback harder to relate. Tutor Plus's intended response is to connect session records with diagnostic checks, study plans, milestones, assignments, recaps and progress evidence. These learning capabilities were already described in Sprint 1 and are retained. **The Sprint 2 refinement is to make the links and authority explicit: assessment scores, assignment completion and Tutor mastery observations remain distinct dated evidence, rather than one invented measure of improvement.**

The prior report's alternative-service discussion establishes motivation, not a current competitive audit or proof of superior outcomes. The intended differentiation remains a connected learning workflow with human teaching and structured evidence. Personalized plans, progress tracking and explainable matching also already appear in Sprint 1. **The three Group 8 items below are candidates awaiting an actual client acknowledgement; neither their appearance in the SDD nor this report establishes new client approval.**

The AI Learning Assistant can support explanations, practice prompts, selected recap summaries and approved resources. Explainable matching considers subject, budget, availability, approximate location, learning preference and session mode, while explaining eligible recommendations and leaving choice with the user. Human responsibility for important learning and financial decisions was already part of Sprint 1. **Sprint 2 now expresses that boundary as acceptance obligations: an AI suggestion cannot directly establish grades, mastery, booking, payment or administrative decisions; authorized human confirmation is required before suggested work is persisted as a plan/task.**

The intended semester system remains a Next.js/React/TypeScript modular monolith using Supabase PostgreSQL/Auth and protected data access, approximate geospatial discovery, Stripe Connect Test Mode and server-only AI adapters. The first release serves adults 18+; sessions use an externally supplied meeting URL or an in-person venue. Version 1.1 replaces direct chat and peer swap with structured assessment/assignment coordination; native video and guardian workflows are outside the baseline. **The Sprint 2 implementation target is narrowed transparently: ten detailed UC/REQ pairs; database support for UC-01, UC-02, UC-04 and UC-06; real UC-01 user-management and identified UC-02 profile UI/logic flows. The mission also requires UC-04 class design; that design is not a claim of a booking/payment UI demonstration.**

Concurrency, scheduling/time zones, authorization, provider failure and learning-evidence provenance remain technical challenges identified in Sprint 1. **The report now requires end-state evidence: transactional booking integrity, private/public DTO separation, denied unauthorized operations, real identity/session behavior, persisted profile read-back and fresh non-IDE build/run. No mock login, SQL placeholder, screenshot-only form, browser return URL or queued email is equivalent to successful application behavior.** The SDD's ordinary authenticated-read p95 target is under 800 ms excluding external-provider latency; no universal two-second provider-flow guarantee or measured success is asserted.

## User requirements retained and clarified

| User | Required capability and boundary | Trace |
| --- | --- | --- |
| Adult Student | Register/verify/recover identity, sign in/out, maintain preferences, discover tutors and reserve under policy; complete owned assessments/work, inspect dated feedback/plans/progress and submit eligible reviews | UC-01–UC-10 plus backlog UC-13–UC-15; SDD §§6.1–6.11 |
| Tutor | Maintain publishable expertise/rate/modes and actual availability; use only authorized student relationships for agendas, assessment scoring, assignments and recaps; inspect actual earnings/payout state | UC-01/02/04/05/06/08/09; SDD corresponding FR groups |
| Administrator | Use a trusted provisioned role for permitted status/capability changes and later audited moderation/catalog/template/policy operations; ordinary registration cannot self-grant admin | UC-01 and UC-12 backlog; FR-A06, FR-AD01–FR-AD03 |
| Any account holder | Own-data privacy, current capability checks, honest provider/save failures, accessible desktop/mobile feedback and structured notices; one account may hold both Student and Tutor capabilities | REQ-01–REQ-10, SDD §20 |

Managed identity belongs in `auth.users`; profile data belongs in `profiles`; application capability grants belong in `user_roles`. Role selection is intent, not authorization authority. Public tutor data excludes private profiles/contact, exact meeting addresses and learning records. Tutor credential text is a self-description unless separately verified; the report does not assert verified qualifications/certification without evidence.

## Three Group 8 requirements — candidate/unconfirmed

These preserve CR-01–CR-03 from `../planning/CLIENT_REQUIREMENTS.md`. They are SDD-derived candidates, not three evidenced client approvals. They belong in Section 2's user-requirement discussion even though their detailed use cases/paired requirements are deferred.

| Candidate ID | Candidate wording for elicitation | Exact source and reserved pair | Needed approval evidence |
| --- | --- | --- | --- |
| CR-01 | A Student should maintain a goal-oriented personalized study plan with ordered milestones, target dates and linked learning work; authorized Tutor revisions retain author/time and missed dates require explicit replanning | SDD feature 13; §6.10 FR-SP01–FR-SP06; UC-13 / REQ-13 | Group 8 representative, actual date/channel, exact agreed wording, acceptance example and acknowledgement: pending |
| CR-02 | A Student should see longitudinal progress from dated sessions, assessment results, completed work and Tutor mastery observations, with source labels and relationship-scoped Tutor access | SDD feature 14; §6.11 FR-PR01–FR-PR06; UC-14 / REQ-14 | Same evidence: pending; do not equate a score with confirmed mastery |
| CR-03 | A Student should receive eligible Tutor recommendations with concrete subject/budget/time/mode reasons and retain manual choice; ranking follows hard constraints and excludes protected factors | SDD feature 15; §6.13 FR-MT01–FR-MT06; UC-15 / REQ-15 | Same evidence: pending; no objectively-best Tutor claim |

Do not change the label to "client-confirmed" until real evidence exists. If Group 8 revises the candidates, retain CR IDs and record the change and affected source/UC/REQ links rather than inventing a historical approval.

## Refinement provenance and feedback

| Report change | Why it is a genuine report refinement, not a new-feature claim |
| --- | --- |
| Evidence-type/authority distinctions | Adds operational acceptance boundaries to Sprint 1's already-present connected learning vision |
| Client evidence explicitly pending | Corrects draft implication that naming three SDD features equals confirmed elicitation |
| Limited demonstrated scope vs whole-semester baseline | Distinguishes specifications/database groups/UI flows and fifteen retained semester features |
| Observable success/denial and failure obligations | Turns prior challenges into evidence gates without declaring them passed |

Sprint 1 result **95/100**, with **2 points deducted for DOCX-only submission** and **3 for context modeling**, is **user-provided feedback**, not independently verified grading evidence. The broken TOC entries are separately observable in the actual DOCX XML. Sprint 2 therefore plans PDF-only export, renewed heading/TOC fields and a lecture-compliant system-only context plus a separate labeled stakeholder companion. No future grade, acceptance, completion percentage or implementation success follows from these refinements.
