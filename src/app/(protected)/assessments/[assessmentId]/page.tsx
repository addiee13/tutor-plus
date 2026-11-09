import { loadWorkspace } from "@/components/workspace/load";
import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { getAssessment, listLearningRelationships } from "@/domains/learning/service";
import {
  WorkspaceHeading,
  WorkspaceTabs,
  learningTabs,
  WorkspaceError,
  Section,
  EmptyState,
  Status,
  formatInstant,
} from "@/components/workspace/ui";
import { WorkflowForm, type WorkflowField } from "@/components/workspace/workflow-form";
import { AssessmentEditor } from "../../learning/editors";
import {
  assignAssessmentAction,
  attemptAssessmentAction,
  scoreAssessmentAction,
  reopenAssessmentAction,
} from "../../learning/actions";

export default async function AssessmentPage({ params }: { params: Promise<{ assessmentId: string }> }) {
  if (!publicConfig()) return null;
  const { assessmentId } = await params;
  const { actor, client } = await protectedContext();
  const loaded = await loadWorkspace(async () => {
    const detail = await getAssessment(client, assessmentId);
    const { assessment, questions, attempts, answerKeys } = detail;
    const tutor = answerKeys !== null;
    const draft = attempts.find((attempt) => attempt.status === "in_progress");
    const answerFields: WorkflowField[] = questions.map((question) => ({
      name: `answer:${question.id}`,
      label: question.prompt,
      type: question.kind === "single_choice" ? "select" : "textarea",
      options: question.choices?.map((choice) => ({ value: choice, label: choice })),
      value: draft?.answers[question.id] ?? "",
      wide: true,
      hint: `${question.points} point${question.points === 1 ? "" : "s"}${question.topic ? ` · Topic: ${question.topic}` : " · Historical question without a topic tag"}`,
      maxLength: 4000,
    }));
    const relations = tutor ? await listLearningRelationships(client) : [];
    const relation = relations.find(
      (row) => row.tutorId === assessment.tutor_id && row.studentId === assessment.student_id,
    );
    return { detail, assessment, questions, attempts, answerKeys, tutor, answerFields, relation };
  });
  if (!loaded.ok) return <WorkspaceError title="Assessment" error={loaded.error} />;
  const { detail, assessment, questions, attempts, answerKeys, tutor, answerFields, relation } = loaded.value;
  return (
    <>
      <WorkspaceHeading
        eyebrow={assessment.purpose.replaceAll("_", " ")}
        title={assessment.title}
        description={`${relation ? `For ${relation.studentName} · ` : ""}${assessment.due_at ? `Due ${formatInstant(assessment.due_at)}.` : "No deadline set."}`}
      >
        <Status>{assessment.status}</Status>
      </WorkspaceHeading>
      <WorkspaceTabs items={learningTabs} current="/assessments" />
      <div className="workspace-grid">
        <div className="workspace-stack">
          <Section title="Instructions">
            <p className="workspace-prose">
              {assessment.instructions || "Answer the questions below. Your tutor will review written responses."}
            </p>
            <p className="hint">
              {questions.length} questions · {questions.reduce((sum, q) => sum + q.points, 0)} possible points. Scores
              do not establish mastery.
            </p>
            {tutor && assessment.status === "draft" && (
              <WorkflowForm
                title="Assign assessment"
                action={assignAssessmentAction}
                hidden={{ assessmentId }}
                submit="Assign to learner"
              />
            )}
            {tutor && assessment.status === "scored" && (
              <WorkflowForm
                title="Reopen assessment for retake"
                action={reopenAssessmentAction}
                hidden={{ assessmentId }}
                submit="Allow another attempt"
              />
            )}
          </Section>
          {tutor && assessment.status === "draft" ? (
            <Section title="Edit your draft">
              <AssessmentEditor detail={detail} />
            </Section>
          ) : tutor ? (
            <Section title="Questions & answer key">
              <ol className="workspace-records">
                {questions.map((question) => (
                  <li className="workspace-record" key={question.id}>
                    <h3>{question.prompt}</h3>
                    <p className="hint">Topic: {question.topic ?? "Not tagged in this historical question"}</p>
                    <p className="hint">
                      {question.points} points ·{" "}
                      {question.kind === "single_choice" ? "Single choice" : "Tutor-scored response"}
                    </p>
                    {question.choices && (
                      <ul>
                        {question.choices.map((choice) => (
                          <li key={choice}>{choice}</li>
                        ))}
                      </ul>
                    )}
                    {answerKeys?.find((key) => key.question_id === question.id) && (
                      <p>
                        <strong>Correct answer:</strong>{" "}
                        {answerKeys?.find((key) => key.question_id === question.id)?.correct_choice}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </Section>
          ) : assessment.student_id === actor.id && assessment.status === "assigned" ? (
            <Section title="Your answers">
              <WorkflowForm
                title="Complete assessment"
                action={attemptAssessmentAction}
                hidden={{ assessmentId }}
                submit="Save answers"
                fields={[
                  ...answerFields,
                  {
                    name: "finalize",
                    label: "Save or submit",
                    type: "select",
                    required: true,
                    value: "false",
                    wide: true,
                    options: [
                      { value: "false", label: "Save draft — keep working" },
                      { value: "true", label: "Submit this attempt for review" },
                    ],
                    hint: "Submitting records this attempt. Your tutor must reopen the assessment before a retake.",
                  },
                ]}
              />
            </Section>
          ) : null}
        </div>
        <Section title="Attempt history" eyebrow={`${attempts.length} saved attempts`}>
          {!attempts.length ? (
            <EmptyState title="No attempts yet">
              {tutor
                ? "Your learner’s submitted work will appear here for review."
                : "Save a draft or submit your answers to create your first attempt."}
            </EmptyState>
          ) : (
            <ul className="workspace-records">
              {attempts.map((attempt) => (
                <li className="workspace-record" key={attempt.id}>
                  <div className="workspace-record-head">
                    <h3>Attempt {attempt.attempt_no}</h3>
                    <Status>{attempt.status.replaceAll("_", " ")}</Status>
                  </div>
                  <p className="hint">
                    {attempt.submitted_at ? `Submitted ${formatInstant(attempt.submitted_at)}` : "Draft in progress"}
                  </p>
                  {attempt.score !== null && (
                    <p>
                      <strong>
                        {attempt.score} / {attempt.max_score} points
                      </strong>
                    </p>
                  )}
                  {attempt.status === "submitted" && (
                    <p className="hint">
                      {attempt.auto_score !== null ? `Automatically scored points: ${attempt.auto_score}. ` : ""}
                      Written responses may still need tutor review.
                    </p>
                  )}
                  <dl className="workspace-facts">
                    {questions.map((question) => (
                      <div key={question.id}>
                        <dt>{question.prompt}</dt>
                        <dd className="workspace-prose">{attempt.answers[question.id] || "No answer saved"}</dd>
                      </div>
                    ))}
                  </dl>
                  {attempt.tutor_feedback && (
                    <div className="notice success">
                      <strong>Tutor feedback</strong>
                      <p className="workspace-prose">{attempt.tutor_feedback}</p>
                    </div>
                  )}
                  {tutor && attempt.status === "submitted" && (
                    <details className="workspace-details">
                      <summary>Score written responses & give feedback</summary>
                      <WorkflowForm
                        title={`Score attempt ${attempt.attempt_no}`}
                        action={scoreAssessmentAction}
                        hidden={{ attemptId: attempt.id }}
                        submit="Save scoring & feedback"
                        fields={[
                          {
                            name: "tutorPoints",
                            label: "Points for written answers",
                            type: "number",
                            required: true,
                            min: 0,
                            max: questions.filter((q) => q.kind === "short_answer").reduce((n, q) => n + q.points, 0),
                            value: "0",
                            hint: "Single-choice points are calculated separately from the private answer key.",
                            wide: true,
                          },
                          {
                            name: "feedback",
                            label: "Feedback for your learner",
                            type: "textarea",
                            required: true,
                            wide: true,
                            maxLength: 4000,
                          },
                        ]}
                      />
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <p>
        <Link className="small-link" href="/assessments">
          ← All assessments
        </Link>
      </p>
    </>
  );
}
