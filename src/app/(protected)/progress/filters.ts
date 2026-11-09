import { InputError } from "../../../domains/shared/errors";
import type { LearningProgressFilters } from "../../../domains/learning/types";
export function readProgressFilters(query: Record<string, string | string[] | undefined>): LearningProgressFilters {
  const read = (key: string) => {
    const value = query[key];
    if (Array.isArray(value)) throw new InputError({ [key]: "Choose one value for each progress filter." });
    return value?.trim() || undefined;
  };
  const topic = read("topic");
  let selectedTopic: LearningProgressFilters["topic"];
  if (topic) {
    try {
      const value: unknown = JSON.parse(topic);
      if (
        !value ||
        typeof value !== "object" ||
        !("subjectId" in value) ||
        !("topic" in value) ||
        typeof value.subjectId !== "string" ||
        typeof value.topic !== "string"
      )
        throw new Error();
      selectedTopic = { subjectId: value.subjectId, topic: value.topic };
    } catch {
      throw new InputError({ topic: "Choose a recorded subject and topic." });
    }
  }
  return {
    goalId: read("goal"),
    topic: selectedTopic,
    tutorId: read("tutor"),
    fromDate: read("from"),
    toDate: read("to"),
  };
}
