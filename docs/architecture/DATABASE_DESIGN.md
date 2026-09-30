# Database management design

Section 6 source draft. **DBMS: PostgreSQL, managed through Supabase.** No SQL has been written or applied. This specification covers the whole system; the starred Sprint 2 groups must later be implemented with reproducible SQL scripts/migrations.

Basis: SDD version 1.1 section 11 and `lec/DatabaseFundamentals.pdf` keys/normalization material. SQL implementation must use the actual supported PostgreSQL version and reviewed migration order.

## Notation and shared conventions

- `PK`: primary key; `FK`: foreign key; `UQ`: unique; `?`: nullable; unmarked fields are NOT NULL. UUID is the application identity type.
- Unless a row says otherwise, every application entity has `id uuid PK`, `created_at timestamptz`, and `updated_at timestamptz`. Link tables use the stated composite PK. Append-only events/observations have `created_at` only unless explicitly specified.
- `text enum[...]` means a PostgreSQL enum or named CHECK constraint with those allowed values; choose one consistent implementation during migration review.
- UTC `timestamptz` represents an instant; local recurrence uses `date`, `time`, weekday and an IANA `timezone text` separately. Half-open intervals prevent adjacent sessions from colliding.
- Money is integer minor units (`bigint`), never floating point; `currency char(3)` identifies ISO currency. Numeric score/weight fields have explicit bounds.
- Normalize stable entities/relationships toward 3NF. Bounded JSONB is acceptable for choices, validated intake/preferences, safe metadata or immutable score snapshots; do not bury ownership, foreign keys, or workflow states inside free-form JSON.
- Financial/assessment/audit retention uses status/soft deletion. Define destructive FK actions explicitly; do not cascade-delete financial history on account removal. Deactivate accounts by default.

## Sprint 2 implementation selection

| Selected major use case | Required table group and dependencies | UI in Sprint 2 |
| --- | --- | --- |
| UC-01 User Management | Managed `auth.users`; `profiles`; `user_roles`; minimal `audit_logs` for privileged role/status changes | Fully functional core signup/login/logout/session/roles |
| UC-02 Profiles | `profiles`; `tutor_profiles`; `subjects`; `tutor_subjects`; availability readiness read dependency | Real profile read/edit/save; publication only with valid readiness |
| UC-04 Availability and Booking | `availability_rules`; `availability_exceptions`; `bookings`; `booking_private_details`; `booking_events`; existing actor/subject FKs | Schema/constraints/policy proof; booking UI deferred |
| UC-06 Payments and Refunds | `payments`; `payment_events`; `refunds`; `payout_refs`; existing booking FKs | Schema/constraints/policy proof; Stripe runtime deferred |

Four major use cases do **not** mean four individual tables. Implement all dependencies in the selected groups. Managed Auth supplies its own identity/session tables; do not create a second password store.

## Detailed dictionary — selected groups

