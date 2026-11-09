import { AdminNav } from "../console-nav";
import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { requireRole } from "@/domains/auth/policy";
import { readAdminWorkspace } from "@/domains/platform/service";
import type { Resource, Subject } from "@/domains/platform/types";
import { WorkspaceHeading, WorkspaceError, Section, EmptyState, Status, formatDate } from "@/components/workspace/ui";
import { loadWorkspace } from "@/components/workspace/load";
import { WorkflowForm, type WorkflowField } from "@/components/workspace/workflow-form";
import { resolveReportAction, moderateReviewAction, saveResourceAction, saveSubjectAction } from "./actions";

export default async function SafetyAdminPage() {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const result = await loadWorkspace(() => {
    requireRole(actor, "administrator");
    return readAdminWorkspace(client);
  });
  if (!result.ok) return <WorkspaceError title="Safety & content administration" error={result.error} />;
  const { reports, subjects, resources, audit, reviews } = result.value;
  return (
    <>
      <WorkspaceHeading
        eyebrow="Narrow, recorded administration"
        title="Safety & learning content."
        description="Review reported concerns, curate the resource library and maintain the subject taxonomy. Moderation decisions require a reason."
      >
        <Link className="button secondary" href="/admin">
          Account capabilities →
        </Link>
      </WorkspaceHeading>
      <AdminNav current="/admin/safety" />
      <div className="workspace-grid">
        <div className="workspace-stack">
          <Section title="Safety reports" eyebrow={`${reports.length} visible reports`}>
            {!reports.length ? (
              <EmptyState title="No reports to review">
                Submitted concerns will appear here for authorized review.
              </EmptyState>
            ) : (
              <ul className="workspace-records">
                {reports.map((report) => (
                  <li className="workspace-record" key={report.id}>
                    <div className="workspace-record-head">
                      <h3>Report · {formatDate(report.createdAt)}</h3>
                      <Status>{report.state}</Status>
                    </div>
                    <p className="workspace-prose">{report.reason}</p>
                    <dl className="workspace-facts">
                      <div>
                        <dt>Report reference</dt>
                        <dd>{report.id}</dd>
                      </div>
                      <div>
                        <dt>Target</dt>
                        <dd>
                          {report.targetReviewId ? `Review ${report.targetReviewId}` : `Account ${report.targetUserId}`}
                        </dd>
                      </div>
                      {report.resolvedAt && (
                        <div>
                          <dt>Resolved</dt>
                          <dd>{formatDate(report.resolvedAt)}</dd>
                        </div>
                      )}
                    </dl>
                    <details className="workspace-details">
                      <summary>Review & record a decision</summary>
                      <WorkflowForm
                        title="Resolve safety report"
                        action={resolveReportAction}
                        hidden={{ id: report.id }}
                        submit="Record decision"
                        fields={[
                          {
                            name: "state",
                            label: "Review state",
                            type: "select",
                            required: true,
                            value: report.state === "open" ? "reviewing" : report.state,
                            options: [
                              { value: "reviewing", label: "Review in progress" },
                              { value: "resolved", label: "Resolved" },
                              { value: "dismissed", label: "Dismissed" },
                            ],
                          },
                          {
                            name: "reason",
                            label: "Decision reason",
                            type: "textarea",
                            required: true,
                            wide: true,
                            maxLength: 500,
                          },
                          {
                            name: "confirmed",
                            label: "I confirm this administrative decision",
                            type: "checkbox",
                            required: true,
                            wide: true,
                          },
                        ]}
                      />
                    </details>
                    {report.targetReviewId && (
                      <details className="workspace-details">
                        <summary>Moderate the reported review</summary>
                        <WorkflowForm
                          title="Moderate reported review"
                          action={moderateReviewAction}
                          hidden={{ id: report.targetReviewId }}
                          submit="Record review visibility"
                          fields={[
                            {
                              name: "status",
                              label: "Public review visibility",
                              type: "select",
                              required: true,
                              options: [
                                { value: "visible", label: "Visible" },
                                { value: "hidden", label: "Hidden" },
                              ],
                            },
                            {
                              name: "reason",
                              label: "Moderation reason",
                              type: "textarea",
                              required: true,
                              wide: true,
                              maxLength: 500,
                            },
                            {
                              name: "confirmed",
                              label: "I confirm this review visibility change",
                              type: "checkbox",
                              required: true,
                              wide: true,
                            },
                          ]}
                        />
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Review moderation">
            <ul className="workspace-records">
              {reviews.map((review) => (
                <li className="workspace-record" key={review.id}>
                  <div className="workspace-record-head">
                    <h3>
                      {review.rating} / 5 · {formatDate(review.createdAt)}
                    </h3>
                    <Status>{review.moderationStatus}</Status>
                  </div>
                  <p className="workspace-prose">{review.comment ?? "No comment submitted"}</p>
                  {review.recommended && <p className="hint">Learner recommended this tutor.</p>}
                  <p>
                    <Link className="small-link" href={`/tutors/${review.tutorId}`}>
                      Public tutor profile →
                    </Link>
                  </p>
                  <details className="workspace-details">
                    <summary>Change this review’s visibility</summary>
                    <WorkflowForm
                      title="Moderate review"
                      action={moderateReviewAction}
                      hidden={{ id: review.id }}
                      submit="Record moderation"
                      fields={[
                        {
                          name: "status",
                          label: "Public review visibility",
                          type: "select",
                          required: true,
                          value: review.moderationStatus,
                          options: [
                            { value: "visible", label: "Visible" },
                            { value: "hidden", label: "Hidden" },
                          ],
                        },
                        {
                          name: "reason",
                          label: "Moderation reason",
                          type: "textarea",
                          required: true,
                          maxLength: 500,
                          wide: true,
                        },
                        {
                          name: "confirmed",
                          label: "I confirm this review visibility change",
                          type: "checkbox",
                          required: true,
                          wide: true,
                        },
                      ]}
                    />
                  </details>
                </li>
              ))}
            </ul>
            {!reviews.length && <p>No reviews were returned for moderation.</p>}
          </Section>
          <Section title="Resources" eyebrow={`${resources.length} saved`}>
            <details className="workspace-details">
              <summary>Add a learning resource</summary>
              <ResourceEditor subjects={subjects} />
            </details>
            <ul className="workspace-records">
              {resources.map((resource) => (
                <li className="workspace-record" key={resource.id}>
                  <div className="workspace-record-head">
                    <h3>{resource.title}</h3>
                    <Status>{resource.active ? "Active" : "Inactive"}</Status>
                  </div>
                  <p>{resource.description}</p>
                  <details className="workspace-details">
                    <summary>Edit resource & attribution</summary>
                    <ResourceEditor subjects={subjects} resource={resource} />
                  </details>
                </li>
              ))}
            </ul>
          </Section>
        </div>
        <div className="workspace-stack">
          <Section title="Subject taxonomy">
            <details className="workspace-details">
              <summary>Add a subject</summary>
              <SubjectEditor subjects={subjects} />
            </details>
            <ul className="workspace-records">
              {subjects.map((subject) => (
                <li className="workspace-record" key={subject.id}>
                  <div className="workspace-record-head">
                    <h3>{subject.name}</h3>
                    <Status>{subject.active ? "Active" : "Inactive"}</Status>
                  </div>
                  <p className="hint">
                    {subject.slug} · Order {subject.sortOrder}
                  </p>
                  <details className="workspace-details">
                    <summary>Edit subject</summary>
                    <SubjectEditor subjects={subjects} subject={subject} />
                  </details>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Recent audit history">
            <ul className="workspace-records">
              {audit.map((entry) => (
                <li className="workspace-record" key={entry.id}>
                  <strong>{entry.action.replaceAll("_", " ")}</strong>
                  <p>{entry.reason}</p>
                  <p className="hint">
                    {entry.entityType} · {entry.entityId} · {formatDate(entry.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
            {!audit.length && <p>No audit entries were returned.</p>}
          </Section>
        </div>
      </div>
    </>
  );
}

function ResourceEditor({ subjects, resource }: { subjects: Subject[]; resource?: Resource }) {
  const fields: WorkflowField[] = [
    { name: "title", label: "Resource title", required: true, maxLength: 200, value: resource?.title, wide: true },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      required: true,
      maxLength: 500,
      value: resource?.description,
      wide: true,
    },
    { name: "url", label: "Resource URL", type: "url", required: true, value: resource?.url, wide: true },
    {
      name: "subjectId",
      label: "Subject",
      type: "select",
      value: resource?.subjectId ?? "",
      options: subjects.map((subject) => ({ value: subject.id, label: subject.name })),
    },
    {
      name: "resourceType",
      label: "Resource type",
      type: "select",
      required: true,
      value: resource?.resourceType ?? "article",
      options: ["article", "video", "practice", "reference", "other"].map((type) => ({
        value: type,
        label: type[0].toUpperCase() + type.slice(1),
      })),
    },
    {
      name: "attribution",
      label: "Attribution & source",
      required: true,
      maxLength: 1000,
      value: resource?.attribution ?? "",
      wide: true,
    },
    {
      name: "reason",
      label: "Reason for this content change",
      type: "textarea",
      required: true,
      wide: true,
      maxLength: 500,
    },
    { name: "confirmed", label: "I confirm this resource change", type: "checkbox", required: true, wide: true },
    {
      name: "active",
      label: "Show in the learning resource library",
      type: "checkbox",
      checked: resource?.active ?? true,
      wide: true,
    },
  ];
  return (
    <WorkflowForm
      title={resource ? "Edit learning resource" : "Add learning resource"}
      action={saveResourceAction}
      fields={fields}
      hidden={{ id: resource?.id ?? "" }}
      submit="Save resource"
    />
  );
}
function SubjectEditor({ subjects, subject }: { subjects: Subject[]; subject?: Subject }) {
  return (
    <WorkflowForm
      title={subject ? "Edit subject" : "Create subject"}
      action={saveSubjectAction}
      hidden={{ id: subject?.id ?? "" }}
      submit="Save subject"
      fields={[
        { name: "name", label: "Subject name", required: true, value: subject?.name, maxLength: 100 },
        {
          name: "slug",
          label: "URL slug",
          required: true,
          value: subject?.slug,
          maxLength: 100,
          hint: "Use lowercase letters, digits and hyphens.",
        },
        {
          name: "parentId",
          label: "Parent subject",
          type: "select",
          value: subject?.parentId ?? "",
          options: subjects.filter((row) => row.id !== subject?.id).map((row) => ({ value: row.id, label: row.name })),
        },
        {
          name: "sortOrder",
          label: "Display order",
          type: "number",
          required: true,
          min: 0,
          max: 10000,
          value: String(subject?.sortOrder ?? 0),
        },
        {
          name: "reason",
          label: "Reason for this taxonomy change",
          type: "textarea",
          required: true,
          wide: true,
          maxLength: 500,
        },
        { name: "confirmed", label: "I confirm this subject change", type: "checkbox", required: true, wide: true },
        {
          name: "active",
          label: "Available for tutor subject offerings",
          type: "checkbox",
          checked: subject?.active ?? true,
          wide: true,
        },
      ]}
    />
  );
}
