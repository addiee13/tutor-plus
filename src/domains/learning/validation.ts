import { randomUUID } from "node:crypto";
import { InputError } from "../shared/errors";
import type {
  AssignmentFeedbackInput,
  AssignmentSubmissionInput,
  CreateAssessmentInput,
  CreateAssignmentInput,
  CreateStudyPlanInput,
  StudyGoalDraft,
  StudyGoal,
  StudyMilestoneLink,
  StudyPlanEvidence,
  TopicMasteryInput,
  UpdateAssessmentInput,
  UpdateAssignmentInput,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const FILE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain"]);
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function fail(field: string, message: string): never {
  throw new InputError({ [field]: message });
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(field, "Enter valid details.");
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, maximum: number, required = true): string | null {
  if (value === null && !required) return null;
  if (typeof value !== "string") fail(field, "Enter valid text.");
  const cleaned = value.replace(/\r\n?/g, "\n").trim();
  if ((!cleaned && required) || cleaned.length > maximum || CONTROL_CHARACTERS.test(cleaned)) {
    fail(field, `Enter ${required ? "text" : "no more than"} ${maximum} characters.`);
  }
  return cleaned || null;
}

function uuid(value: unknown, field: string, optional = false): string | null {
  if (value === null && optional) return null;
  if (typeof value !== "string" || !UUID.test(value)) fail(field, "Choose a valid record.");
  return value;
}

function date(value: unknown, field: string, optional = false): string | null {
  if ((value === null || value === "") && optional) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(field, "Enter a valid date and time.");
  return new Date(value).toISOString();
}

function dateOnly(value: unknown, field: string, optional = false): string | null {
  if ((value === null || value === "") && optional) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    fail(field, "Enter a valid calendar date.");
  }
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) fail(field, "Choose a valid option.");
  return value as T;
}

function int(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    fail(field, `Enter a whole number from ${min} to ${max}.`);
  }
  return value as number;
}

function questions(value: unknown): CreateAssessmentInput["questions"] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    fail("questions", "Add between 1 and 100 questions.");
  }
  return value.map((raw, index) => {
    const field = `questions.${index}`;
    const item = record(raw, field);
    const kind = enumValue(item.kind, ["single_choice", "short_answer"] as const, `${field}.kind`);
    let choices: string[] | null = null;
    let correctChoice: string | null = null;
    if (kind === "single_choice") {
      if (!Array.isArray(item.choices) || item.choices.length < 2 || item.choices.length > 10) {
        fail(`${field}.choices`, "Add between 2 and 10 choices.");
      }
      choices = item.choices.map((choice, choiceIndex) => {
        const parsed = text(choice, `${field}.choices.${choiceIndex}`, 500);
        if (!parsed) fail(`${field}.choices.${choiceIndex}`, "Enter a choice.");
        return parsed;
      });
      if (new Set(choices).size !== choices.length) fail(`${field}.choices`, "Each choice must be unique.");
      correctChoice = text(item.correctChoice, `${field}.correctChoice`, 500);
      if (!correctChoice || !choices.includes(correctChoice)) {
        fail(`${field}.correctChoice`, "Choose the correct answer from the choices.");
      }
    } else if (item.choices !== null && item.choices !== undefined) {
      fail(`${field}.choices`, "Short-answer questions do not have choices.");
    }
    if (kind === "short_answer" && item.correctChoice !== null && item.correctChoice !== undefined) {
      fail(`${field}.correctChoice`, "Short-answer questions are scored by the tutor.");
    }
    const prompt = text(item.prompt, `${field}.prompt`, 2000);
    if (!prompt) fail(`${field}.prompt`, "Enter a question.");
    const topic = text(item.topic, `${field}.topic`, 200);
    if (!topic) fail(`${field}.topic`, "Enter a topic for this question.");
    return { prompt, kind, choices, points: int(item.points, `${field}.points`, 1, 100), correctChoice, topic };
  });
}

export function parseCreateAssessment(input: unknown): CreateAssessmentInput {
  const item = record(input, "assessment");
  const title = text(item.title, "title", 200);
  const instructions = text(item.instructions, "instructions", 4000, false);
  if (!title) fail("title", "Enter a title.");
  return {
    tutorId: uuid(item.tutorId, "tutorId")!,
    studentId: uuid(item.studentId, "studentId")!,
    subjectId: uuid(item.subjectId, "subjectId")!,
    bookingId: uuid(item.bookingId, "bookingId", true),
    title,
    instructions,
    purpose: enumValue(item.purpose, ["diagnostic", "pre_session", "post_session", "milestone"] as const, "purpose"),
    dueAt: date(item.dueAt, "dueAt", true),
    questions: questions(item.questions),
  };
}

