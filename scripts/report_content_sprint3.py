"""Sprint 3 report content: prose, refined use cases/requirements, planning tables, table purposes, class table.

Reused by scripts/build_report_sprint3.py. Sprint 2 wording comes from report_content.py and is refined here;
every Sprint 3 change is marked "(Refined in Sprint 3)" in the text.
"""
from __future__ import annotations

import copy

from report_content import BACKLOG, CLIENT_REQUIREMENTS, REQUIREMENTS as S2_REQUIREMENTS, USE_CASES as S2_USE_CASES

R = "(Refined in Sprint 3) "

TEXT = {
    "teamwork": [
        "We use Discord and iMessage for communication and meetings, and everyone checks the group chat often for progress and questions.",
        "Edu M. Okpok is the Sprint 3 coordinator. Shadmaan Akhand coordinated Sprint 1 and Adam Dalwai coordinated Sprint 2. The coordinator keeps the task board current and assembles the report.",
        "Internal deadlines are set two days before the class deadline so that every section can be reviewed.",
        "Each task is assigned according to the member's strengths and recorded as a card on the GitHub project board (To Do, In Progress, Done).",
        "Every deliverable is reviewed by another member before it is merged or submitted, and a task moves to Done only when the work exists and has been checked.",
        "Decisions, progress, and changes are documented in the repository so that nothing is lost between meetings.",
        "Missed deadlines or incomplete tasks are raised immediately, and disagreements are resolved by returning to the requirements and agreeing on the best solution.",
    ],
    "problem": [
        "Tutor Plus is a responsive web application that connects adult students (18 and older) with qualified tutors for virtual and in-person sessions. It is not only a tutor directory: it supports the whole tutoring cycle. Students find a tutor, reserve a time, pay, prepare for the session, complete diagnostic assessments and practice work, receive feedback, and review their progress. Independent tutors manage their profile, availability, sessions, assignments, and students in one place. Administrators manage accounts, roles, and reported content through role-based access.",
        "The problem Tutor Plus addresses is the fragmented tutoring process. Today a student may use one service to find a tutor, another to schedule and pay, separate documents for goals and assignments, and other tools to track progress. Because these records are separate, it is hard to keep a consistent picture of a student's goals, weaknesses, completed work, tutor feedback, and improvement over time. Existing alternatives such as Wyzant, Preply, Khanmigo, tutoring centers, and combinations of general tools cover parts of this experience, but none of them connects tutor discovery and booking directly to the student's continuing learning record.",
        "Tutor Plus connects each booked session to the learning work around it. Before a session the student records goals and questions and the tutor adds an agenda in a shared session plan. After the session the tutor publishes a recap with mastery notes and next steps, and the student can keep a private reflection that the tutor never sees. Diagnostic assessments show where a student needs help, practice assignments carry the work forward, and verified reviews from completed sessions build a trustworthy tutor reputation. Artificial intelligence is planned as a supporting tool (an AI learning assistant and explainable tutor matching) and never replaces the tutor's or the student's decisions.",
        "The system is a Next.js and TypeScript modular monolith hosted on Vercel, with Supabase PostgreSQL for data and Supabase Auth for identity. Row-level security and server-side checks ensure that users only see and change data they are allowed to. Payments will use Stripe in test mode, where a booking counts as paid only after a verified provider event. Guardian accounts, peer tutoring, built-in video, and direct chat are outside the project scope.",
        "**Progress in Sprint 3.** Sprint 2 delivered user management, profile editing, and session reservation on a database for UC-01, UC-02, UC-04, and UC-06. In Sprint 3 the team added the database tables for four more use cases (UC-05 Diagnostic Assessment, UC-07 Reviews and Ratings, UC-08 Practice Tasks and Assignment Management, and UC-09 Session Planner and Recap) as versioned SQL migrations, and implemented the frontend and logic for UC-09 Session Planner and Recap and UC-07 Reviews and Ratings. The team also produced the class diagram and two UML sequence diagrams (UC-04 booking and UC-09 session planning) and used them to refine the use cases and the classes.",
        "The main technical challenges are preventing double bookings under concurrent requests, handling tutor availability across time zones, enforcing role-based and participant-only access to private learning records, keeping payment state truthful, and connecting assessments, assignments, recaps, and reviews into a long-term record of progress.",
    ],
    "context": [
        "Figure {F:context} shows Tutor Plus as one system at the center of its environment, using the lecture notation: each external entity is a box marked «system» or «user», and each labeled connecting line names the data that flows between Tutor Plus and that entity. Students, Tutors, and Administrators use the web application. Tutor Plus sends sign-up, sign-in, and session checks to Supabase Auth, and reads and writes all application data in Supabase PostgreSQL through user-scoped queries protected by row-level security. Stripe (test mode) will receive checkout and refund requests, an email delivery system sends verification links and reminders, a geocoding system turns a city or ZIP code into an approximate location, and the OpenAI API is planned for the AI learning assistant in a later sprint.",
    ],
    "context_subsystems": [
        "Figure {F:subsystems} shows how the ten detailed use cases are grouped into six subsystems around the central application: User and Profile Management (UC-01, UC-02), Tutor Search and Discovery (UC-03), Scheduling, Booking and Session Planner (UC-04, UC-09), Payment and Refund (UC-06), Learning and Feedback (UC-05, UC-07, UC-08), and Notification (UC-10). The subsystems share one database and one authorization model rather than separate services.",
    ],
    "activity_intro": [
        "Figures {F:activity} and {F:activity2} form one swimlane activity diagram of the core journey: a Student books, attends, and reviews a tutoring session. It follows the lecture notation: a filled initial node, rounded action nodes, diamond decision nodes with guards in square brackets, merge nodes where alternative paths rejoin, fork and join bars for parallel work, and a final node. The diagram is drawn in two parts so that it stays readable; the connector (A) at the end of part 1 continues at connector (A) at the start of part 2. The four lanes are the Student, the Tutor Plus system, Stripe in test mode, and the Tutor. Each lane is explained once below.",
    ],
    "activity_lanes": [
        ("Student.", "Signs in and searches for tutors, then chooses a tutor, subject, mode, and time slot. If the slot was just taken, the Student returns to choose another time. After the booking is created, the Student reviews the summary, confirms checkout, and retries if the payment is declined. Once the booking is confirmed, the Student adds goals and questions to the session plan, attends the session, may write a private reflection (a decision with the guards [yes] and [no] that merge again), and finally rates the session from 1 to 5 with a comment."),
        ("Tutor Plus.", "Returns published tutors and open slots, rechecks availability, and reserves the slot atomically, because the database refuses overlapping bookings. It creates a payment-pending booking with a 15-minute hold, receives the payment result, verifies the signed event, and confirms the booking. It saves the shared session plan, marks the booking completed after the session, saves the recap, checks that a review comes from the Student of a completed booking, saves exactly one review, and updates the tutor rating summary."),
        ("Stripe (test mode).", "Processes the test payment so that card data never reaches Tutor Plus, and sends a signed payment event. A declined payment loops back to the Student's checkout."),
        ("Tutor.", "Adds an agenda to the session plan in parallel with the Student's goals (fork and join), hosts the session in parallel with the Student attending it, and publishes the recap with mastery notes and next steps."),
    ],
    "usecase_intro": [
        "The ten detailed use cases below keep the Sprint 2 template (number, name, actors, description, main flow, alternate path, exception path, pre-condition, and post-condition) and the stable IDs UC-01 to UC-10. Refinements discovered while drawing the sequence diagrams and implementing UC-07 and UC-09 are marked **(Refined in Sprint 3)** in the affected fields. UC-11 to UC-15 remain in the next-sprint backlog.",
    ],
    "requirements_intro": [
        "Each requirement is paired with the use case of the same number and follows the lecture template (requirement number, use case number, introduction, inputs, requirement description, and outputs). Sprint 3 changes are marked **(Refined in Sprint 3)**.",
    ],
    "usecase_diagrams_intro": [
        "Figure {F:uc_overall} is the overall use case diagram. It shows the Tutor Plus system boundary, the human actors outside it (Student, Tutor, and Administrator), the external system actors (Stripe and the email service), and an association from each actor to the use cases it takes part in. Figures {F:uc01} to {F:uc10} show each use case in detail. Each diagram draws the system boundary, the actors, solid association lines, «include» relationships that point from the base use case to a required sub-behavior, and «extend» relationships that point from the optional behavior to the use case it extends, labeled with the condition in square brackets. Where it keeps a diagram clearer, Student, Tutor, and Administrator specialize a common Registered user actor, shown with a hollow-triangle generalization.",
    ],
    "db_intro": [
        "**Database management system.** Tutor Plus uses PostgreSQL 15, hosted by Supabase, as its database management system. PostgreSQL is a relational database with strong support for keys, check constraints, triggers, row-level security, and range exclusion constraints, so business rules such as \"no overlapping bookings\" or \"one review per completed booking\" are enforced inside the database and not only in the user interface. Supabase Auth stores login accounts in its managed auth.users table, and every application profile uses the same id. All timestamps are stored in UTC (timestamptz), time zones as IANA names, and money as whole cents (minor units).",
        "The schema is defined only by versioned migration files in supabase/migrations. Sprint 2 created the tables for UC-01, UC-02, UC-04, and UC-06. Sprint 3 adds two migrations: one for UC-09 and UC-07 (session plans, recaps, private reflections, reviews, and tutor rating summaries) and one for UC-05 and UC-08 (assessments, questions, private answer keys, attempts, assignments, submissions, and feedback). Every exposed table has row-level security enabled and least-privilege grants, and writes go through checked database functions. The database now has {total} tables: {public} in the public schema and {private} private control tables.",
    ],
    "db_erd": [
        "Figures {F:erd1} and {F:erd2} give an overview of all implemented tables and their foreign-key relationships in crow's-foot notation: a bar means exactly one, a circle means zero, and a crow's foot means many. The overview shows keys and foreign keys only; the full attribute list of each table is given in the per-group diagrams and the dictionary that follow. Part 2 repeats the Sprint 2 tables that the new tables reference, showing only their keys.",
    ],
    "db_dictionary_intro": [
        "For each use-case group, a diagram shows its tables with every attribute and type. It is followed by each table's purpose, an attribute table (type, key, and constraints taken from the migration SQL), and its relationships with multiplicity. Groups and tables that are new in Sprint 3 are marked **(new in Sprint 3)**.",
    ],
    "class_intro": [
        "The class diagram models Tutor Plus at two levels. The domain classes (Figures {F:cls1} to {F:cls3}) are the business concepts stored in the database, with their attributes and types, operations, associations, association names, and multiplicities. The application classes (Figures {F:cls4} to {F:cls6}) are the classes the code actually uses for the booking, session planner, and review flows: boundary pages and forms, control server actions, domain services, policies, validation, the Supabase user-scoped client adapter, and the PostgreSQL functions. Their names and operations match the source code in src/domains and src/app. The full system class diagram is split into these six figures so that every attribute and operation is readable on the page; classes that appear in more than one figure (for example Profile, TutorProfile, and Booking) are the same class.",
    ],
    "class_explain": [
        "**Explanation.** The Profile class is the center of the model. Each Profile holds one or more UserRole entries (Student, Tutor, Administrator), performs zero or more audited AuditLog actions, and can publish as zero or one TutorProfile. A TutorProfile teaches subjects through the TutorSubject join class (one tutor teaches through zero or more TutorSubject entries, and each Subject is taught in zero or more), and it is composed of AvailabilityRule objects: availability rules cannot exist without their tutor, so that association is a composition (filled diamond). A Booking links exactly one student Profile, one TutorProfile, and one Subject; each Booking is paid by zero or one Payment, and each Payment can be refunded by zero or more Refund records.",
        "The Sprint 3 classes depend on Booking. A Booking is composed of at most one SessionPlan, one SessionRecap, and one SessionReflection; these records have no meaning without their booking, so composition is used. The SessionReflection is owned by the student Profile and is never visible to the tutor. A completed Booking is rated by zero or one Review, which is written by one Profile and received by one TutorProfile, and each TutorProfile is aggregated in zero or one TutorRatingSummary that the database recalculates whenever a review is created or moderated. An Assessment is created by a TutorProfile, tests one Subject, and contains one or more AssessmentQuestion objects (composition); each question is keyed by at most one private AnswerKey, and the assessment is answered in at most one AssessmentAttempt by its student. An Assignment may follow up a Booking, receives zero or more AssignmentSubmission objects, and each submission is reviewed in at most one AssignmentFeedback.",
        "In the application classes every request follows the same layered path. A boundary page or form posts to a control class (a Next.js server action), which creates a user-scoped UserClient («create» dependency) and delegates to a service class. The service resolves the Actor through AuthService, checks permission through a policy class, validates input through a validation class, and calls one PostgreSQL function through the UserClient. The SessionWorkspace value aggregates the plan, recap, and (for the student only) the reflection that the page displays. The database repeats the critical checks with row-level security, triggers, and constraints, so a direct API call cannot bypass the application. Errors are raised as DomainError or its specialization InputError (generalization, hollow triangle), and the control class turns them into a user-facing message. Table {T:classes} summarizes every class.",
    ],
    "seq_intro": [
        "The two sequence diagrams model one core use case, UC-04 Book a Tutoring Session, and one major Sprint 3 use case, UC-09 Session Planner and Recap; neither is login, logout, or registration. They follow the UML notation from the lectures: the actor and each lifeline are drawn at the top as objectName : ClassName, using the classes from the class diagram; activation bars show when an object is executing; synchronous calls are solid lines with filled arrowheads; returns are dashed lines with open arrowheads; asynchronous messages have an open arrowhead; a «create» message starts a new lifeline; and combined fragments (alt, opt, loop, par, and break) carry their guard conditions in square brackets. Each diagram is split into parts so that it stays readable on the page, and the message numbers continue from one part to the next.",
    ],
    "seq_uc04": [
        "**Explanation (UC-04).** The Student submits the booking form on the BookingsPage boundary, which calls the requestBookingAction operation of the BookingActions control. The control creates a user-scoped UserClient («create» message) and calls requestBooking on the BookingService. The service first resolves the actor through AuthService.getActor, which reads the verified user, profile, roles, and session start through the client. It then asks BookingPolicy whether the actor is a Student and parses the request. It reads the published tutor; the break fragment shows that if the tutor is not published or does not offer the chosen mode, an InputError is returned and the rest of the interaction is skipped. Otherwise the service reads the tutor's subjects and calls the create_booking database function (part 2). Inside the database the tutor row is locked and the booking window is checked. The opt fragment shows idempotency: if the same request key was already used, for example after a double click, the existing booking id is returned and no second booking is created. The alt fragment shows the two outcomes of the atomic reservation. When the slot is available, a payment-pending booking with a 15-minute hold is inserted, read back, and re-checked by BookingPolicy. When the slot is taken, the exclusion constraint raises error 23P01, which databaseFailure turns into a friendly field message. Finally the control triggers an asynchronous cache refresh (revalidatePath) and returns the result to the page.",
    ],
    "seq_uc09": [
        "**Explanation (UC-09).** In part 1 the Student opens the session workspace. SessionWorkspacePage calls getWorkspace on SessionPlanService, which loads the context: it resolves the actor and reads the booking through the UserClient. Row-level security returns the booking only to its two participants, so the break fragment ends the interaction with a forbidden error for anyone else. SessionPolicy resolves the role (student or tutor), computes the session phase (planning, ended, or completed), and returns the permitted actions. The par fragment shows that the plan, the recap, and the reflection are read in parallel, and the nested opt fragment shows that the private reflection is requested only when the actor is the student.",
        "In part 2 the Student saves goals and questions. The service validates the input, checks the editGoals permission, and calls save_session_goals. The alt fragment shows the database saving the plan while the booking is confirmed or in progress, or refusing it with error 22023 when the planner is closed; the interface additionally offers the form only before the scheduled end time. In part 3, after the scheduled end time, the Tutor marks the session delivered and the booking moves from confirmed through in_progress to completed. The loop fragment shows that the Tutor can publish the recap more than once, and each save increases the recap revision. The opt fragment shows the Student optionally saving a private reflection, which the database stores with the student as owner and which the tutor cannot read.",
    ],
    "seq_refinements": [
        "Drawing the sequence diagrams exposed behaviors that the Sprint 2 use cases and class diagrams did not describe. Table {T:refine} lists each discovery and where it was applied; the refined text appears in Sections 5 and 7.",
    ],
    "impl_db": [
        "The four new use-case table groups are created by two versioned SQL migrations in supabase/migrations, which are the single source of truth for the schema. The same files run unchanged in every environment, so the development, test, and production databases are reproducible from the repository. Each migration runs inside one transaction and creates the tables, keys, check constraints, indexes, guard triggers, row-level-security policies, grants, and the checked database functions that the application calls.",
    ],
    "impl_structure": [
        "The code follows a modular-monolith structure. Routes in src/app only render pages and call server actions; each feature's rules live in src/domains in a service, a policy, a validation, and a types file; and the database adapter lives in src/lib/supabase. This keeps authorization and validation in one place per feature, and the classes in the class diagram map directly onto these files.",
    ],
    "impl_comm": [
        "Every form in the application is a React form that posts to a Next.js server action. The server action creates a Supabase client that carries the signed-in user's access token (never a privileged key), and the domain service calls a PostgreSQL function such as save_session_goals or submit_review through that client. PostgreSQL identifies the user with auth.uid(), applies row-level security, runs the guard triggers, and returns the saved timestamp or id. The page is then rendered again from the database, so what the user sees after a reload is the stored value.",
    ],
}

