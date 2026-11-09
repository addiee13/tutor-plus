import { protectedContext } from "@/lib/protected-context";
import { publicConfig } from "@/lib/supabase/config";
import { requireRole } from "@/domains/auth/policy";
import { readAdminWorkspace } from "@/domains/platform/service";
import { loadWorkspace } from "@/components/workspace/load";
import { WorkspaceHeading, WorkspaceError, Section, Status, formatInstant } from "@/components/workspace/ui";
import { WorkflowForm } from "@/components/workspace/workflow-form";
import { AdminNav } from "../console-nav";
import { resolveAssistantReportAction } from "./actions";
export default async function AdminOperationsPage() {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const result = await loadWorkspace(() => {
    requireRole(actor, "administrator");
    return readAdminWorkspace(client);
  });
  if (!result.ok) return <WorkspaceError title="Operational overview & assistant reports" error={result.error} />;
  const { operationalHealth, assistantReports } = result.value;
  return (
    <>
      <WorkspaceHeading
        eyebrow="Aggregate operations, recorded decisions"
        title="Operations & assistant reports."
        description="Review operational counters and response concerns through account-scoped request references."
      />
      <AdminNav current="/admin/operations" />
      <div className="workspace-grid">
        <Section title="Operational metrics">
          <p>
            These values describe the recorded window. They do not by themselves prove provider delivery or service
            availability.
          </p>
          {operationalHealth.length ? (
            <dl className="workspace-facts">
              {operationalHealth.map((metric) => (
                <div key={metric.key}>
                  <dt>{metric.key.replaceAll("_", " ")}</dt>
                  <dd>
                    {metric.value.toLocaleString("en-US")}
                    <p className="hint">
                      {metric.windowStart ? `Window starts ${formatInstant(metric.windowStart)}` : "Current aggregate"}
                    </p>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>No operational metric rows were returned.</p>
          )}
        </Section>
        <Section title="Assistant response reports">
          <p>
            Report reasons and request references appear here. The original question, selected context and generated
            answer are not automatically attached to this view.
          </p>
          <ul className="workspace-records">
            {assistantReports.map((report) => (
              <li className="workspace-record" key={report.id}>
                <div className="workspace-record-head">
                  <h3>Response concern · {formatInstant(report.createdAt)}</h3>
                  <Status>{report.state}</Status>
                </div>
                <p className="workspace-prose">{report.reason}</p>
                <p className="hint">
                  Report {report.id} · Request {report.requestId}
                </p>
                {report.resolutionReason && (
                  <p className="workspace-prose">Decision reason: {report.resolutionReason}</p>
                )}
                {report.resolvedAt && <p className="hint">Decision recorded {formatInstant(report.resolvedAt)}</p>}
                <details className="workspace-details">
                  <summary>Review this response concern</summary>
                  <WorkflowForm
                    title="Resolve assistant response report"
                    action={resolveAssistantReportAction}
                    hidden={{ id: report.id }}
                    submit="Record response review"
                    fields={[
                      {
                        name: "state",
                        label: "Report state",
                        type: "select",
                        required: true,
                        value: report.state === "open" ? "reviewing" : report.state,
                        options: [
                          { value: "reviewing", label: "Reviewing" },
                          { value: "resolved", label: "Resolved" },
                          { value: "dismissed", label: "Dismissed" },
                        ],
                      },
                      {
                        name: "reason",
                        label: "Decision reason",
                        type: "textarea",
                        required: true,
                        maxLength: 500,
                        wide: true,
                      },
                      {
                        name: "confirmed",
                        label: "I confirm this assistant report decision",
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
          {!assistantReports.length && <p>No assistant response reports were returned.</p>}
        </Section>
      </div>
    </>
  );
}
