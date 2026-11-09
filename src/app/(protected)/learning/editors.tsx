"use client";

import { useState } from "react";
import { assessmentQuestionFields } from "@/components/workspace/assessment-question-fields";
import { WorkflowForm, type WorkflowField } from "@/components/workspace/workflow-form";
import type {
  AssessmentDetail,
  Assignment,
  AssignmentMilestoneOption,
  LearningRelationship,
  StudyPlanDetail,
} from "@/domains/learning/types";
import { saveAssessmentAction, saveAssignmentAction, savePlanAction } from "./actions";

function relationshipsField(relationships: LearningRelationship[]): WorkflowField {
  return {
    name: "relationship",
    label: "Learning relationship",
    type: "select",
    required: true,
    wide: true,
    options: relationships.map((row) => ({
      value: row.bookingId,
      label: `${row.studentName} · ${row.subjectName} · ${new Date(row.endsAt).toLocaleDateString("en-US", { timeZone: "UTC" })}`,
    })),
    hint: "Choose a learner from one of your confirmed or completed sessions.",
  };
}
const purposes = [
  { value: "diagnostic", label: "Diagnostic — establish a starting point" },
  { value: "pre_session", label: "Before a session" },
  { value: "post_session", label: "After a session" },
  { value: "milestone", label: "Milestone check" },
];

export function AssessmentEditor({
  relationships = [],
  detail,
}: {
  relationships?: LearningRelationship[];
  detail?: AssessmentDetail;
}) {
  const [count, setCount] = useState(detail?.questions.length || 1);
  const assessment = detail?.assessment;
  const fields: WorkflowField[] = [
    ...(!assessment ? [relationshipsField(relationships)] : []),
    { name: "title", label: "Assessment title", required: true, value: assessment?.title, maxLength: 200, wide: true },
    {
      name: "instructions",
      label: "Instructions for your learner",
      type: "textarea",
      value: assessment?.instructions ?? "",
      maxLength: 4000,
      wide: true,
    },
    {
      name: "purpose",
      label: "Purpose",
      type: "select",
      required: true,
      value: assessment?.purpose ?? "diagnostic",
      options: purposes,
    },
    {
      name: "dueAt",
      label: "Due date & time",
      type: "datetime",
      value: assessment?.due_at ?? "",
      hint: "Optional. Times are entered in UTC.",
    },
    ...assessmentQuestionFields(
      count,
      detail?.questions.map((question) => ({
        ...question,
        correctChoice: detail.answerKeys?.find((key) => key.question_id === question.id)?.correct_choice ?? null,
      })),
    ),
  ];
  return (
    <WorkflowForm
      title={assessment ? "Edit assessment draft" : "Create assessment draft"}
      action={saveAssessmentAction}
      fields={fields}
      hidden={{ assessmentId: assessment?.id ?? "", questionCount: String(count) }}
      submit="Save assessment draft"
      disabled={!assessment && !relationships.length}
      footer={
        <div className="workspace-actions">
          <button
            className="button secondary compact"
            type="button"
            disabled={count >= 100}
            onClick={() => setCount((n) => n + 1)}
          >
            Add question
          </button>
          {count > 1 && (
            <button className="button secondary compact" type="button" onClick={() => setCount((n) => n - 1)}>
              Remove last question
            </button>
          )}
          <span className="hint">
            {count} question{count === 1 ? "" : "s"}
          </span>
        </div>
      }
    />
  );
}

