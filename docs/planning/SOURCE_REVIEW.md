# Source review and interpretation

Reviewed September 30, 2026. This is a source audit, not proof of implementation or client acceptance.

## Authority and inventory

| Source | Use in this plan |
| --- | --- |
| Sprint 2 assignment supplied in this conversation | Graded sections, minimum counts, implementation obligations, deadline, PDF/print rules |
| `docs/TutorPlus_SDD_v1_1.pdf` | Product baseline, Group 11/Group 8, fifteen features, role model, modular-monolith stack, schema/security/acceptance principles |
| `docs/Dalwai_Group11_Sprint1.docx` | Actual previous cover, roster, scheduling columns, heading/TOC hierarchy, problem statement and embedded diagrams |
| `docs/Sprint2_UseCases_Requirements_DB.pdf` | Existing draft IDs and feature order; useful draft material, not an implemented application |
| `lec/4_Requirement_ENgineering_SWE-5.pdf`, PDF pages 64–68 | Use-case fields and requirement fields, including Inputs/Outputs, Rationale, and Test Cases |
| Same requirements lecture, PDF page 60 | Explicit `include` and `extend` relationship exercise |
| `lec/5_System_Modeling_SWE.pdf`, PDF pages 15–17, 23, 38 onward | Context boundary vs. internal architecture, actors/ovals/system boundary, class relationships |
| `lec/ContextDiagram.pdf`, PDF pages 2–3 | Rectangular system/module notation and plain connecting lines; discuss system boundary |
| `lec/ActivityDiagram.pdf`, PDF pages 3–6 | Initial/final states, guarded decisions, fork/join and swimlane examples |
| `lec/DatabaseFundamentals.pdf`, PDF pages 20–23 and 36 | Keys, foreign keys, normalization, whole-scenario design |
| `lec/2_Processes_SWE .pdf` | Incremental process, activities, roles, dependencies, verification/validation |
| `lec/1_Intro_SWE.pdf` | Software-engineering scope and quality framing |

Page references are physical PDF page numbers. Image-based notation slides and both diagrams embedded in Sprint 1 were visually inspected. The Sprint 1 TOC was extracted from the actual DOCX; several entries literally contain `Error! Bookmark not defined.`

When sources conflict: the current assignment controls what is submitted this sprint; the SDD controls intended product behavior; the lectures control notation/template detail. Record an explicit scope refinement rather than silently copying the Sprint 2 draft.

## Findings to resolve

| Finding | Evidence | Treatment |
| --- | --- | --- |
| Implementation presented as complete without a codebase | Existing Sprint 2 PDF says user management and Playwright verification are complete; this workspace initially contained only `docs/` and `lec/` | Rewrite as planned until real code, database rows, test output, and rendered screenshots exist |
| Three client requirements lack independent approval evidence here | SDD and draft identify plans, progress, and explainable matching; no client message/interview record was supplied | Preserve candidates; require actual Group 8 confirmation and date |
| Coordinator must rotate | Sprint 1 names Shadmaan Akhand | Propose Edu M. Okpok, subject to team confirmation; do not claim acceptance |
| Role/schema drift | Draft uses `users.role` and `student_profiles`; SDD uses `profiles` + `user_roles` and permits both Student/Tutor capabilities | Keep provider `auth.users`, application `profiles`, and many-to-many capabilities in `user_roles`; profile preferences stay in `profiles` |
| Source-derived improvements are not all new to Sprint 2 | Sprint 1 already discusses assessments, assignments, plans, progress, and matching | Highlight only the actual new operational clarification, boundaries, and demonstrable scope |
| Context mixes internal modules with external systems | Sprint 1 surrounding nodes are largely internal Tutor Plus services; Sprint 2 draft places internal nodes inside a context figure | Use external dependencies around one Tutor Plus node; show internal modules separately in architecture, not as external peers |
| Human actor stereotypes are wrong in draft context | Student/Tutor/Admin represented as `<<system>>` | Keep system-only context in lecture style; put people in separate stakeholder/use-case views |
| Activity claims one ending but its source has multiple stop paths | Existing Sprint 2 PlantUML text stops on conflict, declined payment, and success | Specify guarded retries/abandonment and an explicit final-state structure; do not assert a rendered figure exists |
| Assignment says "includes/excludes"; lecture says include/extend | Requirements lecture PDF page 60 explicitly requires one include and one extend | Use standard `<<include>>`/`<<extend>>`, document the discrepancy, confirm with instructor rather than invent `<<exclude>>` |
| Unsourced alternates broaden scope | Draft adds Google OAuth, recurring booking series, tutor-to-student ratings, 7-day drafts, 5-attempt lockout | Remove them from required sprint behavior unless separately approved; advanced recurring series is post-MVP in the SDD |
| Unsupported numerical guarantees | Draft claims every payment flow finishes in 2 seconds and sessions expire after 24 hours idle | Keep SDD p95 ordinary-server-read target under 800 ms excluding providers; record provider session configuration rather than invent it |
| Atomic signup and immediate JWT revocation oversimplified | Draft combines Auth API + public insert and claims immediate server invalidation | Plan reviewed signup provisioning/recovery; distinguish refresh-token revocation from unexpired access JWT validity |
| Claimed Sprint 1 score/penalty has no grading artifact | Draft states 95/100 and -2/-3 deductions | Label unverified draft assertions; use only observed defects and actual feedback when supplied |
| Build instructions refer to absent files | Draft lists scripts/code not present here | Specify future build contract; mark all execution steps unverified until implemented |
| Assignment's free-hosting examples may be outdated | Assignment lists historic free-tier offers | Do not repeat pricing/free-tier guarantees; verify provider terms when choosing accounts |

## Current official technical references

Consulted September 30, 2026; versions and account features must be rechecked at implementation time. These support technical design, not the course rubric.

- Next.js documentation: Authentication, Data Access Layer, Server Actions, and Route Handlers. Authorization belongs at the operation/data boundary, not only navigation/layout guards.
- Supabase documentation: Creating a client for SSR, Users, User Management, Row Level Security, Signing out, and User sessions. Cookie-based SSR requires verified identity; user metadata is editable; exposed tables require RLS/grants; unexpired JWTs are not instantly invalidated by signout. Provider lifetime/inactivity controls are plan-dependent.
- PostgreSQL documentation: Range Types, section 8.17.10. Exclusion constraints can enforce non-overlapping time ranges; verify database version and extension availability.
- Stripe documentation: Webhooks and Idempotent requests. Verify provider signatures, deduplicate events, and handle retries/out-of-order delivery.
- OpenAI documentation: Text generation/Responses and data controls. Keep integration behind a server adapter and minimize selected learning context; choose model/retention/cost settings later.

No package versions, hosting prices, credentials, or deployment URLs have been selected or provisioned.