export function parseUpdateAssessment(input: unknown): UpdateAssessmentInput {
  const item = record(input, "assessment");
  const title = text(item.title, "title", 200);
  if (!title) fail("title", "Enter a title.");
  return {
    title,
    instructions: text(item.instructions, "instructions", 4000, false),
    purpose: enumValue(item.purpose, ["diagnostic", "pre_session", "post_session", "milestone"] as const, "purpose"),
    dueAt: date(item.dueAt, "dueAt", true),
    questions: questions(item.questions),
  };
}

export function parseAssessmentAnswers(value: unknown): Record<string, string> {
  const item = record(value, "answers");
  const entries = Object.entries(item);
  if (entries.length > 100) fail("answers", "There are too many answers.");
  const result: Record<string, string> = {};
  for (const [questionId, answer] of entries) {
    if (!UUID.test(questionId)) fail("answers", "An answer refers to an invalid question.");
    const parsed = text(answer, `answers.${questionId}`, 4000, false);
    result[questionId] = parsed ?? "";
  }
  return result;
}

export function parseAssessmentScore(input: unknown): { tutorPoints: number; feedback: string } {
  const item = record(input, "score");
  const feedback = text(item.feedback, "feedback", 4000);
  if (!feedback) fail("feedback", "Enter feedback.");
  return { tutorPoints: int(item.tutorPoints, "tutorPoints", 0, 10000), feedback };
}

export function parseCreateAssignment(input: unknown): CreateAssignmentInput {
  const item = record(input, "assignment");
  const title = text(item.title, "title", 200);
  const instructions = text(item.instructions, "instructions", 4000);
  if (!title || !instructions) fail("assignment", "Enter a title and instructions.");
  if (typeof item.acceptsLate !== "boolean") fail("acceptsLate", "Choose whether late work is accepted.");
  const studyPlanId = uuid(item.studyPlanId ?? null, "studyPlanId", true);
  const milestoneId = uuid(item.milestoneId ?? null, "milestoneId", true);
  if ((studyPlanId === null) !== (milestoneId === null)) fail("milestoneId", "Choose both a study plan and milestone.");
  const topic = text(item.topic, "topic", 200);
  if (!topic) fail("topic", "Enter an assignment topic.");
  return {
    tutorId: uuid(item.tutorId, "tutorId")!,
    studentId: uuid(item.studentId, "studentId")!,
    bookingId: uuid(item.bookingId, "bookingId")!,
    title,
    instructions,
    submissionType: enumValue(item.submissionType, ["text", "link", "file"] as const, "submissionType"),
    dueAt: date(item.dueAt, "dueAt")!,
    acceptsLate: item.acceptsLate,
    topic,
    studyPlanId,
    milestoneId,
  };
}

export function parseUpdateAssignment(input: unknown): UpdateAssignmentInput {
  const item = record(input, "assignment");
  const title = text(item.title, "title", 200);
  const instructions = text(item.instructions, "instructions", 4000);
  if (!title || !instructions) fail("assignment", "Enter a title and instructions.");
  if (typeof item.acceptsLate !== "boolean") fail("acceptsLate", "Choose whether late work is accepted.");
  const studyPlanId = uuid(item.studyPlanId ?? null, "studyPlanId", true);
  const milestoneId = uuid(item.milestoneId ?? null, "milestoneId", true);
  if ((studyPlanId === null) !== (milestoneId === null)) fail("milestoneId", "Choose both a study plan and milestone.");
  const topic = text(item.topic, "topic", 200);
  if (!topic) fail("topic", "Enter an assignment topic.");
  return {
    title,
    instructions,
    submissionType: enumValue(item.submissionType, ["text", "link", "file"] as const, "submissionType"),
    dueAt: date(item.dueAt, "dueAt")!,
    acceptsLate: item.acceptsLate,
    topic,
    studyPlanId,
    milestoneId,
  };
}

