"use client";
import { useState } from "react";
import type { BadgePolicy } from "@/domains/platform/types";
import { WorkflowForm, type WorkflowAction, type WorkflowField } from "@/components/workspace/workflow-form";
const facts = [
  { value: "completed_sessions", label: "Completed platform sessions" },
  { value: "visible_reviews", label: "Visible eligible reviews" },
  { value: "rating_average", label: "Visible review average" },
  { value: "recommendations", label: "Visible learner recommendations" },
];
export function BadgePolicyEditor({ policy, action }: { policy: BadgePolicy; action: WorkflowAction }) {
  const [count, setCount] = useState(Math.max(1, policy.thresholds.length));
  const [selectedFacts, setSelectedFacts] = useState(policy.thresholds.map((rule) => rule.fact as string));
  const fields: WorkflowField[] = [
    ...Array.from({ length: count }, (_, i): WorkflowField[] => [
      {
        name: `fact:${i}`,
        label: `Rule ${i + 1} — platform fact`,
        type: "select",
        required: true,
        value: policy.thresholds[i]?.fact,
        options: facts,
      },
      {
        name: `threshold:${i}`,
        label: `Rule ${i + 1} — minimum value`,
        type: "number",
        required: true,
        min: 1,
        max: selectedFacts[i] === "rating_average" ? 5 : 100000,
        step: selectedFacts[i] === "rating_average" ? 0.1 : 1,
        value: policy.thresholds[i]?.threshold.toString(),
      },
      {
        name: `label:${i}`,
        label: `Rule ${i + 1} — public badge label`,
        required: true,
        maxLength: 120,
        value: policy.thresholds[i]?.label,
        wide: true,
        hint: "Describe this platform fact. A badge does not verify an external credential.",
      },
    ]).flat(),
    {
      name: "reason",
      label: "Reason for the badge policy change",
      type: "textarea",
      required: true,
      maxLength: 500,
      wide: true,
    },
    {
      name: "confirmed",
      label: "I confirm this public badge policy version",
      type: "checkbox",
      required: true,
      wide: true,
    },
  ];
  return (
    <WorkflowForm
      title="Publish badge policy"
      action={action}
      hidden={{ expectedVersion: String(policy.version), thresholdCount: String(count) }}
      fields={fields}
      submit="Publish confirmed badge policy"
      onFieldChange={(name, value) => {
        if (name.startsWith("fact:"))
          setSelectedFacts((items) => {
            const next = [...items];
            next[Number(name.split(":")[1])] = value;
            return next;
          });
      }}
      footer={
        <div className="workspace-actions">
          <button
            className="button secondary compact"
            type="button"
            disabled={count >= 4}
            onClick={() => setCount((value) => value + 1)}
          >
            Add badge rule
          </button>
          {count > 1 && (
            <button className="button secondary compact" type="button" onClick={() => setCount((value) => value - 1)}>
              Remove last rule
            </button>
          )}
        </div>
      }
    />
  );
}
