# Sprint 2 paired requirements

Prepared September 30, 2026. Exactly ten detailed requirements, REQ-01–REQ-10, paired with UC-01–UC-10. These specify expected behavior; **none is marked implemented, tested or client-approved by this document**. Reserved REQ-11–REQ-15 appear only in the backlog of `USE_CASES.md` and traceability.

Template authority: `lec/4_Requirement_ENgineering_SWE-5.pdf`, physical pp65–68. Physical p66 explicitly includes **Name** and **Rationale**, alongside Requirement #, Use Case #, Introduction, Input, Requirement Description, Output and Test Cases TBD. Physical pp67–68 explain inputs, prerequisite checks/rationale, functional/nonfunctional description and outputs. All records include the union of these fields. Keep formal **Test cases: TBD** as instructed for the next sprint; independently executed implementation checks belong in report 7.2 with actual logs, not in invented formal cases.

Shared quality baseline: SDD §20 requires authorization/RLS, minimized private DTOs, accessible labeled keyboard/touch flows with non-color state cues and honest failure handling. Its p95 target is under 800 ms for ordinary authenticated server reads **excluding external-provider latency**; it is a target to measure, not a passed benchmark or a universal two-second payment/auth promise. Each record identifies its relevant constraints. Numeric policy not specified in authoritative sources must be selected/documented before implementation, not invented here.

## REQ-01 — User Account and Role Management

**Requirement number:** REQ-01.

**Use Case number:** UC-01.

**Name:** User Account and Role Management.

**Introduction:** Adults must establish and recover a managed identity and use only authorized Student, Tutor or provisioned Administrator capabilities. User management is the required fully functional Sprint 2 UI/logic flow; full demonstration still requires evidence.

**Inputs:** User-entered name/email/password, 18+ attestation and permitted role intent; provider verification/recovery token, login/session/refresh data; server-owned identity/status/roles; administrator-selected target/change/reason. Secrets stay in the managed-provider/server boundary.

**Rationale:** Registration needs configured Auth plus a reviewed profile/role provisioning/recovery path. Login needs an existing identity; protected work needs active status and relevant verified capability. Admin grants need trusted authority. These checks prevent a partially provisioned user, editable metadata or dashboard-only gating from becoming authorization.

**Requirements Description — Functional:**

1. Collect email/password, adult confirmation and Student/Tutor intent; validate input and reject self-assigned Administrator authority. Store managed identity in `auth.users`, application data in `profiles`, capability grants in `user_roles`; support one account with both Student and Tutor capabilities.
2. Support verification/resend, login, logout, password reset and session refresh using actual configured provider behavior. Deny booking/payment/publication/assessment or assignment submission until verified. Pending verification must be visible; provider/account errors must not fabricate completion.
3. Resolve current roles/status on server operations and use protected user-scoped persistence. Tutor actions require the relevant complete profile/readiness; inactive/removed-role actions are denied even with stale UI/session claims.
4. Logout clears application session cookies and revokes refresh capability at the documented scope. Disclose/test access-token expiry behavior; do not promise every issued JWT is instantly invalidated. Refresh failure sends the user to truthful recovery/sign-in state.
5. Permit only audited administrator account/status/capability changes; deactivation hides public content while retaining financial/audit records. The full moderation/catalog console remains UC-12 backlog.

**Requirements Description — Nonfunctional:** Protect credentials/keys, minimize logs/errors and prevent public private-profile access through grants/RLS; use accessible form labels/errors/focus and responsive navigation. Production admin MFA follows SDD's SHOULD rather than a fabricated completed local MFA claim. Recovery/provisioning failures must be diagnosable without credential leakage; do not invent fixed lockout/lifetime policies.

**Outputs:** Actual registration/pending-verification/recovery result, verified permitted dashboard/session state, logout result and authorized audited account changes; safe profile/role view with no passwords or privileged keys.

**Source:** SDD §6.1 FR-A01–FR-A06, security/authorization §§12 and 20.1; architecture identity/session decisions.