export function parseAssignmentDraft(input: unknown): { body: string | null; linkUrl: string | null } {
  const item = record(input, "draft");
  const body = text(item.body ?? null, "body", 8000, false);
  const linkUrl = text(item.linkUrl ?? null, "linkUrl", 1000, false);
  if (linkUrl && !/^https:\/\//i.test(linkUrl)) fail("linkUrl", "Use an HTTPS link.");
  if ((!body && !linkUrl) || (body && linkUrl)) fail("draft", "Save either text or one HTTPS link.");
  return { body, linkUrl };
}

export function parseAssignmentCancellationReason(value: unknown): string {
  const cleaned = text(value, "reason", 500, true);
  return cleaned as string;
}

export function parseAssignmentSubmission(input: unknown): AssignmentSubmissionInput {
  const item = record(input, "submission");
  const body = text(item.body ?? null, "body", 8000, false);
  const linkUrl = text(item.linkUrl ?? null, "linkUrl", 1000, false);
  if (linkUrl && !/^https:\/\//i.test(linkUrl)) fail("linkUrl", "Use an HTTPS link.");
  const file = item.file;
  if (file !== undefined && file !== null) {
    if (typeof File === "undefined" || !(file instanceof File)) fail("file", "Choose a valid file.");
    if (!file.size || file.size > MAX_UPLOAD_BYTES) fail("file", "Files must be 10 MiB or smaller.");
    if (!FILE_TYPES.has(file.type)) fail("file", "Use a PDF, PNG, JPEG, or plain-text file.");
  }
  return { body, linkUrl, file: (file as File | null | undefined) ?? null };
}

export function parseAssignmentFeedback(input: unknown): AssignmentFeedbackInput {
  const item = record(input, "feedback");
  const feedback = text(item.feedback, "feedback", 4000);
  if (!feedback) fail("feedback", "Enter feedback.");
  const score = item.score === null ? null : int(item.score, "score", 0, 100);
  return { feedback, score, outcome: enumValue(item.outcome, ["returned", "completed"] as const, "outcome") };
}

function parseGoalLinks(value: unknown, field: string): StudyMilestoneLink[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) fail(field, "A milestone can have up to 20 learning links.");
  return value.map((raw, index) => {
    const item = record(raw, `${field}.${index}`);
    return {
      kind: enumValue(item.kind, ["resource", "assignment", "assessment"] as const, `${field}.${index}.kind`),
      id: uuid(item.id, `${field}.${index}.id`)!,
    };
  });
}

function parseGoalsForWrite(value: unknown): StudyGoalDraft[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) fail("goals", "Add between 1 and 20 goals.");
  let milestoneCount = 0;
  const goals = value.map((raw, index) => {
    const item = record(raw, `goals.${index}`);
    if (!Array.isArray(item.milestones) || item.milestones.length < 1 || item.milestones.length > 20) {
      fail(`goals.${index}.milestones`, "Add between 1 and 20 milestones to each goal.");
    }
    milestoneCount += item.milestones.length;
    const id = item.id === undefined ? randomUUID() : uuid(item.id, `goals.${index}.id`)!;
    const title = text(item.title, `goals.${index}.title`, 200);
    const topic = text(item.topic, `goals.${index}.topic`, 200);
    const targetDate = dateOnly(item.targetDate, `goals.${index}.targetDate`);
    const baseline = text(item.baseline, `goals.${index}.baseline`, 2000);
    const schedule = text(item.schedule, `goals.${index}.schedule`, 500);
    const successCriterion = text(item.successCriterion, `goals.${index}.successCriterion`, 1000);
    if (!title) fail(`goals.${index}.title`, "Enter a goal.");
    if (!topic) fail(`goals.${index}.topic`, "Enter the learning topic.");
    if (!targetDate) fail(`goals.${index}.targetDate`, "Choose a target date.");
    if (!baseline) fail(`goals.${index}.baseline`, "Record the starting point.");
    if (!schedule) fail(`goals.${index}.schedule`, "Describe the learning schedule.");
    if (!successCriterion) fail(`goals.${index}.successCriterion`, "Describe how success will be recognized.");
    return {
      id,
      position: index + 1,
      title,
      topic,
      targetDate,
      baseline,
      schedule,
      successCriterion,
      description: text(item.description ?? null, `goals.${index}.description`, 2000, false),
      milestones: item.milestones.map((rawMilestone, milestoneIndex) => {
        const field = `goals.${index}.milestones.${milestoneIndex}`;
        const milestone = record(rawMilestone, `goals.${index}.milestones.${milestoneIndex}`);
        const milestoneId = milestone.id === undefined ? randomUUID() : uuid(milestone.id, `${field}.id`)!;
        const milestoneTitle = text(milestone.title, `${field}.title`, 200);
        if (!milestoneTitle) fail(`${field}.title`, "Enter a milestone.");
        return {
          id: milestoneId,
          position: milestoneIndex + 1,
          title: milestoneTitle,
          description: text(milestone.description ?? null, `${field}.description`, 2000, false),
          status: enumValue(
            milestone.status,
            ["planned", "in_progress", "completed", "blocked"] as const,
            `${field}.status`,
          ),
          targetDate: dateOnly(milestone.targetDate, `${field}.targetDate`, true),
          links: parseGoalLinks(milestone.links, `${field}.links`),
        };
      }),
    };
  });
  if (milestoneCount > 100) fail("goals", "A plan can contain no more than 100 milestones.");
  const allIds = goals.flatMap((goal) => [goal.id, ...goal.milestones.map((milestone) => milestone.id)]);
  if (new Set(allIds).size !== allIds.length) fail("goals", "Goal and milestone IDs must be unique.");
  return goals;
}

