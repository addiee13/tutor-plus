import { hasRole } from "@/domains/auth/policy";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { listResources, readAssistantStatus } from "@/domains/platform/service";
import { listLearningRelationships, listStudyPlans } from "@/domains/learning/service";
import { WorkspaceHeading, WorkspaceError, Section } from "@/components/workspace/ui";
import { loadWorkspace } from "@/components/workspace/load";
import { AssistantForm } from "./form";
export default async function AssistantPage() {
  if (!publicConfig()) return null;
  const { client, actor } = await protectedContext();
  const status = await readAssistantStatus();
  const result = await loadWorkspace(() =>
    Promise.all([listResources(client), listLearningRelationships(client), listStudyPlans(client)]),
  );
  if (!result.ok) return <WorkspaceError title="Learning assistant" error={result.error} />;
  const [resources, relationships, plans] = result.value;
  return (
    <>
      <WorkspaceHeading
        eyebrow="Another way into the idea"
        title="Learning assistant."
        description="Ask a focused learning question and choose the shared context that helps explain it."
      />
      <div className="workspace-grid">
        <Section title="Work through a question">
          {!status.configured && (
            <div className="notice warning" role="status">
              <strong>The learning assistant is not configured yet.</strong>
              <p>Your question cannot be sent until an administrator connects the assistant provider.</p>
            </div>
          )}
          {!hasRole(actor, "student") && (
            <p className="notice warning">Student capability is required to ask the learning assistant.</p>
          )}
          <p className="notice warning">
            AI guidance can be inaccurate. Check it against your course instructions and learning materials before using
            it. Suggestions remain drafts until an authorized person confirms a change.
          </p>
          <AssistantForm
            configured={status.configured && hasRole(actor, "student")}
            promptLimit={status.promptLimit}
            resources={resources}
            relationships={relationships}
            plans={plans}
          />
        </Section>
        <Section title="Keep your learning in your hands">
          <p>
            The assistant can help explain concepts and suggest practice. You and your tutor decide what becomes part of
            a saved plan.
          </p>
          <p>Choose relevant resources, a session or a study plan when you want more focused help.</p>
        </Section>
      </div>
    </>
  );
}
