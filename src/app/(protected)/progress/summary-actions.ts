"use server";

import { createUserClient } from "@/lib/supabase/server";
import { generateLearningProgressSummary } from "@/domains/platform/progress-summary";
import type { ProgressSummarySource } from "@/domains/platform/progress-summary-context";
import { InputError, safeMessage } from "@/domains/shared/errors";
import { readProgressFilters } from "./filters";

export type ProgressSummaryState = {
  summary?: string;
  sources?: ProgressSummarySource[];
  generatedAt?: string;
  caveat?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function generateProgressSummaryAction(
  _previous: ProgressSummaryState,
  form: FormData,
): Promise<ProgressSummaryState> {
  try {
    const query: Record<string, string | string[]> = {};
    for (const name of ["goal", "topic", "tutor", "from", "to"]) {
      const values = form.getAll(name);
      if (values.some((value) => typeof value !== "string"))
        throw new InputError({ [name]: "Choose a valid progress filter." });
      if (values.length) query[name] = values.length === 1 ? String(values[0]) : values.map(String);
    }
    return await generateLearningProgressSummary(await createUserClient(), readProgressFilters(query));
  } catch (error) {
    return { error: safeMessage(error), fieldErrors: error instanceof InputError ? error.fields : undefined };
  }
}
