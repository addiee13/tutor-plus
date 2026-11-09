import { listSubjects } from "@/domains/marketplace/service";
import { loadPlanLinks } from "../learning/plan-links";
import { loadWorkspace } from "@/components/workspace/load";
import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { hasRole } from "@/domains/auth/policy";
import { listStudyPlans, listLearningRelationships } from "@/domains/learning/service";
import {
  WorkspaceHeading,
  WorkspaceTabs,
  learningTabs,
  WorkspaceError,
  Section,
  EmptyState,
  Status,
} from "@/components/workspace/ui";
import { StudyPlanEditor } from "../learning/editors";
export default async function StudyPlansPage() {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const loaded = await loadWorkspace(async () => {
    const [items, relationships, linkOptions, subjects] = await Promise.all([
      listStudyPlans(client),
      listLearningRelationships(client),
      loadPlanLinks(client),
      listSubjects(client),
    ]);
    const tutor = hasRole(actor, "tutor");
    return {
      items,
      relationships: relationships.filter((row) => row.studentId !== actor.id),
      tutor,
      linkOptions,
      subjects,
    };
  });
  if (!loaded.ok) return <WorkspaceError title="Study plans" error={loaded.error} />;
  const { items, relationships, tutor, linkOptions, subjects } = loaded.value;
  return (
    <>
      <WorkspaceHeading
        eyebrow="A path you can follow"
        title="Study plans & progress."
        description="Break learning goals into milestones, revise the plan together and connect progress to real, dated evidence."
      />
      <WorkspaceTabs items={learningTabs} current="/study-plans" />
      <div className="workspace-grid">
        <Section title="Your study plans">
          {items.length ? (
            <ul className="workspace-records">
              {items.map((plan) => (
                <li className="workspace-record" key={plan.id}>
                  <div className="workspace-record-head">
                    <h3>
                      <Link href={`/study-plans/${plan.id}`}>{plan.title}</Link>
                    </h3>
                    <Status>{plan.status}</Status>
                  </div>
                  <p className="hint">Revision {plan.current_revision} · Goals retain their revision history.</p>
                  <Link className="button secondary compact" href={`/study-plans/${plan.id}`}>
                    View plan & progress →
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Make your next steps clear">
              {tutor
                ? "Create a plan with goals and observable milestones for one of your learners."
                : "Create a personal plan, or open a plan shared by your tutor with its milestones and evidence."}
            </EmptyState>
          )}
        </Section>
        {hasRole(actor, "student") && (
          <Section title="Create your personal study plan" eyebrow="Start with your own goal">
            <p>
              Define a subject, objective, target date, starting point, practice schedule and success criterion. You can
              create this plan before booking a tutor and choose whether to share it later.
            </p>
            <StudyPlanEditor personal studentId={actor.id} subjects={subjects} linkOptions={linkOptions} />
          </Section>
        )}
        {tutor && (
          <Section title="Create a study plan" eyebrow="Tutor workspace">
            {!relationships.length && (
              <p className="notice warning">
                A confirmed or completed tutoring relationship is required before creating a shared plan.
              </p>
            )}
            <StudyPlanEditor relationships={relationships} linkOptions={linkOptions} />
          </Section>
        )}
      </div>
    </>
  );
}
