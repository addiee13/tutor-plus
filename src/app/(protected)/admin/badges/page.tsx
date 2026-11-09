import { protectedContext } from "@/lib/protected-context";
import { publicConfig } from "@/lib/supabase/config";
import { requireRole } from "@/domains/auth/policy";
import { readBadgePolicy, readSafetyWorkspace } from "@/domains/platform/service";
import { loadWorkspace } from "@/components/workspace/load";
import { WorkspaceHeading, WorkspaceError, Section, formatInstant } from "@/components/workspace/ui";
import { AdminNav } from "../console-nav";
import { BadgePolicyEditor } from "./editor";
import { badgePolicyAction } from "./actions";
export default async function BadgePolicyPage() {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const result = await loadWorkspace(async () => {
    requireRole(actor, "administrator");
    const [policy, workspace] = await Promise.all([readBadgePolicy(client), readSafetyWorkspace(client)]);
    return { policy, audit: workspace.audit.filter((item) => item.entityType.includes("badge")) };
  });
  if (!result.ok) return <WorkspaceError title="Public badge policy" error={result.error} />;
  return (
    <>
      <WorkspaceHeading
        eyebrow="Public facts, recorded rules"
        title="Badge policy."
        description="Set the visible platform facts that qualify for a badge. Each confirmed change creates an attributed policy version."
      />
      <AdminNav current="/admin/badges" />
      <div className="workspace-grid">
        <Section title={`Publish from version ${result.value.policy.version}`}>
          <p className="hint">
            Current version saved {formatInstant(result.value.policy.createdAt)}. External credentials are not inferred
            from these counters.
          </p>
          <BadgePolicyEditor policy={result.value.policy} action={badgePolicyAction} />
        </Section>
        <Section title="Badge policy audit">
          <ul className="workspace-records">
            {result.value.audit.map((item) => (
              <li className="workspace-record" key={item.id}>
                <strong>{item.action}</strong>
                <p>{item.reason}</p>
                <p className="hint">
                  {formatInstant(item.createdAt)} · {item.entityId}
                </p>
              </li>
            ))}
          </ul>
          {!result.value.audit.length && <p>No badge policy audit entries were returned.</p>}
        </Section>
      </div>
    </>
  );
}
