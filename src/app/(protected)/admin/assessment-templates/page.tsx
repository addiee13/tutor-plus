import { protectedContext } from "@/lib/protected-context";
import { publicConfig } from "@/lib/supabase/config";
import { requireRole } from "@/domains/auth/policy";
import { readAdminAssessmentTemplates, readSafetyWorkspace } from "@/domains/platform/service";
import { loadWorkspace } from "@/components/workspace/load";
import { WorkspaceHeading, WorkspaceError, Section, Status, formatInstant } from "@/components/workspace/ui";
import { AdminNav } from "../console-nav";
import { AssessmentTemplateEditor } from "./editor";
import { assessmentTemplateAction } from "./actions";
export default async function AssessmentTemplatesPage() {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const result = await loadWorkspace(async () => {
    requireRole(actor, "administrator");
    const [templates, workspace] = await Promise.all([
      readAdminAssessmentTemplates(client),
      readSafetyWorkspace(client),
    ]);
    return {
      templates,
      subjects: workspace.subjects,
      audit: workspace.audit.filter((item) => item.entityType.includes("assessment_template")),
    };
  });
  if (!result.ok) return <WorkspaceError title="Assessment template administration" error={result.error} />;
  const { templates, subjects, audit } = result.value;
  return (
    <>
      <WorkspaceHeading
        eyebrow="Reusable, reviewed definitions"
        title="Assessment templates."
        description="Maintain topic-tagged questions and answer keys in recorded versions. Tutors create editable drafts within their authorized learning relationships."
      />
      <AdminNav current="/admin/assessment-templates" />
      <div className="workspace-grid">
        <div className="workspace-stack">
          {templates.map((template) => (
            <Section key={template.id} title={template.title} eyebrow={`Version ${template.version}`}>
              <Status>{template.active ? "Available to tutors" : "Inactive"}</Status>
              <p>{template.description}</p>
              <p className="hint">
                {template.questions.length} questions · {template.purpose.replaceAll("_", " ")} · Saved{" "}
                {formatInstant(template.createdAt)}
              </p>
              <details className="workspace-details">
                <summary>Revise this template</summary>
                <AssessmentTemplateEditor template={template} subjects={subjects} action={assessmentTemplateAction} />
              </details>
            </Section>
          ))}
          {!templates.length && (
            <Section title="No template versions yet">
              <p>Create a reviewed question set to make it available to eligible tutors.</p>
            </Section>
          )}
          <Section title="Template audit history">
            <ul className="workspace-records">
              {audit.map((item) => (
                <li className="workspace-record" key={item.id}>
                  <strong>{item.action}</strong>
                  <p>{item.reason}</p>
                  <p className="hint">
                    {formatInstant(item.createdAt)} · {item.entityId}
                  </p>
                </li>
              ))}
            </ul>
            {!audit.length && <p>No template audit entries were returned.</p>}
          </Section>
        </div>
        <Section title="Create a template">
          <AssessmentTemplateEditor subjects={subjects} action={assessmentTemplateAction} />
        </Section>
      </div>
    </>
  );
}