FRAMEWORKS = [
    ("Languages", "TypeScript (application), SQL and PL/pgSQL (database), CSS Modules (styling)."),
    ("Framework", "Next.js 16 App Router with React server components and server actions."),
    ("Database and authentication", "Supabase: PostgreSQL 15, Supabase Auth, and row-level security, with the PostGIS and btree_gist extensions; @supabase/ssr and @supabase/supabase-js for the user-scoped client."),
    ("Hosting", "Vercel for the web application and Supabase Cloud for the database."),
    ("Tools", "Node.js 22 and npm, Supabase CLI, Git and GitHub (repository, project board, Actions), ESLint, Prettier, Vitest and Playwright, and PlantUML for the diagrams."),
]

CODE_TREE = [
    "src/",
    "  app/                         Next.js routes and server actions",
    "    (protected)/",
    "      bookings/                UC-04 booking page, forms, actions",
    "      sessions/[bookingId]/    UC-09 session workspace page, forms, actions",
    "      reviews/                 UC-07 reviews page, form, actions",
    "      profile/  admin/  dashboard/",
    "    login/  signup/  auth/callback/",
    "  domains/                     business rules, one folder per feature",
    "    auth/       service.ts  policy.ts  validation.ts",
    "    bookings/   service.ts  policy.ts  validation.ts  types.ts",
    "    sessions/   service.ts  policy.ts  validation.ts  types.ts",
    "    reviews/    service.ts  policy.ts  validation.ts  types.ts",
    "    profiles/   service.ts",
    "    shared/     errors.ts  form.ts  postgres.ts",
    "  lib/supabase/                user-scoped Supabase client (server.ts)",
    "supabase/migrations/           versioned SQL migrations (schema source of truth)",
    "tests/                         unit, integration and browser tests",
    "scripts/build.sh               non-IDE install, check and build script",
]