**Test cases:** TBD (to be discussed in the next sprint).

## REQ-02 — Student and Tutor Profile Management

**Requirement number:** REQ-02.

**Use Case number:** UC-02.

**Name:** Student and Tutor Profile Management.

**Introduction:** Users need persistent private preferences and tutors need an accurate readiness-controlled public profile. The selected second Sprint 2 UI/logic flow must identify its demonstrated subflows rather than claim the entire product feature from one form.

**Inputs:** Owner-entered display name/avatar/bio/interests/time zone/approximate area/mode/preferences; tutor headline, subjects, expertise, credential text, experience, integer rate/currency, modes/service area/languages/photo; save/publication intent, version and authoritative availability facts.

**Rationale:** An active authenticated owner and appropriate Tutor capability must be resolved before access. Publishing additionally needs verified email and valid profile/subject/rate/availability/mode data. Separating owned application records from a public projection prevents sensitive data from leaking through discovery.

**Requirements Description — Functional:**

1. Create/load/edit Student preference data in `profiles` and Tutor-specific data in `tutor_profiles`/subject associations; retain values after refresh and distinguish saved data from unsaved form input.
2. Revalidate allowed fields, ranges, IANA time zone, ownership/capability and record version server-side. Reject other-user changes and mass-assigned role/status/public-authority fields; preserve canonical values on failure.
3. Allow incomplete unpublished Tutor drafts and intentional unpublishing. Publication must validate all required readiness facts, including authoritative UC-04 availability; a saved draft is not a published tutor.
4. Public tutor DTOs expose only approved display/teaching/rate/mode/approximate-area and reputation/availability fields. Credential text is not proof of certification/background verification. Exact addresses, contact, meeting and student-learning data remain private.

**Requirements Description — Nonfunctional:** Ownership restrictions apply through services and RLS/least-privilege grants, not merely hidden controls. Editor, readiness feedback and public preview are accessible/responsive; failed writes show no false success. Availability is read through its domain boundary, not duplicated into profile business logic.

**Outputs:** Persisted owner profile/draft/version, validation/readiness result and permitted public preview/publication state, verifiable through reload and safe read-back.

**Source:** SDD §6.2 FR-P01–FR-P05, §6.1 FR-A04, architecture/class/database design.

**Test cases:** TBD (to be discussed in the next sprint).

## REQ-03 — Tutor Discovery and Search

**Requirement number:** REQ-03.

**Use Case number:** UC-03.

**Name:** Tutor Discovery and Search.

**Introduction:** Students need manual discovery of eligible published tutors using educational, scheduling, budget and mode/location filters; explainable smart matching is separate UC-15 backlog.

**Inputs:** Subject/topic, mode, time window, price/rating bounds, optional in-person radius; manual city/state/ZIP or consented browser location; bounded page/cursor; public tutor readiness and authoritative availability data.

**Rationale:** Only public eligible tutor data should enter discovery. Manual location avoids compulsory browser tracking; query bounds and correct time interpretation prevent unbounded/private/stale results from being represented as bookable guarantees.

**Requirements Description — Functional:**

1. Support initial Math, Science and Reading/Writing taxonomy with extensible topics and filters for subject, mode, date/time, price, rating and approximate in-person distance.
2. Permit manual city/state/ZIP without geolocation; request consent before browser location. Denial returns to manual entry. Virtual search can omit geography.
3. Query only published approved public tutor data; show relevant subject, rate, mode, area, rating and next-availability facts, with bounded pagination and honest empty results.
4. Validate filter ranges and retain the user's selected constraints. Geocoding failure may offer an explicit non-geographic retry, never silently relax a hard distance limit. Booking performs its own current eligibility/availability checks.
5. Link to an explicitly separate later UC-15 matching entry if implemented; do not require fixed top-five results or equate manual sorting with matching completion.

**Requirements Description — Nonfunctional:** Indexed/bounded search must protect exact private locations and exclude private contact/learning data. Accessible filter labels and empty-state recovery must work on desktop/mobile. SDD's ordinary-read performance target excludes provider latency; no measured achievement is asserted.

