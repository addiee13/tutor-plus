import { EvidenceCharts } from "./evidence-charts";
import { ProgressFilterForm } from "./filter-form";
import { readProgressFilters } from "./filters";
import { InputError } from "@/domains/shared/errors";
import { TopicRecords } from "./topic-records";
import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { hasRole } from "@/domains/auth/policy";
import {
  getLearningProgress,
  listLearningRelationships,
  listTopicEvidenceCandidates,
} from "@/domains/learning/service";
import { loadWorkspace } from "@/components/workspace/load";
import {
  WorkspaceHeading,
  WorkspaceTabs,
  learningTabs,
  WorkspaceError,
  Section,
  EmptyState,
  Status,
  formatDate,
} from "@/components/workspace/ui";
import { WorkflowForm } from "@/components/workspace/workflow-form";
import type { LearningProgressOverview } from "@/domains/learning/types";
import { masteryAction } from "../learning/actions";
const labels = { needs_work: "Needs Work", improving: "Improving", confident: "Confident" };
export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const query = await searchParams;
  const requested = typeof query.student === "string" ? query.student : undefined;
  const loaded = await loadWorkspace(async () => {
    const filters = readProgressFilters(query);
    const relationships = await listLearningRelationships(client);
    const students = [
      ...new Map(relationships.map((row) => [row.studentId, { id: row.studentId, name: row.studentName }])).values(),
    ];
    const selectedId = requested ?? (hasRole(actor, "student") ? actor.id : students[0]?.id);
    if (!selectedId)
      return {
        relationships,
        students,
        selectedId,
        progress: null,
        subjects: [],
        evidence: [],
        filters,
      };
    const progress = await getLearningProgress(client, selectedId, filters);
    const subjects = [
      ...new Map(
        relationships
          .filter((row) => row.studentId === selectedId)
          .map((row) => [row.subjectId, { id: row.subjectId, name: row.subjectName }]),
      ).values(),
    ];
    const evidence =
      selectedId !== actor.id && hasRole(actor, "tutor")
        ? (
            await Promise.all(
              subjects.map(async (subject) =>
                (await listTopicEvidenceCandidates(client, selectedId, subject.id)).map((candidate) => ({
                  value: `${candidate.sourceKind}:${candidate.sourceId}`,
                  label: `${candidate.label} · ${formatDate(candidate.occurredAt)}`,
                  subjectId: subject.id,
                })),
              ),
            )
          ).flat()
        : [];
    return { relationships, students, selectedId, progress, subjects, evidence, filters };
  });
  if (!loaded.ok)
    return (
      <>
        <WorkspaceError title="Learning progress" error={loaded.error} />
        {loaded.error instanceof InputError && (
          <ul className="notice warning">
            {Object.entries(loaded.error.fields).map(([field, message]) => (
              <li key={field}>{message}</li>
            ))}
          </ul>
        )}
        <Link
          className="button secondary"
          href={loaded.error instanceof InputError && requested ? `/progress?student=${requested}` : "/progress"}
        >
          Clear filters & open permitted progress →
        </Link>
      </>
    );
  const { students, selectedId, progress, subjects, evidence, filters } = loaded.value;
  const tutorView = selectedId !== actor.id && hasRole(actor, "tutor");
  return (
    <>
      <WorkspaceHeading
        eyebrow="See the work behind the growth"
        title="Learning progress."
        description="Follow active goals, practice, sessions and dated topic observations. Assessment scores remain separate from human-confirmed mastery."
      />
      <WorkspaceTabs items={learningTabs} current="/progress" />
      {progress?.coverage.bounded && (
        <div className="notice warning" role="status">
          <strong>This view may contain an incomplete history.</strong>
          <p>
            One or more source queries reached their effective record cap. Counts, summaries and empty filtered views
            describe only the records returned here.
          </p>
          <p className="hint">
            Affected sources: {progress.coverage.cappedSources.map((source) => source.replaceAll("_", " ")).join(" · ")}
            .
          </p>
        </div>
      )}
      {hasRole(actor, "tutor") && students.length > 0 && (
        <Section title="Choose a learner">
          <form method="get" action="/progress" className="workspace-actions">
            <div className="field">
              <label htmlFor="progress-student">Learning relationship</label>
              <select id="progress-student" name="student" defaultValue={selectedId}>
                {hasRole(actor, "student") && <option value={actor.id}>My own progress</option>}
                {students
                  .filter((student) => student.id !== actor.id)
                  .map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.name}
                    </option>
                  ))}
              </select>
            </div>
            <button className="button secondary" type="submit">
              Open progress →
            </button>
          </form>
        </Section>
      )}
      {progress && selectedId && (
        <ProgressFilterForm
          filters={filters}
          options={progress.filterOptions}
          studentId={selectedId}
          subjects={subjects}
        />
      )}
      {!progress ? (
        <EmptyState title="A learning relationship starts the record">
          A tutor can view progress for learners they support. Students can view their own saved evidence.
        </EmptyState>
      ) : (
        <div className="workspace-grid" style={{ marginTop: "1.5rem" }}>
          <div className="workspace-stack">
            <Section title="Dated learning evidence">
              <EvidenceCharts progress={progress} filters={filters} />
            </Section>
            <Section title="Evidence by learning topic">
              <TopicRecords progress={progress} subjects={subjects} />
            </Section>
            <Section title="Active goals" eyebrow={`${progress.activeGoals.length} current goals`}>
              {!progress.activeGoals.length ? (
                <EmptyState title="No active goals yet">
                  Create or open a study plan to define the topic, starting point and success criterion.
                </EmptyState>
              ) : (
                <ul className="workspace-records">
                  {progress.activeGoals.map(({ planId, planTitle, goal }) => (
                    <li key={`${planId}:${goal.id}`} className="workspace-record">
                      <h3>{goal.title}</h3>
                      <p>{goal.topic}</p>
                      <dl className="workspace-facts">
                        <div>
                          <dt>Target</dt>
                          <dd>{formatDate(goal.targetDate)}</dd>
                        </div>
                        <div>
                          <dt>Starting point</dt>
                          <dd>{goal.baseline ?? "Not recorded"}</dd>
                        </div>
                        <div>
                          <dt>Practice schedule</dt>
                          <dd>{goal.schedule ?? "Not recorded"}</dd>
                        </div>
                        <div>
                          <dt>Success criterion</dt>
                          <dd>{goal.successCriterion ?? "Not recorded"}</dd>
                        </div>
                      </dl>
                      <Link className="small-link" href={`/study-plans/${planId}`}>
                        {planTitle} →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Milestones in order">
              <ol className="workspace-records">
                {progress.milestones.map(({ planId, goalId, goalTopic, milestone, evidence }) => (
                  <li className="workspace-record" key={`${planId}:${goalId}:${milestone.id}`}>
                    <div className="workspace-record-head">
                      <h3>{milestone.title}</h3>
                      <Status>{milestone.status.replaceAll("_", " ")}</Status>
                    </div>
                    <p>
                      {goalTopic} ·{" "}
                      {milestone.targetDate ? `Target ${formatDate(milestone.targetDate)}` : "No target date"}
                    </p>
                    {milestone.targetDate &&
                      milestone.targetDate < progress.observedAt.slice(0, 10) &&
                      milestone.status !== "completed" && (
                        <p className="notice warning">
                          Target date passed. The saved date remains until you explicitly reschedule it.
                        </p>
                      )}
                    <p className="hint">{evidence.length} linked evidence records</p>
                    <Link className="small-link" href={`/study-plans/${planId}`}>
                      Open milestone in plan →
                    </Link>
                  </li>
                ))}
              </ol>
              {!progress.milestones.length && <p>No milestones have been saved.</p>}
            </Section>
            <Section title="Topic observations">
              <p>
                Each label records a tutor’s dated judgement and its source. The labels are not calculated from a score.
              </p>
              {progress.topicEvidence.length ? (
                <ul className="workspace-records">
                  {progress.topicEvidence.map((observation) => (
                    <li className="workspace-record" key={observation.id}>
                      <div className="workspace-record-head">
                        <h3>{observation.topic}</h3>
                        <Status>{labels[observation.label]}</Status>
                      </div>
                      <p className="workspace-prose">{observation.note}</p>
                      <p className="hint">
                        Observed {formatDate(observation.observed_at)} · Recorded {formatDate(observation.created_at)}
                      </p>
                      <p>
                        <Link
                          className="small-link"
                          href={
                            observation.sourcePath ??
                            sourcePath(progress, observation.source_kind, observation.source_id)
                          }
                        >
                          Source: {observation.source_kind.replaceAll("_", " ")} →
                        </Link>
                      </p>
                      <p className="hint">Observation author reference: {observation.recorded_by}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No topic judgement recorded">
                  A tutor can add Needs Work, Improving or Confident with a saved evidence source and observation date.
                </EmptyState>
              )}
            </Section>
            {tutorView &&
              subjects.map((subject) => (
                <Section key={subject.id} title={`Record an observation · ${subject.name}`}>
                  <WorkflowForm
                    title={`Record ${subject.name} topic mastery`}
                    action={masteryAction}
                    hidden={{ studentId: selectedId!, subjectId: subject.id }}
                    submit="Save dated observation"
                    disabled={!evidence.some((source) => source.subjectId === subject.id)}
                    fields={[
                      { name: "topic", label: "Topic", required: true, maxLength: 200, wide: true },
                      {
                        name: "label",
                        label: "Current judgement",
                        type: "select",
                        required: true,
                        options: [
                          { value: "needs_work", label: "Needs Work" },
                          { value: "improving", label: "Improving" },
                          { value: "confident", label: "Confident" },
                        ],
                      },
                      {
                        name: "observedAt",
                        label: "Observation date & time",
                        type: "datetime",
                        required: true,
                        value: progress.observedAt,
                        hint: "Enter when the evidence was observed, in UTC.",
                      },
                      {
                        name: "source",
                        label: "Dated evidence source",
                        type: "select",
                        required: true,
                        wide: true,
                        options: evidence
                          .filter((source) => source.subjectId === subject.id)
                          .map((source) => ({ value: source.value, label: source.label })),
                      },
                      { name: "note", label: "What the evidence shows", type: "textarea", wide: true, maxLength: 3000 },
                    ]}
                  />
                  {!evidence.some((source) => source.subjectId === subject.id) && (
                    <p className="hint">
                      Score an assessment, receive a submission or publish a session recap before adding a judgement.
                    </p>
                  )}
                </Section>
              ))}
          </div>
          <div className="workspace-stack">
            <Section title="Assessment evidence">
              {progress.assessments.map(({ assessment, attempts }) => (
                <article className="workspace-record" key={assessment.id}>
                  <h3>
                    <Link href={`/assessments/${assessment.id}`}>{assessment.title}</Link>
                  </h3>
                  <p className="hint">{attempts.length} saved attempts</p>
                  {attempts
                    .filter((attempt) => attempt.status === "scored")
                    .map((attempt) => (
                      <p key={attempt.id}>
                        Attempt {attempt.attempt_no}: {attempt.score} / {attempt.max_score} ·{" "}
                        {formatDate(attempt.scored_at)}
                      </p>
                    ))}
                </article>
              ))}
              {!progress.assessments.length && <p>No assessment evidence is available.</p>}
            </Section>
            <Section title="Practice & task evidence">
              <ul className="workspace-records">
                {progress.tasks.map((task) => (
                  <li className="workspace-record" key={task.id}>
                    <h3>
                      <Link href={`/assignments/${task.id}`}>{task.title}</Link>
                    </h3>
                    <Status>{task.status}</Status>
                    <p className="hint">Due {formatDate(task.due_at)}</p>
                  </li>
                ))}
              </ul>
              {!progress.tasks.length && <p>No assignments have been saved.</p>}
            </Section>
            <Section title="Sessions & recaps">
              <ul className="workspace-records">
                {progress.sessions.map((session) => (
                  <li className="workspace-record" key={session.bookingId}>
                    <h3>{session.subjectName}</h3>
                    <p>
                      {session.tutorName} · {formatDate(session.endsAt)}
                    </p>
                    <Link className="small-link" href={`/sessions/${session.bookingId}`}>
                      {session.recapAvailable ? "Read session recap" : "Open session record"} →
                    </Link>
                  </li>
                ))}
              </ul>
              {!progress.sessions.length && <p>No session records were returned.</p>}
            </Section>
            <Section title="Evidence timeline">
              <ul className="workspace-records">
                {progress.events.map((event) => (
                  <li key={event.id} className="workspace-record">
                    <strong>{event.event_type.replaceAll("_", " ")}</strong>
                    <p className="hint">{formatDate(event.occurred_at)}</p>
                    <Link
                      className="small-link"
                      href={event.sourcePath ?? sourcePath(progress, event.source_kind, event.source_id)}
                    >
                      {event.sourcePath ? "Open source record" : "Find related learning work"} →
                    </Link>
                  </li>
                ))}
              </ul>
              {!progress.events.length && <p>No dated completion events have been recorded.</p>}
            </Section>
          </div>
        </div>
      )}
    </>
  );
}
function sourcePath(progress: LearningProgressOverview, kind: string, id: string): string {
  if (kind === "session_recap") return `/sessions/${id}`;
  if (kind === "assessment_attempt") {
    const found = progress.assessments.find((item) => item.attempts.some((attempt) => attempt.id === id));
    return found ? `/assessments/${found.assessment.id}` : "/assessments";
  }
  const found = progress.topicRecords.find(
    (item) => item.sourceKind === "assignment_submission" && item.sourceId === id,
  );
  return found?.sourcePath ?? "/assignments";
}
