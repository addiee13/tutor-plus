import Link from "next/link";
import { protectedContext } from "@/lib/protected-context";
import { publicConfig } from "@/lib/supabase/config";
import { requireRole } from "@/domains/auth/policy";
import { listSavedTutors } from "@/domains/marketplace/service";
import { formatMoney } from "@/domains/bookings/presentation";
import { loadWorkspace } from "@/components/workspace/load";
import { WorkspaceHeading, WorkspaceError, Section, EmptyState } from "@/components/workspace/ui";
import { WorkflowForm } from "@/components/workspace/workflow-form";
import { TutorAvatar } from "@/components/workspace/tutor-avatar";
import { unsaveTutorAction } from "../dashboard/actions";
export default async function SavedTutorsPage() {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const result = await loadWorkspace(() => {
    requireRole(actor, "student");
    return listSavedTutors(client);
  });
  if (!result.ok) return <WorkspaceError title="Saved tutors" error={result.error} />;
  return (
    <>
      <WorkspaceHeading
        eyebrow="Keep a useful connection"
        title="Your saved tutors."
        description="Return to the currently public teaching profiles you chose to keep with your account."
      />
      <Section title="Saved teaching profiles">
        {result.value.length >= 50 && (
          <p className="notice warning">
            This view shows up to 50 recently saved profiles. Older saved profiles may not appear until you remove a
            more recent one.
          </p>
        )}
        <div className="tutor-grid">
          {result.value.map((tutor) => (
            <article className="workspace-record" key={tutor.id}>
              <div className="tutor-identity">
                <TutorAvatar name={tutor.publicDisplayName} url={tutor.publicAvatarUrl} />
                <div>
                  <h3>
                    <Link href={`/tutors/${tutor.id}`}>{tutor.publicDisplayName}</Link>
                  </h3>
                  <p>{tutor.headline}</p>
                </div>
              </div>
              <p>{formatMoney(tutor.hourlyRateMinor, tutor.currency)} / hour</p>
              <WorkflowForm
                title={`Remove saved tutor ${tutor.publicDisplayName}`}
                action={unsaveTutorAction}
                hidden={{ tutorId: tutor.id }}
                submit="Remove saved tutor"
              />
            </article>
          ))}
        </div>
        {!result.value.length && (
          <EmptyState title="No currently public tutors saved">
            Save a teaching profile while browsing tutors to return to it later.
          </EmptyState>
        )}
        <Link className="button secondary" href="/tutors">
          Browse teaching profiles →
        </Link>
      </Section>
    </>
  );
}
