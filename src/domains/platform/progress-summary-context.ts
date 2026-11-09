import type { LearningProgressFilters, LearningProgressOverview } from "../learning/types";

export type ProgressSummarySource = { id: string; label: string; path: string };
export type ProgressSummaryContext = {
  sources: ProgressSummarySource[];
  contextText: string;
  limited: boolean;
};

/** Only the already-filtered evidence collection is used; broad sidebar collections are deliberately excluded. */
export function buildProgressSummaryContext(
  progress: LearningProgressOverview,
  filters: LearningProgressFilters,
  recaps: ReadonlyMap<string, { summary: string; nextSteps: string | null }> = new Map(),
): ProgressSummaryContext {
  const sources: ProgressSummarySource[] = [];
  const evidence: Array<Record<string, unknown>> = [];
  let limited = progress.coverage.bounded;
  const append = (source: ProgressSummarySource, entry: Record<string, unknown>) => {
    if (JSON.stringify(evidence).length + JSON.stringify(entry).length > 28000) {
      limited = true;
      return false;
    }
    sources.push(source);
    evidence.push(entry);
    return true;
  };
  const groups = new Map<string, typeof progress.topicRecords>();
  for (const record of progress.topicRecords) {
    const key = `${record.sourceKind}:${record.sourceId}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  const sortedGroups = [...groups.values()].sort((a, b) => b[0].occurredAt.localeCompare(a[0].occurredAt));
  if (sortedGroups.length > 16) limited = true;
  const clip = (value: string | null | undefined, max = 700) => {
    if (value && value.length > max) limited = true;
    return value?.slice(0, max) ?? null;
  };
  for (const group of sortedGroups.slice(0, 16)) {
    const first = group[0];
    const id = `S${sources.length + 1}`;
    if (group.length > 8) limited = true;
    const recap = first.sourceKind === "session_recap" ? recaps.get(first.sourceId) : undefined;
    const added = append(
      { id, label: first.sourceLabel, path: first.sourcePath },
      {
        source: id,
        kind: first.sourceKind,
        date: first.occurredAt,
        label: clip(first.sourceLabel, 200),
        topics: group.slice(0, 8).map((record) => ({
          topic: clip(record.topic, 200),
          assessmentPoints: record.assessmentPoints,
          assignmentFeedback: record.assignmentFeedback,
          recapNarrative: record.recapNarrative && {
            strengths: clip(record.recapNarrative.strengths),
            practiceAreas: clip(record.recapNarrative.practiceAreas),
          },
          tutorObservation: record.tutorObservation && {
            ...record.tutorObservation,
            note: clip(record.tutorObservation.note),
          },
        })),
        ...(recap ? { recap: clip(recap.summary, 1600), suggestedNextSteps: clip(recap.nextSteps) } : {}),
      },
    );
    if (!added) break;
  }
  // Goals describe intentions, not evidence of achievement. Date filters apply to evidence, not goal creation.
  if (progress.activeGoals.length > 5) limited = true;
  for (const item of progress.activeGoals.slice(0, 5)) {
    const id = `S${sources.length + 1}`;
    const added = append(
      { id, label: `Goal: ${item.goal.title}`, path: `/study-plans/${item.planId}` },
      {
        source: id,
        kind: "active_goal_not_achievement",
        title: clip(item.goal.title, 200),
        topic: clip(item.goal.topic, 200),
        baseline: clip(item.goal.baseline),
        successCriterion: clip(item.goal.successCriterion),
        targetDate: item.goal.targetDate,
      },
    );
    if (!added) break;
  }
  return {
    sources,
    limited,
    contextText: JSON.stringify({
      observedAt: progress.observedAt,
      filters,
      incompleteHistory: limited,
      evidence,
    }),
  };
}
