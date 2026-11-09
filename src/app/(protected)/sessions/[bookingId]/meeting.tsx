import { readBookingPrivateDetails } from "@/domains/marketplace/service";
import type { UserClient } from "@/lib/supabase/server";
import { loadWorkspace } from "@/components/workspace/load";
import { WorkflowForm } from "@/components/workspace/workflow-form";
import { safeMessage } from "@/domains/shared/errors";
import { meetingDetailsAction } from "./actions";
export async function PrivateMeetingDetails({
  client,
  bookingId,
  isTutor,
}: {
  client: UserClient;
  bookingId: string;
  isTutor: boolean;
}) {
  const result = await loadWorkspace(() => readBookingPrivateDetails(client, bookingId));
  if (!result.ok)
    return (
      <section className="panel workspace-section">
        <h2>Private meeting details</h2>
        <p className="notice warning" role="alert">
          {safeMessage(result.error)}
        </p>
      </section>
    );
  const details = result.value;
  return (
    <section className="panel workspace-section">
      <span className="eyebrow">Booking participants only</span>
      <h2>Where you’ll meet</h2>
      {details?.meetingUrl && (
        <p>
          <a className="button secondary" href={details.meetingUrl} target="_blank" rel="noreferrer">
            Open meeting link ↗
          </a>
        </p>
      )}
      {details?.meetingPlace && <p className="workspace-prose">{details.meetingPlace}</p>}
      {!details?.meetingUrl && !details?.meetingPlace && (
        <p>The tutor has not shared a meeting link or place for this session yet.</p>
      )}
      {isTutor && (
        <details className="workspace-details">
          <summary>Edit private meeting details</summary>
          <WorkflowForm
            title="Save private meeting details"
            action={meetingDetailsAction}
            hidden={{ bookingId }}
            submit="Save meeting details"
            fields={[
              {
                name: "meetingUrl",
                label: "Secure meeting link",
                type: "url",
                value: details?.meetingUrl ?? "",
                wide: true,
                hint: "Use an HTTPS link from your meeting provider.",
              },
              {
                name: "meetingPlace",
                label: "Meeting place & instructions",
                type: "textarea",
                value: details?.meetingPlace ?? "",
                wide: true,
                maxLength: 1000,
                hint: "Shared only with the participants on this booking.",
              },
            ]}
          />
        </details>
      )}
    </section>
  );
}
