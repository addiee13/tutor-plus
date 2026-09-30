# Sprint 2 traceability and evidence register

Prepared September 30, 2026. This is **specification coverage and an evidence request register**, not proof of implementation, test passes, client approval or a grade. UC/REQ/S2/CR IDs retain existing draft/planning meaning. Diagram/evidence identifiers below are stable handoff labels for these drafts; reconcile actual artifact names without renumbering the use cases. Formal requirement Test cases remain TBD for next sprint. V identifiers are reserved implementation-validation evidence slots, not fabricated formal test cases or passing executions.

## Source-to-use-case-to-requirement coverage

SDD §5.1 catalog numbering differs from the Sprint 2 draft's UC ordering. The explicit mapping prevents accidentally treating SDD feature 5 Payments as draft UC-05 Diagnostic Assessment.

| UC / REQ pair | Name | Exact SDD feature / requirement source | Sprint 2 delivery depth | Task / diagram / validation slot | Current evidence state |
| --- | --- | --- | --- | --- | --- |
| UC-01 / REQ-01 | User Management | Feature 1; §6.1 FR-A01–FR-A06 | Full record; real core UI/logic + database group; distinguish admin subflow coverage | S2-02/04/05/06; UCD-01, CLASS-01; V-01, V-02 | Text specified; runtime/evidence not verified by reader |
| UC-02 / REQ-02 | Student and Tutor Profiles | Feature 2; §6.2 FR-P01–FR-P05; FR-A04 | Full record; identified profile UI/logic subflows + database group; omitted publication subflows disclosed | S2-02/04/05/07; CLASS-01 in report 4.3; V-03 | Text specified; persisted rendered/denial evidence pending review |
| UC-03 / REQ-03 | Tutor Search and Discovery | Feature 3; §6.3 FR-S01–FR-S06 | Full record + use-case diagram; UI not inferred | S2-02/04; UCD-02; V-04 | Specification only unless later builder evidence is recorded |
| UC-04 / REQ-04 | Availability and Session Booking | Feature 4; §6.4 FR-B01–FR-B07; §§13.1–13.3 | Full record + database group + mission-required class design; supplementary reservation UI/SQL persistence underway, not full booking/payment completion | S2-03/04/05; UCD-03, CLASS-02, ACT-01, ERD-01; V-05 | User reports worker underway; actual persistence/denial evidence pending; Stripe confirmation deferred |
| UC-05 / REQ-05 | Diagnostic Assessment | Feature 11; §6.8 FR-DA01–FR-DA07 | Full record; learning runtime deferred | S2-02/04; V-06 | Specification only |
| UC-06 / REQ-06 | Payment and Refund Processing | Feature 5; §6.5 FR-PAY01–FR-PAY06 | Full record + database group; real charge/refund/payout not inferred | S2-04/05; UCD-04, ACT-01, ERD-01; V-07 | Schema/provider outcomes require distinct evidence |
| UC-07 / REQ-07 | Reviews and Ratings | Feature 6; §6.6 FR-R01–FR-R05 | Full record; runtime deferred | S2-02/04; V-08 | Specification only |
| UC-08 / REQ-08 | Practice Tasks and Assignments | Feature 12; §6.9 FR-AS01–FR-AS06; §§14.2–14.3 | Full record; runtime deferred | S2-02/04; V-09 | Specification only; no chat or contradictory overdue state |
| UC-09 / REQ-09 | Session Planner and Recap | Feature 7; §6.7 FR-PL01–FR-PL05 | Full record; runtime deferred; external/in-person teaching distinguished | S2-02/04; ACT-01; V-10 | Specification only; no native video or claimed lesson execution |
| UC-10 / REQ-10 | Notifications and Reminders | Feature 9; §6.14 FR-N01–FR-N02; FR-B07 | Full record; delivery runtime deferred except real Auth verification path required by UC-01 | S2-02/04; V-11 | Notice intent/provider acceptance/inbox receipt remain distinct |

## Next-sprint backlog and client candidates

These are five reserved IDs, not additional detailed Sprint 2 records. The semester baseline still includes all fifteen features.