**Outputs:** Bounded safe tutor results or accurate empty/unavailable state, applied-filter summary, public tutor details and pagination; no booking/payment mutation.

**Source:** SDD §6.3 FR-S01–FR-S06, §13.3; §20.3 quality target.

**Test cases:** TBD (to be discussed in the next sprint).

## REQ-04 — Availability and Booking Integrity

**Requirement number:** REQ-04.

**Use Case number:** UC-04.

**Name:** Availability and Booking Integrity.

**Introduction:** Tutors need predictable scheduling and students need reservations that cannot double-book or claim unverified financial confirmation. Sprint 2 requires real database support for this group; that is distinct from a complete booking/payment UI.

**Inputs:** Tutor-owned weekly rules/exceptions, IANA zone, durations and lead/buffer windows; Student booking intent/structured goals; participants/subject/UTC interval/mode; server integer price/currency snapshot; participant-private meeting details; policy/state/version and cancellation/reschedule intent; verified UC-06 financial outcome.

**Rationale:** Current tutor readiness, verified active student eligibility, authoritative availability and displayed policy are prerequisites for a valid reservation. Overlap checking must happen transactionally at persistence, because a displayed slot can become stale between selection and checkout.

**Requirements Description — Functional:**

1. Store authorized weekly availability and date exceptions; calculate candidate slots using current bookings, durations, IANA zones, lead time and buffers; store UTC instants and display viewer-local time.
2. Persist participants, subject, UTC start/end, mode, price snapshot, state and structured notes. Enforce valid intervals, foreign keys and transactional overlap/uniqueness rules so concurrent claims cannot both reserve the same tutor interval.
3. Paid checkout creates/reuses payment-pending state; confirmation requires authoritative server/provider evidence from UC-06, not a browser return/notification. Any reservation expiry/release policy must be documented before use; no source supports imposing the draft's ten-minute guarantee here.
4. Apply displayed cancellation/rescheduling policy and valid booking state transitions; reschedule atomically with event/version history. Booking, payment, refund and payout states remain distinct.
5. Require participant-only meeting-place data for in-person delivery and a virtual meeting URL before start. Generate deduplicated UC-10 events and feasible 24-hour/1-hour reminders from confirmed state.

**Requirements Description — Nonfunctional:** Database invariants and authorization/RLS must withstand direct unauthorized operations and concurrency, not just UI checks. Time-zone presentation is explicit and accessible; provider/DB failure cannot produce a false confirmation. Advanced recurring-session series remain post-MVP; recurring availability is in scope.

**Outputs:** Stored availability, eligible slots, canonical booking state/history/price/policy summary, private meeting readiness and notice events; permitted cancellation/reschedule with separately truthful financial state.

**Source:** SDD §6.4 FR-B01–FR-B07, §§13.1–13.3, §6.5 FR-PAY04–FR-PAY06.

**Test cases:** TBD (to be discussed in the next sprint).

## REQ-05 — Diagnostic Assessment and Mastery Evidence

**Requirement number:** REQ-05.

**Use Case number:** UC-05.

**Name:** Diagnostic Assessment and Mastery Evidence.

**Introduction:** Pre/post-session and diagnostic checks need traceable topic-level evidence without conflating an assessment score with human-confirmed mastery.

**Inputs:** Authorized tutor/student/booking/plan links; versioned assessment/purpose/topic, item type, points and private scoring key; student answers/timestamps; bounded tutor score/feedback; configured evidence/confirmation rules.

**Rationale:** Authorized assignment and pinned definition/scoring rules are prerequisites for meaningful results. Student answer submission needs verified identity; subjective work requires an authorized human scorer, and other tutors must not gain access merely from a Tutor role.

**Requirements Description — Functional:**