export function AssignmentEditor({
  relationships = [],
  assignment,
  milestoneOptions = [],
}: {
  relationships?: LearningRelationship[];
  assignment?: Assignment;
  milestoneOptions?: AssignmentMilestoneOption[];
}) {
  const [relationshipId, setRelationshipId] = useState(assignment?.booking_id ?? "");
  const relation = relationships.find((row) => row.bookingId === relationshipId);
  const availableMilestones = milestoneOptions.filter(
    (item) =>
      item.bookingId === (assignment?.booking_id ?? relation?.bookingId) &&
      item.studentId === (assignment?.student_id ?? relation?.studentId) &&
      item.subjectId === (assignment?.subject_id ?? relation?.subjectId),
  );
  const fields: WorkflowField[] = [
    ...(!assignment ? [relationshipsField(relationships)] : []),
    { name: "title", label: "Assignment title", required: true, maxLength: 200, value: assignment?.title, wide: true },
    {
      name: "topic",
      label: "Learning topic",
      required: true,
      maxLength: 200,
      value: assignment?.topic ?? "",
      wide: true,
    },
    {
      name: "linkedMilestone",
      label: "Linked study-plan milestone",
      type: "select",
      wide: true,
      value:
        assignment?.study_plan_id && assignment.milestone_id
          ? `${assignment.study_plan_id}:${assignment.milestone_id}`
          : "",
      options: availableMilestones.map((item) => ({
        value: `${item.planId}:${item.milestoneId}`,
        label: `${item.planTitle} · ${item.milestoneTitle} · ${item.topic}`,
      })),
      hint: "Optional. Choose a milestone from the selected learner’s subject. The saved assignment retains that plan revision.",
    },
    {
      name: "instructions",
      label: "Instructions & success criteria",
      type: "textarea",
      required: true,
      maxLength: 4000,
      value: assignment?.instructions,
      wide: true,
    },
    {
      name: "submissionType",
      label: "How the learner submits",
      type: "select",
      required: true,
      value: assignment?.submission_type ?? "text",
      options: [
        { value: "text", label: "Written response" },
        { value: "link", label: "Link to work" },
        { value: "file", label: "Private file upload" },
      ],
    },
    {
      name: "dueAt",
      label: "Due date & time",
      type: "datetime",
      required: true,
      value: assignment?.due_at,
      hint: "Enter the deadline in UTC.",
    },
    {
      name: "acceptsLate",
      label: "Allow submissions after the deadline",
      type: "checkbox",
      checked: assignment?.accepts_late ?? false,
      wide: true,
    },
  ];
  return (
    <WorkflowForm
      title={assignment ? "Edit assignment draft" : "Create assignment draft"}
      action={saveAssignmentAction}
      fields={fields}
      hidden={{ assignmentId: assignment?.id ?? "" }}
      submit="Save assignment draft"
      disabled={!assignment && !relationships.length}
      onFieldChange={(name, value) => {
        if (name === "relationship") setRelationshipId(value);
      }}
    />
  );
}

export type PlanLinkOption = {
  kind: "resource" | "assignment" | "assessment";
  id: string;
  label: string;
  studentId?: string;
  subjectId?: string | null;
};

