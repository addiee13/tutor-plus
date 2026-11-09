import Link from "next/link";
import type { LearningProgressOverview, LearningTopicRecord } from "@/domains/learning/types";
import { Status, formatInstant } from "@/components/workspace/ui";

const labels = { needs_work: "Needs Work", improving: "Improving", confident: "Confident" };
const sourceLabels = {
  assessment_question: "Assessment question",
  assignment_submission: "Assignment submission",
  session_recap: "Session recap",
  tutor_observation: "Tutor observation",
};
export function TopicRecords({
  progress,
  subjects,
}: {
  progress: LearningProgressOverview;
  subjects: { id: string; name: string }[];
}) {
  if (!progress.topicSummaries.length)
    return (
      <p>
        No topic-tagged evidence matches this view. Clear filters or open the context histories to see other saved work.
      </p>
    );
  return (
    <>
      <p>
        Compare dated work within each recorded topic. Assessment points and feedback stay separate from the tutor’s
        judgement.
      </p>
      <ul className="workspace-records">
        {progress.topicSummaries.map((summary) => {
          const records = progress.topicRecords.filter(
            (record) =>
              record.subjectId === summary.subjectId &&
              record.topic.trim().toLocaleLowerCase() === summary.topic.trim().toLocaleLowerCase(),
          );
          return (
            <li className="workspace-record" key={`${summary.subjectId}:${summary.topic}`}>
              <h3>
                {subjects.find((subject) => subject.id === summary.subjectId)?.name ?? "Learning topic"} ·{" "}
                {summary.topic}
              </h3>
              <dl className="workspace-facts">
                <div>
                  <dt>Dated source records</dt>
                  <dd>{summary.recordCount}</dd>
                </div>
                <div>
                  <dt>Scored assessment questions</dt>
                  <dd>
                    {summary.assessmentQuestionCount
                      ? `${summary.assessmentQuestionCount} · ${summary.assessmentPoints.earned}/${summary.assessmentPoints.possible} points`
                      : "No scored questions recorded"}
                  </dd>
                </div>
                <div>
                  <dt>Assignment submissions</dt>
                  <dd>
                    {summary.assignmentSubmissionCount} · {summary.scoredAssignmentFeedbackCount} with a recorded score
                  </dd>
                </div>
                <div>
                  <dt>Session recaps</dt>
                  <dd>{summary.recapCount}</dd>
                </div>
                <div>
                  <dt>Tutor observations</dt>
                  <dd>{summary.tutorObservationCount}</dd>
                </div>
              </dl>
              {summary.latestTutorObservation ? (
                <p>
                  <Status>{labels[summary.latestTutorObservation.label]}</Status> Latest explicit tutor judgement ·{" "}
                  {formatInstant(summary.latestTutorObservation.observedAt)}
                  {" · "}
                  <Link className="small-link" href={summary.latestTutorObservation.sourcePath}>
                    {summary.latestTutorObservation.sourceLabel} →
                  </Link>
                </p>
              ) : (
                <p className="hint">No explicit tutor mastery judgement is recorded for this topic.</p>
              )}
              {!!summary.recurringStrengths.length && (
                <RepeatedPhrases title="Repeated tutor strength notes" phrases={summary.recurringStrengths} />
              )}
              {!!summary.recurringPracticeAreas.length && (
                <RepeatedPhrases title="Repeated tutor practice notes" phrases={summary.recurringPracticeAreas} />
              )}
              <details className="workspace-details">
                <summary>Read this topic’s dated evidence</summary>
                <ol className="workspace-records">
                  {[...records]
                    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
                    .map((record) => (
                      <li className="workspace-record" key={record.id}>
                        <p className="hint">
                          {sourceLabels[record.sourceKind]} · {formatInstant(record.occurredAt)}
                        </p>
                        <Link className="small-link" href={record.sourcePath}>
                          {record.sourceLabel} →
                        </Link>
                        <RecordDetails record={record} />
                      </li>
                    ))}
                </ol>
              </details>
            </li>
          );
        })}
      </ul>
      <p className="hint">
        Counts and points describe saved records. Repeated notes are identical tutor-authored phrases found in at least
        two tagged recaps; they do not infer a new strength, gap or mastery score.
      </p>
    </>
  );
}

function RecordDetails({ record }: { record: LearningTopicRecord }) {
  return (
    <>
      {record.assessmentPoints && (
        <p>
          {record.assessmentPoints.earned}/{record.assessmentPoints.possible} assessment points
        </p>
      )}
      {record.assignmentFeedback && (
        <p>
          Tutor outcome: {record.assignmentFeedback.outcome}.{" "}
          {record.assignmentFeedback.score === null
            ? "No numeric score recorded."
            : `Recorded score: ${record.assignmentFeedback.score}.`}{" "}
          Updated {formatInstant(record.assignmentFeedback.updatedAt)}.
        </p>
      )}
      {record.recapNarrative && (
        <dl>
          <dt>Observed strengths</dt>
          <dd className="workspace-prose">{record.recapNarrative.strengths || "No structured strength note"}</dd>
          <dt>Areas to practise</dt>
          <dd className="workspace-prose">{record.recapNarrative.practiceAreas || "No structured practice note"}</dd>
        </dl>
      )}
      {record.tutorObservation && (
        <p>
          <Status>{labels[record.tutorObservation.label]}</Status> {record.tutorObservation.note}
        </p>
      )}
    </>
  );
}
function RepeatedPhrases({
  title,
  phrases,
}: {
  title: string;
  phrases: LearningProgressOverview["topicSummaries"][number]["recurringStrengths"];
}) {
  return (
    <div>
      <h4>{title}</h4>
      <ul>
        {phrases.map((phrase) => (
          <li key={phrase.text}>
            <p className="workspace-prose">{phrase.text}</p>
            <p className="hint">Same phrase in {phrase.recapCount} recaps.</p>
            <ul>
              {phrase.sources.map((source) => (
                <li key={source.bookingId}>
                  <Link className="small-link" href={source.sourcePath}>
                    Recap · {formatInstant(source.occurredAt)} →
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
