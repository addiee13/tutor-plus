import { loadWorkspace } from "@/components/workspace/load";
import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { hasRole } from "@/domains/auth/policy";
import { listAssessments, listLearningRelationships } from "@/domains/learning/service";
import { readTutorAssessmentTemplates } from "@/domains/platform/service";
import { InputError, safeMessage } from "@/domains/shared/errors";
import { WorkflowForm } from "@/components/workspace/workflow-form";
import { useAssessmentTemplateAction } from "../admin/assessment-templates/actions";
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
import { AssessmentEditor } from "../learning/editors";
export default async function AssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const loaded = await loadWorkspace(async () => {
    const [items, relationships] = await Promise.all([listAssessments(client), listLearningRelationships(client)]);
    const tutor = hasRole(actor, "tutor");
    return { items, relationships: relationships.filter((row) => row.studentId !== actor.id), tutor };
  });
  if (!loaded.ok) return <WorkspaceError title="Assessments" error={loaded.error} />;
  const { items, relationships, tutor } = loaded.value;
  const query = await searchParams;
  const templateBooking = typeof query.templateBooking === "string" ? query.templateBooking : "";
  const catalog =
    tutor && templateBooking
      ? await loadWorkspace(() => {
          if (!relationships.some((row) => row.bookingId === templateBooking))
            throw new InputError({ templateBooking: "Choose one of your booked learner relationships." });
          return readTutorAssessmentTemplates(client, templateBooking);
        })
      : null;
  return (
    <>
      <WorkspaceHeading
        eyebrow="A useful starting point"
        title="Assessments."
        description="Understand current knowledge, spot questions and choose the next learning step. Scores are evidence, not automatic mastery."
      />
      <WorkspaceTabs items={learningTabs} current="/assessments" />
      {tutor && (
        <Section title="Start from an approved template">
          <p>
            Select an authorized learner relationship to see templates approved for that subject. Creating a draft does
            not assign it.
          </p>
          <form
            action="/assessments"
            method="get"
            className="workspace-actions"
            aria-label="Choose template relationship"
          >
            <div className="field">
              <label htmlFor="template-booking">Template learning relationship</label>
              <select id="template-booking" name="templateBooking" required defaultValue={templateBooking}>
                <option value="">Choose a learner relationship</option>
                {relationships.map((row) => (
                  <option key={row.bookingId} value={row.bookingId}>
                    {row.studentName} · {row.subjectName} · {formatDate(row.endsAt)}
                  </option>
                ))}
              </select>
            </div>
            <button className="button secondary" type="submit" disabled={!relationships.length}>
              Show approved templates →
            </button>
          </form>
          {catalog && !catalog.ok && (
            <p className="notice warning" role="alert">
              {catalog.error instanceof InputError
                ? Object.values(catalog.error.fields).join(" ")
                : safeMessage(catalog.error)}
            </p>
          )}
          {catalog?.ok && (
            <div className="workspace-grid equal" style={{ marginTop: "1rem" }}>
              {catalog.value.map((template) => (
                <article className="workspace-record" key={template.id}>
                  <h3>{template.title}</h3>
                  <p>{template.description}</p>
                  <p className="hint">
                    Version {template.version} · {template.questions.length} questions ·{" "}
                    {template.purpose.replaceAll("_", " ")}
                  </p>
                  <details className="workspace-details">
                    <summary>Review this template definition</summary>
                    <ol>
                      {template.questions.map((question, index) => (
                        <li key={index}>
                          <p className="workspace-prose">{question.prompt}</p>
                          <p className="hint">
                            {question.topic} · {question.points} points · {question.kind.replaceAll("_", " ")}
                          </p>
                          {question.choices && (
                            <ul>
                              {question.choices.map((choice) => (
                                <li key={choice}>{choice}</li>
                              ))}
                            </ul>
                          )}
                          {question.correctChoice && (
                            <p className="hint">Tutor-only answer key: {question.correctChoice}</p>
                          )}
                        </li>
                      ))}
                    </ol>
                  </details>
                  <WorkflowForm
                    title={`Use assessment template ${template.title}`}
                    action={useAssessmentTemplateAction}
                    hidden={{ templateId: template.id, bookingId: templateBooking }}
                    submit="Create draft from this template"
                  />
                </article>
              ))}
              {!catalog.value.length && <p>No active approved templates match this booked subject yet.</p>}
            </div>
          )}
        </Section>
      )}
      <div className={tutor ? "workspace-grid" : "workspace-stack"}>
        <Section title={tutor ? "Your saved assessments" : "Your assessments"}>
          {items.length ? (
            <ul className="workspace-records">
              {items.map((item) => (
                <li className="workspace-record" key={item.id}>
                  <div className="workspace-record-head">
                    <h3>
                      <Link href={`/assessments/${item.id}`}>{item.title}</Link>
                    </h3>
                    <Status>{item.status}</Status>
                  </div>
                  <p className="hint">
                    {item.purpose.replaceAll("_", " ")} ·{" "}
                    {item.due_at ? `Due ${formatDate(item.due_at)}` : "No deadline"}
                  </p>
                  <Link className="button secondary compact" href={`/assessments/${item.id}`}>
                    Open assessment →
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No assessments yet">
              {tutor
                ? "Create a draft for a learner from one of your confirmed or completed sessions."
                : "Assessments assigned by your tutor will appear here."}
            </EmptyState>
          )}
        </Section>
        {tutor && (
          <Section title="Create an assessment" eyebrow="Tutor workspace">
            {!relationships.length ? (
              <p className="notice warning">
                A confirmed or completed tutoring relationship is required. Payment-pending reservations do not
                establish this relationship.
              </p>
            ) : null}
            <AssessmentEditor relationships={relationships} />
          </Section>
        )}
      </div>
    </>
  );
}
