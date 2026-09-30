# Tutor Plus agent guide

## Current phase

This workspace is a **documentation-only Sprint 2 scaffold**, prepared September 30, 2026. Application implementation requires a subsequent explicit request. In this phase, edit planning documents, report drafts, and directory placeholders only; do not install packages, generate application code, create SQL migrations, provision services, or claim a runnable application.

## Read before working

1. Read `README.md` for the entry points and current state.
2. For scope or conflicting specifications, read `docs/planning/SOURCE_REVIEW.md`. The supplied Sprint 2 assignment governs grading; `docs/TutorPlus_SDD_v1_1.pdf` governs the product baseline; lecture slides govern notation and templates. The existing Sprint 2 PDF is a draft, not implementation evidence.
3. For sprint work, read `docs/planning/SPRINT2_PLAN.md` and `docs/planning/TRACEABILITY.md`. Keep use-case, requirement, task, diagram, and test IDs stable.
4. For architecture, schema, or implementation requests, read `docs/architecture/ARCHITECTURE.md` and the relevant design document before changing a boundary.
5. For report work, read `docs/sprint2/REPORT_OUTLINE.md` and `docs/sprint2/REPORT_CHECKLIST.md`; check the cited lecture pages rather than inventing a format.

## Working rules

- Use standard shell commands and native Codex tools directly. Prefer `rg` for bounded searches.
- Preserve original files in `docs/` and `lec/`. Write refinements beside them; do not overwrite historical evidence.
- Inspect existing work before editing. This folder was not a Git repository at scaffold creation; do not assume a remote, branch, clean worktree, or GitHub project exists here. Never commit, push, or create branches without a request.
- Mark proposals, client confirmations, and implementation results distinctly. Never invent client approval, coordinator acceptance, grades, screenshots, URLs, credentials, test passes, or completion percentages.
- Use the version 1.1 scope: adults 18+, Student/Tutor/Administrator capabilities, structured learning coordination. Direct chat, peer skill swap, native video, and guardian workflows are outside the baseline.
- Maintain exactly ten detailed Sprint 2 use cases and ten paired requirements, including UC-01 User Management. Keep UC-11 through UC-15 in the next-sprint backlog rather than counting them as this sprint's detailed deliverables.
- Keep the instruction guide concise. Put task-specific detail in the linked source of truth, not duplicated in this file.

## Architecture guardrails for later implementation

- Use one Next.js/TypeScript modular monolith with Supabase PostgreSQL/Auth; application routes call domain services, which own authorization, validation, and persistence boundaries.
- Keep application roles in `user_roles`, identity in managed `auth.users`, and application profile data in `profiles`. One account may have Student and Tutor capabilities. User-editable metadata is never authorization authority.
- Authorize every server operation and protect exposed private tables with RLS and least-privilege grants. Public tutor DTOs exclude private profile, contact, meeting, and learning data.
- Use user-scoped database clients for normal work. Keep privileged provider keys server-only; isolate audited administrative operations.
- Use versioned migrations as the schema source of truth. Put transactional invariants in PostgreSQL, not just UI checks. Store UTC instants, IANA time zones, and integer monetary minor units.
- Provider failures must not fabricate booking, payment, progress, or email success. Payment state comes from verified provider events, not a browser redirect.
- Keep AI, Stripe, geocoding, and email adapters separate from domain logic. They are not prerequisites for the two proposed Sprint 2 UI flows except the real authentication/verification flow.

## Completion gates

For a documentation task, check every required field, numbering, cross-reference, and source assumption. For a diagram task, match lecture notation, preserve editable source, render and inspect the complete figure, and record its review state.

For a later implementation task, run the narrowest relevant validation, then the agreed quality suite; record actual commands and results. Require working frontend-to-database persistence, denied unauthorized access, refresh/logout behavior, and rendered desktop/mobile evidence before claiming a feature is complete. A placeholder or a written test plan is not a passing test.

For Sprint 2 submission, require a new confirmed coordinator, three evidenced Group 8 client requirements, all report sections, four implemented use-case table groups, two demonstrated UI/logic flows, GitHub board/page screenshots, a fresh non-IDE build/run check, and a visually inspected PDF. Every member submits their own correctly named PDF; the coordinator prints a copy before class on October 5, 2026.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
