import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { requireRole } from "@/domains/auth/policy";
import { readAdminWorkspace } from "@/domains/platform/service";
import type { MatchingFactorKey } from "@/domains/platform/types";
import { loadWorkspace } from "@/components/workspace/load";
import { WorkspaceHeading, WorkspaceError, Section, formatDate } from "@/components/workspace/ui";
import { WorkflowForm, type WorkflowField } from "@/components/workspace/workflow-form";
import { matchingFactorsAction } from "../console-actions";
import { AdminNav } from "../console-nav";
const labels: Record<MatchingFactorKey, string> = {
  rate_fit: "Budget fit",
  teaching_preference: "Teaching preferences",
  rating: "Visible review rating",
  experience: "Published teaching experience",
  completed_sessions: "Completed platform sessions",
};
export default async function AdminMatching() {
  if (!publicConfig()) return null;
  const { actor, client } = await protectedContext();
  const result = await loadWorkspace(() => {
    requireRole(actor, "administrator");
    return readAdminWorkspace(client);
  });
  if (!result.ok) return <WorkspaceError title="Matching factor administration" error={result.error} />;
  const { matchingFactors, matchingFactorAudit } = result.value;
  const fields: WorkflowField[] = Object.entries(labels).flatMap(([key, label]) => {
    const factor = matchingFactors?.factors.find((factor) => factor.key === key);
    return [
      {
        name: `label:${key}`,
        label: `${label} — public label`,
        required: true,
        maxLength: 100,
        value: factor?.label ?? label,
        wide: true,
      },
      {
        name: `weight:${key}`,
        label: `${label} — weight`,
        type: "number" as const,
        required: true,
        min: 0,
        max: 100,
        step: 0.01,
        value: String(factor?.weight ?? 0),
      },
      {
        name: `active:${key}`,
        label: `Apply ${label.toLowerCase()} to ranking`,
        type: "checkbox" as const,
        checked: factor?.active ?? false,
      },
    ];
  });
  return (
    <>
      <WorkspaceHeading
        eyebrow="A traceable ranking policy"
        title="Matching factors."
        description="Hard eligibility is applied before these public-fact factors. Protected attributes are excluded from ranking. A confirmed change publishes a new version."
      />
      <AdminNav current="/admin/matching" />
      <div className="workspace-grid">
        <Section
          title={matchingFactors ? `Published version ${matchingFactors.version}` : "No published factor version"}
        >
          <p>
            {matchingFactors
              ? `Published ${formatDate(matchingFactors.createdAt)}.`
              : "The values below are an unpublished proposal until you confirm a valid configuration."}
          </p>
          <WorkflowForm
            title="Publish matching factor version"
            action={matchingFactorsAction}
            fields={[
              ...fields,
              {
                name: "reason",
                label: "Reason for this ranking-policy change",
                type: "textarea",
                required: true,
                maxLength: 500,
                wide: true,
              },
              {
                name: "confirmed",
                label: "I confirm publication of this matching factor version",
                type: "checkbox",
                required: true,
                wide: true,
              },
            ]}
            submit="Publish factor version"
          />
        </Section>
        <Section title="Factor audit history">
          <ul className="workspace-records">
            {matchingFactorAudit.map((entry) => (
              <li className="workspace-record" key={entry.id}>
                <strong>{entry.action}</strong>
                <p>{entry.reason}</p>
                <p className="hint">
                  {formatDate(entry.createdAt)} · Actor {entry.actorId} · Version reference {entry.entityId}
                </p>
              </li>
            ))}
          </ul>
          {!matchingFactorAudit.length && <p>No factor-version audit entries were returned.</p>}
        </Section>
      </div>
    </>
  );
}