| Reserved pair | Feature name | Exact SDD trace | Client requirement/evidence |
| --- | --- | --- | --- |
| UC-11 / REQ-11 | AI Learning Assistant and Curated Resources | Feature 8; §6.12 FR-AI01–FR-AI06 | Baseline; no independent new client approval asserted |
| UC-12 / REQ-12 | Administration and Platform Safety | Feature 10; §6.14 FR-AD01–FR-AD03 | Baseline; limited UC-01 account management is not full console completion |
| UC-13 / REQ-13 | Personalized Study Plans and Milestones | Feature 13; §6.10 FR-SP01–FR-SP06 | CR-01 Group 8 candidate/unconfirmed; representative/date/wording/acknowledgement pending |
| UC-14 / REQ-14 | Learning Progress Tracker | Feature 14; §6.11 FR-PR01–FR-PR06 | CR-02 Group 8 candidate/unconfirmed; evidence pending |
| UC-15 / REQ-15 | Explainable Smart Tutor Matching | Feature 15; §6.13 FR-MT01–FR-MT06 | CR-03 Group 8 candidate/unconfirmed; evidence pending |

## Four database groups — design is not replay evidence

| Use case | Planned group from architecture dictionary | Evidence required for implementation claim |
| --- | --- | --- |
| UC-01 | Provider-managed `auth.users`; application `profiles`, `user_roles`, audited privileged mutations in `audit_logs` | Actual migration/provisioning/role policies; registered identity plus linked profile/permitted capabilities; unauthorized grant denial; no duplicate password store |
| UC-02 | `profiles`, `tutor_profiles`, `subjects`, `tutor_subjects`, deliberately safe public projection and availability readiness dependency | Actual types/keys/owner/version rules; real save/read-back and wrong-user denial; draft/publication readiness and public-field inspection |
| UC-04 | `availability_rules`, `availability_exceptions`, `bookings`, `booking_private_details`, `booking_events`, actor/subject references | Clean replay; valid/invalid interval checks, concurrent overlap rejection, participant policy and private-meeting denial; booking state/event invariants |
| UC-06 | `payments`, `payment_events`, `refunds`, `payout_refs` and booking references | Actual integer money/currency/uniqueness/refund-bound constraints; deduplication and participant/private-finance checks; separate state tables. Provider-signed runtime proof is additionally needed only for claimed processed charges/refunds/payouts |

Record actual migration names/version and any justified refinement against the dictionary. SDD appendix uses `admin` and `deactivated/suspended` while the earlier architecture uses `administrator` and `inactive`; explicitly document the chosen vocabulary/mapping and denial semantics in actual schema/report. A renamed enum does not justify losing a required access restriction or silently rewriting source evidence. Four groups mean all dependencies, not four isolated tables; types, PK/FK/cardinality, constraints, RLS/grants and replay must match actual SQL.

## Model and report locations

| Label | Required artifact | Report location | Review required |
| --- | --- | --- | --- |
| CTX-01 | Main lecture system-only external context | 1.5.1 | Physical modeling p16/pp15–17; only external systems around Tutor Plus; no human-as-system stereotypes/internal-module peers |
| CTX-02 | Separate mission stakeholder companion | 1.5.1 | Actual human roles with labeled interactions; clearly distinct from CTX-01 |
| ACT-01 | Booking and learning activity | 1.5.2; reference in 5.0 | Physical activity pp3–6; correct lanes/guards/retry/abandonment/fork-join where valid; no false payment/mail success or claim later scope implemented |
| UCD-01 | UC-01 User Management diagram | 2.3 | Actors/ovals/system boundary; trusted admin role; valid include/extend |
| UCD-02 | UC-03 Discovery diagram | 2.3 | Filters/public boundary; matching stays separate UC-15; useful valid relationships |
| UCD-03 | UC-04 Booking diagram | 2.3 | Availability/transactional booking/policy relationships; confirmation requires authoritative payment |
| UCD-04 | UC-06 Payment/refund diagram | 2.3 | Stripe external actor; conditional refund vs required payment subflow, with valid relationship direction |
| ERD-01 | Four-group relationships and key design | 3.1 | Actual PK/FK/cardinality/types, role association, private and provider-managed boundaries |
| CLASS-01 | UC-01 plus UC-02 implemented responsibilities | 4.1 and 4.3 | Class compartments, operations/dependencies and composition/multiplicities match code; no mutually exclusive role inheritance |
| CLASS-02 | Mission-required UC-04 booking class design | 4.2 | Availability rule/exception, booking/participants/state, service/financial dependency; design not booking-UI evidence |