| Table | Attributes and types | Keys / cardinality / checks |
| --- | --- | --- |
| `auth.users` (provider owned) | `id uuid`; identity/email/password/session provider fields managed by Auth | Provider PK; application references `id`; no direct application password writes |
| `profiles` | `id uuid`; `display_name text`; `bio text?`; `avatar_path text?`; `timezone text`; `city text?`; `region text?`; `postal_code text?`; `country_code char(2)?`; `learning_preferences jsonb`; `account_status text enum[active,inactive]`; `adult_attested_at timestamptz`; shared timestamps | PK/FK `id → auth.users.id`, one identity to zero/one profile during provisioning and exactly one after successful provisioning; valid timezone; JSON shape validated; private owner data |
| `user_roles` | `user_id uuid`; `role text enum[student,tutor,administrator]`; `granted_by uuid?`; `created_at timestamptz` | Composite PK `(user_id,role)`; user/grantor FKs to profiles; one user to many capabilities; browser cannot grant roles; initial admin grantor may be null only in controlled bootstrap |
| `tutor_profiles` | shared `id`; `user_id uuid`; `public_display_name text`; `public_avatar_url text?`; `headline text`; `bio text`; `credentials_text text?`; `experience_years smallint`; `hourly_rate_minor bigint`; `currency char(3)`; `supports_virtual boolean`; `supports_in_person boolean`; `service_area_label text?`; `approximate_location geography(Point,4326)?`; `service_radius_km numeric(6,2)?`; `publication_state text enum[draft,review_ready,published,paused]`; `version integer` | UQ/FK `user_id → profiles.id`; one profile to zero/one tutor profile; positive rate; nonnegative experience; at least one mode; location/radius required for in-person publication; public snapshot intentionally derives tutor-approved display fields from private profile |
| `subjects` | shared `id`; `parent_id uuid?`; `name text`; `slug text`; `active boolean`; `sort_order integer` | UQ slug; self FK parent; prohibit invalid taxonomy cycles through catalog service; initial Math, Science, Reading/Writing |
| `tutor_subjects` | `tutor_id uuid`; `subject_id uuid`; `expertise text?`; `rate_override_minor bigint?`; `created_at timestamptz` | Composite PK `(tutor_id,subject_id)`; FKs to tutor_profiles/subjects; positive override when supplied; many-to-many tutor/subject |
| `availability_rules` | shared `id`; `tutor_id uuid`; `weekday smallint`; `local_start time`; `local_end time`; `timezone text`; `valid_from date`; `valid_until date?`; `active boolean` | FK tutor; weekday 0–6; start < end; end date ≥ start; split overnight ranges into valid daily rules; prevent unintended overlapping effective rules |
| `availability_exceptions` | shared `id`; `tutor_id uuid`; `local_date date`; `local_start time?`; `local_end time?`; `timezone text`; `exception_type text enum[unavailable,additional]`; `reason text?` | FK tutor; both times null for full-day unavailable, otherwise both set and ordered; additions require interval |
| `bookings` | shared `id`; `student_id uuid`; `tutor_id uuid`; `subject_id uuid`; `starts_at timestamptz`; `ends_at timestamptz`; `blocking_starts_at timestamptz`; `blocking_ends_at timestamptz`; `mode text enum[virtual,in_person]`; `price_minor bigint`; `platform_fee_minor bigint`; `currency char(3)`; `status text enum[draft,payment_pending,confirmed,in_progress,completed,cancelled]`; `hold_expires_at timestamptz?`; `policy_snapshot jsonb`; `cancellation_reason text?`; `version integer` | FKs student→profiles, tutor→tutor_profiles, subject→subjects; interval ordered, blocking interval contains session interval, money nonnegative; student ≠ tutor's user; participant roles checked; GiST exclusion prevents overlapping tutor blocking ranges for active statuses |
| `booking_private_details` | `booking_id uuid`; `meeting_url text?`; `meeting_place text?`; `created_at timestamptz`; `updated_at timestamptz` | PK/FK booking; zero/one detail row per booking; virtual/in-person required detail validated before start; participants only; never public tutor DTO |
| `booking_events` | shared `id`; `booking_id uuid`; `actor_id uuid?`; `event_type text`; `from_state text?`; `to_state text?`; `reason text?`; `booking_version integer`; `created_at timestamptz` | FKs booking/actor; append-only history; non-user verified provider/job events have null actor and explicit event type; UQ booking/version for state transitions |
| `payments` | shared `id`; `booking_id uuid`; `provider_payment_id text?`; `idempotency_key text`; `amount_minor bigint`; `fee_minor bigint`; `currency char(3)`; `state text enum[created,requires_action,processing,paid,failed,partially_refunded,refunded]`; `paid_at timestamptz?`; `refunded_at timestamptz?` | UQ/FK booking; UQ provider ID when assigned; UQ idempotency key; nonnegative amount; fee within amount; one canonical payment record per booking, retry history in events |
| `payment_events` | shared `id`; `payment_id uuid`; `provider_event_id text`; `event_type text`; `safe_state_snapshot jsonb`; `processed_at timestamptz?`; `created_at timestamptz` | FK payment; UQ provider event ID; provider-verified server writes only; never raw provider payload/card data in report/client |
| `refunds` | shared `id`; `payment_id uuid`; `provider_refund_id text?`; `idempotency_key text`; `amount_minor bigint`; `state text enum[requested,pending,succeeded,failed]`; `reason text`; `requested_by uuid?` | FK payment/requestor; UQ provider refund ID/idempotency key; positive amount; transactionally bound total successful/pending refunds to captured amount |
| `payout_refs` | shared `id`; `payment_id uuid`; `connected_account_id text`; `provider_transfer_id text?`; `provider_charge_id text?`; `state text`; `last_verified_at timestamptz?` | FK payment; UQ transfer ID when present; one payment to zero/many provider references; provider is payout authority; minimized safe display DTO |
| `audit_logs` | shared `id`; `actor_id uuid?`; `action text`; `entity_type text`; `entity_id uuid?`; `reason text`; `safe_metadata jsonb`; `created_at timestamptz` | FK actor; entity reference is typed polymorphic audit metadata rather than a general FK; append-only server writes; redact secrets/private work |