1. Allow authorized Tutor creation/reuse/assignment of diagnostic, pre-session, post-session and milestone checks; support multiple choice, short answer and tutor-scored items with points/topic tags.
2. Save attempt answers, timestamps and completion/scoring state; permit drafts and authorized further attempts while retaining history, without imposing an unsupported seven-day draft limit.
3. Finalize idempotently; auto-score supported objective items and explicitly retain awaiting-tutor state for subjective items. Bound points and clearly label automated versus Tutor scores.
4. Show the Student's own topic evidence and only relationship-linked attempts to assigned Tutors. Never return private scoring keys in student/public payloads.
5. Create a dated linked mastery observation only according to Tutor confirmation or configured evidence rules; a single scored attempt must not automatically imply Confident mastery.

**Requirements Description — Nonfunctional:** Private keys/attempts are protected through service/RLS/private-schema boundaries and minimized DTOs. Submission failure and duplicate retry do not create fabricated results/evidence. Prompts, scoring labels and results are accessible, and history retains source attribution.

**Outputs:** Owned draft/submitted/awaiting-tutor/scored attempt, topic evidence and score-source labels, with justified provenance-linked observation where applicable.

**Source:** SDD feature 11, §6.8 FR-DA01–FR-DA07, §14.1.

**Test cases:** TBD (to be discussed in the next sprint).

## REQ-06 — Payment, Refund and Payout State

**Requirement number:** REQ-06.

**Use Case number:** UC-06.

**Name:** Payment, Refund and Payout State.

**Introduction:** Paid sessions need provider-confirmed financial records, eligible refunds and truthful Tutor payout state. A Sprint 2 financial schema/migration demonstrates storage support, not a successful provider charge.

**Inputs:** Verified actor and server-owned eligible booking/amount/currency/fee/tutor account; provider-only payment credentials; signature/event identity/idempotency key; policy-approved refund reason/amount and actual transfer/payout events.

**Rationale:** Configured Stripe Connect Test Mode, an eligible payment-pending booking and trusted event verification are needed for runtime payment. Refund requires captured funds and an authorized policy decision; no browser redirect or client-supplied amount can establish success.

**Requirements Description — Functional:**

1. Create/reuse one server-owned payment record per paid session with integer monetary minor units/currency and consistent booking/participant references. Prefer SDD's Test Mode destination-charge demonstration with one Tutor per booking when provider runtime is undertaken.
2. Use Stripe-provided credentials UI; never store raw card data. Verify event signatures and identifiers, deduplicate retries, and reconcile stale/out-of-order events without regressing financial state.
3. Confirm booking only from authoritative captured/server financial state; preserve independent payment, refund and transfer/payout records with constrained transitions and audit provenance.
4. Request only policy-authorized refunds idempotently, retain requested/pending/failed/completed outcome from actual provider evidence, and track actual Tutor payout state separately from charge capture.
5. Decline/additional-action/outage paths offer safe recovery with no duplicate charges or fabricated settled funds. Refund fee treatment and reservation holds follow documented approved policy, not draft assumptions.

**Requirements Description — Nonfunctional:** Provider keys/signing secrets remain server-only, exposed private financial tables have RLS/least-privilege grants, and public/private DTOs minimize payment identifiers. Logs/errors are safe; transactional/idempotent persistence and reconciliation protect integrity across provider failure. Stripe UI does not justify claiming that all compliance responsibility disappears.

**Outputs:** Actual payment/refund/payout states and permitted receipts/earnings views, deduplication/audit records, authoritative booking transition and notice events; no raw credentials.

**Source:** SDD §6.5 FR-PAY01–FR-PAY06 and financial/security design.

**Test cases:** TBD (to be discussed in the next sprint).

## REQ-07 — Verified Reviews and Reputation

**Requirement number:** REQ-07.

**Use Case number:** UC-07.

**Name:** Verified Reviews and Reputation.

**Introduction:** Tutor reputation must come from eligible completed-session Student reviews and explainable rules, not arbitrary aggregate edits or unsupported reciprocal ratings.

**Inputs:** Owned completed booking, Student rating/optional text/recommendation; moderation action/reason and current admin grant; approved reviews/completion facts and badge rules.