# ---------------------------------------------------------------- use cases (refined copies of Sprint 2)
UC_ORDER = [
    "UC-01", "UC-02", "UC-03", "UC-04", "UC-05", "UC-06", "UC-07", "UC-08", "UC-09", "UC-10",
]


def _refine():
    cases = [list(copy.deepcopy(c)) for c in S2_USE_CASES]
    # UC-04 (index 3): idempotent retry and tutor publication check discovered in the sequence diagram.
    c = cases[3]
    c[3] = c[3][:3] + [
        R + "The system checks that the tutor is published and offers the chosen mode, then reserves the slot in one database transaction that locks the tutor's schedule.",
        "The system saves the booking as payment pending and holds the time for 15 minutes.",
        "The Student can cancel and the time becomes free again.",
    ]
    c[4] = c[4] + " " + R + "If the same request is submitted twice (for example a double click), the system returns the first booking instead of creating a second one."
    c[5] = c[5] + " " + R + "If the tutor is no longer published or does not offer the chosen mode, the request is refused before any reservation is attempted."
    # UC-05 (index 4)
    c = cases[4]
    c[3] = [
        "The Tutor creates an assessment for one of their subjects, adds ordered questions (single choice or short answer), and assigns it to a Student they teach.",
        "The Student opens the assigned assessment, answers the questions, and submits before the due date.",
        "The system scores the single-choice answers against an answer key that the Student can never read.",
        "The Tutor scores the short answers and adds feedback.",
        "The dated result is saved and both users can view it.",
    ]
    c[4] = c[4] + " " + R + "A partial save keeps the attempt in progress; only the final submission locks the answers."
    # UC-07 (index 6)
    c = cases[6]
    c[3] = [
        "The Student opens the Reviews page and sees their completed sessions that can be reviewed.",
        "The Student enters a rating from 1 to 5 and an optional comment and submits.",
        "The system checks that the Student is the student on the booking, that the booking is completed, and that it has no review yet.",
        "The system saves the review and recalculates the Tutor's rating count and average.",
        "The Student sees the saved review, and the Tutor sees the updated rating summary.",
    ]
    c[4] = R + "An Administrator hides or restores a reported review and records a reason; the rating summary is recalculated from visible reviews only. Editing a submitted review within 7 days is deferred: in this release a submitted review is final."
    c[5] = "A Student without a completed booking cannot review. A second review for the same booking is refused by a unique key (error 23505). " + R + "A review cannot be changed after submission, and it cannot be deleted."
    # UC-08 (index 7)
    c = cases[7]
    c[3] = [
        "The Tutor creates an assignment with instructions, a submission type (text, link, or file), and a due date, optionally linked to a booking, and assigns it.",
        "The Student submits a text answer, a link, or one file.",
        "The system checks the due date and the file type and size and saves the submission as a numbered attempt.",
        "The Tutor returns written feedback with an optional score and either completes the assignment or returns it for another attempt.",
        "The Student reads the feedback.",
    ]
    c[5] = R + "A submission after the due date is refused unless the Tutor allowed late work (then it is marked late). A file over 10 MB or of a type other than PDF, PNG, JPEG, or plain text is refused."
    # UC-09 (index 8)
    c = cases[8]
    c[3] = [
        "The Student or Tutor opens the session workspace for their booking; only the two participants can open it.",
        "Before the session ends, the Student adds goals and questions and the Tutor adds an agenda; each sees the other's part.",
        R + "After the scheduled end time, the Tutor marks the session delivered and the booking becomes completed.",
        "The Tutor publishes a recap with a summary, mastery notes, and next steps.",
        "After the session, the Student can write a private reflection that the Tutor cannot see.",
    ]
    c[4] = R + "The Tutor edits and republishes the recap; each save increases its revision number. The Student leaves the reflection empty."
    c[5] = "Only the two people on the booking can open its plan. The private reflection is hidden from the Tutor. " + R + "The plan form is offered only before the scheduled end time of a confirmed booking (the database closes it once the booking is completed or not confirmed), and a recap or reflection cannot be saved before the session ends."
    c[6] = "A confirmed booking exists between the Student and Tutor."
    return [tuple(x) for x in cases]


