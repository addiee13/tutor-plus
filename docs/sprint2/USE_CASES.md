# Sprint 2 use cases

Prepared September 30, 2026. These are **behavior specifications, not implementation or test results**. Exactly ten detailed records, UC-01–UC-10, retain the existing Sprint 2 draft IDs; the five-item next-sprint backlog is separate. Each UC has exactly one paired REQ with the same numeric suffix in `REQUIREMENTS.md`.

Template: requirements lecture `lec/4_Requirement_ENgineering_SWE-5.pdf`, physical p64. Actors here include the people, application, providers and persistence entities requested by that template; listing an internal database does not make it an external actor in a UML use-case/context figure. Preconditions include their reason; Inputs identify origin and purpose. Expected outputs are conditional on successful execution.

Interaction tags classify the actual step, not the module name: **Actor-System** means a person interacts with a system (in either direction); **System-System** means an application/provider/database exchange; **Actor-Actor** is reserved for an actual coordinated human interaction. Reading another person's persisted agenda or feedback is Actor-System, not automatically Actor-Actor. No direct-chat, peer-swap, native-video, minor or guardian workflow is introduced.

## UC-01 — User Management

**Use Case #:** UC-01. **Paired requirement:** REQ-01.

**Name of the Use Case:** User Management (registration, verification, login, logout, session handling and authorized role/account management).

**Actors:** Visitor becoming a Student or Tutor supplies registration and 18+ attestation; Student/Tutor manages their session and recovery; Administrator signs in with a provisioned role and manages permitted account status/capabilities, never self-registering as admin; Tutor Plus validates and authorizes; Supabase Auth manages identity, verification, credentials and sessions; PostgreSQL stores `profiles`, `user_roles` and audit data; configured email service carries verification/recovery messages.

**Inputs:** Person-entered name, email, password, adult attestation and Student/Tutor role intent identify an eligible account; provider verification/recovery tokens prove ownership; login credentials establish a session; provider session/refresh data maintains it; administrator-selected target, allowed change and reason identify an auditable action. Server-resolved identity, current status and roles are authority, not editable metadata.

**Pre-condition:** Registration has an accessible form and configured Auth/provisioning path so identity can be created safely. Verification/recovery has a usable configured callback and delivery channel. Login has a registered identity. Protected actions require verified identity, active status and the required current role. Administrator operations require a server-verified admin grant to prevent privilege escalation.

**Use Case Description:** Main successful registration-to-login flow:

1. [Actor-System] Visitor enters the inputs, selects permitted role intent, attests to being 18+, and submits registration; Tutor Plus reports missing/invalid fields before accepting the intent.
2. [System-System] Tutor Plus requests managed registration and trusted profile/capability provisioning; duplicate handling and provisioning recovery follow the configured provider path. It does not claim a separate Auth API request and profile insert are inherently atomic.
3. [System-System] Auth requests a verification message through the configured email path; Tutor Plus retains pending verification state and does not equate provider acceptance with inbox delivery.
4. [Actor-System] Visitor follows the verification link; the system validates its token and reports the authoritative verification outcome.
5. [Actor-System] User submits credentials; Tutor Plus displays only an authoritative sign-in result and a destination permitted by current capabilities.
6. [System-System] The server verifies identity/session, loads active status and `user_roles`, and maintains the session through the configured refresh mechanism; protected operations repeat authorization checks rather than trusting a dashboard redirect.

**Alternate Path:** A1 [Actor-System] An existing user signs in without repeating registration (main steps 5–6). A2 [Actor-System] A signed-in user requests logout; the application removes its session cookies and reports the chosen signout scope. A3 [System-System] Auth revokes refresh capability for that scope; already-issued access tokens may remain valid until expiry, so do not claim universal instantaneous JWT invalidation. A4 [Actor-System] A user requests reset/resend and completes a valid provider callback. A5 [Actor-System] A verified Administrator requests an allowed status/capability change with reason. A6 [System-System] The server checks admin authority, persists/audits the change, hides deactivated public content while retaining financial/audit records, and applies current role/status checks on later operations. These are valid entry points/outcomes, not errors.

