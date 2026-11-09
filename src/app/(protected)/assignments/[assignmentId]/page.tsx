import { loadWorkspace } from "@/components/workspace/load";
import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { getAssignment, listLearningRelationships, listAssignmentMilestoneOptions } from "@/domains/learning/service";
import {
  WorkspaceHeading,
  WorkspaceTabs,
  learningTabs,
  WorkspaceError,
  Section,
  EmptyState,
  Status,
  formatInstant,
  formatFileSize,
} from "@/components/workspace/ui";
import { WorkflowForm, type WorkflowField } from "@/components/workspace/workflow-form";
import { AssignmentEditor } from "../../learning/editors";
import {
  assignAssignmentAction,
  submitAssignmentAction,
  prepareAssignmentUploadAction,
  feedbackAssignmentAction,
  closeAssignmentAction,
  cancelAssignmentAction,
  saveAssignmentDraftAction,
  submitAssignmentDraftAction,
} from "../../learning/actions";

export default async function AssignmentPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  if (!publicConfig()) return null;
  const { assignmentId } = await params;
  const { actor, client } = await protectedContext();
  const loaded = await loadWorkspace(async () => {
    const { assignment, submissions, draft } = await getAssignment(client, assignmentId);
    const student = assignment.student_id === actor.id;
    const relations = await listLearningRelationships(client);
    const relation = relations.find(
      (row) => row.tutorId === assignment.tutor_id && row.studentId === assignment.student_id,
    );
    const tutor = !!relation && !student;
    const milestones = tutor && assignment.status === "draft" ? await listAssignmentMilestoneOptions(client) : [];
    const accepting =
      !assignment.submissions_closed_at &&
      ["assigned", "returned"].includes(assignment.status) &&
      (assignment.accepts_late || Date.parse(assignment.due_at) > new Date().getTime());
    const submissionFields: WorkflowField[] =
      assignment.submission_type === "text"
        ? [
            {
              name: "body",
              label: "Your written response",
              type: "textarea",
              required: true,
              maxLength: 8000,
              wide: true,
              value: draft?.body ?? "",
            },
          ]
        : assignment.submission_type === "link"
          ? [
              {
                name: "linkUrl",
                label: "Link to your work",
                type: "url",
                required: true,
                maxLength: 1000,
                wide: true,
                value: draft?.link_url ?? "",
                hint: "Use an HTTPS link your tutor can open. Check its sharing settings.",
              },
            ]
          : [
              {
                name: "file",
                label: "Your file",
                type: "file",
                required: true,
                wide: true,
                accept: "application/pdf,image/png,image/jpeg,text/plain",
                hint: "PDF, PNG, JPEG or plain text, up to 10 MiB. Files stay private to the learning relationship. If submission fails, choose the file again.",
              },
            ];
    return { assignment, submissions, draft, student, relation, tutor, submissionFields, milestones, accepting };
  });
  if (!loaded.ok) return <WorkspaceError title="Assignment" error={loaded.error} />;
  const { assignment, submissions, draft, student, relation, tutor, submissionFields, milestones, accepting } =
    loaded.value;
  return (
    <>
      <WorkspaceHeading
        eyebrow="Practice with purpose"
        title={assignment.title}
        description={`Due ${formatInstant(assignment.due_at)}${relation ? ` · ${student ? relation.tutorName : relation.studentName}` : ""}.`}
      >
        <Status>{assignment.status}</Status>
      </WorkspaceHeading>
      <WorkspaceTabs items={learningTabs} current="/assignments" />
      <div className="workspace-grid">
        <div className="workspace-stack">
          <Section title="The assignment">
            <p className="workspace-prose">{assignment.instructions}</p>
            <p>Topic: {assignment.topic ?? "Not tagged in this historical assignment"}</p>
            {assignment.cancellation_reason && (
              <div className="notice warning">
                <strong>Assignment cancelled</strong>
                <p className="workspace-prose">{assignment.cancellation_reason}</p>
              </div>
            )}
            {assignment.study_plan_id && (
              <p>
                <Link className="small-link" href={`/study-plans/${assignment.study_plan_id}`}>
                  Linked study plan · revision {assignment.plan_revision_no} →
                </Link>
              </p>
            )}
            <p className="hint">
              Submission: {assignment.submission_type}.{" "}
              {assignment.accepts_late
                ? "Late work is accepted and marked as late."
                : "Submissions close at the deadline."}
            </p>
            {tutor && assignment.status === "draft" && (
              <WorkflowForm
                title="Assign draft"
                action={assignAssignmentAction}
                hidden={{ assignmentId }}
                submit="Assign to learner"
              />
            )}
          </Section>
          {tutor && ["draft", "assigned", "returned"].includes(assignment.status) && (
            <Section title="Cancel this assignment">
              <p>Record why this task should stop. Existing submissions and feedback are retained.</p>
              <WorkflowForm
                title="Cancel assignment"
                action={cancelAssignmentAction}
                hidden={{ assignmentId }}
                submit="Cancel assignment"
                fields={[
                  {
                    name: "reason",
                    label: "Cancellation reason",
                    type: "textarea",
                    required: true,
                    wide: true,
                    maxLength: 500,
                  },
                  {
                    name: "confirmed",
                    label: "I confirm cancellation of this assignment",
                    type: "checkbox",
                    required: true,
                    wide: true,
                  },
                ]}
              />
            </Section>
          )}
          {tutor &&
            !assignment.submissions_closed_at &&
            ["assigned", "submitted", "returned"].includes(assignment.status) && (
              <Section title="Assignment acceptance">
                <p>You can close further submissions while retaining submitted work and feedback.</p>
                <WorkflowForm
                  title="Close assignment submissions"
                  action={closeAssignmentAction}
                  hidden={{ assignmentId }}
                  submit="Close submissions"
                  fields={[
                    {
                      name: "confirmed",
                      label: "I confirm that further submissions should be closed",
                      type: "checkbox",
                      required: true,
                      wide: true,
                    },
                  ]}
                />
              </Section>
            )}
          {assignment.submissions_closed_at && (
            <Section title="Submissions are closed">
              <p>
                Closed {formatInstant(assignment.submissions_closed_at)}. Existing work and feedback remain visible.
              </p>
            </Section>
          )}
          {tutor && assignment.status === "draft" && (
            <Section title="Edit draft">
              <AssignmentEditor assignment={assignment} milestoneOptions={milestones} />
            </Section>
          )}
          {student && assignment.status === "submitted" && (
            <Section title="Awaiting tutor feedback">
              <p>
                Your submitted work is saved. Another attempt becomes available if your tutor returns the assignment for
                changes.
              </p>
            </Section>
          )}
          {student && accepting && assignment.submission_type === "file" && (
            <Section title={submissions.length ? "Submit another attempt" : "Submit your work"}>
              <p>Each saved submission keeps its own history and feedback.</p>
              <WorkflowForm
                title="Submit assignment"
                action={submitAssignmentAction}
                prepareUpload={prepareAssignmentUploadAction}
                hidden={{ assignmentId }}
                submit="Submit work"
                fields={submissionFields}
              />
            </Section>
          )}
          {student && accepting && assignment.submission_type !== "file" && (
            <Section title="Prepare a private draft">
              <p>Save and review your work before submitting it. Drafts are visible only to you.</p>
              <WorkflowForm
                title="Save private assignment draft"
                action={saveAssignmentDraftAction}
                hidden={{ assignmentId }}
                submit="Save private draft"
                fields={submissionFields}
              />
              {draft && (
                <div className="workspace-record">
                  <h3>Review your saved draft</h3>
                  <p className="hint">
                    Saved {formatInstant(draft.updated_at)}. Later edits must be saved before submission.
                  </p>
                  {draft.body && <p className="workspace-prose">{draft.body}</p>}
                  {draft.link_url && (
                    <a href={draft.link_url} target="_blank" rel="noreferrer">
                      Open saved draft link ↗
                    </a>
                  )}
                  <WorkflowForm
                    title="Submit saved assignment draft"
                    action={submitAssignmentDraftAction}
                    hidden={{ assignmentId }}
                    submit="Submit saved draft"
                    fields={[
                      {
                        name: "confirmed",
                        label: "I confirm this saved draft is ready for tutor review",
                        type: "checkbox",
                        required: true,
                        wide: true,
                      },
                    ]}
                  />
                </div>
              )}
            </Section>
          )}
          {student &&
            !accepting &&
            !assignment.accepts_late &&
            ["assigned", "returned"].includes(assignment.status) &&
            !assignment.submissions_closed_at && (
              <Section title="The submission deadline has passed">
                <p>This assignment does not accept late work. Previous work and feedback remain in the history.</p>
              </Section>
            )}
        </div>
        <Section title="Submissions & feedback" eyebrow={`${submissions.length} saved`}>
          {!submissions.length ? (
            <EmptyState title="Work will appear here">
              {student
                ? "Submit your work when it’s ready for your tutor to review."
                : "Your learner’s submissions will appear here with each review outcome."}
            </EmptyState>
          ) : (
            <ul className="workspace-records">
              {submissions.map((submission) => (
                <li className="workspace-record" key={submission.id}>
                  <div className="workspace-record-head">
                    <h3>Submission {submission.attempt_no}</h3>
                    <Status>{submission.feedback?.outcome ?? "Awaiting review"}</Status>
                  </div>
                  <p className="hint">
                    {formatInstant(submission.submitted_at)}
                    {submission.is_late ? " · Submitted after the deadline" : ""}
                  </p>
                  {submission.body && <p className="workspace-prose">{submission.body}</p>}
                  {submission.link_url && (
                    <a className="button secondary compact" href={submission.link_url} target="_blank" rel="noreferrer">
                      Open submitted link ↗
                    </a>
                  )}
                  {submission.file_path && (
                    <p>
                      <Link
                        className="button secondary compact"
                        href={`/assignments/files/${submission.id}`}
                        target="_blank"
                      >
                        Open private file ↗
                      </Link>
                      <span className="hint">
                        {" "}
                        {submission.file_mime} ·{" "}
                        {submission.file_size_bytes ? formatFileSize(submission.file_size_bytes) : ""}
                      </span>
                    </p>
                  )}
                  {submission.feedback && (
                    <div className="notice success">
                      <strong>Tutor feedback</strong>
                      <p className="workspace-prose">{submission.feedback.feedback}</p>
                      {submission.feedback.score !== null && <p>Score: {submission.feedback.score}</p>}
                      <p className="hint">Updated {formatInstant(submission.feedback.updated_at)}</p>
                    </div>
                  )}
                  {tutor && assignment.status !== "cancelled" && (
                    <details className="workspace-details">
                      <summary>
                        {submission.feedback ? "Edit feedback on this submission" : "Review this submission"}
                      </summary>
                      <WorkflowForm
                        title={`Review submission ${submission.attempt_no}`}
                        action={feedbackAssignmentAction}
                        hidden={{ submissionId: submission.id }}
                        submit="Save review"
                        fields={[
                          {
                            name: "feedback",
                            label: "Feedback",
                            type: "textarea",
                            required: true,
                            wide: true,
                            maxLength: 4000,
                            value: submission.feedback?.feedback ?? "",
                          },
                          {
                            name: "score",
                            label: "Score (0–100)",
                            type: "number",
                            min: 0,
                            max: 100,
                            step: 1,
                            value: submission.feedback?.score?.toString() ?? "",
                          },
                          {
                            name: "outcome",
                            label: "Next step",
                            type: "select",
                            required: true,
                            value: submission.feedback?.outcome ?? "returned",
                            options: [
                              { value: "returned", label: "Return for another attempt" },
                              { value: "completed", label: "Mark assignment completed" },
                            ],
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
        <Link className="small-link" href="/assignments">
          ← All assignments
        </Link>
      </p>
    </>
  );
}