USE_CASES = _refine()


def _refine_requirements():
    reqs = [list(copy.deepcopy(r)) for r in S2_REQUIREMENTS]
    reqs[3][3] += " " + R + "A repeated request with the same request key shall return the existing booking."
    reqs[4][3] = "The system shall let a Tutor create an assessment only for a subject they teach and assign it only to a Student they teach. The Student shall answer it once, with partial saves allowed until the final submission and no submission after the due date. Single-choice answers shall be scored automatically against an answer key kept in a separate table that Students cannot read, and short answers shall be scored by the Tutor. Dated results shall be stored separately from Tutor feedback. " + R.strip()
    reqs[6][3] = "The system shall accept one review per completed booking, only from the Student on that booking, with a rating from 1 to 5 and a comment of at most 2,000 characters. Submitted reviews shall not be edited or deleted. The system shall keep each Tutor's rating count and average in a summary that the database recalculates from visible reviews, and shall let an Administrator hide or restore a review with a recorded reason. " + R + "The 7-day edit window and 30-day review window are deferred to a later sprint."
    reqs[7][3] = "The system shall allow assignments only between a Tutor and a Student they teach and shall refuse submissions after the due date unless late work is allowed. Each submission shall contain text, a link, or one file of type PDF, PNG, JPEG, or plain text no larger than 10 MB, and is stored as a numbered attempt. Each submission and its feedback shall be kept with its date. " + R.strip()
    reqs[8][3] = "The system shall let only the two people on a booking open its plan. The Student's goals and the Tutor's agenda shall be editable only while the booking is confirmed or in progress; the interface offers them only before the scheduled end time, and aligning the database check with that end time is planned for the next migration. Only the booked Tutor shall mark the session delivered and publish the recap, and only after the scheduled end time; each republish shall increase the recap revision. The Student's private reflection shall be saved only after the session and shall never be shown to the Tutor. " + R.strip()
    return [tuple(x) for x in reqs]


