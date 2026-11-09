import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { requireRole } from "@/domains/auth/policy";
import { readAdminWorkspace } from "@/domains/platform/service";
import { loadWorkspace } from "@/components/workspace/load";
import { WorkspaceHeading, WorkspaceError, Section, EmptyState, Status, formatDate } from "@/components/workspace/ui";
import { WorkflowForm } from "@/components/workspace/workflow-form";
import { adminStatusAction, adminRoleAction } from "../console-actions";
import { AdminNav } from "../console-nav";
export default async function AdminAccounts({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q : "";
  const page = typeof query.page === "string" ? Number(query.page) : 1;
  const result = await loadWorkspace(() => {
    requireRole(actor, "administrator");
    return readAdminWorkspace(client, { query: q || undefined, page, pageSize: 20 });
  });
  if (!result.ok) return <WorkspaceError title="Account administration" error={result.error} />;
  const { users, hasMoreUsers } = result.value;
  return (
    <>
      <WorkspaceHeading
        eyebrow="Recorded account decisions"
        title="Accounts & capabilities."
        description="Search real accounts, review current grants and status, then confirm each change with a reason."
      />
      <AdminNav current="/admin/accounts" />
      <Section title="Find an account">
        <form action="/admin/accounts" method="get" className="workspace-actions">
          <div className="field">
            <label htmlFor="admin-query">Name, email or account reference</label>
            <input id="admin-query" name="q" maxLength={100} defaultValue={q} />
          </div>
          <button className="button secondary" type="submit">
            Search accounts →
          </button>
        </form>
      </Section>
      <div className="workspace-stack" style={{ marginTop: "1.5rem" }}>
        {!users.length ? (
          <EmptyState title="No matching accounts">Change the search term to inspect another account.</EmptyState>
        ) : (
          users.map((user) => (
            <Section key={user.id} title={user.displayName} eyebrow={user.email ?? "Email not exposed"}>
              <div className="workspace-record-head">
                <p className="hint">
                  Account {user.id} · Created {formatDate(user.createdAt)}
                </p>
                <Status>{user.status}</Status>
              </div>
              <p>Capabilities: {user.roles.join(" · ") || "None"}</p>
              <div className="workspace-grid equal">
                <details className="workspace-details">
                  <summary>Change account status</summary>
                  <WorkflowForm
                    title={`Change ${user.displayName} account status`}
                    action={adminStatusAction}
                    hidden={{ userId: user.id }}
                    submit="Record status decision"
                    disabled={user.id === actor.id}
                    fields={[
                      {
                        name: "status",
                        label: "Account status",
                        type: "select",
                        required: true,
                        value: user.status,
                        options: [
                          { value: "active", label: "Active" },
                          { value: "inactive", label: "Inactive — deny account access" },
                        ],
                      },
                      {
                        name: "reason",
                        label: "Reason for this change",
                        type: "textarea",
                        required: true,
                        wide: true,
                        maxLength: 500,
                      },
                      {
                        name: "confirmed",
                        label: "I confirm this account status change",
                        type: "checkbox",
                        required: true,
                        wide: true,
                      },
                    ]}
                  />
                  {user.id === actor.id && <p className="hint">Your own account status cannot be changed here.</p>}
                </details>
                <details className="workspace-details">
                  <summary>Grant or revoke a capability</summary>
                  <WorkflowForm
                    title={`Change ${user.displayName} capability`}
                    action={adminRoleAction}
                    hidden={{ userId: user.id }}
                    submit="Record capability decision"
                    fields={[
                      {
                        name: "role",
                        label: "Capability",
                        type: "select",
                        required: true,
                        options: [
                          { value: "student", label: "Student" },
                          { value: "tutor", label: "Tutor" },
                          { value: "administrator", label: "Administrator" },
                        ],
                      },
                      {
                        name: "operation",
                        label: "Decision",
                        type: "select",
                        required: true,
                        options: [
                          { value: "grant", label: "Grant capability" },
                          { value: "revoke", label: "Revoke capability" },
                        ],
                      },
                      {
                        name: "reason",
                        label: "Reason for this capability change",
                        type: "textarea",
                        required: true,
                        wide: true,
                        maxLength: 500,
                      },
                      {
                        name: "confirmed",
                        label: "I confirm this capability change",
                        type: "checkbox",
                        required: true,
                        wide: true,
                      },
                    ]}
                  />
                </details>
              </div>
            </Section>
          ))
        )}
      </div>
      <nav className="workspace-actions" aria-label="Account result pages" style={{ marginTop: "1.5rem" }}>
        {page > 1 && (
          <Link className="button secondary" href={`/admin/accounts?q=${encodeURIComponent(q)}&page=${page - 1}`}>
            Previous
          </Link>
        )}
        {hasMoreUsers && (
          <Link className="button secondary" href={`/admin/accounts?q=${encodeURIComponent(q)}&page=${page + 1}`}>
            Next accounts →
          </Link>
        )}
      </nav>
    </>
  );
}
