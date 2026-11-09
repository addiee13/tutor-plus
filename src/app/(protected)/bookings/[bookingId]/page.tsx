import { BookingLearningNotes } from "./notes";
import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { getWorkspace } from "@/domains/sessions/service";
import { listBookingRescheduleHistory } from "@/domains/marketplace/service";
import { formatMoney, formatUtc } from "@/domains/bookings/presentation";
import { loadWorkspace } from "@/components/workspace/load";
import { WorkspaceHeading, WorkspaceError, Section, Status, formatInstant } from "@/components/workspace/ui";
export default async function BookingDetails({ params }: { params: Promise<{ bookingId: string }> }) {
  if (!publicConfig()) return null;
  const { bookingId } = await params;
  const { client } = await protectedContext();
  const result = await loadWorkspace(() =>
    Promise.all([getWorkspace(client, bookingId), listBookingRescheduleHistory(client, bookingId)]),
  );
  if (!result.ok) return <WorkspaceError title="Booking details" error={result.error} />;
  const [workspace, history] = result.value;
  const { booking } = workspace;
  return (
    <>
      <WorkspaceHeading
        eyebrow="Your saved reservation record"
        title="Booking details."
        description={`${workspace.subjectName} · ${workspace.tutorName}.`}
      >
        <Status>{booking.status.replaceAll("_", " ")}</Status>
      </WorkspaceHeading>
      <div className="workspace-grid">
        <Section title="Current booking">
          <dl className="workspace-facts">
            <div>
              <dt>Booking reference</dt>
              <dd>{booking.id}</dd>
            </div>
            <div>
              <dt>Starts</dt>
              <dd>{formatUtc(booking.starts_at)}</dd>
            </div>
            <div>
              <dt>Ends</dt>
              <dd>{formatUtc(booking.ends_at)}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{booking.mode === "virtual" ? "Virtual" : "In person"}</dd>
            </div>
            <div>
              <dt>Saved price</dt>
              <dd>{formatMoney(booking.price_minor, booking.currency)}</dd>
            </div>
          </dl>
          {booking.cancellation_reason && <p>Cancellation reason: {booking.cancellation_reason}</p>}
          {["confirmed", "in_progress", "completed"].includes(booking.status) && (
            <Link className="button primary" href={`/sessions/${booking.id}`}>
              Open session & private meeting details →
            </Link>
          )}
          <p className="hint">
            Payment is unavailable. This page does not create a charge, refund or payment confirmation.
          </p>
        </Section>
        <Section title="Time-change history">
          <ul className="workspace-records">
            {history.map((change) => (
              <li className="workspace-record" key={change.id}>
                <h3>Booking version {change.bookingVersion}</h3>
                <dl className="workspace-facts">
                  <div>
                    <dt>Previous time</dt>
                    <dd>
                      {formatUtc(change.oldStartsAt)} – {formatUtc(change.oldEndsAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>New time</dt>
                    <dd>
                      {formatUtc(change.newStartsAt)} – {formatUtc(change.newEndsAt)}
                    </dd>
                  </div>
                </dl>
                <p>{change.reason}</p>
                <p className="hint">
                  Recorded {formatInstant(change.createdAt)} · Participant reference {change.actorId}
                </p>
              </li>
            ))}
          </ul>
          {!history.length && <p>No saved time changes for this booking.</p>}
        </Section>
      </div>
      <div style={{ marginTop: "1.5rem" }}>
        <BookingLearningNotes client={client} bookingId={bookingId} role={workspace.role} />
      </div>
      <p>
        <Link className="small-link" href="/bookings">
          ← All bookings
        </Link>
      </p>
    </>
  );
}