REQUIREMENTS = _refine_requirements()

FEATURES = [
    "User Management", "Manage Student and Tutor Profiles", "Tutor Search and Discovery",
    "Availability Management and Session Booking", "Diagnostic Assessment", "Payment and Refund Processing",
    "Reviews and Ratings", "Practice Tasks and Assignment Management", "Session Planner and Recap",
    "Notifications and Reminders", "AI Learning Assistant and Resource Library (AI feature)",
    "Administration and Platform Safety", "Personalized Study Plan and Milestones (proposed client feature)",
    "Learning Progress Tracker (proposed client feature)",
    "Explainable Smart Tutor Matching (proposed client and AI feature)",
]

USER_REQUIREMENTS = [
    ("Student", "register as an adult, find and book a tutor, prepare goals before a session, read the recap afterwards, keep private reflections, complete assessments and assignments, and rate completed sessions."),
    ("Tutor", "publish a profile with subjects and rates, set availability, add an agenda, mark sessions delivered, publish recaps, create assessments and assignments, give feedback, and see their rating."),
    ("Administrator", "grant and remove roles, activate or deactivate accounts, and hide or restore reported reviews, with every action recorded in the audit log."),
]

SPRINT3_PLAN = [
    ("Edu M. Okpok (Coordinator)", "Eokpok1@student.gsu.edu", "Coordination, planning table, revised problem statement, report assembly", "4 [confirm]", "None", "10/26/26 [confirm]", "100% [confirm]"),
    ("Adam Dalwai", "Adalwai1@student.gsu.edu", "UC-09 and UC-07 frontend and logic, hosting", "8 [confirm]", "Database tables", "10/26/26 [confirm]", "100% [confirm]"),
    ("Shadmaan Akhand", "Sakhand2@student.gsu.edu", "SQL migrations for UC-05, UC-07, UC-08, UC-09; database section", "6 [confirm]", "Class diagram", "10/26/26 [confirm]", "100% [confirm]"),
    ("Kien Duong", "Kduong10@student.gsu.edu", "Class diagram, sequence diagrams (UC-04, UC-09), refinements", "5 [confirm]", "Use cases", "10/26/26 [confirm]", "100% [confirm]"),
    ("Nikhil Rodrigo", "Nrodrigo2@student.gsu.edu", "Context, activity and use case diagrams; use case and requirement revisions; GitHub board and screenshots", "5 [confirm]", "None", "10/26/26 [confirm]", "100% [confirm]"),
]

