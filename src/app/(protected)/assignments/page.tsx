import { loadWorkspace } from "@/components/workspace/load";
import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { hasRole } from "@/domains/auth/policy";
import { listAssignments, listLearningRelationships, listAssignmentMilestoneOptions } from "@/domains/learning/service";
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
import { AssignmentEditor } from "../learning/editors";
export default async function AssignmentsPage() {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const loaded = await loadWorkspace(async () => {
    const tutor = hasRole(actor, "tutor");
    const [items, relationships, milestones] = await Promise.all([
      listAssignments(client),
      listLearningRelationships(client),
      tutor ? listAssignmentMilestoneOptions(client) : Promise.resolve([]),
    ]);
    return { items, relationships: relationships.filter((row) => row.studentId !== actor.id), tutor, milestones };
  });
  if (!loaded.ok) return <WorkspaceError title="Assignments" error={loaded.error} />;
  const { items, relationships, tutor, milestones } = loaded.value;
  return (
    <>
      <WorkspaceHeading
        eyebrow="Practice with purpose"
        title="Assignments."
        description="Keep instructions, submissions and tutor feedback together, with a clear deadline and a saved history of your work."
      />
      <WorkspaceTabs items={learningTabs} current="/assignments" />
      <div className={tutor ? "workspace-grid" : "workspace-stack"}>
        <Section title="Your assignments">
          {items.length ? (
            <ul className="workspace-records">
              {items.map((item) => (
                <li className="workspace-record" key={item.id}>
                  <div className="workspace-record-head">
                    <h3>
                      <Link href={`/assignments/${item.id}`}>{item.title}</Link>
                    </h3>
                    <Status>{item.status}</Status>
                  </div>
                  <p className="hint">
                    Due {formatDate(item.due_at)} ·{" "}
                    {item.submission_type === "file"
                      ? "Private file"
                      : item.submission_type === "link"
                        ? "Link"
                        : "Written response"}
                  </p>
                  <Link className="button secondary compact" href={`/assignments/${item.id}`}>
                    Open assignment →
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No assignments yet">
              {tutor
                ? "Set a focused task for a learner from an established tutoring relationship."
                : "Your tutor’s assignments and practice tasks will appear here."}
            </EmptyState>
          )}
        </Section>
        {tutor && (
          <Section title="Create an assignment" eyebrow="Tutor workspace">
            {!relationships.length && (
              <p className="notice warning">You need a confirmed or completed tutoring relationship to assign work.</p>
            )}
            <AssignmentEditor relationships={relationships} milestoneOptions={milestones} />
          </Section>
        )}
      </div>
    </>
  );
}
