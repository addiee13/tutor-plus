import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { getPublicTutor } from "@/domains/marketplace/service";
import { listLearningRelationships } from "@/domains/learning/service";
import { WorkspaceHeading, WorkspaceError, Section } from "@/components/workspace/ui";
import { loadWorkspace } from "@/components/workspace/load";
import { WorkflowForm, type WorkflowField } from "@/components/workspace/workflow-form";
import { safetyReportAction } from "./actions";
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const query = await searchParams;
  const tutorId = typeof query.tutor === "string" ? query.tutor : "";
  const reviewId = typeof query.review === "string" ? query.review : "";
  const result = await loadWorkspace(() =>
    Promise.all([tutorId ? getPublicTutor(client, tutorId) : Promise.resolve(null), listLearningRelationships(client)]),
  );
  if (!result.ok) return <WorkspaceError title="Report a concern" error={result.error} />;
  const [tutor, relationships] = result.value;
  const review = reviewId ? tutor?.reviews.find((item) => item.id === reviewId) : null;
  const unavailableReview = !!reviewId && !review;
  const fields: WorkflowField[] = [
    ...(!tutor
      ? [
          {
            name: "relationship",
            label: "Who is this concern about?",
            type: "select" as const,
            required: true,
            wide: true,
            options: relationships.map((row) => ({
              value: row.bookingId,
              label: `${row.studentId === actor.id ? row.tutorName : row.studentName} · ${row.subjectName}`,
            })),
          },
        ]
      : []),
    {
      name: "reason",
      label: "What should we review?",
      type: "textarea",
      required: true,
      wide: true,
      maxLength: 2000,
      hint: "Include the relevant session date or review details. Do not include passwords or payment information.",
    },
  ];
  return (
    <>
      <WorkspaceHeading
        eyebrow="A respectful learning community"
        title="Report a concern."
        description="Share a concern about an account or experience so an administrator can review the saved details."
      />
      <div className="workspace-grid">
        <Section
          title={
            review && tutor
              ? `Concern about a review on ${tutor.publicDisplayName}’s profile`
              : tutor
                ? `Concern about ${tutor.publicDisplayName}`
                : "Tell us what happened"
          }
        >
          {unavailableReview && (
            <p className="notice warning" role="alert">
              This public review is not available to report here. Open the current tutor profile and choose the review
              again.
            </p>
          )}
          {review && <p className="workspace-prose">{review.comment ?? `${review.rating} out of 5 stars`}</p>}
          {!tutor && !relationships.length && (
            <p className="notice warning">
              To report a public tutor, open their tutor profile and choose “Report a concern.” You can also report a
              participant from an established learning relationship here.
            </p>
          )}
          <WorkflowForm
            title="Submit a safety report"
            action={safetyReportAction}
            hidden={{ targetTutorId: review ? "" : (tutor?.id ?? ""), targetReviewId: review?.id ?? "" }}
            disabled={unavailableReview || (!tutor && !relationships.length)}
            submit="Send report for review"
            fields={fields}
          />
        </Section>
        <Section title="What happens next">
          <p>Your report is saved for an authorized administrator. They can record a review decision and reason.</p>
          <p>Only the participant or public tutor you select is attached to this report.</p>
        </Section>
      </div>
    </>
  );
}