PLAN_HEADERS = ["Assignee Name", "Email address", "Task", "Duration (hours)", "Dependency", "Due Date", "Evaluation"]

# Verbatim from Adam_Dalwai_Group11_Sprint2.pdf (Section 1.2 and page 10).
SPRINT1_PLAN = [
    ("Shadmaan Akhand (coordinator)", "Sakhand2@student.gsu.edu", "Problem Statement", "1 hours", "None", "9/18/26", "100%"),
    ("Adam Dalwai", "Adalwai1@student.gsu.edu", "Context diagram, activity diagram", "3 hours", "System Architecture", "9/18/26", "100%"),
    ("Edu M. Okpok", "Eokpok1@student.gsu.edu", "Teamwork Basics", "1 hour", "None", "09/18/2026", "100%"),
    ("Kien Duong", "Kduong10@student.gsu.edu", "Final Review and Revision", "1 hour", "Split with Nikhil", "09/18/2026", "100%"),
    ("Nikhil Rodrigo", "Nrodrigo2@student.gsu.edu", "Final Review and Revision", "1 hour", "Split with Kien", "09/18/2026", "100%"),
]
SPRINT2_PLAN = [
    ("Shadmaan Akhand", "Sakhand2@student.gsu.edu", "Requirements, Implementation", "3", "Worked with Adam", "10/05/26", "100%"),
    ("Adam Dalwai (coordinator)", "Adalwai1@student.gsu.edu", "Use Cases, Implementation", "3.5", "Worked with Shadmaan", "10/05/26", "100%"),
    ("Edu M. Okpok", "Eokpok1@student.gsu.edu", "Revised Problem Statement, Use Case Diagrams", "2", "None", "10/05/26", "100%"),
    ("Kien Duong", "Kduong10@student.gsu.edu", "Context and Activity Diagram", "1", "None", "10/05/26", "100%"),
    ("Nikhil Rodrigo", "Nrodrigo2@student.gsu.edu", "Database Management", "1.5", "None", "10/05/26", "100%"),
]

BIOGRAPHIES = [
    ("Shadmaan Akhand", "A computer science student with experience in data engineering and software development. I have experience working with Python, C, SQL, and AWS. Experienced in working with data pipelines and cloud technologies, along with exposure to DevOps tools and practices."),
    ("Adam Asif Dalwai", "A computer science student with hands-on experience in full-stack engineering, cloud systems, and applied AI development. Skilled in Python, TypeScript, and FastAPI, with practical experience building RAG pipelines, vector similarity search using Hugging Face models and Elasticsearch, and deploying containerized backends to GCP with Docker and CI/CD."),
    ("Edu M. Okpok", "Computer science student at GSU with hands-on experience in web content, Agile research, and customer-facing roles across tech, insurance, and retail environments. Multilingual communicator with a background in Python, C, and SQL, and a track record of supporting team operations in fast-paced settings."),
    ("Nikhil Rodrigo", "A computer science student with experience in software development and programming. Has experience working with Java and Python and a foundational understanding of programming concepts, problem solving, and software development. Currently building technical skills through coursework and hands-on software engineering projects."),
    ("Kien Duong", "Computer Science student with hands-on experience in software development and programming. Proficient in C, Python, and MySQL, with experience developing applications and working with databases. Currently exploring Hugging Face models and machine learning technologies, while also learning Unity and game development."),
]