**Exception Path:** E1 [Actor-System] Invalid input, absent adult attestation, invalid credentials or unusable tokens produce safe actionable feedback; no successful registration/session is fabricated. E2 [Actor-System] Unverified users receive a verification/resend state and are denied booking, payment, publication and learning submissions; do not invent a blanket provider prohibition on every login. E3 [System-System] Auth, provisioning, refresh or mail failure leaves a recoverable pending/failed state, with no invented profile, session or delivery success. E4 [Actor-System] Non-admin role escalation and inactive-account actions are denied; editable metadata cannot grant authority. No fixed five-attempt lockout, 24-hour idle lifetime or Google OAuth is required by this record.

**Post-condition:** Main success has a verified managed identity, one linked application profile, permitted capabilities and a usable authenticated session. Logout alternative has removed the application's local session and revoked refresh capability at the configured scope, subject to access-token lifetime. Admin alternative has persisted/audited only authorized changes.

**Outputs:** Verification/pending/error screens, permitted dashboard, safe current actor/profile data, session transitions, recovery outcome and administrative audit/status updates as applicable; no passwords or privileged tokens in application tables/output.

**Source:** SDD §6.1 FR-A01–FR-A06, §12 security/authorization; architecture identity/session boundary. The admin subflow is account management, not the full UC-12 moderation console.

## UC-02 — Manage Student and Tutor Profiles

**Use Case #:** UC-02. **Paired requirement:** REQ-02.

**Name of the Use Case:** Manage Student and Tutor Profiles.

**Actors:** Student edits private learning preferences; Tutor edits expertise and requests public publication; Tutor Plus validates ownership/readiness and separates public/private projections; PostgreSQL persists `profiles`, `tutor_profiles`, `tutor_subjects` and readiness-related availability facts.

**Inputs:** Account-owner-entered display name, avatar, bio, interests, IANA time zone, approximate location, preferred mode and optional learning preferences maintain the private profile; tutor-entered headline, subjects, expertise, credential text, experience, rate, modes, service area, languages and photo describe tutoring; save/publication intent and current record version control changes. Authoritative availability is read from UC-04, not invented in the form.

**Pre-condition:** An active authenticated account owns the profile, preventing cross-account edits. Tutor-specific actions require Tutor capability; publication also requires verified email and valid profile, subject, rate, availability and mode facts, so incomplete tutors cannot enter discovery.

**Use Case Description:** Main tutor edit/publication flow:

1. [Actor-System] Tutor opens their own editor; Tutor Plus presents permitted stored private/tutor fields and publication readiness.
2. [Actor-System] Tutor edits the inputs and requests save; the form preserves entered values while validation feedback is resolved.
3. [System-System] The service resolves ownership/current capability, validates allowed fields and ranges, and persists the permitted change with version control in PostgreSQL; client-submitted role/status changes are excluded.
4. [Actor-System] Tutor reviews the canonical saved values and requests publication.
5. [System-System] Tutor Plus checks authoritative readiness and updates the deliberately public tutor projection only when all gates pass; private account/contact/learning data remains private.
6. [Actor-System] Tutor sees the persisted publication state and can reload to inspect the same saved data and public preview.

**Alternate Path:** A1 [Actor-System] Student edits and saves only their own private profile/preferences; tutor publication is not required. A2 [Actor-System] Tutor saves an incomplete unpublished draft or explicitly withdraws publication. A3 [System-System] PostgreSQL retains the draft/private data while the public projection remains hidden. These are accepted states, not validation failures.

**Exception Path:** E1 [Actor-System] Invalid time zone/rate/mode or missing publication data produces specific errors; an incomplete draft may remain saved but cannot be reported as published. E2 [System-System] Ownership/capability denial, stale version or persistence failure rejects the change and preserves prior canonical values; no false save message. E3 [Actor-System] A readiness failure explains the missing profile/subject/rate/availability/mode facts without silently broadening visibility.

**Post-condition:** Main success has saved owned profile/tutor data and a readiness-approved public projection. Student/draft alternatives have persisted private/unpublished data. Unauthorized changes have not been committed.

**Outputs:** Saved editor values/version, readiness feedback, public preview and publication/draft state; public tutor DTO contains only approved public fields, approximate area, subjects, rate/modes and supported reputation/availability facts.

**Source:** SDD §6.2 FR-P01–FR-P05; §6.1 FR-A04; architecture and database design. The actual Sprint 2 demo must identify which student/tutor/publication subflows are implemented.

## UC-03 — Tutor Search and Discovery