**Rationale:** Booking ownership/completion and uniqueness are prerequisites for a verified review. Approved visibility determines aggregate input; administrator authority plus an audit reason is needed to alter moderation state while preserving provenance.

**Requirements Description — Functional:**

1. Permit only the Student from a completed valid booking to submit one review for it, validated through ownership, state, rating bounds and a database uniqueness rule.
2. Persist rating, optional text, recommendation flag and moderation state. Compute public aggregates only from approved reviews; deny direct user writes to aggregate reputation.
3. Allow audited authorized hiding/moderation of reported reviews while retaining the original record. Recompute affected aggregates from eligible approved records.
4. Produce rule-based explainable badges from real source facts. Support rating-only reviews; do not add Tutor-to-Student ratings.

**Requirements Description — Nonfunctional:** Enforce eligibility and admin authority through server/persistence policies; exclude private booking/learning details from public review DTOs. Duplicate retries and failed writes cannot inflate counts; accessible rating controls/labels and honest moderation state are required.

**Outputs:** Stored review receipt/state, approved public review list, derived rating/count/badge explanation and retained moderation audit.

**Source:** SDD §6.6 FR-R01–FR-R05.

**Test cases:** TBD (to be discussed in the next sprint).

## REQ-08 — Practice Assignment Lifecycle

**Requirement number:** REQ-08.

**Use Case number:** UC-08.

**Name:** Practice Assignment Lifecycle.

**Introduction:** Structured work and Tutor feedback need accountable ownership, submission state and evidence links instead of a direct-chat coordination channel.

**Inputs:** Authorized Tutor/student relationship, title/instructions/topic/due time/task/submission type, optional booking/milestone; Student draft/text/link/file and storage metadata; Tutor feedback/score/completion action; author/edit/submission timestamps.

**Rationale:** Assignment creation needs a real authorized learning relationship; verified Student submission must match assignee and allowed type. Safe file handling must be configured before enabling uploads; feedback authorship must be protected independently of Student ownership of submissions.

**Requirements Description — Functional:**

1. Support authorized homework/quiz/reading/text/restricted-file tasks with required instructions, topic, creator, Student, due date, state and permitted submission type, plus validated optional learning-object links.
2. Follow SDD lifecycle `draft → assigned → in_progress → submitted → returned → completed`, with permitted cancellation/reason. Allow saved drafts and returned-work correction. Accept and visibly flag late work unless the Tutor has closed the task; overdue is not an invented contradictory final state.
3. Persist idempotent authorized submissions and Tutor-authored feedback/optional score with edit timestamps; deny Student edits to Tutor feedback and unrelated Tutor/Student access.
4. Enforce allowed file MIME/size/ownership paths, malware-safe handling policy and authenticated downloads; failed upload cannot be presented as completed submission.
5. Emit dated completion/feedback events linked to plans/progress and UC-10 notices without inventing missing evidence or duplicate completion.

**Requirements Description — Nonfunctional:** Protect work/storage through server checks, RLS and least-privilege policies; preserve provenance/version history, safe errors and retry integrity. Accessible due-state labels distinguish lifecycle, lateness and feedback; no direct chat is required or introduced.

**Outputs:** Persisted assignment, owned draft/submission/late state, structured Tutor feedback/returned/completed state and traceable notification/learning events.

**Source:** SDD feature 12, §6.9 FR-AS01–FR-AS06, §§14.2–14.3.

**Test cases:** TBD (to be discussed in the next sprint).

## REQ-09 — Session Planner, Recap and Private Reflection

**Requirement number:** REQ-09.

**Use Case number:** UC-09.

**Name:** Session Planner, Recap and Private Reflection.

**Introduction:** Confirmed sessions need shared preparation and dated Tutor outcomes, with a separate Student-private reflection and evidence path to later progress tracking.