`booking_events`, `payment_events`, `refunds`, and `booking_private_details` refine the SDD's conceptual schema to make history, idempotency and private-field boundaries explicit. They are proposed design refinements, not historical implemented tables.

## Whole-system dictionary — subsequent sprints

These table definitions complete the conceptual database plan; they are **not required to be migrated in this documentation-only change**. Shared field conventions apply unless overridden.

| Table | Attributes and types | Keys / relationships / constraints |
| --- | --- | --- |
| `favorites` | `student_id uuid`; `tutor_id uuid`; `created_at timestamptz` | Composite PK; FKs profiles/tutor_profiles; private student-owned saved tutors |
| `booking_goals` | shared `id`; `booking_id uuid`; `author_id uuid`; `goals text`; `questions text?`; `agenda text?` | FKs booking/profile; participants only; distinguish author/edit authority |
| `session_recaps` | shared `id`; `booking_id uuid`; `tutor_id uuid`; `topics jsonb`; `strengths text`; `practice_areas text`; `next_step text`; `submitted_at timestamptz?` | UQ booking; FKs booking/tutor; tutor-authored, participant-readable |
| `student_reflections` | shared `id`; `booking_id uuid`; `student_id uuid`; `reflection text` | UQ `(booking_id,student_id)`; FKs booking/profile; only owning student reads/writes |
| `study_goals` | shared `id`; `student_id uuid`; `subject_id uuid`; `objective text`; `target_date date`; `baseline text?`; `success_criterion text`; `state text` | FKs profile/subject; one student has many goals |
| `study_plans` | shared `id`; `goal_id uuid`; `owner_id uuid`; `title text`; `state text enum[draft,active,completed,archived]`; `source text enum[human,ai_suggestion]`; `confirmed_at timestamptz?`; `version integer` | UQ goal for the current plan; FKs goal/owner; AI suggestion requires human confirmation; prior versions in revisions |
| `milestones` | shared `id`; `plan_id uuid`; `subject_id uuid?`; `topic text`; `sequence integer`; `target_date date`; `state text enum[not_started,in_progress,completed,reschedule_needed]`; `completed_at timestamptz?` | FKs plan/subject; UQ `(plan_id,sequence)`; one milestone belongs to one plan |
| `plan_revisions` | shared `id`; `plan_id uuid`; `actor_id uuid`; `version integer`; `change_summary jsonb`; `reason text`; `created_at timestamptz` | FKs plan/actor; UQ `(plan_id,version)`; append-only attribution/history |
| `assessments` | shared `id`; `creator_id uuid`; `subject_id uuid`; `title text`; `purpose text enum[diagnostic,pre_session,post_session,milestone_check]`; `instructions text`; `publication_state text`; `version integer` | FKs creator/subject; pin assigned assessment versions; public definitions exclude private scoring keys |
| `assessment_items` | shared `id`; `assessment_id uuid`; `sequence integer`; `item_type text enum[multiple_choice,short_answer,tutor_scored]`; `prompt text`; `choices jsonb?`; `max_points numeric(8,2)`; `topic text` | FK assessment; UQ `(assessment_id,sequence)`; positive points; bounded choices; no answer-key column exposed to students |
| `private.assessment_answer_keys` | `item_id uuid`; `scoring_key jsonb`; `updated_at timestamptz` | PK/FK item; private non-exposed schema, no student/anonymous grants; authorized scoring path only |
| `assessment_assignments` | shared `id`; `assessment_id uuid`; `assessment_version integer`; `student_id uuid`; `tutor_id uuid`; `booking_id uuid?`; `milestone_id uuid?`; `due_at timestamptz?`; `state text` | FKs assessment/profile/tutor/booking/milestone; verify authorized tutor–student relationship and link consistency |
| `assessment_attempts` | shared `id`; `assignment_id uuid`; `student_id uuid`; `attempt_number integer`; `answers jsonb`; `objective_score numeric(8,2)?`; `tutor_score numeric(8,2)?`; `status text enum[draft,submitted,awaiting_tutor,scored]`; `submitted_at timestamptz?`; `finalization_key text?` | FKs assessment assignment/profile; UQ `(assignment_id,attempt_number)` and finalization key; bound scores to available points; owner drafts, authorized tutor scoring |
| `assignments` | shared `id`; `tutor_id uuid`; `student_id uuid`; `subject_id uuid`; `topic text`; `title text`; `instructions text`; `due_at timestamptz`; `assignment_type text enum[homework,quiz,reading,text_response,file_submission]`; `submission_type text enum[text,link,file]`; `booking_id uuid?`; `milestone_id uuid?`; `state text enum[draft,assigned,in_progress,submitted,returned,completed,cancelled]` | FKs tutor/profile/subject/booking/milestone; explicit relationship/ownership checks; overdue is a derived flag, not a contradictory state enum |
| `assignment_submissions` | shared `id`; `assignment_id uuid`; `student_id uuid`; `attempt_number integer`; `response_text text?`; `response_url text?`; `storage_path text?`; `mime_type text?`; `size_bytes bigint?`; `submitted_at timestamptz?`; `late boolean`; `state text`; `finalization_key text?` | FKs assignment/profile; UQ `(assignment_id,attempt_number)`/finalization key; permitted submission type and authenticated storage ownership verified |
| `assignment_feedback` | shared `id`; `submission_id uuid`; `tutor_id uuid`; `feedback text`; `score numeric(8,2)?`; `completion_state text`; `edited_at timestamptz` | UQ submission; FKs submission/tutor; only authorized tutor edits; audited edits |
| `mastery_observations` | shared `id`; `student_id uuid`; `subject_id uuid`; `topic text`; `level text enum[needs_work,improving,confident]`; `assessment_attempt_id uuid?`; `assignment_feedback_id uuid?`; `session_recap_id uuid?`; `recorded_by uuid`; `observed_at timestamptz`; `note text?`; `created_at timestamptz` | FKs student/subject/actor and evidence tables; require one concrete evidence FK for evidence-derived observations; human observation may use explicit note; append-only provenance |
| `ranking_configurations` | shared `id`; `version integer`; `weights jsonb`; `active boolean`; `created_by uuid`; `created_at timestamptz` | UQ version; FK actor; bounded validated weights; immutable used versions |
| `match_requests` | shared `id`; `student_id uuid`; `criteria jsonb`; `configuration_id uuid`; `created_at timestamptz` | FKs profile/configuration; minimized owner-private intake; no protected attributes |
| `match_results` | shared `id`; `request_id uuid`; `tutor_id uuid`; `eligible boolean`; `score_components jsonb`; `rank integer?`; `explanation_snapshot jsonb`; `created_at timestamptz` | FKs request/tutor; UQ `(request_id,tutor_id)`; rank only eligible candidates; reasons derived from stored facts |
| `reviews` | shared `id`; `booking_id uuid`; `student_id uuid`; `tutor_id uuid`; `rating smallint`; `body text?`; `recommendation boolean`; `moderation_state text enum[pending,approved,hidden]` | UQ booking; FKs booking/profile/tutor; rating 1–5; owning student + completed eligible booking; approved-only aggregate |
| `badges` | shared `id`; `name text`; `slug text`; `criteria jsonb`; `active boolean` | UQ slug; auditable criteria, no implication of credential verification |
| `user_badges` | `tutor_id uuid`; `badge_id uuid`; `source_snapshot jsonb`; `awarded_at timestamptz` | Composite PK; FKs tutor/badge; one explainable award per badge/tutor |
| `resources` | shared `id`; `subject_id uuid`; `title text`; `resource_type text`; `url text?`; `storage_path text?`; `description text`; `attribution text`; `active boolean`; `owner_id uuid` | FKs subject/owner; approved source catalog; validate at least one safe resource location |
| `resource_links` | shared `id`; `resource_id uuid`; `recap_id uuid?`; `milestone_id uuid?`; `assignment_id uuid?` | FKs resource and linked targets; exactly one target set; avoids unconstrained polymorphic learning links |
| `notification_preferences` | `user_id uuid`; `category text`; `email_enabled boolean`; `updated_at timestamptz` | Composite PK; FK profile; required security/transaction notices cannot be muted |
| `notifications` | shared `id`; `user_id uuid`; `category text`; `title text`; `body text`; `target_path text`; `event_key text`; `read_at timestamptz?` | FK profile; UQ `(user_id,event_key)`; internal safe paths; owner read/read-state update |
| `notification_deliveries` | shared `id`; `notification_id uuid`; `channel text`; `state text`; `attempt_count integer`; `next_attempt_at timestamptz?`; `provider_reference text?` | FK notification; UQ `(notification_id,channel)`; idempotent retry; in-app availability independent of email success |
| `reports` | shared `id`; `reporter_id uuid`; `target_user_id uuid?`; `target_review_id uuid?`; `reason text`; `state text enum[open,reviewing,resolved,dismissed]`; `resolved_by uuid?`; `resolved_at timestamptz?` | FKs reporter/user/review/resolver; exactly one target; authorized admin resolution + audit |
| `blocks` | `blocker_id uuid`; `blocked_id uuid`; `created_at timestamptz` | Composite PK; both FKs profiles; prohibit self-block; private safety relationship |
| `ai_request_records` | shared `id`; `user_id uuid`; `purpose text`; `usage_units integer?`; `outcome text`; `provider_reference text?`; `created_at timestamptz` | FK profile; minimal quota/operation metadata; optional content history requires separate retention/privacy decision |