# ---------------------------------------------------------------- database groups and table purposes
DB_GROUPS = [
    ("UC-01 User Management", "uc01", False, ["profiles", "user_roles", "audit_logs", "admin_bootstrap_guard"]),
    ("UC-02 Manage Student and Tutor Profiles", "uc02", False, ["subjects", "tutor_profiles", "tutor_subjects", "public_tutor_snapshots"]),
    ("UC-04 Availability Management and Session Booking", "uc04", False, ["availability_rules", "availability_exceptions", "bookings", "booking_private_details", "booking_events", "booking_policy"]),
    ("UC-06 Payment and Refund Processing", "uc06", False, ["payments", "payment_events", "refunds", "payout_refs"]),
    ("UC-05 Diagnostic Assessment", "uc05", True, ["assessments", "assessment_questions", "assessment_answer_keys", "assessment_attempts"]),
    ("UC-07 Reviews and Ratings", "uc07", True, ["reviews", "tutor_rating_summaries"]),
    ("UC-08 Practice Tasks and Assignment Management", "uc08", True, ["assignments", "assignment_submissions", "assignment_feedback"]),
    ("UC-09 Session Planner and Recap", "uc09", True, ["session_plans", "session_recaps", "session_reflections"]),
]

PURPOSES = {
    "profiles": "Private profile of each account. Its id is the managed Supabase Auth user id.",
    "user_roles": "Student, Tutor, and Administrator capabilities of each account; one account can hold several roles.",
    "audit_logs": "Append-only record of every administrator action and its reason.",
    "admin_bootstrap_guard": "Private control table that allows the first Administrator to be created only once. It is in the private schema and is not exposed to clients.",
    "subjects": "Catalog of subjects that tutors can teach, with an optional parent subject.",
    "tutor_profiles": "A tutor's teaching profile: headline, rate, session modes, area, and publication state.",
    "tutor_subjects": "Join table linking a tutor to each subject they teach, with an optional rate override.",
    "public_tutor_snapshots": "Public copy of a published tutor profile; it holds no private account or contact data.",
    "availability_rules": "Weekly recurring times when a tutor is available, in the tutor's time zone.",
    "availability_exceptions": "Date-specific days off or extra times for a tutor.",
    "bookings": "A reserved tutoring session. Exclusion constraints block overlapping active bookings for the same tutor or student.",
    "booking_private_details": "Meeting link or place, visible only to the two participants of the booking.",
    "booking_events": "Append-only history of each booking status change.",
    "booking_policy": "Private single-row configuration: lead time, booking window, buffer, hold time, duration limits, and platform fee. It is not exposed to clients.",
    "payments": "Payment for one booking, stored in whole cents with the platform fee and the provider state.",
    "payment_events": "Verified provider events for a payment; each provider event is processed only once.",
    "refunds": "Refund requests for a payment and their state; a refund can never exceed the amount paid.",
    "payout_refs": "Reference to the tutor payout that corresponds to a payment.",
    "assessments": "A diagnostic or progress assessment that a tutor creates for one of their subjects and assigns to one student.",
    "assessment_questions": "Ordered questions of an assessment (single choice or short answer) with their points.",
    "assessment_answer_keys": "Correct choice for each single-choice question, kept in a separate table that students cannot read.",
    "assessment_attempts": "A student's answers to an assessment with automatic and tutor scores; one attempt per student and assessment.",
    "reviews": "One rating (1 to 5) and comment for a completed booking, written by its student; moderated by administrators.",
    "tutor_rating_summaries": "Per-tutor rating count, sum, and average, recalculated by a trigger from visible reviews only.",
    "assignments": "Practice work a tutor assigns to a student they teach, with a due date and status.",
    "assignment_submissions": "Numbered submission attempts for an assignment (text, link, or one file) with a late flag.",
    "assignment_feedback": "The tutor's written feedback, optional score, and outcome for one submission.",
    "session_plans": "Shared plan for one booking: the student's goals and questions and the tutor's agenda.",
    "session_recaps": "The tutor's published recap for one booking: summary, mastery notes, next steps, and revision number.",
    "session_reflections": "A student's private reflection on a booking; row-level security hides it from the tutor.",
}

