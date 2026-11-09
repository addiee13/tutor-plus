import { loadPlanLinks } from "../../learning/plan-links";
import { loadWorkspace } from "@/components/workspace/load";
import Link from "next/link";
import { publicConfig } from "@/lib/supabase/config";
import { protectedContext } from "@/lib/protected-context";
import { getStudyPlan, listStudyEvidenceCandidates, listLearningRelationships } from "@/domains/learning/service";
import {
  WorkspaceHeading,
  WorkspaceTabs,
  learningTabs,
  WorkspaceError,
  Section,
  EmptyState,
  Status,
  formatDate,
  formatInstant,
} from "@/components/workspace/ui";
import { WorkflowForm } from "@/components/workspace/workflow-form";
import { StudyPlanEditor } from "../../learning/editors";
import {
  recordEvidenceAction,
  rescheduleMilestoneAction,
  proposeMilestoneAction,
  decidePlanProposalAction,
  sharePersonalPlanAction,
} from "../../learning/actions";

export default async function StudyPlanPage({ params }: { params: Promise<{ planId: string }> }) {
  if (!publicConfig()) return null;
  const { planId } = await params;
  const { actor, client } = await protectedContext();
  const loaded = await loadWorkspace(async () => {
    const [detail, linkOptions, relationships] = await Promise.all([
      getStudyPlan(client, planId),
      loadPlanLinks(client),
      listLearningRelationships(client),
    ]);
    const candidates = detail.canPropose ? await listStudyEvidenceCandidates(client, planId) : [];
    const { plan, revisions, evidence, progress } = detail;
    const revision = revisions.find((row) => row.revision_no === plan.current_revision);
    const tutor = plan.student_id !== actor.id;
    const personal = detail.access === "personal";
    const canRevise = detail.canRevise;
    const canPropose = detail.canPropose;
    const shareOptions = relationships.filter((row) => row.studentId === actor.id && row.subjectId === plan.subject_id);
    return {
      detail,
      candidates,
      plan,
      revisions,
      evidence,
      progress,
      revision,
      tutor,
      linkOptions,
      personal,
      canRevise,
      canPropose,
      shareOptions,
    };
  });
  if (!loaded.ok) return <WorkspaceError title="Study plan" error={loaded.error} />;
  const {
    detail,
    candidates,
    plan,
    revisions,
    evidence,
    progress,
    revision,
    tutor,
    linkOptions,
    personal,
    canRevise,
    canPropose,
    shareOptions,
  } = loaded.value;
  return (
    <>
      <WorkspaceHeading
        eyebrow={`${personal ? "Your personal study plan" : "Shared study plan"} · revision ${plan.current_revision}`}
        title={revision?.title ?? "Study plan"}
        description={revision?.description ?? "Small, observable steps toward your learning goals."}
      >
        <Status>{plan.status}</Status>
      </WorkspaceHeading>
      <WorkspaceTabs items={learningTabs} current="/study-plans" />
      <div className="workspace-grid">
        <div className="workspace-stack">
          <Section title="Goals & milestones">
            {revision?.goals.map((goal) => (
              <article key={goal.id} className="workspace-record" style={{ marginBottom: "1rem" }}>
                <h3>{goal.title}</h3>
                {goal.description && <p className="workspace-prose">{goal.description}</p>}
                <dl className="workspace-facts">
                  <div>
                    <dt>Topic</dt>
                    <dd>{goal.topic}</dd>
                  </div>
                  <div>
                    <dt>Target date</dt>
                    <dd>{formatDate(goal.targetDate)}</dd>
                  </div>
                  <div>
                    <dt>Starting point</dt>
                    <dd>{goal.baseline ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt>Practice schedule</dt>
                    <dd>{goal.schedule ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt>Success criterion</dt>
                    <dd>{goal.successCriterion ?? "Not recorded"}</dd>
                  </div>
                </dl>
                <ol className="workspace-records">
                  {goal.milestones.map((milestone) => {
                    const links = evidence.filter((row) => row.milestone_id === milestone.id);
                    return (
                      <li className="workspace-record" key={milestone.id}>
                        <div className="workspace-record-head">
                          <strong>{milestone.title}</strong>
                          <Status>
                            {links.length
                              ? `${links.length} evidence record${links.length === 1 ? "" : "s"}`
                              : "Evidence not yet linked"}
                          </Status>
                        </div>
                        <div className="workspace-meta">
                          <Status>{milestone.status.replaceAll("_", " ")}</Status>
                          <span>
                            {milestone.targetDate ? `Target ${formatDate(milestone.targetDate)}` : "No target date"}
                          </span>
                          <span>Position {milestone.position}</span>
                        </div>
                        {milestone.targetDate &&
                          milestone.targetDate < new Date().toISOString().slice(0, 10) &&
                          milestone.status !== "completed" && (
                            <p className="notice warning">
                              The target date has passed. The saved date stays visible until it is explicitly
                              rescheduled.
                            </p>
                          )}
                        {milestone.description && <p>{milestone.description}</p>}
                        {milestone.links.length > 0 && (
                          <ul>
                            {milestone.links.map((link) => (
                              <li key={`${link.kind}:${link.id}`}>
                                <Link
                                  className="small-link"
                                  href={
                                    link.kind === "resource"
                                      ? `/resources?resource=${link.id}`
                                      : link.kind === "assignment"
                                        ? `/assignments/${link.id}`
                                        : `/assessments/${link.id}`
                                  }
                                >
                                  {linkOptions.find((option) => option.kind === link.kind && option.id === link.id)
                                    ?.label ?? `${link.kind} learning material`}{" "}
                                  →
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                        {((personal && plan.student_id === actor.id) || tutor) && (
                          <details className="workspace-details">
                            <summary>Reschedule this milestone</summary>
                            <WorkflowForm
                              title={`Reschedule ${milestone.title}`}
                              action={rescheduleMilestoneAction}
                              hidden={{
                                planId,
                                milestoneId: milestone.id,
                                expectedRevision: String(plan.current_revision),
                                mode: personal ? "personal" : "shared",
                              }}
                              submit="Confirm new target date"
                              fields={[
                                {
                                  name: "targetDate",
                                  label: "New target date",
                                  type: "date",
                                  required: true,
                                  value: milestone.targetDate ?? "",
                                },
                                {
                                  name: "reason",
                                  label: "Why is the date changing?",
                                  type: "textarea",
                                  required: true,
                                  wide: true,
                                  maxLength: 2000,
                                },
                                {
                                  name: "confirmed",
                                  label: "I confirm this date change and its recorded reason",
                                  type: "checkbox",
                                  required: true,
                                  wide: true,
                                },
                              ]}
                            />
                          </details>
                        )}
                        {canPropose && (
                          <details className="workspace-details">
                            <summary>Propose a date for learner confirmation</summary>
                            <WorkflowForm
                              title={`Propose a new date for ${milestone.title}`}
                              action={proposeMilestoneAction}
                              hidden={{ planId, milestoneId: milestone.id }}
                              submit="Save date proposal"
                              fields={[
                                { name: "targetDate", label: "Proposed target date", type: "date", required: true },
                                {
                                  name: "summary",
                                  label: "Why this date may help",
                                  type: "textarea",
                                  required: true,
                                  wide: true,
                                  maxLength: 2000,
                                },
                              ]}
                            />
                          </details>
                        )}
                        {links.length > 0 && (
                          <ul>
                            {links.map((link) => (
                              <li key={link.id}>
                                {link.source_kind.replaceAll("_", " ")} · {formatDate(link.created_at)} · Revision{" "}
                                {link.revision_no}
                              </li>
                            ))}
                          </ul>
                        )}
                        {candidates.length > 0 && (
                          <details className="workspace-details">
                            <summary>Link saved learning evidence</summary>
                            <WorkflowForm
                              title={`Record evidence for ${milestone.title}`}
                              action={recordEvidenceAction}
                              hidden={{ planId, milestoneId: milestone.id }}
                              submit="Link evidence"
                              fields={[
                                {
                                  name: "source",
                                  label: "Saved learning record",
                                  type: "select",
                                  required: true,
                                  wide: true,
                                  options: candidates
                                    .filter(
                                      (candidate) =>
                                        !links.some(
                                          (link) =>
                                            link.source_id === candidate.sourceId &&
                                            link.source_kind === candidate.sourceKind,
                                        ),
                                    )
                                    .map((candidate) => ({
                                      value: `${candidate.sourceKind}:${candidate.sourceId}`,
                                      label: `${candidate.label} · ${formatDate(candidate.occurredAt)}`,
                                    })),
                                  hint: "Only records from this learning relationship can be used. The service verifies the source again.",
                                },
                              ]}
                            />
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </article>
            ))}
            {!revision?.goals.length && (
              <EmptyState title="No goals in this revision">
                Your tutor can add goals and milestones in a new plan revision.
              </EmptyState>
            )}
          </Section>
          {canRevise && (
            <Section title="Revise the plan" eyebrow="Keep the history">
              <p>
                Saving creates an immutable revision. Stable milestone IDs keep evidence attached to the same learning
                goal.
              </p>
              <StudyPlanEditor personal={plan.student_id === actor.id} detail={detail} linkOptions={linkOptions} />
            </Section>
          )}
        </div>
        <div className="workspace-stack">
          <Section title="Progress from evidence" eyebrow="A record of the work">
            <h3>
              {progress.milestonesWithEvidence} of {progress.totalMilestones} milestones have evidence
            </h3>
            <progress
              className="progress-track"
              value={progress.milestonesWithEvidence}
              max={progress.totalMilestones || 1}
              aria-label="Milestones with linked learning evidence"
            />
            <p>
              {progress.evidenceCount} dated evidence record{progress.evidenceCount === 1 ? "" : "s"} linked to this
              plan.
            </p>
            <p className="hint">
              This shows evidence coverage. It does not claim mastery or turn assessment scores into automatic
              completion.
            </p>
            {detail.canPropose && !candidates.length && (
              <p className="notice warning">
                There are no eligible saved assessment attempts, assignment submissions or session recaps to link yet.
              </p>
            )}
          </Section>
          {personal && plan.student_id === actor.id && (
            <Section title="Choose whether to share this plan">
              <p>
                This personal plan is private. You can attach it to a matching booked tutoring relationship when you
                want that tutor’s support.
              </p>
              {shareOptions.length ? (
                <WorkflowForm
                  title="Share personal study plan"
                  action={sharePersonalPlanAction}
                  hidden={{ planId }}
                  submit="Share with booked tutor"
                  fields={[
                    {
                      name: "bookingId",
                      label: "Booked learning relationship",
                      type: "select",
                      required: true,
                      wide: true,
                      options: shareOptions.map((row) => ({
                        value: row.bookingId,
                        label: `${row.tutorName} · ${row.subjectName} · ${formatDate(row.endsAt)}`,
                      })),
                    },
                    {
                      name: "confirmed",
                      label: "I confirm sharing this plan with the tutor on this booking",
                      type: "checkbox",
                      required: true,
                      wide: true,
                    },
                  ]}
                />
              ) : (
                <p>
                  No matching booked tutor relationship is available. You can keep working on this plan independently.
                </p>
              )}
            </Section>
          )}
          <Section title="Draft date proposals">
            <p>
              Proposals are separate from the current plan. Only the learner’s explicit acceptance changes the canonical
              date.
            </p>
            <ul className="workspace-records">
              {detail.proposals.map((proposal) => (
                <li className="workspace-record" key={proposal.id}>
                  <Status>{proposal.status}</Status>
                  <h3>{formatDate(proposal.proposed_target_date)}</h3>
                  <p>{proposal.summary}</p>
                  <p className="hint">
                    Proposed {formatInstant(proposal.created_at)} · Author {proposal.proposed_by}
                  </p>
                  {!tutor && proposal.status === "pending" && (
                    <WorkflowForm
                      title="Decide date proposal"
                      action={decidePlanProposalAction}
                      hidden={{ proposalId: proposal.id }}
                      submit="Record my decision"
                      fields={[
                        {
                          name: "decision",
                          label: "Your decision",
                          type: "select",
                          required: true,
                          options: [
                            { value: "accept", label: "Accept the proposed date" },
                            { value: "dismiss", label: "Keep the current date" },
                          ],
                        },
                        {
                          name: "reason",
                          label: "Decision reason",
                          type: "textarea",
                          required: true,
                          wide: true,
                          maxLength: 2000,
                        },
                        {
                          name: "confirmed",
                          label: "I confirm any accepted date change",
                          type: "checkbox",
                          wide: true,
                        },
                      ]}
                    />
                  )}
                </li>
              ))}
            </ul>
            {!detail.proposals.length && <p>No pending or historical date proposals.</p>}
          </Section>
          <Section title="Rescheduling history">
            <ul className="workspace-records">
              {detail.replanningHistory.map((change) => (
                <li className="workspace-record" key={change.id}>
                  <strong>
                    {formatDate(change.from_target_date)} → {formatDate(change.to_target_date)}
                  </strong>
                  <p>{change.reason}</p>
                  <p className="hint">
                    Revision {change.revision_no} · {formatInstant(change.created_at)} · Author {change.authored_by}
                  </p>
                </li>
              ))}
            </ul>
            {!detail.replanningHistory.length && <p>No milestone dates have been rescheduled.</p>}
          </Section>
          <Section title="Revision history">
            <ol className="workspace-records">
              {[...revisions]
                .sort((a, b) => b.revision_no - a.revision_no)
                .map((item) => (
                  <li className="workspace-record" key={item.id}>
                    <strong>
                      Revision {item.revision_no} · {item.title}
                    </strong>
                    <p className="hint">
                      {formatInstant(item.created_at)} · {item.goals.length} goals
                    </p>
                    <details>
                      <summary>Read this revision</summary>
                      {item.description && <p>{item.description}</p>}
                      <ul>
                        {item.goals.map((goal) => (
                          <li key={goal.id}>
                            {goal.title}
                            <ul>
                              {goal.milestones.map((milestone) => (
                                <li key={milestone.id}>{milestone.title}</li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
            </ol>
          </Section>
        </div>
      </div>
      <p>
        <Link className="small-link" href="/study-plans">
          ← All study plans
        </Link>
      </p>
    </>
  );
}
