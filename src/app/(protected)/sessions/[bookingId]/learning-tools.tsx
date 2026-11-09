import Link from "next/link";
import type { UserClient } from "@/lib/supabase/server";
import { listSessionLearningLinkOptions } from "@/domains/sessions/service";
import type { SessionAgendaLinkInput, SessionWorkspace } from "@/domains/sessions/types";
import { safeMessage } from "@/domains/shared/errors";
import { loadWorkspace } from "@/components/workspace/load";
import { Section, Status, formatInstant, formatFileSize } from "@/components/workspace/ui";
import { WorkflowForm } from "@/components/workspace/workflow-form";
import {
  saveAgendaLinksAction,
  uploadSessionAttachmentAction,
  reviewSessionAttachmentAction,
  prepareSessionAttachmentUploadAction,
} from "./actions";

function linkValue(link: SessionAgendaLinkInput): string {
  return link.kind === "milestone" ? `milestone:${link.studyPlanId}:${link.milestoneId}` : `${link.kind}:${link.id}`;
}
function linkPath(link: SessionAgendaLinkInput): string {
  return link.kind === "milestone"
    ? `/study-plans/${link.studyPlanId}`
    : link.kind === "resource"
      ? `/resources?resource=${link.id}`
      : link.kind === "assignment"
        ? `/assignments/${link.id}`
        : `/assessments/${link.id}`;
}

export async function AgendaLearningLinks({ client, workspace }: { client: UserClient; workspace: SessionWorkspace }) {
  const result = workspace.can.editAgenda
    ? await loadWorkspace(() => listSessionLearningLinkOptions(client, workspace.booking.id))
    : null;
  return (
    <Section title="Agenda learning links">
      <p>Resources, assigned work, assessments and milestones selected for this booked session.</p>
      {workspace.agendaLinks.length ? (
        <ol className="workspace-records">
          {workspace.agendaLinks.map((link) => (
            <li className="workspace-record" key={link.position}>
              <Link className="small-link" href={linkPath(link)}>
                {link.label} →
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p>No learning records have been linked to this agenda.</p>
      )}
      {result && !result.ok && (
        <p className="notice warning" role="alert">
          {safeMessage(result.error)}
        </p>
      )}
      {result?.ok && (
        <WorkflowForm
          title="Save agenda learning links"
          action={saveAgendaLinksAction}
          hidden={{ booking: workspace.booking.id }}
          submit="Save agenda links"
          fields={[
            {
              name: "learningLinks",
              label: "Learning records for this agenda",
              type: "choices",
              wide: true,
              options: result.value.map((link) => ({ value: linkValue(link), label: link.label })),
              selected: workspace.agendaLinks.map(linkValue),
              hint: "Choose up to twenty records. Their authorization is checked again when saved.",
            },
          ]}
        />
      )}
    </Section>
  );
}

export function SessionAttachments({ workspace }: { workspace: SessionWorkspace }) {
  return (
    <Section title="Preparation files">
      <p>Files stay within this booked learning relationship, with a recorded tutor review.</p>
      {workspace.can.uploadAttachment && (
        <WorkflowForm
          title="Upload preparation file"
          action={uploadSessionAttachmentAction}
          prepareUpload={prepareSessionAttachmentUploadAction}
          hidden={{ booking: workspace.booking.id }}
          submit="Upload preparation file"
          fields={[
            {
              name: "file",
              label: "Preparation file",
              type: "file",
              required: true,
              wide: true,
              accept: "application/pdf,image/png,image/jpeg,text/plain",
              hint: "PDF, PNG, JPEG or plain text, up to 10 MiB. Choose the file again if an upload fails.",
            },
          ]}
        />
      )}
      <ul className="workspace-records">
        {workspace.attachments.map((attachment, index) => (
          <li className="workspace-record" key={attachment.id} data-attachment-id={attachment.id}>
            <div className="workspace-record-head">
              <h3>Preparation file {index + 1}</h3>
              <Status>{attachment.status}</Status>
            </div>
            <p className="hint">
              {attachment.file_mime} · {formatFileSize(attachment.file_size_bytes)} · Uploaded{" "}
              {formatInstant(attachment.created_at)}
            </p>
            {(workspace.role === "student" || attachment.status === "approved") && (
              <Link className="button secondary compact" href={`/sessions/files/${attachment.id}`} target="_blank">
                Open private preparation file ↗
              </Link>
            )}
            {workspace.role === "tutor" && attachment.status === "pending" && (
              <p className="hint">Your approval is required before this file can be opened from the tutor workspace.</p>
            )}
            {attachment.reviewed_at && <p className="hint">Reviewed {formatInstant(attachment.reviewed_at)}</p>}
            {attachment.review_reason && <p className="workspace-prose">{attachment.review_reason}</p>}
            {workspace.can.reviewAttachment && attachment.status === "pending" && (
              <WorkflowForm
                title={`Review preparation file ${index + 1}`}
                action={reviewSessionAttachmentAction}
                hidden={{ booking: workspace.booking.id, attachmentId: attachment.id }}
                submit="Record file review"
                fields={[
                  {
                    name: "decision",
                    label: "Review decision",
                    type: "select",
                    required: true,
                    options: [
                      { value: "approved", label: "Approve" },
                      { value: "rejected", label: "Reject" },
                    ],
                  },
                  {
                    name: "reason",
                    label: "Review reason",
                    type: "textarea",
                    maxLength: 500,
                    wide: true,
                    hint: "A reason is required when rejecting a file.",
                  },
                  {
                    name: "confirmed",
                    label: "I confirm this preparation-file review decision",
                    type: "checkbox",
                    required: true,
                    wide: true,
                  },
                ]}
              />
            )}
          </li>
        ))}
      </ul>
      {!workspace.attachments.length && <p>No preparation files have been uploaded.</p>}
    </Section>
  );
}