**Use Case #:** UC-03. **Paired requirement:** REQ-03.

**Name of the Use Case:** Tutor Search and Discovery.

**Actors:** Student/search visitor supplies filters and browses public tutors; Tutor Plus validates/paginates discovery; PostgreSQL/PostGIS returns permitted public candidates and approximate distance; geocoding service optionally resolves a manually entered area; browser location service is used only with permission.

**Inputs:** Person-selected subject/topic, mode, date/time window, price, rating and optional in-person radius constrain results; manually entered city/state/ZIP or consented browser position supplies approximate search origin; cursor/page bounds limit work. Published tutor/readiness data and bookable availability come from stored authoritative records.

**Pre-condition:** Public tutor projection and bounded search endpoint exist; publishing rules determine eligible data. Search does not require at least one matching tutor or a compulsory login, since an empty result/public browse is legitimate. Protected booking after discovery requires UC-01 verification.

**Use Case Description:**

1. [Actor-System] Searcher supplies filters and manual location when needed, then requests results; Tutor Plus validates ranges and time-zone interpretation.
2. [System-System] If necessary and available, Tutor Plus resolves the approximate manual area through the geocoding adapter; exact private meeting addresses are not queried as public profile fields.
3. [System-System] Tutor Plus executes a bounded query over published public tutor data, relevant availability and optional PostGIS distance, applying the selected filters before presentation.
4. [Actor-System] Searcher reads tutor cards with subject, price, mode, area, rating and useful next-availability facts, or an honest no-results state.
5. [Actor-System] Searcher opens a public profile, adjusts filters or requests the next bounded page; entry to booking is explicitly subject to account eligibility.

**Alternate Path:** A1 [Actor-System] Searcher chooses virtual-only discovery and omits geographic filtering. A2 [Actor-System] Searcher grants browser-location permission instead of typing an area; declining permission returns to manual entry without blocking that valid route. A3 [Actor-System] In a later implementation, the student explicitly selects UC-15 explainable matching; that separate backlog feature is not silently counted as UC-03 delivery or required to return a fixed top five.

**Exception Path:** E1 [Actor-System] Invalid filters/location prompt correction. E2 [System-System] Geocoding/database failure returns a truthful unavailable state; a non-geographic retry requires user choice and must not silently drop a hard distance constraint. E3 [Actor-System] If a previously displayed tutor is withdrawn or a slot changes, the system reports the changed eligibility; cached search never guarantees a booking. No-match itself is a normal successful query, not an infrastructure exception.

**Post-condition:** A bounded result set or accurate empty state is presented without modifying booking/payment data; selected public profile can be inspected.

**Outputs:** Safe tutor cards/profile, applied-filter summary, optional approximate distance and pagination/empty-state controls; no private profile/learning/contact/meeting fields.

**Source:** SDD §6.3 FR-S01–FR-S06, §13.3; UC-15 remains distinct.

## UC-04 — Availability Management and Session Booking

**Use Case #:** UC-04. **Paired requirement:** REQ-04.

**Name of the Use Case:** Availability Management and Session Booking.

**Actors:** Tutor defines availability and private meeting details; Student selects/reserves a session; Tutor Plus calculates slots, authorizes and controls booking state; PostgreSQL enforces transactional scheduling integrity; payment service/Stripe adapter supplies the verified UC-06 payment outcome; notification service handles resulting events.

**Inputs:** Tutor-entered weekly rules, exceptions, IANA time zone, durations, lead/buffer limits determine bookable time; student-selected tutor/subject/slot/duration/mode and structured goals determine reservation intent; server rate snapshot fixes monetary minor units/currency; private meeting details support delivery; cancellation/reschedule request and policy determine permitted transitions.

**Pre-condition:** Tutor capability/ownership protects availability edits. Student is active and verified; selected tutor is eligible and published; server has configured scheduling/policy facts. A configured payment path is needed for paid-booking confirmation, not merely for availability editing or a payment-pending record.

**Use Case Description:**