The added link/history/private tables are implementation-oriented refinements. Keep product requirements stable; have the team approve the schema refinement before writing migrations. Do not store derived progress as user-editable authoritative facts or arrays of unvalidated external IDs.

## Main relationships for the ERD

- Identity 1 → 1 provisioned profile; profile 1 → many role rows; profile 1 → 0/1 tutor profile.
- Tutor profiles many ↔ many subjects through tutor_subjects; each tutor has many availability rules/exceptions.
- Student profile 1 → many bookings; tutor profile 1 → many bookings; subject 1 → many bookings.
- Booking 1 → 0/1 private-detail row; booking 1 → many events; booking 1 → 0/1 canonical payment; payment 1 → many provider events/refunds/payout references.
- Booking 1 → 0/1 recap, 1 → many goals, and 1 → 0/1 owning-student reflection; booking 1 → 0/1 review.
- Student 1 → many goals; goal 1 → 0/1 current plan; plan 1 → many milestones/revisions.
- Assessment 1 → many items; item 1 → 0/1 private key; assessment 1 → many assignments; assignment 1 → many attempts.
- Practice assignment 1 → many submissions; submission 1 → 0/1 feedback; evidence rows link to mastery observations.
- Match request 1 → many results; configuration 1 → many requests; tutor 1 → many results.
- User 1 → many notifications; notification 1 → many delivery attempts represented by per-channel tracking state.