# ---------------------------------------------------------------- class table (Section 7)
CLASS_TABLE = [
    ("Profile", "id: UUID, displayName, timezone, adultAttested, status", "saveOwnProfile(name, timezone)", "holds 1..* UserRole; performs 0..* AuditLog; publishes as 0..1 TutorProfile; books 0..* Booking; writes 0..* Review"),
    ("UserRole", "role: Role, grantedBy: UUID", "grant(target, role), revoke(target, role)", "1..* per Profile"),
    ("AuditLog", "action, reason, createdAt", "(append only)", "0..* per Profile"),
    ("TutorProfile", "id, headline, hourlyRateMinor, supportsVirtual, publicationState", "publish()", "teaches 0..* TutorSubject; composed of 0..* AvailabilityRule; is booked in 0..* Booking; aggregated in 0..1 TutorRatingSummary"),
    ("Subject / TutorSubject", "name, slug / expertise, rateOverrideMinor", "(catalog)", "Subject 1 to 0..* TutorSubject; Booking 0..* to 1 Subject"),
    ("AvailabilityRule", "weekday, localStart, localEnd, timezone", "(validated on save)", "0..* per TutorProfile (composition)"),
    ("Booking", "id, startsAt, endsAt, mode, priceMinor, status, holdExpiresAt", "create(...), cancel(reason), markCompleted()", "1 Profile, 1 TutorProfile, 1 Subject; 0..1 Payment; composes 0..1 SessionPlan, 0..1 SessionRecap, 0..1 SessionReflection; rated by 0..1 Review"),
    ("Payment / Refund", "amountMinor, feeMinor, state, paidAt / amountMinor, state, reason", "(provider events)", "Booking 1 to 0..1 Payment; Payment 1 to 0..* Refund"),
    ("SessionPlan", "studentGoals, studentQuestions, tutorAgenda", "saveGoals(goals, questions), saveAgenda(agenda)", "0..1 per Booking"),
    ("SessionRecap", "summary, masteryNotes, nextSteps, revision", "publish(summary, mastery, nextSteps)", "0..1 per Booking"),
    ("SessionReflection", "reflection, updatedAt", "save(reflection)", "0..1 per Booking; owned by 1 student Profile"),
    ("Review", "rating {1..5}, comment, status", "submit(booking, rating, comment), moderate(status, reason)", "0..1 per Booking; 1 author Profile; 1 TutorProfile"),
    ("TutorRatingSummary", "ratingCount, ratingAvg", "refresh()", "0..1 per TutorProfile"),
    ("Assessment", "title, purpose, status, dueAt", "(assign)", "created by 1 TutorProfile; tests 1 Subject; contains 1..* AssessmentQuestion; 0..1 AssessmentAttempt"),
    ("AssessmentQuestion / AnswerKey", "position, prompt, kind, points / correctChoice", "(none)", "AssessmentQuestion 1 to 0..1 AnswerKey (composition)"),
    ("AssessmentAttempt", "answers: JSON, score, maxScore", "submit(answers, finalize), score(points, feedback)", "1 Assessment; 1 student Profile"),
    ("Assignment", "title, dueAt, status", "(assign, cancel)", "1 TutorProfile; 1 student Profile; follows up 0..1 Booking; 0..* AssignmentSubmission"),
    ("AssignmentSubmission / AssignmentFeedback", "attemptNo, body, isLate / feedback, score, outcome", "submit(body, link) / give(feedback, score, outcome)", "Submission 1 to 0..1 Feedback"),
    ("SessionPlanService «service»", "(stateless)", "getWorkspace, saveStudentPlan, saveTutorAgenda, markSessionCompleted, publishRecap, saveReflection", "used by 1 SessionActions; uses SessionPolicy, SessionValidation, AuthService, UserClient; creates SessionWorkspace"),
    ("ReviewService «service»", "(stateless)", "listEligibleBookings, submitReview, getTutorRatingSummary", "used by 1 ReviewActions; uses ReviewPolicy, ReviewValidation, AuthService, UserClient"),
    ("BookingService «service»", "(stateless)", "readBookingWorkspace, requestBooking, cancelBooking", "used by 1 BookingActions; uses BookingPolicy, BookingValidation, AuthService, UserClient"),
    ("SessionPolicy / ReviewPolicy / BookingPolicy «policy»", "(pure functions)", "resolveSessionRole, sessionPhase, sessionPermissions, requireSessionPermission / requireReviewAuthor, isReviewable, canReview / requireBookingStudent, requireBookingParticipant", "used by the matching service"),
    ("AuthService «service» and Actor", "Actor: id, roles, sessionStartedAt", "getActor(client)", "creates Actor; used by every service"),
    ("UserClient «adapter»", "user access token", "createUserClient(), from(table), rpc(name, params)", "1 per request; calls PostgreSQL"),
    ("DomainError / InputError", "code / fields", "(exceptions)", "InputError specializes DomainError"),
]

SEQ_REFINEMENTS = [
    ("UC-04 sequence: retried submit", "create_booking returns the existing booking for a reused request key (opt fragment).", "UC-04 alternate path; REQ-04 description"),
    ("UC-04 sequence: tutor check before reserving", "BookingService reads the published tutor and offered mode before calling the database (break fragment).", "UC-04 main flow step 4 and exception path"),
    ("UC-04 sequence: participant re-check", "requireBookingParticipant() added to BookingPolicy; BookingService re-checks the saved booking.", "Class diagram: BookingPolicy"),
    ("UC-09 sequence: session must be delivered", "New operation markSessionCompleted / mark_session_completed and Booking.markCompleted().", "UC-09 main flow step 3; Booking and SessionPlanService classes"),
    ("UC-09 sequence: phase-based permissions", "SessionPolicy.sessionPhase() and sessionPermissions() decide which forms are offered.", "UC-09 exception path; SessionPolicy class"),
    ("UC-09 sequence: recap republish", "The loop fragment showed repeated publishing; SessionRecap.revision added.", "UC-09 alternate path; SessionRecap attribute"),
    ("UC-09 sequence: private reflection read", "Reflection is requested only for the student (opt); SessionWorkspace.reflection is null for the tutor.", "UC-09 description; SessionWorkspace class"),
    ("UC-07 implementation: review immutability", "Database trigger allows only moderation changes after submission.", "UC-07 alternate and exception paths; REQ-07"),
]