1. [Actor-System] Tutor submits weekly availability and exceptions in the displayed time zone; Tutor Plus validates rule ranges and permitted ownership.
2. [System-System] The scheduling service persists rules/exceptions and derives UTC candidate intervals by subtracting active bookings and buffers, applying duration/lead-window constraints.
3. [Actor-System] Student selects an eligible slot, mode and subject, enters structured goals, and reviews the server-calculated price and cancellation policy.
4. [System-System] A database transaction rechecks current availability, participant eligibility and overlap constraints, then creates one payment-pending booking with participant/time/mode/price snapshots; concurrent claims cannot both succeed.
5. [System-System] Tutor Plus invokes UC-06 and confirms the paid booking only from verified provider/server payment state, recording the transition and generating notification events once.
6. [Actor-System] Student and Tutor inspect their confirmed booking, displayed local times and participant-only meeting details; virtual URL must be supplied before start.

**Alternate Path:** A1 [Actor-System] Tutor edits/date-blocks availability without a booking request. A2 [Actor-System] A participant requests policy-permitted cancellation or rescheduling. A3 [System-System] The server validates current state, changes time transactionally where relevant, records the event/version, invokes any required UC-06 refund and emits UC-10 events without conflating refund completion with cancellation. A4 [Actor-System] A user deliberately abandons checkout; expiry/release follows documented policy, not an invented ten-minute guarantee. Recurring availability is not an advanced recurring-booking series.

**Exception Path:** E1 [Actor-System] A concurrent claim, invalid interval, ineligible account or stale slot is rejected with a new-selection action. E2 [System-System] Payment failure/unavailability leaves truthful pending/failed payment state and applies documented reservation-release rules; it never confirms from a browser redirect. E3 [Actor-System] Invalid state transitions or missing meeting readiness prevent the corresponding action and explain recovery; database failure rolls back the booking mutation.

**Post-condition:** Main success has one confirmed non-overlapping booking and separately recorded successful payment state. Availability-only alternative has valid stored rules. Cancellation/rescheduling has an authorized persisted event with independent financial state; failure has not produced a false confirmation.

**Outputs:** Availability/slot views, policy and price summary, canonical booking state, UTC records/local presentation, private meeting readiness and deduplicated notice events.

**Source:** SDD §6.4 FR-B01–FR-B07, §6.5 FR-PAY04–FR-PAY06, §§13.1–13.3. Sprint 2 database coverage does not establish a booking UI/payment demo.

## UC-05 — Diagnostic Assessment

**Use Case #:** UC-05. **Paired requirement:** REQ-05.

**Name of the Use Case:** Diagnostic Assessment and Mastery Checks.

**Actors:** Authorized Tutor creates/reuses/assigns assessment and scores subjective work; Student answers an assigned check; Tutor Plus validates assignment/attempts and objective scoring; PostgreSQL stores definitions, assignments, answers and dated evidence; scoring keys reside behind a private boundary.

**Inputs:** Tutor-provided subject/topic, purpose (diagnostic, pre/post-session or milestone), versioned items, point values and topic tags define the check; authorized student/booking/plan link determines access; student answers and timestamps supply evidence; tutor scores/feedback finalize subjective items; private scoring rules are never student-supplied authority.

**Pre-condition:** Tutor has an authorized relationship to the assigned student and valid assessment definition; verified active Student owns the assigned attempt. Scoring rules and point maxima exist so scores can be bounded and keys protected.

**Use Case Description:**

1. [Actor-System] Tutor creates or selects a supported assessment and assigns it within their authorized booking/study-plan relationship.
2. [System-System] Tutor Plus validates the relationship/version, persists assignment, and serves only student-permitted prompts/choices, excluding private answer keys.
3. [Actor-System] Student opens the assessment, supplies responses and submits; the system distinguishes saved draft from finalized submission.
4. [System-System] The service persists the attempt idempotently, timestamps it and calculates supported objective scores; subjective work remains explicitly awaiting tutor scoring.
5. [Actor-System] Assigned Tutor scores the subjective responses with bounded points and finalizes feedback; the student views their own result.
6. [System-System] Tutor Plus stores final topic-level evidence and may produce a linked mastery observation according to confirmation/configured evidence rules; one result does not automatically imply Confident mastery.

**Alternate Path:** A1 [Actor-System] Student deliberately saves unfinished answers as a draft and later resumes under the same authorized assignment; no seven-day expiry is assumed. A2 [Actor-System] An authorized new attempt retains prior attempts for comparison. A3 [System-System] An all-objective check finalizes without subjective scoring, clearly labeling its automated score source.

