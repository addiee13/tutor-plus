import { InputError, type FieldErrors } from "../shared/errors";
import { readText } from "../shared/form";
import { parseBookingId } from "../bookings/validation";

export const GOALS_MAX = 2000;
export const QUESTIONS_MAX = 2000;
export const AGENDA_MAX = 4000;
export const SUMMARY_MAX = 4000;
export const MASTERY_MAX = 2000;
export const NEXT_STEPS_MAX = 2000;
export const REFLECTION_MAX = 4000;

// Line breaks and tabs are allowed in long-form text; other control characters are not.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

type TextRule = { label: string; max: number; required: boolean };

function collect(form: FormData, rules: Record<string, TextRule>) {
  const fields: FieldErrors = {};
  const values: Record<string, string | null> = {};
  for (const [name, rule] of Object.entries(rules)) {
    const value = readText(form, name);
    if (rule.required && !value) fields[name] = `Enter ${rule.label}.`;
    else if (value.length > rule.max) fields[name] = `Keep ${rule.label} to ${rule.max} characters or fewer.`;
    else if (CONTROL_CHARACTERS.test(value)) fields[name] = `Remove unsupported characters from ${rule.label}.`;
    values[name] = value || null;
  }
  if (Object.keys(fields).length) throw new InputError(fields);
  return values;
}

export function parseSessionTarget(form: FormData): string {
  return parseBookingId(readText(form, "booking"));
}

export function parseStudentPlan(form: FormData) {
  const booking = parseSessionTarget(form);
  const values = collect(form, {
    goals: { label: "your goals for this session", max: GOALS_MAX, required: true },
    questions: { label: "your questions", max: QUESTIONS_MAX, required: false },
  });
  return { booking, goals: values.goals as string, questions: values.questions };
}

export function parseTutorAgenda(form: FormData) {
  const booking = parseSessionTarget(form);
  const values = collect(form, { agenda: { label: "an agenda", max: AGENDA_MAX, required: true } });
  return { booking, agenda: values.agenda as string };
}

export function parseRecap(form: FormData) {
  const booking = parseSessionTarget(form);
  const values = collect(form, {
    summary: { label: "a session summary", max: SUMMARY_MAX, required: true },
    mastery_notes: { label: "mastery notes", max: MASTERY_MAX, required: false },
    next_steps: { label: "next steps", max: NEXT_STEPS_MAX, required: false },
  });
  return {
    booking,
    summary: values.summary as string,
    mastery_notes: values.mastery_notes,
    next_steps: values.next_steps,
  };
}

export function parseReflection(form: FormData) {
  const booking = parseSessionTarget(form);
  const values = collect(form, {
    reflection: { label: "a reflection", max: REFLECTION_MAX, required: true },
  });
  return { booking, reflection: values.reflection as string };
}