export function parseCreateStudyPlan(input: unknown): CreateStudyPlanInput & { goals: StudyGoalDraft[] } {
  const item = record(input, "plan");
  const title = text(item.title, "title", 200);
  if (!title) fail("title", "Enter a plan title.");
  return {
    tutorId: uuid(item.tutorId, "tutorId")!,
    studentId: uuid(item.studentId, "studentId")!,
    subjectId: uuid(item.subjectId, "subjectId", true),
    bookingId: uuid(item.bookingId, "bookingId", true),
    title,
    description: text(item.description ?? null, "description", 4000, false),
    goals: parseGoalsForWrite(item.goals),
  };
}

export function parseCreatePersonalStudyPlan(input: unknown): {
  subjectId: string;
  title: string;
  description: string | null;
  goals: StudyGoalDraft[];
} {
  const item = record(input, "plan");
  const subjectId = uuid(item.subjectId, "subjectId");
  if (!subjectId) fail("subjectId", "Choose an active subject.");
  const parsed = parseReviseStudyPlan({
    expectedRevision: 1,
    title: item.title,
    description: item.description,
    goals: item.goals,
  });
  return { subjectId, title: parsed.title, description: parsed.description, goals: parsed.goals };
}

export function parseReviseStudyPlan(input: unknown): {
  expectedRevision: number;
  title: string;
  description: string | null;
  goals: StudyGoalDraft[];
} {
  const item = record(input, "plan");
  const title = text(item.title, "title", 200);
  if (!title) fail("title", "Enter a plan title.");
  return {
    expectedRevision: int(item.expectedRevision, "expectedRevision", 1, 100000),
    title,
    description: text(item.description ?? null, "description", 4000, false),
    goals: parseGoalsForWrite(item.goals),
  };
}

export function parseRescheduleMilestone(input: unknown): {
  expectedRevision: number;
  targetDate: string;
  reason: string;
} {
  const item = record(input, "reschedule");
  const targetDate = dateOnly(item.targetDate, "targetDate");
  const reason = text(item.reason, "reason", 500);
  if (!targetDate) fail("targetDate", "Choose a new target date.");
  if (!reason) fail("reason", "Explain why the date is changing.");
  return { expectedRevision: int(item.expectedRevision, "expectedRevision", 1, 100000), targetDate, reason };
}

export function parseStudyPlanProposal(input: unknown): {
  milestoneId: string;
  proposedTargetDate: string;
  summary: string;
} {
  const item = record(input, "proposal");
  const proposedTargetDate = dateOnly(item.proposedTargetDate, "proposedTargetDate");
  const summary = text(item.summary, "summary", 1000);
  if (!proposedTargetDate) fail("proposedTargetDate", "Choose a proposed target date.");
  if (!summary) fail("summary", "Describe the proposed change.");
  return {
    milestoneId: uuid(item.milestoneId, "milestoneId")!,
    proposedTargetDate,
    summary,
  };
}

export function parseProposalConfirmationReason(value: unknown): string {
  const reason = text(value, "reason", 500);
  if (!reason) fail("reason", "Explain why you are confirming the new date.");
  return reason;
}