**Exception Path:** E1 [Actor-System] Closed/ineligible assignments, invalid responses or out-of-range tutor scores are rejected without false completion. E2 [System-System] A failed save/finalization preserves the last canonical state and allows safe retry; repeated submission cannot duplicate finalized evidence. E3 [Actor-System] Unassigned tutors and other students are denied attempts/keys, even if they know the record ID.

**Post-condition:** Main success has a finalized scored attempt with topic evidence and provenance; a draft remains incomplete and a partially scored attempt remains awaiting Tutor. History/authorization is preserved.

**Outputs:** Assignment/draft/submission/scoring state, objective versus tutor score labels, topic evidence and linked observation when justified; no public answer keys or fabricated mastery.

**Source:** SDD §6.8 FR-DA01–FR-DA07, §§14.1 and 20.1; SDD feature 11 retains draft UC-05 identity.

## UC-06 — Payment and Refund Processing

**Use Case #:** UC-06. **Paired requirement:** REQ-06.

**Name of the Use Case:** Payment and Refund Processing (including separate payout-state tracking).

**Actors:** Verified Student pays/requests permitted refund; Tutor views their own earnings/payout state; authorized operator performs permitted financial reconciliation; Tutor Plus controls server-created financial records; Stripe Connect Test Mode processes payment/refund/payout events; PostgreSQL persists financial and deduplication records.

**Inputs:** Server-owned booking/price snapshot, integer amount/currency, platform fee and connected tutor determine charge; user payment credentials go only to Stripe UI; idempotency key and verified signed event determine authoritative mutation; cancellation policy/reason determines refund eligibility; provider payout data identifies actual state.

**Pre-condition:** Eligible payment-pending booking, verified active payer, configured Test Mode provider/connected account and usable signature verification exist for payment success. Refund requires a relevant captured payment and authorized policy decision; payout display requires financial records owned by the tutor. A SQL row alone is not a processed charge.

**Use Case Description:**

1. [System-System] Tutor Plus validates server booking/amount and idempotently creates or reuses the linked payment record and provider payment request.
2. [Actor-System] Student completes Stripe-provided payment UI; Tutor Plus does not collect/store raw card credentials or treat a return URL as success.
3. [System-System] Stripe sends a provider event; the server verifies its signature, deduplicates its identifier and reconciles the relevant financial state without regressing from stale/out-of-order events.
4. [System-System] PostgreSQL records capture state independently of booking state; the booking service receives an authoritative confirm action and notification event.
5. [Actor-System] Student views actual payment outcome/receipt information; Tutor views actual earnings/payout state, with pending transfer/payout distinguished from settled funds.

**Alternate Path:** A1 [Actor-System] Authorized participant requests a policy-permitted cancellation/refund. A2 [System-System] Tutor Plus submits an idempotent refund request and records requested/pending state until provider evidence establishes the outcome. A3 [System-System] Later provider payout events update independent transfer/payout records; capture is not itself a completed payout. Refund amount/fees follow approved displayed policy, not an assumed universal fee waiver.

**Exception Path:** E1 [Actor-System] Decline or required additional action shows safe retry/action feedback without inventing payment success or a fixed hold duration. E2 [System-System] Invalid signature, duplicate/stale event, provider outage or mismatched amount is rejected/reconciled without unauthorized state change. E3 [System-System] Persistence failure triggers safe retry/reconciliation, not silent loss or duplicate charges. E4 [Actor-System] Ineligible refund requests are denied with policy explanation; rejected refund does not erase payment history.

**Post-condition:** Main success has an authoritative captured payment and corresponding booking transition. Refund/payout alternatives retain their own actual states and provenance; unresolved provider work remains pending, never falsely settled.

**Outputs:** Payment/refund/payout states, permitted financial summaries, deduplication/audit records and notice events; no exposed provider secrets or raw card data.

**Source:** SDD §6.5 FR-PAY01–FR-PAY06 and financial design. Sprint 2 requires real database support for this group, not proof of provider processing unless independently demonstrated.

## UC-07 — Reviews and Ratings

**Use Case #:** UC-07. **Paired requirement:** REQ-07.

**Name of the Use Case:** Reviews and Ratings.

**Actors:** Student from a completed valid booking submits one verified review; Tutor/searcher views approved reputation; Administrator moderates reported reviews with an audit reason; Tutor Plus validates eligibility and derives aggregates/badges; PostgreSQL persists review/moderation and source evidence.

