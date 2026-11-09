import { loadWorkspace } from "@/components/workspace/load";
import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { hasRole } from "@/domains/auth/policy";
import { listAssessments, listAssignments, listStudyPlans } from "@/domains/learning/service";
import {
  WorkspaceHeading,
  WorkspaceTabs,
  learningTabs,
  WorkspaceError,
  Section,
  EmptyState,
  Status,
} from "@/components/workspace/ui";

export default async function LearningPage() {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const loaded = await loadWorkspace(async () => {
    const [assessments, assignments, plans] = await Promise.all([
      listAssessments(client),
      listAssignments(client),
      listStudyPlans(client),
    ]);
    return { assessments, assignments, plans };
  });
  if (!loaded.ok) return <WorkspaceError title="Your learning desk" error={loaded.error} />;
  const { assessments, assignments, plans } = loaded.value;
  return (
    <>
      <WorkspaceHeading
        eyebrow="Steady steps, visible growth"
        title="Your learning desk."
        description={
          hasRole(actor, "tutor")
            ? "Connect assessments, practice and study plans to the learners you support."
            : "Pick up your practice, share what you know and keep the next milestone in sight."
        }
      />
      <WorkspaceTabs items={learningTabs} current="/learning" />
      <div className="workspace-grid equal">
        <Section title="Assessments" eyebrow={`${assessments.length} saved`}>
          {assessments.length ? (
            <ul className="workspace-records">
              {assessments.slice(0, 4).map((item) => (
                <li className="workspace-record" key={item.id}>
                  <Link href={`/assessments/${item.id}`}>
                    <h3>{item.title}</h3>
                  </Link>
                  <Status>{item.status}</Status>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="A starting point for learning">
              Assigned assessments help you and your tutor see what to focus on next.
            </EmptyState>
          )}
          <p>
            <Link className="small-link" href="/assessments">
              All assessments →
            </Link>
          </p>
        </Section>
        <Section title="Practice & assignments" eyebrow={`${assignments.length} saved`}>
          {assignments.length ? (
            <ul className="workspace-records">
              {assignments.slice(0, 4).map((item) => (
                <li className="workspace-record" key={item.id}>
                  <Link href={`/assignments/${item.id}`}>
                    <h3>{item.title}</h3>
                  </Link>
                  <Status>{item.status}</Status>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Make room for practice">
              Your tutor can share focused assignments once you have an established learning relationship.
            </EmptyState>
          )}
          <p>
            <Link className="small-link" href="/assignments">
              All assignments →
            </Link>
          </p>
        </Section>
      </div>
      <section style={{ marginTop: "1.5rem" }}>
        <Section title="Study plans & progress" eyebrow="Evidence of the work you do">
          {plans.length ? (
            <ul className="workspace-records">
              {plans.slice(0, 6).map((plan) => (
                <li className="workspace-record" key={plan.id}>
                  <Link href={`/study-plans/${plan.id}`}>
                    <h3>{plan.title}</h3>
                  </Link>
                  <Status>{plan.status}</Status>
                  <p className="hint">Revision {plan.current_revision}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Turn your goals into a plan">
              Study plans link milestones to saved assessments, assignments and session recaps. An assessment score
              alone does not establish mastery.
            </EmptyState>
          )}
          <p>
            <Link className="small-link" href="/study-plans">
              Open study plans →
            </Link>
          </p>
        </Section>
      </section>
    </>
  );
}
