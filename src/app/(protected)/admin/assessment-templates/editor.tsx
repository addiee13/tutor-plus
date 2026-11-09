"use client";
import { useState } from "react";
import type { AssessmentTemplate, Subject } from "@/domains/platform/types";
import { assessmentQuestionFields } from "@/components/workspace/assessment-question-fields";
import { WorkflowForm, type WorkflowAction, type WorkflowField } from "@/components/workspace/workflow-form";
export function AssessmentTemplateEditor({
  template,
  subjects,
  action,
}: {
  template?: AssessmentTemplate;
  subjects: Subject[];
  action: WorkflowAction;
}) {
  const [count, setCount] = useState(template?.questions.length ?? 1);
  const fields: WorkflowField[] = [
    {
      name: "title",
      label: "Assessment template title",
      required: true,
      wide: true,
      maxLength: 200,
      value: template?.title,
    },
    {
      name: "description",
      label: "Template instructions",
      type: "textarea",
      wide: true,
      maxLength: 4000,
      value: template?.description,
    },
    {
      name: "subjectId",
      label: "Template subject",
      type: "select",
      value: template?.subjectId ?? "",
      options: subjects.map((subject) => ({
        value: subject.id,
        label: `${subject.name}${subject.active ? "" : " (inactive)"}`,
      })),
      hint: "Leave unselected only for a general template.",
    },
    {
      name: "purpose",
      label: "Assessment purpose",
      type: "select",
      required: true,
      value: template?.purpose ?? "diagnostic",
      options: [
        { value: "diagnostic", label: "Diagnostic" },
        { value: "pre_session", label: "Before a session" },
        { value: "post_session", label: "After a session" },
        { value: "milestone", label: "Milestone check" },
      ],
    },
    ...assessmentQuestionFields(count, template?.questions),
    {
      name: "active",
      label: "Make this version available to eligible tutors",
      type: "checkbox",
      checked: template?.active ?? false,
      wide: true,
    },
    {
      name: "reason",
      label: "Reason for this template version",
      type: "textarea",
      required: true,
      wide: true,
      maxLength: 500,
    },
    {
      name: "confirmed",
      label: "I confirm this assessment template version",
      type: "checkbox",
      required: true,
      wide: true,
    },
  ];
  return (
    <WorkflowForm
      title={template ? "Revise assessment template" : "Create assessment template"}
      action={action}
      fields={fields}
      hidden={{
        id: template?.id ?? "",
        expectedVersion: template ? String(template.version) : "",
        questionCount: String(count),
      }}
      submit="Save confirmed template version"
      footer={
        <div className="workspace-actions">
          <button
            className="button secondary compact"
            type="button"
            disabled={count >= 100}
            onClick={() => setCount((value) => value + 1)}
          >
            Add question
          </button>
          {count > 1 && (
            <button className="button secondary compact" type="button" onClick={() => setCount((value) => value - 1)}>
              Remove last question
            </button>
          )}
          <span className="hint">{count} questions · answer keys remain within authorized authoring views.</span>
        </div>
      }
    />
  );
}