**Inputs:** Student-selected completed booking, rating, optional text and recommendation flag define review; moderation state/action/reason and current admin authority govern visibility; approved reviews and completed-session facts feed rule-based aggregates/badges. Users do not submit their own aggregate rating.

**Pre-condition:** Active authenticated Student owns a completed valid booking without an existing review; publication/moderation rules are defined. Moderator has server-verified admin authority so visibility changes are accountable.

**Use Case Description:**

1. [Actor-System] Student opens the eligible completed-session review form and submits rating/optional text/recommendation.
2. [System-System] Tutor Plus checks completed-booking ownership, field bounds and uniqueness, then persists the review with its configured moderation state.
3. [System-System] The reputation service derives aggregate ratings and explainable badges only from approved data, preserving review-to-booking provenance.
4. [Actor-System] Student sees submission/moderation state; Tutor and public viewers see only approved reviews/derived reputation, not private learning details.

**Alternate Path:** A1 [Actor-System] Student submits only the required rating, omitting optional text. A2 [Actor-System] Administrator reviews a reported review and confirms a permitted visibility action with reason. A3 [System-System] The system preserves the review/audit record and recomputes approved aggregates without deleting history. No reciprocal tutor-to-student rating is added.

**Exception Path:** E1 [Actor-System] Duplicate, invalid rating, incomplete booking or wrong-user submission is rejected. E2 [System-System] Save/aggregate failure leaves truthful pending/error state and does not falsely change public reputation. E3 [Actor-System] Non-admin moderation attempts and direct client aggregate updates are denied.

**Post-condition:** One eligible review has been stored; only approved records contribute publicly. Moderation preserves audit evidence and correct aggregates.

**Outputs:** Review receipt/state, approved review list, derived rating/badge explanation and moderation audit when applicable.

**Source:** SDD §6.6 FR-R01–FR-R05; moderation integrates later UC-12 rather than requiring its complete console in Sprint 2.

## UC-08 — Practice Tasks and Assignment Management

**Use Case #:** UC-08. **Paired requirement:** REQ-08.

**Name of the Use Case:** Practice Tasks and Assignment Management.

**Actors:** Authorized Tutor assigns work and authors feedback; Student owns drafts/submissions; Tutor Plus controls authorization/lifecycle; PostgreSQL stores assignment/submission/feedback/evidence; private storage service handles restricted files; notification service emits due/submission/return events.

**Inputs:** Tutor-entered title, instructions, topic, student, due date, task/submission type and optional booking/milestone specify work; student text/link/permitted file is a submission; tutor feedback, optional score, completion action and timestamp supply reviewed evidence. Storage metadata enforces allowed MIME, size and ownership.

**Pre-condition:** Tutor has an authorized student relationship and valid task definition. Active verified Student is the assignee for submission. Private upload/download policies must exist before file submissions can be enabled, avoiding public access to learning work.

**Use Case Description:**

1. [Actor-System] Tutor creates a draft task and assigns it to an authorized student, identifying instructions, due time and permitted submission type.
2. [System-System] Tutor Plus checks relationship/link consistency, persists the assignment and emits an assignment notice without granting other tutors access.
3. [Actor-System] Student reads the task, starts work, saves a draft and submits permitted text/link/file; these are structured work objects, not chat messages.
4. [System-System] The system validates ownership/type/file policy, timestamps/idempotently stores the submission and marks late work when applicable; lateness does not silently close the task.
5. [Actor-System] Tutor reviews the submission and returns structured feedback, optional bounded score and the appropriate completion/return action.
6. [System-System] Tutor Plus persists author/edit timestamp and valid state transition, emitting linked plan/progress evidence and notifications without allowing the student to overwrite tutor feedback.

**Alternate Path:** A1 [Actor-System] Student resumes a saved draft. A2 [Actor-System] Tutor returns work for correction; Student resubmits if permitted. A3 [Actor-System] Tutor cancels an eligible assigned task with reason. A4 [Actor-System] A late but still-open submission is accepted and visibly labeled. Lifecycle follows SDD `draft → assigned → in_progress → submitted → returned → completed` with permitted cancellation; overdue is a dated flag, not a contradictory replacement state.

