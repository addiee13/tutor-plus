import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { isDomainError, safeMessage } from "@/domains/shared/errors";
import { formatUtc } from "@/domains/bookings/presentation";
import { getWorkspace } from "@/domains/sessions/service";
import type { SessionPhase, SessionWorkspace } from "@/domains/sessions/types";
import { AgendaForm, CompleteSessionForm, GoalsForm, RecapForm, ReflectionForm } from "./forms";
import styles from "../sessions.module.css";

export const dynamic = "force-dynamic";

const PHASE_LABELS: Record<SessionPhase, string> = {
  planning: "Planning — before the session",
  ended: "Session time has ended",
  completed: "Completed",
  unavailable: "Not open for planning",
};

/** The visible journey of a session; "unavailable" sits outside it, with every step still upcoming. */
const PHASE_STEPS: readonly (readonly [SessionPhase, string])[] = [
  ["planning", "Planning"],
  ["ended", "Session ended"],
  ["completed", "Completed"],
];

function PhaseStepper({ phase }: { phase: SessionPhase }) {
  const index = PHASE_STEPS.findIndex(([key]) => key === phase);
  return (
    <ol className={styles.stepper} aria-label="Session progress">
      {PHASE_STEPS.map(([key, label], step) => {
        const state = index < 0 || step > index ? "upcoming" : step < index ? "done" : "current";
        return (
          <li key={key} className={styles[state]} aria-current={state === "current" ? "step" : undefined}>
            <span className={styles.stepMark} aria-hidden="true">
              {state === "done" ? "✓" : step + 1}
            </span>
            <span className={styles.stepLabel}>
              {label}
              {state === "done" && <span className="visually-hidden"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default async function SessionWorkspacePage({ params }: { params: Promise<{ bookingId: string }> }) {
  if (!publicConfig()) return null;
  const { bookingId } = await params;
  const { client } = await protectedContext();
  let workspace: SessionWorkspace;
  try {
    workspace = await getWorkspace(client, bookingId);
  } catch (error) {
    const denied = isDomainError(error, "forbidden");
    return (
      <>
        <section className="page-heading">
          <span className="eyebrow">Session planner &amp; recap</span>
          <h1 id="denied-heading">{denied ? "This workspace isn’t available." : "Session workspace."}</h1>
        </section>
        <section className="panel" aria-labelledby="denied-heading">
          <div className="notice warning" role="alert">
            {denied
              ? "Only the student and tutor on this booking can open its session workspace. No session details were shown."
              : safeMessage(error)}
          </div>
          <Link className="button secondary" href="/bookings">
            Back to bookings
          </Link>
        </section>
      </>
    );
  }

  const { booking, role, phase, can, plan, recap, reflection } = workspace;
  const bookingRef = booking.id;
  return (
    <>
      <section className="page-heading">
        <span className="eyebrow">Session planner &amp; recap</span>
        <h1>Session workspace.</h1>
        <p>
          {role === "student"
            ? "Share your goals before the lesson, read your tutor’s recap afterwards, and keep a private reflection."
            : "Read your student’s goals, prepare an agenda, and publish a recap once the session has ended."}
        </p>
      </section>

      <section className={`panel ${styles.overview}`} aria-label="Booking summary">
        <PhaseStepper phase={phase} />
        <dl className={styles.summary}>
          <div>
            <dt>Subject</dt>
            <dd>{workspace.subjectName}</dd>
          </div>
          <div>
            <dt>{role === "student" ? "Tutor" : "Your listing"}</dt>
            <dd>{workspace.tutorName}</dd>
          </div>
          <div>
            <dt>Session (UTC)</dt>
            <dd>
              <time dateTime={booking.starts_at}>{formatUtc(booking.starts_at)}</time> –{" "}
              <time dateTime={booking.ends_at}>{formatUtc(booking.ends_at).slice(11)}</time>
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <span className="status-chip" data-status={booking.status} data-testid="session-status">
                {booking.status.replace("_", " ")}
              </span>{" "}
              <span className={styles.meta}>{PHASE_LABELS[phase]}</span>
            </dd>
          </div>
        </dl>
        <p className={styles.meta}>
          You are viewing this booking as its <strong>{role}</strong>. Booking reference {bookingRef}.
        </p>
        {can.markCompleted && <CompleteSessionForm bookingId={bookingRef} />}
      </section>

      {phase === "unavailable" ? (
        <div className={`notice warning ${styles.unavailable}`} role="status">
          The planner opens once a booking is confirmed. This booking is <code>{booking.status}</code>, so there is
          nothing to plan yet.
        </div>
      ) : (
        <div className={styles.grid}>
          <section className={`panel ${styles.card}`} aria-labelledby="goals-heading">
            <span className="tag">Student</span>
            <h2 id="goals-heading">Goals and questions</h2>
            {can.editGoals ? (
              <GoalsForm bookingId={bookingRef} goals={plan?.student_goals} questions={plan?.student_questions} />
            ) : (
              <SavedText
                empty={
                  role === "tutor" ? "Your student hasn’t shared goals yet." : "No goals were saved for this session."
                }
                entries={[
                  ["Goals", plan?.student_goals],
                  ["Questions", plan?.student_questions],
                ]}
                updatedAt={plan?.student_updated_at}
              />
            )}
            {can.editGoals && plan?.student_updated_at && <Saved at={plan.student_updated_at} />}
          </section>

          <section className={`panel ${styles.card}`} aria-labelledby="agenda-heading">
            <span className="tag clay">Tutor</span>
            <h2 id="agenda-heading">Agenda</h2>
            {can.editAgenda ? (
              <AgendaForm bookingId={bookingRef} agenda={plan?.tutor_agenda} />
            ) : (
              <SavedText
                empty={role === "student" ? "Your tutor hasn’t added an agenda yet." : "No agenda was saved."}
                entries={[["Agenda", plan?.tutor_agenda]]}
                updatedAt={plan?.tutor_updated_at}
              />
            )}
            {can.editAgenda && plan?.tutor_updated_at && <Saved at={plan.tutor_updated_at} />}
          </section>

          <section className={`panel ${styles.card}`} aria-labelledby="recap-heading">
            <span className="tag">Recap</span>
            <h2 id="recap-heading">Session recap</h2>
            {can.publishRecap ? (
              <RecapForm
                bookingId={bookingRef}
                summary={recap?.summary}
                masteryNotes={recap?.mastery_notes}
                nextSteps={recap?.next_steps}
                published={!!recap}
              />
            ) : recap ? (
              <SavedText
                empty=""
                entries={[
                  ["What we covered", recap.summary],
                  ["Mastery notes", recap.mastery_notes],
                  ["Next steps", recap.next_steps],
                ]}
                updatedAt={recap.updated_at}
              />
            ) : (
              <p data-testid="recap-pending">
                {phase === "planning"
                  ? "The recap opens after the session ends. Nothing has been published yet."
                  : "Recap pending — your tutor hasn’t published one yet."}
              </p>
            )}
            {can.publishRecap && recap && (
              <p className={styles.meta}>
                Published {formatUtc(recap.published_at)} · revision {recap.revision} · last updated{" "}
                {formatUtc(recap.updated_at)}
              </p>
            )}
          </section>

          {role === "student" ? (
            <section className={`panel ${styles.card} ${styles.private}`} aria-labelledby="reflection-heading">
              <span className="tag ink">Private to you</span>
              <h2 id="reflection-heading">Your reflection</h2>
              {can.writeReflection ? (
                <ReflectionForm bookingId={bookingRef} reflection={reflection?.reflection} />
              ) : (
                <p>Your private reflection opens after the session ends.</p>
              )}
              {reflection && <Saved at={reflection.updated_at} />}
            </section>
          ) : (
            <section className={`panel ${styles.card} ${styles.private}`} aria-labelledby="privacy-heading">
              <span className="tag ink">Privacy</span>
              <h2 id="privacy-heading">Student reflection</h2>
              <p data-testid="reflection-private">
                Student reflections are private to the student. They are never shown to tutors, and this page does not
                request them.
              </p>
            </section>
          )}
        </div>
      )}
      <p className="session-note">
        <Link href="/bookings">← Back to bookings</Link>
        {role === "student" && booking.status === "completed" && (
          <>
            {" · "}
            <Link href="/reviews">Review this session</Link>
          </>
        )}
      </p>
    </>
  );
}

function Saved({ at }: { at: string }) {
  return <p className={styles.meta}>Last saved {formatUtc(at)}</p>;
}

function SavedText({
  entries,
  empty,
  updatedAt,
}: {
  entries: [string, string | null | undefined][];
  empty: string;
  updatedAt?: string | null;
}) {
  const present = entries.filter((entry): entry is [string, string] => !!entry[1]);
  if (!present.length) return <p>{empty}</p>;
  return (
    <>
      {present.map(([label, value]) => (
        <div key={label}>
          <span className={styles.label}>{label}</span>
          <p className={styles.readout}>{value}</p>
        </div>
      ))}
      {updatedAt && <p className={styles.meta}>Last updated {formatUtc(updatedAt)}</p>}
    </>
  );
}
