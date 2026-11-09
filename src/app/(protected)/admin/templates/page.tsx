import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { requireRole } from "@/domains/auth/policy";
import { readAdminWorkspace } from "@/domains/platform/service";
import { notificationCategories, type NotificationTemplate } from "@/domains/platform/types";
import { loadWorkspace } from "@/components/workspace/load";
import { WorkspaceHeading, WorkspaceError, Section, Status, formatDate } from "@/components/workspace/ui";
import { WorkflowForm } from "@/components/workspace/workflow-form";
import { templateAction } from "../console-actions";
import { AdminNav } from "../console-nav";
export default async function AdminTemplates() {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const result = await loadWorkspace(() => {
    requireRole(actor, "administrator");
    return readAdminWorkspace(client);
  });
  if (!result.ok) return <WorkspaceError title="Notification templates" error={result.error} />;
  return (
    <>
      <WorkspaceHeading
        eyebrow="Clear, recorded communication"
        title="Notification templates."
        description="Maintain plain-text notice content and destination paths. Each confirmed change records a version and an audit reason."
      />
      <AdminNav current="/admin/templates" />
      <div className="workspace-grid">
        <div className="workspace-stack">
          {result.value.templates.map((template) => (
            <Section
              key={template.id}
              title={template.title}
              eyebrow={`${template.category.replaceAll("_", " ")} · version ${template.version}`}
            >
              <Status>{template.active ? "Active" : "Inactive"}</Status>
              <p className="workspace-prose">{template.body}</p>
              <p className="hint">Last updated {formatDate(template.updatedAt)}</p>
              <details className="workspace-details">
                <summary>Edit this template</summary>
                <TemplateEditor template={template} />
              </details>
            </Section>
          ))}
          {!result.value.templates.length && (
            <Section title="No templates yet">
              <p>Add the first template for a supported notification category.</p>
            </Section>
          )}
        </div>
        <Section title="Create a template">
          <TemplateEditor />
        </Section>
      </div>
    </>
  );
}
function TemplateEditor({ template }: { template?: NotificationTemplate }) {
  return (
    <WorkflowForm
      title={template ? "Edit notification template" : "Create notification template"}
      action={templateAction}
      hidden={{ id: template?.id ?? "" }}
      submit="Save confirmed template"
      fields={[
        {
          name: "category",
          label: "Notification category",
          type: "select",
          required: true,
          value: template?.category,
          options: notificationCategories.map((category) => ({
            value: category,
            label: category.replaceAll("_", " "),
          })),
        },
        { name: "title", label: "Notice title", required: true, maxLength: 200, value: template?.title },
        {
          name: "body",
          label: "Notice body",
          type: "textarea",
          required: true,
          maxLength: 5000,
          value: template?.body,
          wide: true,
        },
        {
          name: "targetPath",
          label: "Destination path",
          value: template?.targetPath ?? "",
          wide: true,
          hint: "An internal path such as /bookings. External destinations are not accepted.",
        },
        {
          name: "active",
          label: "Use this template for future notices",
          type: "checkbox",
          checked: template?.active ?? true,
          wide: true,
        },
        {
          name: "reason",
          label: "Reason for this template change",
          type: "textarea",
          required: true,
          maxLength: 500,
          wide: true,
        },
        {
          name: "confirmed",
          label: "I confirm this notification template change",
          type: "checkbox",
          required: true,
          wide: true,
        },
      ]}
    />
  );
}