**Inputs:** Confirmed booking/participants; Student goals/questions/priorities/approved attachments; Tutor agenda and authorized milestones/assessments/assignments; recap topics/strengths/practice areas/resources/next step; Student reflection and justified mastery evidence.

**Rationale:** Confirmed participant relationships are prerequisites for shared planner access. Recap requires post-session authorship/state checks; access to a shared workspace must not reveal private reflection. The actual lesson occurs externally/in person, so native video is not an integration prerequisite.

**Requirements Description — Functional:**

1. Create/retrieve one booking-linked planner idempotently from authoritative confirmation; allow Student structured goals/questions and Tutor agenda/authorized learning links.
2. Permit only authorized Tutor post-session recap and justified mastery observation; retain author, date and edit/provenance information.
3. Permit Student-owned private reflection while explicitly denying Tutor/public access. Shared preparation and feedback are structured persisted artifacts, not direct chat.
4. Publish only authorized dated evidence to later UC-14 progress integration and report pending/missing recap truthfully. No unsupported fixed 48-hour completion/reminder rule or mandatory AI approval is added.

**Requirements Description — Nonfunctional:** Participant checks/RLS and minimized DTOs isolate shared versus private data; idempotent persistence/events prevent duplicate workspace/evidence. Accessible preparation/recap state and truthful save/failure feedback are required. External teaching is a human interaction, not evidence that this web application implements native video.

**Outputs:** Participant-only planner/agenda/recap, owner-only reflection, attributed evidence links and honest pending/saved state.

**Source:** SDD §6.7 FR-PL01–FR-PL05, §§7.1–7.2 and 14.1–14.3.

**Test cases:** TBD (to be discussed in the next sprint).

## REQ-10 — Transactional Notifications and Reminders

**Requirement number:** REQ-10.

**Use Case number:** UC-10.

**Name:** Transactional Notifications and Reminders.

**Introduction:** Authorized users need reliable record-backed event notices and feasible reminders, with optional email categories and truthful delivery state.

**Inputs:** Authoritative domain event/ID/recipient/minimized payload; notification category/preferences; confirmed session UTC time and scheduling facts; recipient read/preference intent; email provider acknowledgement/failure/delivery evidence.

**Rationale:** A valid canonical event and eligible recipient are prerequisites so notices cannot falsely imply booking/payment success. Scheduler/email configuration is needed for dispatch; recipient ownership and required-notice rules control reads/preferences.

**Requirements Description — Functional:**

1. Cover booking, payment/refund, reminders, assessment assigned/scored, assignment due/submitted/returned, milestone risk, review and moderation events with deduplicated recipient-owned records.
2. Support persisted read state and category-level optional email preferences, while retaining required security/transaction notices. Validate access to the linked resource separately from feed visibility.
3. Schedule feasible 24-hour/1-hour reminders for confirmed sessions; cancel/revise stale scheduled notices after cancellation/rescheduling. Last-minute bookings do not imply a past reminder was sent.
4. Record queue/provider acceptance, failure/retry and actual delivery evidence distinctly. Failed email keeps in-app notice available; bounded idempotent retries do not fabricate inbox receipt or duplicate business events.

**Requirements Description — Nonfunctional:** Recipient-only RLS/authorization, minimized mail content and safe error handling protect privacy. Provider outage must not corrupt canonical booking/financial state; accessible non-color read/category indicators and independent scheduled-job authorization are required. No unmeasured immediate-delivery guarantee is made.

**Outputs:** Actual recipient notice/feed/read state, persisted preferences, valid scheduled reminders and truthful email attempt/delivery status.

**Source:** SDD §6.14 FR-N01–FR-N02, §6.4 FR-B07 and §18.

**Test cases:** TBD (to be discussed in the next sprint).

## Record review boundary

The strict field sets and paired IDs are documentation deliverables. Client confirmation, rendered diagrams, actual schemas/flows, passing checks, screenshots and submission evidence are separate gates in `REPORT_CHECKLIST.md` and `../planning/TRACEABILITY.md`. No requirement-level completion percentage or measured performance result is inferred from this draft.