**Exception Path:** E1 [Actor-System] Wrong assignee, unauthorized tutor, closed/cancelled task or invalid transition is denied. E2 [System-System] Disallowed MIME/size/path or failed authenticated upload/download rejects the file and does not mark a submission successful. E3 [System-System] Save/feedback failure retains canonical state for safe retry; no completed/progress claim without evidence. Overdue itself is not a processing failure.

**Post-condition:** Task/submission/feedback have valid states, ownership and timestamps; completed work links to traceable evidence. Draft/returned/late/cancelled alternatives remain distinguishable.

**Outputs:** Work list, private draft/submission receipt, returned/completed state, structured tutor feedback and dated downstream events; no student editing of feedback.

**Source:** SDD §6.9 FR-AS01–FR-AS06 and §§14.2–14.3; SDD feature 12 retains draft UC-08 identity.

## UC-09 — Session Planner and Recap

**Use Case #:** UC-09. **Paired requirement:** REQ-09.

**Name of the Use Case:** Session Planner and Recap.

**Actors:** Student supplies goals/questions and private reflection; booked Tutor prepares agenda, teaches and records recap; Tutor Plus enforces participant boundaries and evidence provenance; PostgreSQL persists booking-linked planner/recap/reflection; participants use their external meeting service or in-person venue for the actual lesson (no native video integration assumed).

**Inputs:** Confirmed booking/participants establish workspace eligibility; student goals/questions/priority topics and approved attachments guide preparation; tutor agenda and authorized task/assessment/milestone links structure teaching; topics covered, strengths, practice areas, resources and next step form recap; student reflection remains owner-private; any mastery observation needs evidence/confirmation rules.

**Pre-condition:** A confirmed authorized booking exists, allowing only its participants to read shared planner data. Meeting readiness/time governs actual teaching. Recap is post-session; private reflection has a separate ownership boundary so tutor access to planner does not imply access to it.

**Use Case Description:**

1. [System-System] On authoritative booking confirmation, Tutor Plus creates/retrieves its participant-scoped planner idempotently, with no duplicate workspace on event retry.
2. [Actor-System] Student enters structured goals/questions; Tutor later reads permitted goals and adds the agenda and authorized evidence links. This asynchronous artifact coordination is not an Actor-Actor chat exchange.
3. [Actor-Actor] Student and Tutor conduct the scheduled live instructional session in person or through their external meeting service. This is a real human teaching interaction specified by the product journey, not a claimed Sprint 2 demonstration or in-app video/chat feature.
4. [Actor-System] Tutor records the post-session recap and any justified mastery observation; Student reads the authorized recap and may add a separate private reflection.
5. [System-System] The server validates authorship/booking links, persists dated records and emits traceable evidence for later UC-14 progress; private reflections are excluded from Tutor/public views.

**Alternate Path:** A1 [Actor-System] Participants use preparation-only workspace before the lesson; it remains without a post-session recap. A2 [Actor-System] Student records a private reflection without sharing it. A3 [Actor-System] Tutor deliberately edits an existing recap, retaining author/edit timestamp and provenance. Optional AI summarization is later UC-11 behavior, not a required new approval workflow.

**Exception Path:** E1 [Actor-System] Wrong participants, premature recap or invalid linked evidence are denied; private reflection access is separately checked. E2 [System-System] Persistence/event failure preserves canonical saved/pending state and supports deduplicated retry; no fabricated progress update. E3 [Actor-System] Missing recap is displayed honestly as pending; no unsupported fixed 48-hour reminder promise.

**Post-condition:** Main success has booking-linked authorized planner and dated Tutor recap; any reflection is owner-private and mastery/evidence are correctly attributed. Preparation-only state is not completed teaching or recap.

**Outputs:** Shared goals/agenda, permitted recap and evidence links, private reflection view, pending/saved feedback and truthful downstream-event state.

**Source:** SDD §6.7 FR-PL01–FR-PL05, §§7.1–7.2 and 14.1–14.3.

## UC-10 — Notifications and Reminders

**Use Case #:** UC-10. **Paired requirement:** REQ-10.

**Name of the Use Case:** Notifications and Reminders.

**Actors:** Student/Tutor/Administrator reads their own notices and selects optional email categories; Tutor Plus/domain event source creates authorized events; notification/scheduler service persists and dispatches deduplicated notices; PostgreSQL stores recipient/preference/read/delivery state; email service processes optional/required mail attempts.