## Integrity, indexes, and RLS

| Concern | Database/application protection | Required test |
| --- | --- | --- |
| Identity/profile provisioning | Unique identity FK; trusted transactional trigger or tested recovery | New user has exactly one profile; failure is visible/recoverable |
| Roles/status | Protected role grants; current active status checked in sensitive operations and policies | Self-admin role write denied; inactive identity cannot bypass using old JWT |
| Tutor publication | Service validates subject, rate, modes, timezone and availability; enforce equivalent write restrictions | Incomplete tutor cannot become publicly visible via direct API write |
| Booking overlaps | Active-status tutor/time exclusion constraint; reviewed scheduling locks; valid intervals | Two simultaneous contenders: exactly one successful reservation |
| Time/money validity | CHECK constraints and integer money snapshots | Reversed interval, negative money and invalid state denied |
| Payment/review duplication | Unique provider IDs, canonical booking/payment, one review/booking | Retry produces no duplicate canonical row/charge/review |
| Private data | RLS and explicit safe projections; private schema for answer keys | Stranger cannot read profile/booking/learning; student cannot get keys |
| Financial retention | Restrict cascades and deactivate rather than delete | Account deactivation preserves payment/refund/audit evidence |

Index FKs and common filters: tutor/date/status bookings, student upcoming bookings, tutor publication/subject, assignment owner/status/due, evidence student/topic/date, notification user/read/date, and geography with GiST when enabled. Migration review must check query plans rather than adding indexes indiscriminately.

RLS matrix: anonymous reads active subjects and explicitly published public tutor data only; Student reads/edits own permitted profile/work and own bookings; Tutor edits own tutor/availability and authorized student work; Administrator performs narrow audited account/moderation operations. Provider webhook state is not browser-writable. Owner profile updates cannot change `account_status`, adult attestation history, roles, or computed publication/financial fields through mass assignment.

## Migration/runbook acceptance

1. Use migration filenames ordered by identity/profile/roles/catalog → tutor/availability → booking → payment/audit boundaries. Include extensions, checks, indexes, grants, RLS and reviewed helper-function privileges in the scripts.
2. Bootstrap identities through supported Auth APIs or local tools; do not insert passwords into application SQL. Supply deterministic subjects/tutors/availability/booking fixtures with documented seed rules.
3. Replay on a new local or disposable test environment, rerun seed safely, verify counts/FKs and allowed/denied operations, then capture schema/relationship evidence.
4. Document actual commands and environment versions in Section 7. A schema dictionary alone does not satisfy the assignment's SQL/database implementation requirement.