export function parseTopicMastery(input: unknown): TopicMasteryInput {
  const item = record(input, "mastery");
  const topic = text(item.topic, "topic", 200);
  if (!topic) fail("topic", "Enter a topic.");
  return {
    studentId: uuid(item.studentId, "studentId")!,
    subjectId: uuid(item.subjectId, "subjectId")!,
    topic,
    label: enumValue(item.label, ["needs_work", "improving", "confident"] as const, "label"),
    sourceKind: enumValue(
      item.sourceKind,
      ["assessment_attempt", "assignment_submission", "session_recap"] as const,
      "sourceKind",
    ),
    sourceId: uuid(item.sourceId, "sourceId")!,
    observedAt: date(item.observedAt, "observedAt")!,
    note: text(item.note ?? null, "note", 1000, false),
  };
}

export function parseEvidenceSource(input: unknown): {
  sourceKind: StudyPlanEvidence["source_kind"];
  sourceId: string;
} {
  const item = record(input, "evidence");
  return {
    sourceKind: enumValue(
      item.sourceKind,
      ["assessment_attempt", "assignment_submission", "session_recap"] as const,
      "sourceKind",
    ),
    sourceId: uuid(item.sourceId, "sourceId")!,
  };
}

export function parseRecordId(value: unknown, field = "id"): string {
  return uuid(value, field)!;
}

export function parsePlanGoalSnapshot(value: unknown): StudyGoal[] {
  // Older snapshots did not carry the structured case fields. They remain visible without inventing criteria.
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) fail("goals", "Invalid stored goals.");
  return value.map((raw, index) => {
    const item = record(raw, `goals.${index}`);
    const id = uuid(item.id, `goals.${index}.id`)!;
    const title = text(item.title, `goals.${index}.title`, 200);
    if (!title) fail(`goals.${index}.title`, "Invalid stored goal.");
    const rawMilestones = item.milestones;
    if (!Array.isArray(rawMilestones) || rawMilestones.length < 1 || rawMilestones.length > 20) {
      fail(`goals.${index}.milestones`, "Invalid stored milestones.");
    }
    return {
      id,
      position: Number.isInteger(item.position) ? (item.position as number) : index + 1,
      title,
      topic: typeof item.topic === "string" ? text(item.topic, `goals.${index}.topic`, 200, false) : null,
      targetDate: typeof item.targetDate === "string" ? dateOnly(item.targetDate, `goals.${index}.targetDate`) : null,
      baseline: typeof item.baseline === "string" ? text(item.baseline, `goals.${index}.baseline`, 2000, false) : null,
      schedule: typeof item.schedule === "string" ? text(item.schedule, `goals.${index}.schedule`, 500, false) : null,
      successCriterion:
        typeof item.successCriterion === "string"
          ? text(item.successCriterion, `goals.${index}.successCriterion`, 1000, false)
          : null,
      description: text(item.description ?? null, `goals.${index}.description`, 2000, false),
      milestones: rawMilestones.map((rawMilestone, milestoneIndex) => {
        const milestone = record(rawMilestone, `goals.${index}.milestones.${milestoneIndex}`);
        const milestoneId = uuid(milestone.id, `goals.${index}.milestones.${milestoneIndex}.id`)!;
        const milestoneTitle = text(milestone.title, `goals.${index}.milestones.${milestoneIndex}.title`, 200);
        if (!milestoneTitle) fail(`goals.${index}.milestones.${milestoneIndex}.title`, "Invalid stored milestone.");
        return {
          id: milestoneId,
          position: Number.isInteger(milestone.position) ? (milestone.position as number) : milestoneIndex + 1,
          title: milestoneTitle,
          description: text(milestone.description ?? null, `milestones.${milestoneIndex}.description`, 2000, false),
          status: ["planned", "in_progress", "completed", "blocked"].includes(String(milestone.status))
            ? (milestone.status as StudyGoal["milestones"][number]["status"])
            : "unspecified",
          targetDate:
            typeof milestone.targetDate === "string"
              ? dateOnly(milestone.targetDate, `milestones.${milestoneIndex}.targetDate`)
              : null,
          links: parseGoalLinks(milestone.links, `milestones.${milestoneIndex}.links`),
        };
      }),
    };
  });
}
