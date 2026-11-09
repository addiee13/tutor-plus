"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { LearningProgressFilters, LearningProgressFilterOptions } from "@/domains/learning/types";
import { Section } from "@/components/workspace/ui";
export function ProgressFilterForm({
  filters,
  options,
  studentId,
  subjects,
}: {
  filters: LearningProgressFilters;
  options: LearningProgressFilterOptions;
  studentId: string;
  subjects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Section title="Choose the progress view">
      <form
        action="/progress"
        method="get"
        className="form"
        aria-label="Filter learning progress"
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const query = new URLSearchParams();
          for (const [key, value] of data) if (typeof value === "string" && value) query.append(key, value);
          startTransition(() => router.push(`/progress?${query.toString()}`, { scroll: false }));
        }}
      >
        <input type="hidden" name="student" value={studentId} />
        <fieldset className="form-fields" disabled={pending}>
          <legend className="visually-hidden">Progress filters</legend>
          <div className="workflow-fields">
            <div className="field">
              <label htmlFor="progress-goal">Goal</label>
              <select id="progress-goal" name="goal" defaultValue={filters.goalId ?? ""}>
                <option value="">All goals</option>
                {options.goals.map((goal) => (
                  <option key={goal.goalId} value={goal.goalId}>
                    {goal.planTitle} · {goal.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="progress-topic">Subject & topic</label>
              <select
                id="progress-topic"
                name="topic"
                defaultValue={filters.topic ? JSON.stringify(filters.topic) : ""}
              >
                <option value="">All recorded topics</option>
                {options.topics.map((topic) => (
                  <option key={`${topic.subjectId}:${topic.topic}`} value={JSON.stringify(topic)}>
                    {subjects.find((subject) => subject.id === topic.subjectId)?.name ?? "Subject"} · {topic.topic}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="progress-tutor">Tutor</label>
              <select id="progress-tutor" name="tutor" defaultValue={filters.tutorId ?? ""}>
                <option value="">All related tutors</option>
                {options.tutors.map((tutor) => (
                  <option key={tutor.tutorId} value={tutor.tutorId}>
                    {tutor.tutorName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="progress-from">Evidence date from</label>
              <input id="progress-from" name="from" type="date" defaultValue={filters.fromDate ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="progress-to">Evidence date through</label>
              <input id="progress-to" name="to" type="date" defaultValue={filters.toDate ?? ""} />
            </div>
          </div>
        </fieldset>
        <p className="hint">
          Evidence dates use an inclusive UTC calendar range. Current goals and milestone target dates stay visible for
          the selected goal, topic and tutor. Session, task and assessment lists remain available as context.
        </p>
        <div className="workspace-actions">
          <button className="button primary" type="submit" disabled={pending}>
            {pending ? "Updating evidence…" : "Apply progress filters →"}
          </button>
          <Link className="button secondary" href={`/progress?student=${studentId}`}>
            Clear progress filters
          </Link>
        </div>
      </form>
      {pending && (
        <p className="notice" role="status">
          Updating your learning evidence. Your current view stays here while it loads.
        </p>
      )}
    </Section>
  );
}