**Inputs:** Authoritative booking/payment/assessment/assignment/milestone/review/moderation event, recipient ID, minimized payload and event identity determine notice; current preferences choose optional email; confirmed session time supports feasible 24-hour/1-hour reminders; read/preference request comes from the authenticated recipient; provider outcomes determine delivery status.

**Pre-condition:** Valid event and eligible recipient exist, preventing notices from implying unconfirmed business state. The scheduler/email path is configured for actual reminder/mail attempts. Reading/editing preferences requires ownership; required security/transaction email is not disabled by an optional-category setting.

**Use Case Description:**

1. [System-System] An authoritative domain operation emits an event; notification service validates recipient/payload and idempotently persists the in-app notice and dispatch intent.
2. [System-System] The service checks category preferences and required-notice rules, schedules feasible reminders and requests eligible email through the configured adapter.
3. [System-System] It records actual provider acknowledgement/failure separately from eventual delivery evidence; successful queueing is not proof that the recipient received mail.
4. [Actor-System] Recipient reads their own in-app feed/details; Tutor Plus marks only their authorized notice read and routes to permitted linked data.
5. [Actor-System] Recipient changes optional email categories and sees the persisted setting while required notices remain protected.

**Alternate Path:** A1 [Actor-System] Recipient disables optional-category email and uses the in-app notice. A2 [System-System] The service omits infeasible advance reminder times for a last-minute confirmed session, without inventing a reminder sent in the past. A3 [Actor-System] Recipient views an already-read notice; read state need not create duplicate notifications.

**Exception Path:** E1 [System-System] Email failure retains in-app notice and real failure/pending-retry state; retry must be bounded/idempotent and cannot claim delivered. E2 [System-System] Invalid event/recipient/payload or persistence failure prevents false notification success; duplicate events reuse existing work. E3 [Actor-System] Other-user feed/read/preference attempts are denied. A cancelled/rescheduled booking invalidates obsolete reminders instead of sending stale confirmations.

**Post-condition:** Authorized in-app notice/read state and email/scheduler state reflect actual processing; optional preferences persist. Business success and inbox delivery have not been fabricated from notification intent.

**Outputs:** Recipient-only feed/read counts, persisted preferences, minimized email payload, real delivery-attempt status and deduplicated reminder/event records.

**Source:** SDD §6.14 FR-N01–FR-N02, §6.4 FR-B07 and §18 notices.

## Next-sprint backlog — not detailed Sprint 2 records

Names/IDs preserve the existing draft, while SDD feature numbers are explicitly mapped because catalog order differs. REQ-11–REQ-15 are reserved pairs, not five additional detailed requirements in this sprint.

| Use case / reserved pair | Backlog scope | Exact SDD trace | Client evidence |
| --- | --- | --- | --- |
| UC-11 / REQ-11 | AI Learning Assistant and Curated Resources: minimized selected context, approved resources, human-confirmed suggestions; no autonomous grading/booking/charges | Feature 8; §6.12 FR-AI01–FR-AI06 | Baseline product feature, not independently approved new client request |
| UC-12 / REQ-12 | Administration and Platform Safety: user/report/review/catalog/template/badge/audit administration with controlled destructive actions | Feature 10; §6.14 FR-AD01–FR-AD03 | Baseline; UC-01 account-role subflow and UC-07 moderation do not equal full delivery |
| UC-13 / REQ-13 | Personalized Study Plans and Milestones: goals, ordered milestones, attributed revisions, human-confirmed AI drafts and explicit replanning | Feature 13; §6.10 FR-SP01–FR-SP06 | CR-01 Group 8 candidate, unconfirmed |
| UC-14 / REQ-14 | Learning Progress Tracker: dated evidence, labeled mastery/completion measures and authorized relationship-scoped access | Feature 14; §6.11 FR-PR01–FR-PR06 | CR-02 Group 8 candidate, unconfirmed |
| UC-15 / REQ-15 | Explainable Smart Tutor Matching: hard eligibility before configurable ranking, concrete reasons and user choice; no protected factors/objectively-best claim | Feature 15; §6.13 FR-MT01–FR-MT06 | CR-03 Group 8 candidate, unconfirmed |

The semester baseline includes all fifteen features at controlled depth. Deferral here applies to detailed Sprint 2 records/delivery scope, not deletion from SDD version 1.1. Source review state: lecture template visually checked; no implemented flow, rendered use-case diagram or successful test is established by these specifications.
