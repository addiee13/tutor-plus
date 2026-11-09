import { InputError, type FieldErrors } from "../shared/errors";
import { readText } from "../shared/form";
import { parseBookingId } from "../bookings/validation";
import type { SessionAgendaLinkInput, SessionAttachmentReviewInput } from "./types";

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

function normalizeLongText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function collect(form: FormData, rules: Record<string, TextRule>) {
  const fields: FieldErrors = {};
  const values: Record<string, string | null> = {};
  for (const [name, rule] of Object.entries(rules)) {
    const raw = form.get(name);
    const value = typeof raw === "string" ? normalizeLongText(raw) : "";
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
  const rawTopics = form.getAll("priorityTopic");
  if (rawTopics.some((value) => typeof value !== "string") || rawTopics.length > 10) {
    throw new InputError({ priorityTopic: "Choose up to ten priority topics." });
  }
  const priorityTopics = [...new Set(rawTopics.map((value) => (value as string).trim()).filter(Boolean))];
  if (priorityTopics.some((topic) => topic.length > 200 || CONTROL_CHARACTERS.test(topic))) {
    throw new InputError({ priorityTopic: "Keep each priority topic to 200 characters or fewer." });
  }
  return { booking, goals: values.goals as string, questions: values.questions, priorityTopics };
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

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InputError({ [field]: "Enter valid details." });
  return value as Record<string, unknown>;
}

function textValue(value: unknown, field: string, max: number, required = true): string | null {
  if (value === null && !required) return null;
  if (typeof value !== "string") throw new InputError({ [field]: "Enter valid text." });
  const normalized = normalizeLongText(value);
  if ((required && !normalized) || normalized.length > max || CONTROL_CHARACTERS.test(normalized)) {
    throw new InputError({ [field]: `Enter ${required ? "text" : "no more than"} ${max} characters.` });
  }
  return normalized || null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new InputError({ [field]: "Choose a valid record." });
  return value;
}

export function parseSessionAgendaLinks(value: unknown): SessionAgendaLinkInput[] {
  if (!Array.isArray(value) || value.length > 20)
    throw new InputError({ links: "Choose up to twenty learning links." });
  return value.map((raw, index) => {
    const field = `links.${index}`;
    const item = object(raw, field);
    if (item.kind === "milestone") {
      return {
        kind: "milestone" as const,
        studyPlanId: uuidValue(item.studyPlanId, `${field}.studyPlanId`),
        milestoneId: uuidValue(item.milestoneId, `${field}.milestoneId`),
      };
    }
    if (item.kind === "resource" || item.kind === "assignment" || item.kind === "assessment") {
      return { kind: item.kind, id: uuidValue(item.id, `${field}.id`) };
    }
    throw new InputError({ [field]: "Choose a supported learning link." });
  });
}

export function parseStructuredRecap(value: unknown) {
  const item = object(value, "recap");
  const bookingId = parseBookingId(String(item.bookingId ?? ""));
  const summary = textValue(item.summary, "summary", SUMMARY_MAX)!;
  const masteryNotes = textValue(item.masteryNotes ?? null, "masteryNotes", MASTERY_MAX, false);
  const strengths = textValue(item.strengths, "strengths", MASTERY_MAX)!;
  const practiceAreas = textValue(item.practiceAreas, "practiceAreas", MASTERY_MAX)!;
  const nextSteps = textValue(item.nextSteps ?? null, "nextSteps", NEXT_STEPS_MAX, false);
  if (!Array.isArray(item.topics) || item.topics.length < 1 || item.topics.length > 20) {
    throw new InputError({ topics: "Add between one and twenty covered topics." });
  }
  const topics = [...new Set(item.topics.map((topic, index) => textValue(topic, `topics.${index}`, 200)!))];
  if (!Array.isArray(item.resourceIds) || item.resourceIds.length > 20) {
    throw new InputError({ resourceIds: "Choose up to twenty approved resources." });
  }
  const resourceIds = [...new Set(item.resourceIds.map((id, index) => uuidValue(id, `resourceIds.${index}`)))];
  return { bookingId, summary, topics, masteryNotes, strengths, practiceAreas, nextSteps, resourceIds };
}

export function parseSessionAttachmentReview(value: unknown): SessionAttachmentReviewInput {
  const item = object(value, "review");
  if (item.decision !== "approved" && item.decision !== "rejected") {
    throw new InputError({ decision: "Choose approval or rejection." });
  }
  const reason = textValue(item.reason ?? null, "reason", 500, item.decision === "rejected");
  return { decision: item.decision, reason };
}
