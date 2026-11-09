import { InputError } from "@/domains/shared/errors";
import type { AssessmentQuestionInput } from "@/domains/learning/types";
/** Converts labelled authoring controls into a domain input; the domain validates the full definition again. */
export function readQuestionForm(form: FormData): AssessmentQuestionInput[] {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const count = Number(text("questionCount"));
  if (!Number.isInteger(count) || count < 1 || count > 100)
    throw new InputError({ questions: "Add between 1 and 100 questions." });
  return Array.from({ length: count }, (_, i) => {
    const kind = text(`kind:${i}`);
    if (kind !== "single_choice" && kind !== "short_answer")
      throw new InputError({ [`kind:${i}`]: "Choose a question type." });
    return {
      prompt: text(`prompt:${i}`),
      topic: text(`topic:${i}`),
      kind,
      choices:
        kind === "single_choice"
          ? text(`choices:${i}`)
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean)
          : null,
      points: Number(text(`points:${i}`)),
      correctChoice: kind === "single_choice" ? text(`correctChoice:${i}`) : null,
    };
  });
}
