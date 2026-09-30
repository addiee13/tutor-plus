# Frontend and logic class design

Section 7 implementation design, with a report location under Sprint 1's **4.0 CLASS DIAGRAM**. Status: specification only; no class diagram export or implementation exists yet.

Selected UI/logic use cases: **UC-01 User Management** and **UC-02 Manage Student and Tutor Profiles**. See `SPRINT2_PLAN.md` for why these replace the existing draft's suggested user-management/booking pair.

## UC-01 responsibilities

| Class / responsibility box | State / attributes | Operations / responsibilities |
| --- | --- | --- |
| `ActorContext` | user ID, verified email state, active account state, current role capabilities | Immutable request-scoped authority for service calls |
| `UserProfile` | ID, display name, timezone, preferences, status, adult attestation | Represent application profile; exclude password/token data |
| `RoleGrant` | user ID, role, grantor, created time | Represent permitted capability assignment |
| `AuthService` | Auth adapter, provisioning boundary, role lookup | Register, verify actor, login, logout, request reset, resolve permitted destination |
| `AuthProvider` | Managed-provider configuration, no public secrets | Sign up/sign in/sign out/refresh according to supported Supabase contract |
| `ProfileProvisioningService` | Reviewed trigger/recovery contract | Create one application profile and validate allowed initial role intent |
| `AuthorizationService` | Current role/status lookup | Require active user, required capability and resource authority |
| Registration/Login views | Form state, pending/error/success state | Collect inputs, show accessible validation, invoke server operation, navigate only on authoritative result |

Relationships: UserProfile 1 → many RoleGrant; AuthService depends on AuthProvider, provisioning and authorization; views invoke server-bound AuthService operations; ActorContext is passed to services, not supplied by an editable browser field.

**Use composition, not Student/Tutor/Admin inheritance.** SDD allows one account to have both Student and Tutor capabilities. Inheriting mutually exclusive user subclasses would misrepresent that model. RoleGrant is an association, not a password-bearing subclass.

## UC-02 responsibilities

| Class / responsibility box | State / attributes | Operations / responsibilities |
| --- | --- | --- |
| `TutorProfile` | tutor ID/user ID, public identity snapshot, headline, bio, rates/modes, publication state/version | Represent tutor-specific data and readiness state |
| `Subject` / `TutorSubject` | Subject taxonomy; tutor/subject/expertise relation | Represent many-to-many teaching capabilities |
| `ProfileService` | Authorization, validation, persistence, readiness dependency | Load own profile, edit permitted fields, save private preferences, save tutor draft, request publish |
| `PublicationPolicy` | Required profile/subject/rate/mode/availability facts | Return explicit readiness failures or authorize public snapshot update |
| `ProfileRepository` | User-scoped database boundary | Read/update permitted fields, persist optimistic version changes, return safe private DTO |
| `PublicTutorProjection` | Tutor-approved public fields only | Expose published information without private account/contact/location/learning data |
| Profile editor view | Input state, validation errors, saved version/readiness messages | Show persisted values, edit/save, keep input on failure, reload authoritative state |

Relationships: UserProfile 1 → 0/1 TutorProfile; TutorProfile many ↔ many Subject through TutorSubject; ProfileService uses AuthorizationService, ProfileRepository and PublicationPolicy; publication policy queries valid availability through a narrow readiness interface. Availability belongs to its domain and is not reimplemented in the profile form.

## Interaction sequences

Registration: visitor enters name/email/password/18+ confirmation/role intent → server validates → managed Auth provisions identity → trusted provisioning creates application profile/allowed capability → verification state shown → verified login resolves actor → role-aware dashboard. Invalid/duplicate/provider failures return safe field/general errors without leaking credentials. Do not draw the Auth API + later profile write as atomic unless the selected implementation guarantees it.

Profile edit: authenticated actor opens editor → service checks own ID/current status → repository returns safe DTO → actor edits → server validates permitted fields → update persists with version check → UI shows canonical saved result → reload reproduces value. Other-user edits and role/status mass assignment are denied. Tutor can save an incomplete draft but cannot publish until readiness succeeds.

## Diagram specification

- UML class boxes have compartments for name, attributes with types, and relevant operations.
- Show multiplicities and named associations for profile/role/tutor/subject relationships. Use dashed dependencies for service/provider use; reserve inheritance for genuine substitutable types, not roles.
- Label boundary, domain, and infrastructure responsibilities consistently. Explain DTOs as data projections, not additional identity stores.
- Produce one readable class figure covering both use cases, or two clearly labeled figures if a single page becomes crowded. Preserve editable `.drawio` source plus a high-resolution export; inspect at final report print scale.
- Trace classes to UC-01/REQ-01 and UC-02/REQ-02 and identify the implemented subset when code is eventually added.

Model completion gate: attributes/operations, associations, multiplicities, no contradictory role inheritance, no provider secrets, readable export. Implementation completion is a separate gate requiring real code, database communication and tests.
