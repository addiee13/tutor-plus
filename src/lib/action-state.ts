import { InputError, safeMessage, type ActionState } from "@/domains/shared/errors";

export const initialActionState: ActionState = { message: "" };

/** Converts a thrown error into form state: a safe summary plus per-field messages for validation failures. */
export function actionFailure(error: unknown, values?: Record<string, string>): ActionState {
  return {
    message: safeMessage(error),
    fields: error instanceof InputError ? error.fields : undefined,
    values,
  };
}
