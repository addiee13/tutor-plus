import Link from "next/link";
import type { LearningProgressOverview, LearningProgressFilters } from "@/domains/learning/types";
import { formatInstant, Status } from "@/components/workspace/ui";

type Point = { id: string; at: string; value: number; label: string; sourcePath: string };
const labels = { needs_work: "Needs Work", improving: "Improving", confident: "Confident" };
export function EvidenceCharts({
  progress,
  filters = {},
}: {
  progress: LearningProgressOverview;
  filters?: LearningProgressFilters;
}) {
  const scopedQuestions = !!(filters.goalId || filters.topic);
  const assessmentPoints: Point[] = scopedQuestions
    ? progress.topicRecords
        .filter(
          (record) =>
            record.sourceKind === "assessment_question" &&
            record.assessmentPoints &&
            record.assessmentPoints.possible > 0,
        )
        .map((record) => ({
          id: record.id,
          at: record.occurredAt,
          value: (record.assessmentPoints!.earned / record.assessmentPoints!.possible) * 100,
          label: `${record.sourceLabel} · ${record.topic} · ${record.assessmentPoints!.earned}/${record.assessmentPoints!.possible} question points`,
          sourcePath: record.sourcePath,
        }))
    : progress.assessments
        .filter(({ assessment }) => !filters.tutorId || assessment.tutor_id === filters.tutorId)
        .flatMap(({ assessment, attempts }) =>
          attempts
            .filter(
              (attempt) =>
                attempt.status === "scored" &&
                attempt.score !== null &&
                attempt.max_score !== null &&
                attempt.max_score > 0 &&
                attempt.scored_at &&
                (!filters.fromDate ||
                  Date.parse(attempt.scored_at) >= Date.parse(`${filters.fromDate}T00:00:00.000Z`)) &&
                (!filters.toDate || Date.parse(attempt.scored_at) <= Date.parse(`${filters.toDate}T23:59:59.999Z`)),
            )
            .map((attempt) => ({
              id: attempt.id,
              at: attempt.scored_at!,
              value: (attempt.score! / attempt.max_score!) * 100,
              label: `${assessment.title} · attempt ${attempt.attempt_no} · ${attempt.score}/${attempt.max_score} points`,
              sourcePath: `/assessments/${assessment.id}`,
            })),
        );
  const topicPoints: Point[] = progress.topicEvidence.map((observation) => ({
    id: observation.id,
    at: observation.observed_at,
    value: { needs_work: 0, improving: 1, confident: 2 }[observation.label],
    label: `${observation.topic} · ${labels[observation.label]}`,
    sourcePath: observation.sourcePath ?? "/progress",
  }));
  const latest = [
    ...new Map(
      [...progress.topicEvidence]
        .sort(
          (a, b) =>
            Date.parse(a.observed_at) - Date.parse(b.observed_at) ||
            Date.parse(a.created_at) - Date.parse(b.created_at),
        )
        .map((observation) => [
          `${observation.subject_id}:${observation.topic.trim().toLocaleLowerCase()}`,
          observation,
        ]),
    ).values(),
  ];
  return (
    <div className="workspace-stack">
      <section aria-labelledby="topic-summary-title">
        <h3 id="topic-summary-title">What the latest observations say</h3>
        <div className="workspace-grid equal">
          <div className="workspace-record">
            <h3>Topics with a Confident observation</h3>
            {latest.filter((item) => item.label === "confident").length ? (
              <ul>
                {latest
                  .filter((item) => item.label === "confident")
                  .map((item) => (
                    <li key={item.id}>
                      <Link className="small-link" href={item.sourcePath ?? "/progress"}>
                        {item.topic} →
                      </Link>
                      <p className="hint">{formatInstant(item.observed_at)}</p>
                    </li>
                  ))}
              </ul>
            ) : (
              <p>No current topic has a saved Confident observation.</p>
            )}
          </div>
          <div className="workspace-record">
            <h3>Topics to keep practicing</h3>
            {latest.filter((item) => item.label !== "confident").length ? (
              <ul>
                {latest
                  .filter((item) => item.label !== "confident")
                  .map((item) => (
                    <li key={item.id}>
                      <Link className="small-link" href={item.sourcePath ?? "/progress"}>
                        {item.topic} →
                      </Link>{" "}
                      <Status>{labels[item.label]}</Status>
                      <p className="hint">{formatInstant(item.observed_at)}</p>
                    </li>
                  ))}
              </ul>
            ) : (
              <p>No current Needs Work or Improving observation has been recorded.</p>
            )}
          </div>
        </div>
        <p className="hint">
          These summaries use each topic’s latest dated tutor judgement in this view. Scores do not choose the label.
        </p>
      </section>
      <DatedPlot
        id="assessment-evidence-chart"
        title={scopedQuestions ? "Dated assessment question results" : "Dated assessment results"}
        description={
          scopedQuestions
            ? "These tagged question records match the selected goal or topic. The vertical axis shows the percentage of that question’s available points earned; each mark links to its source."
            : "The vertical axis shows the percentage of available assessment points earned. Each mark links to its scored attempt; different assessments may cover different material."
        }
        points={assessmentPoints}
        levels={[
          { value: 0, label: "0%" },
          { value: 25, label: "25%" },
          { value: 50, label: "50%" },
          { value: 75, label: "75%" },
          { value: 100, label: "100%" },
        ]}
        max={100}
      />
      <DatedPlot
        id="topic-evidence-chart"
        title="Dated topic observations"
        description="Tutor judgements are shown as the recorded categories. Each mark links to the supporting source; no numeric mastery level is inferred."
        points={topicPoints}
        levels={[
          { value: 0, label: "Needs Work" },
          { value: 1, label: "Improving" },
          { value: 2, label: "Confident" },
        ]}
        max={2}
      />
    </div>
  );
}
function DatedPlot({
  id,
  title,
  description,
  points,
  levels,
  max,
}: {
  id: string;
  title: string;
  description: string;
  points: Point[];
  levels: { value: number; label: string }[];
  max: number;
}) {
  const ordered = [...points]
    .filter((point) => Number.isFinite(Date.parse(point.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!ordered.length)
    return (
      <figure className="evidence-figure">
        <figcaption>
          <h3>{title}</h3>
          <p>{description}</p>
        </figcaption>
        <p className="workspace-empty">No dated records match this chart’s current view.</p>
      </figure>
    );
  const instants = ordered.map((point) => Date.parse(point.at));
  let first = Math.min(...instants),
    last = Math.max(...instants);
  if (first === last) {
    first -= 43200000;
    last += 43200000;
  }
  const x = (at: string) => 110 + ((Date.parse(at) - first) / (last - first)) * 500;
  const y = (value: number) => 190 - (value / max) * 150;
  return (
    <figure className="evidence-figure">
      <figcaption id={`${id}-caption`}>
        <h3>{title}</h3>
        <p>{description}</p>
      </figcaption>
      <div
        className="evidence-chart-scroll"
        tabIndex={0}
        role="region"
        aria-label={`${title}, scroll horizontally if needed`}
      >
        <svg className="evidence-plot" viewBox="0 0 650 250" aria-labelledby={`${id}-caption`} role="group">
          {levels.map((level) => (
            <g key={level.value} aria-hidden="true">
              <line
                x1={105}
                x2={620}
                y1={y(level.value)}
                y2={y(level.value)}
                stroke="var(--line)"
                strokeDasharray="3 5"
              />
              <text x={96} y={y(level.value) + 5} textAnchor="end" fill="var(--muted)" fontSize={13}>
                {level.label}
              </text>
            </g>
          ))}
          <line x1={105} x2={620} y1={200} y2={200} stroke="var(--muted)" aria-hidden="true" />
          <text x={110} y={225} fill="var(--muted)" fontSize={12} aria-hidden="true">
            {new Date(first).toISOString().slice(0, 10)}
          </text>
          <text x={615} y={225} textAnchor="end" fill="var(--muted)" fontSize={12} aria-hidden="true">
            {new Date(last).toISOString().slice(0, 10)}
          </text>
          {ordered.map((point, index) => (
            <a
              key={point.id}
              href={point.sourcePath}
              tabIndex={0}
              aria-label={`${point.label}, ${formatInstant(point.at)}. Open saved source.`}
            >
              <title>{`${point.label} · ${formatInstant(point.at)}`}</title>
              <circle
                cx={x(point.at)}
                cy={y(point.value)}
                r={7}
                fill="var(--forest)"
                stroke="var(--card)"
                strokeWidth={2}
              />
              <text
                x={x(point.at)}
                y={y(point.value) - 13}
                textAnchor="middle"
                fill="var(--forest)"
                fontSize={11}
                aria-hidden="true"
              >
                {index + 1}
              </text>
            </a>
          ))}
        </svg>
      </div>
      <p className="hint">
        Scroll the chart horizontally on narrow screens. Each numbered mark is one saved record. Marks at the same date
        may overlap; all records are listed below.
      </p>
      <details className="workspace-details">
        <summary>Read the chart’s dated source records</summary>
        <div className="evidence-table-scroll">
          <table className="evidence-table">
            <caption className="visually-hidden">{title} records and source links</caption>
            <thead>
              <tr>
                <th scope="col">Mark</th>
                <th scope="col">Observed or scored at</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((point, index) => (
                <tr key={point.id}>
                  <th scope="row">{index + 1}</th>
                  <td>{formatInstant(point.at)}</td>
                  <td>
                    <Link className="small-link" href={point.sourcePath}>
                      {point.label} →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