These labels do not assert artifacts already exist under those filenames. Preserve actual editable sources and reviewed exports; map filename differences to the label in the final evidence manifest. All figures need complete visual inspection at final report scale, not only textual/XML checks.

## Implementation-validation evidence slots

Formal Test cases remain TBD. These are requested verification topics, with **no passing result or actual command invented**. Deferred runtime slots do not force unselected features into this sprint, but a claim of implementation needs their real evidence.

| Slot | Topic | Required observable end state | Result / evidence path |
| --- | --- | --- | --- |
| V-01 | UC-01 real identity/session flow | Actual registration, verification-channel result, login, refresh/reload, logout and protected recovery; known configured token scope/lifetime | Pending actual command/log/screen review |
| V-02 | Current roles/status/security | Student/Tutor permissions and role combinations; non-admin escalation/wrong-user denied; inactive/removed-role behavior and audited admin changes where claimed | Pending |
| V-03 | UC-02 persistence/privacy | Owned profile save read back after reload; bad input/stale save safe; wrong-user denied; draft/readiness/public DTO proven for claimed subset | Pending |
| V-04 | UC-03 search | Bounded eligible results/empty state, manual location/denial route, safe public fields; no silent hard-filter removal | Deferred unless claimed implemented |
| V-05 | UC-04 database integrity | Migration/seed replay, FKs/interval/money validation, concurrent second claim rejected, permitted transitions/private participant scope | Required for Sprint 2 DB group; actual results pending |
| V-06 | UC-05 learning evidence | Private keys, owned/assigned access, objective vs pending subjective score, duplicate-safe finalization | Deferred |
| V-07 | UC-06 financial integrity | Replay/constraints, one payment/event uniqueness, refund bounds/access and independent states; verified provider events additionally for any runtime claim | Required database subset; actual results pending |
| V-08 | UC-07 verified reputation | One eligible completed-booking Student review; server-approved aggregates and audited moderation | Deferred |
| V-09 | UC-08 work lifecycle | Owned draft/submission/return/completion; visible lateness; protected file/feedback access and dated evidence | Deferred |
| V-10 | UC-09 shared/private workspace | Participant-only goals/recap; owner-only reflection; dated provenance, pending state truthful | Deferred |
| V-11 | UC-10 notices | Authorized deduplicated feed/preferences; real queue/failure/delivery distinction; stale reminders removed | Deferred except UC-01 actual verification channel |
| V-12 | Fresh non-IDE reproduction | Actual dependency/config prerequisites, clean DB replay, terminal build/start, frontend-to-DB read/write and actual desktop/mobile navigation | Required; logs/screenshots pending |
| V-13 | GitHub and PDF/submission | Verified repo/board links and all implemented pages; inspected numbered PDF/TOC; each real receipt and coordinator print | Required; receipt/print status future/unverified |

## Draft outputs and unresolved gates

- Authored report-ready text: `../sprint2/USE_CASES.md`, `REQUIREMENTS.md`, `PROBLEM_STATEMENT.md`, `REPORT_OUTLINE.md`, `REPORT_CHECKLIST.md`; current scheduling addendum: `SPRINT2_EXECUTION.md`; this trace register. Only strict content/ID/source review is completed by this role.
- Mission exact wording/weights, Group 8 approvals, member task acceptance, class start time, actual repository/project URLs, runtime/model evidence, complete page screenshots and final PDF/receipts must be recorded when obtained. GitHub authentication/repository creation and local Supabase attempts reported by user are not substitutes.
- Report internal validators are structural estimates/checks, not grades. Sprint 1 95/100 and 2-/3-point deductions are user-provided; no instructor grading artifact is independently verified.
- If another role supplies code/test/render evidence after this snapshot, add its real date/command/path/result and review outcome; do not infer results from these planned slots or the old Sprint 2 PDF's completion claims.
- User reports core graph/ERD sources built and admin/metadata drift being fixed. Map actual sources/exports and rerun results before marking their independent review complete; a validator estimate is never an actual grade.