export function StudyPlanEditor({
  relationships = [],
  detail,
  linkOptions = [],
  personal = false,
  subjects = [],
  studentId,
}: {
  relationships?: LearningRelationship[];
  detail?: StudyPlanDetail;
  linkOptions?: PlanLinkOption[];
  personal?: boolean;
  subjects?: { id: string; name: string }[];
  studentId?: string;
}) {
  const revision = detail?.revisions.find((r) => r.revision_no === detail.plan.current_revision);
  const [relationshipId, setRelationshipId] = useState("");
  const [selectedSubject, setSelectedSubject] = useState(detail?.plan.subject_id ?? "");
  const relation = relationships.find((row) => row.bookingId === relationshipId);
  const learner = detail?.plan.student_id ?? (personal ? studentId : relation?.studentId);
  const subject = detail?.plan.subject_id ?? (personal ? selectedSubject : relation?.subjectId);
  const availableLinks = linkOptions.filter(
    (link) => (!link.studentId || link.studentId === learner) && (!link.subjectId || link.subjectId === subject),
  );
  const [goalCounts, setGoalCounts] = useState<number[]>(revision?.goals.map((goal) => goal.milestones.length) ?? [1]);
  const fields: WorkflowField[] = [
    ...(!detail
      ? personal
        ? [
            {
              name: "subjectId",
              label: "Subject",
              type: "select" as const,
              required: true,
              wide: true,
              options: subjects.map((subject) => ({ value: subject.id, label: subject.name })),
            },
          ]
        : [relationshipsField(relationships)]
      : []),
    { name: "title", label: "Plan title", required: true, maxLength: 200, value: revision?.title, wide: true },
    {
      name: "description",
      label: "What you’re working toward",
      type: "textarea",
      maxLength: 4000,
      value: revision?.description ?? "",
      wide: true,
    },
    ...goalCounts.flatMap((milestoneCount, i): WorkflowField[] => {
      const goal = revision?.goals[i];
      return [
        {
          name: `goalTitle:${i}`,
          label: `Goal ${i + 1}`,
          required: true,
          value: goal?.title,
          maxLength: 200,
          wide: true,
        },
        {
          name: `goalTopic:${i}`,
          label: `Goal ${i + 1} — topic`,
          required: true,
          value: goal?.topic ?? "",
          maxLength: 200,
        },
        {
          name: `goalTargetDate:${i}`,
          label: `Goal ${i + 1} — target date`,
          type: "date",
          required: true,
          value: goal?.targetDate ?? "",
        },
        {
          name: `goalBaseline:${i}`,
          label: `Goal ${i + 1} — starting point`,
          required: true,
          value: goal?.baseline ?? "",
          maxLength: 2000,
          hint: "Describe your current evidence, such as 2/5 on a factoring check.",
        },
        {
          name: `goalSchedule:${i}`,
          label: `Goal ${i + 1} — practice schedule`,
          required: true,
          value: goal?.schedule ?? "",
          maxLength: 500,
          hint: "For example, Tuesday at 14:00 in your time zone.",
        },
        {
          name: `goalCriterion:${i}`,
          label: `Goal ${i + 1} — success criterion`,
          required: true,
          value: goal?.successCriterion ?? "",
          maxLength: 1000,
          wide: true,
          hint: "What observable result will show that this goal is met?",
        },
        {
          name: `goalDescription:${i}`,
          label: `Goal ${i + 1} — description`,
          type: "textarea",
          value: goal?.description ?? "",
          wide: true,
          maxLength: 2000,
        },
        ...Array.from({ length: milestoneCount }, (_, j): WorkflowField[] => [
          {
            name: `milestoneTitle:${i}:${j}`,
            label: `Goal ${i + 1} · milestone ${j + 1}`,
            required: true,
            value: goal?.milestones[j]?.title,
            maxLength: 200,
          },
          {
            name: `milestoneStatus:${i}:${j}`,
            label: `Milestone ${i + 1}.${j + 1} — state`,
            type: "select",
            required: true,
            value:
              goal?.milestones[j]?.status === "unspecified" ? "planned" : (goal?.milestones[j]?.status ?? "planned"),
            options: [
              { value: "planned", label: "Planned" },
              { value: "in_progress", label: "In progress" },
              { value: "completed", label: "Completed" },
              { value: "blocked", label: "Blocked" },
            ],
          },
          {
            name: `milestoneTargetDate:${i}:${j}`,
            label: `Milestone ${i + 1}.${j + 1} — target date`,
            type: "date",
            value: goal?.milestones[j]?.targetDate ?? "",
            readOnly: !!goal?.milestones[j]?.id,
            hint: goal?.milestones[j]?.id
              ? "Use Reschedule in the plan view to change this date and keep its history."
              : "Optional milestone deadline.",
          },
          {
            name: `milestoneLinks:${i}:${j}`,
            label: `Milestone ${i + 1}.${j + 1} — learning links`,
            type: "choices",
            wide: true,
            options: availableLinks.map((link) => ({ value: `${link.kind}:${link.id}`, label: link.label })),
            selected: goal?.milestones[j]?.links.map((link) => `${link.kind}:${link.id}`) ?? [],
            hint: "Choose resources, assignments and assessments for this learner and topic.",
          },
          {
            name: `milestoneDescription:${i}:${j}`,
            label: `Milestone ${i + 1}.${j + 1} — evidence to look for`,
            value: goal?.milestones[j]?.description ?? "",
            maxLength: 2000,
          },
        ]).flat(),
      ];
    }),
  ];
  const hidden: Record<string, string> = {
    planId: detail?.plan.id ?? "",
    mode: personal || detail?.plan.tutor_id === null ? "personal" : "shared",
    expectedRevision: String(detail?.plan.current_revision ?? 0),
    goalCount: String(goalCounts.length),
  };
  goalCounts.forEach((count, i) => {
    hidden[`goalId:${i}`] = revision?.goals[i]?.id ?? "";
    hidden[`milestoneCount:${i}`] = String(count);
    for (let j = 0; j < count; j++) hidden[`milestoneId:${i}:${j}`] = revision?.goals[i]?.milestones[j]?.id ?? "";
  });
  return (
    <WorkflowForm
      title={detail ? "Revise study plan" : "Create study plan"}
      onFieldChange={(name, value) => {
        if (name === "relationship") setRelationshipId(value);
        if (name === "subjectId") setSelectedSubject(value);
      }}
      action={savePlanAction}
      fields={fields}
      hidden={hidden}
      submit={detail ? "Save new revision" : "Create study plan"}
      disabled={!detail && (personal ? !subjects.length : !relationships.length)}
      footer={
        <div className="workspace-stack">
          <div className="workspace-actions">
            <button
              className="button secondary compact"
              type="button"
              disabled={goalCounts.length >= 10}
              onClick={() => setGoalCounts((counts) => [...counts, 1])}
            >
              Add goal
            </button>
            {goalCounts.length > 1 && (
              <button
                className="button secondary compact"
                type="button"
                onClick={() => setGoalCounts((counts) => counts.slice(0, -1))}
              >
                Remove last goal
              </button>
            )}
          </div>
          {goalCounts.map((count, i) => (
            <div className="workspace-actions" key={i}>
              <span className="hint">
                Goal {i + 1} · {count} milestones
              </span>
              <button
                className="button secondary compact"
                type="button"
                disabled={count >= 20}
                onClick={() => setGoalCounts((counts) => counts.map((n, j) => (j === i ? n + 1 : n)))}
              >
                Add milestone
              </button>
              {count > 1 && (
                <button
                  className="button secondary compact"
                  type="button"
                  onClick={() => setGoalCounts((counts) => counts.map((n, j) => (j === i ? n - 1 : n)))}
                >
                  Remove last milestone
                </button>
              )}
            </div>
          ))}
        </div>
      }
    />
  );
}
