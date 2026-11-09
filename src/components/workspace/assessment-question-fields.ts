import type { WorkflowField } from "./workflow-form";
export type QuestionEditorValue = {
  prompt: string;
  topic: string | null;
  kind: "single_choice" | "short_answer";
  choices: string[] | null;
  points: number;
  correctChoice: string | null;
};
export function assessmentQuestionFields(count: number, questions: QuestionEditorValue[] = []): WorkflowField[] {
  return Array.from({ length: count }, (_, i): WorkflowField[] => {
    const question = questions[i];
    return [
      {
        name: `topic:${i}`,
        label: `Question ${i + 1} — topic`,
        required: true,
        value: question?.topic ?? "",
        maxLength: 200,
        wide: true,
        hint: "Name the specific learning topic this question checks.",
      },
      {
        name: `prompt:${i}`,
        label: `Question ${i + 1} — prompt`,
        type: "textarea",
        required: true,
        value: question?.prompt,
        maxLength: 2000,
        wide: true,
      },
      {
        name: `kind:${i}`,
        label: `Question ${i + 1} — answer type`,
        type: "select",
        required: true,
        value: question?.kind ?? "short_answer",
        options: [
          { value: "short_answer", label: "Written answer — tutor scored" },
          { value: "single_choice", label: "Single choice — automatically scored" },
        ],
      },
      {
        name: `points:${i}`,
        label: `Question ${i + 1} — points`,
        type: "number",
        required: true,
        min: 1,
        max: 100,
        value: String(question?.points ?? 1),
      },
      {
        name: `choices:${i}`,
        label: `Question ${i + 1} — answer choices`,
        type: "textarea",
        value: question?.choices?.join("\n") ?? "",
        maxLength: 5009,
        hint: "For single-choice questions, enter 2 to 10 distinct choices, one per line, up to 500 characters each. Leave blank for written answers.",
      },
      {
        name: `correctChoice:${i}`,
        label: `Question ${i + 1} — correct choice`,
        value: question?.correctChoice ?? "",
        maxLength: 500,
        hint: "For single-choice questions, copy the correct choice exactly. This answer key is tutor-only.",
      },
    ];
  }).flat();
}
