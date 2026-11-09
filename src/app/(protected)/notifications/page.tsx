import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { readNotificationWorkspace } from "@/domains/platform/service";
import {
  WorkspaceHeading,
  WorkspaceError,
  Section,
  EmptyState,
  Status,
  formatInstant,
} from "@/components/workspace/ui";
import { loadWorkspace } from "@/components/workspace/load";
import { WorkflowForm } from "@/components/workspace/workflow-form";
import { markReadAction, notificationPreferenceAction } from "./actions";
export default async function NotificationsPage() {
  if (!publicConfig()) return null;
  const { client } = await protectedContext();
  const result = await loadWorkspace(() => readNotificationWorkspace(client));
  if (!result.ok) return <WorkspaceError title="Notifications" error={result.error} />;
  const { notifications, preferences } = result.value;
  return (
    <>
      <WorkspaceHeading
        eyebrow="Keep the thread"
        title="Notifications."
        description="Updates about your learning relationships, upcoming work and account, all in one place."
      />
      <div className="workspace-grid">
        <Section title="Your updates">
          {notifications.length ? (
            <ul className="workspace-records">
              {notifications.map((item) => (
                <li className="workspace-record" key={item.id} data-notification-id={item.id}>
                  <div className="workspace-record-head">
                    <h3>{item.title}</h3>
                    <Status>{item.readAt ? "Read" : "Unread"}</Status>
                  </div>
                  <p className="workspace-prose">{item.body}</p>
                  <p className="hint">
                    {item.category.replaceAll("_", " ")} · {formatInstant(item.createdAt)}
                  </p>
                  {item.deliveryState && (
                    <p className="hint">
                      Email state: {item.deliveryState.replaceAll("_", " ")}.{" "}
                      {item.deliveryState === "accepted"
                        ? "The provider accepted the message; delivery has not been observed yet."
                        : ""}
                    </p>
                  )}
                  <div className="workspace-actions">
                    {item.targetPath && (
                      <Link className="button secondary compact" href={item.targetPath}>
                        Open update →
                      </Link>
                    )}
                    {!item.readAt && (
                      <WorkflowForm
                        title={`Mark ${item.title} read`}
                        action={markReadAction}
                        hidden={{ id: item.id }}
                        submit="Mark as read"
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="You’re all caught up">
              Saved updates will appear here as your tutoring and learning work progresses.
            </EmptyState>
          )}
        </Section>
        <Section title="Email preferences">
          <p>
            Choose which optional updates may be emailed to you. Required account messages keep their required setting.
          </p>
          <div className="workspace-stack">
            {preferences.map((preference) => (
              <div className="workspace-record" key={preference.category}>
                <h3>{preference.category.replaceAll("_", " ")}</h3>
                {preference.required ? (
                  <p className="hint">
                    Required account notice ·{" "}
                    {preference.emailEnabled ? "Email enabled" : "Current setting managed by account policy"}
                  </p>
                ) : (
                  <WorkflowForm
                    title={`Email preference for ${preference.category}`}
                    action={notificationPreferenceAction}
                    hidden={{ category: preference.category }}
                    submit="Save preference"
                    fields={[
                      {
                        name: "emailEnabled",
                        label: "Send these updates by email",
                        type: "checkbox",
                        checked: preference.emailEnabled,
                        wide: true,
                      },
                    ]}
                  />
                )}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
