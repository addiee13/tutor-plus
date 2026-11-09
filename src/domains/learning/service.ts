import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../auth/service";
import { hasRole, requireRole, type Actor } from "../auth/policy";
import { DomainError, InputError } from "../shared/errors";
import { PgErrorCode } from "../shared/postgres";
import {
  parseAssignmentFeedback,
  parseAssignmentCancellationReason,
  parseAssignmentDraft,
  parseAssignmentSubmission,
  parseAssessmentAnswers,
  parseCreatePersonalStudyPlan,
  parseAssessmentScore,
  parseCreateAssessment,
  parseCreateAssignment,
  parseCreateStudyPlan,
  parseEvidenceSource,
  parsePlanGoalSnapshot,
  parseProposalConfirmationReason,
  parseRecordId,
  parseReviseStudyPlan,
  parseRescheduleMilestone,
  parseStudyPlanProposal,
  parseTopicMastery,
  parseUpdateAssessment,
  parseUpdateAssignment,
} from "./validation";
import type {
  Assessment,
  AssessmentAnswerKey,
  AssessmentAttempt,
  AssessmentDetail,
  AssessmentQuestion,
  Assignment,
  AssignmentSubmissionDraft,
  AssignmentMilestoneOption,
  AssignmentDetail,
  AssignmentFeedback,
  AssignmentSubmission,
  CreateAssessmentInput,
  LearningProgressEvent,
  LearningProgressCappedSource,
  LearningProgressFilters,
  LearningProgressFilterOptions,
  LearningProgressOverview,
  LearningTopicRecord,
  LearningTopicSummary,
  LearningRelationship,
  StudyGoal,
  StudyGoalDraft,
  StudyPlan,
  StudyPlanDetail,
  StudyPlanEvidence,
  StudyPlanListItem,
  StudyPlanProposal,
  StudyPlanReplanningHistory,
  StudyPlanRevision,
  StudyEvidenceCandidate,
  TopicEvidenceCandidate,
  TopicMasteryObservation,
  UpdateAssessmentInput,
} from "./types";

const ASSESSMENT_FIELDS =
  "id,tutor_id,student_id,subject_id,booking_id,title,instructions,purpose,status,definition_version,due_at,assigned_at,created_at,updated_at";
const QUESTION_FIELDS = "id,assessment_id,position,prompt,kind,choices,points,topic,created_at";
const ATTEMPT_FIELDS =
  "id,assessment_id,student_id,attempt_no,definition_version,answers,status,auto_score,tutor_score,score,max_score,tutor_feedback,submitted_at,scored_at,created_at,updated_at";
const ASSIGNMENT_FIELDS =
  "id,tutor_id,student_id,booking_id,subject_id,topic,study_plan_id,plan_revision_no,milestone_id,title,instructions,submission_type,due_at,accepts_late,submissions_closed_at,status,cancellation_reason,created_at,updated_at";
const SUBMISSION_FIELDS =
  "id,assignment_id,student_id,attempt_no,body,link_url,file_path,file_mime,file_size_bytes,is_late,submitted_at";
const FEEDBACK_FIELDS = "id,submission_id,tutor_id,feedback,score,outcome,created_at,updated_at";
const PLAN_FIELDS = "id,tutor_id,student_id,subject_id,booking_id,status,current_revision,created_at,updated_at";
const REVISION_FIELDS = "id,plan_id,revision_no,title,description,goals,authored_by,created_at";
const EVIDENCE_FIELDS = "id,plan_id,revision_no,milestone_id,source_kind,source_id,recorded_by,created_at";
const REPLANNING_FIELDS =
  "id,plan_id,milestone_id,revision_no,from_target_date,to_target_date,reason,authored_by,created_at";
const PROPOSAL_FIELDS =
  "id,plan_id,milestone_id,proposed_target_date,summary,proposed_by,status,decided_by,decided_at,decision_reason,created_at";
const MASTERY_FIELDS =
  "id,student_id,tutor_id,subject_id,topic,label,source_kind,source_id,recorded_by,observed_at,note,created_at";
const PROGRESS_EVENT_FIELDS =
  "id,student_id,tutor_id,subject_id,event_type,source_kind,source_id,occurred_at,created_at";
const BUCKET = "assignment-submissions";
const PROGRESS_POSTGREST_ROW_CAP = 1000;

export function progressQueryAtEffectiveCap(returnedRows: number, requestedLimit: number): boolean {
  return returnedRows >= Math.min(requestedLimit, PROGRESS_POSTGREST_ROW_CAP);
}

/** Summaries are arithmetic over saved records and exact repeated recap phrases, never mastery inference. */
export function summarizeLearningTopicEvidence(records: LearningTopicRecord[]): LearningTopicSummary[] {
  const groups = new Map<string, LearningTopicRecord[]>();
  for (const record of records) {
    const key = `${record.subjectId}:${record.topic.trim().toLocaleLowerCase("en-US")}`;
    const rows = groups.get(key) ?? [];
    rows.push(record);
    groups.set(key, rows);
  }
  const repeatedPhrases = (rows: LearningTopicRecord[], field: "strengths" | "practiceAreas") => {
    const phrases = new Map<
      string,
      { text: string; sources: Array<{ bookingId: string; occurredAt: string; sourcePath: string }> }
    >();
    for (const record of rows) {
      const phrase = record.sourceKind === "session_recap" ? record.recapNarrative?.[field]?.trim() : null;
      if (!phrase) continue;
      const key = phrase.replace(/\s+/g, " ").toLocaleLowerCase("en-US");
      const item = phrases.get(key) ?? { text: phrase, sources: [] };
      if (!item.sources.some((source) => source.bookingId === record.sourceId)) {
        item.sources.push({ bookingId: record.sourceId, occurredAt: record.occurredAt, sourcePath: record.sourcePath });
      }
      phrases.set(key, item);
    }
    return [...phrases.values()]
      .filter((phrase) => phrase.sources.length >= 2)
      .map((phrase) => ({ text: phrase.text, recapCount: phrase.sources.length, sources: phrase.sources }))
      .sort((left, right) => right.recapCount - left.recapCount || left.text.localeCompare(right.text));
  };

  return [...groups.values()]
    .map((rows) => {
      const latestObservation = rows
        .filter((record) => record.tutorObservation)
        .sort(
          (left, right) =>
            Date.parse(right.tutorObservation!.observedAt) - Date.parse(left.tutorObservation!.observedAt),
        )[0];
      return {
        subjectId: rows[0].subjectId,
        topic: rows[0].topic,
        recordCount: rows.length,
        assessmentQuestionCount: rows.filter((record) => record.sourceKind === "assessment_question").length,
        assignmentSubmissionCount: rows.filter((record) => record.sourceKind === "assignment_submission").length,
        recapCount: new Set(
          rows.filter((record) => record.sourceKind === "session_recap").map((record) => record.sourceId),
        ).size,
        tutorObservationCount: rows.filter((record) => record.sourceKind === "tutor_observation").length,
        assessmentPoints: rows.reduce(
          (sum, record) => ({
            earned: sum.earned + (record.assessmentPoints?.earned ?? 0),
            possible: sum.possible + (record.assessmentPoints?.possible ?? 0),
          }),
          { earned: 0, possible: 0 },
        ),
        scoredAssignmentFeedbackCount: rows.filter(
          (record) =>
            record.sourceKind === "assignment_submission" &&
            record.assignmentFeedback?.score !== null &&
            record.assignmentFeedback?.score !== undefined,
        ).length,
        latestTutorObservation: latestObservation?.tutorObservation
          ? {
              label: latestObservation.tutorObservation.label,
              observedAt: latestObservation.tutorObservation.observedAt,
              sourceLabel: latestObservation.sourceLabel,
              sourcePath: latestObservation.sourcePath,
            }
          : null,
        recurringStrengths: repeatedPhrases(rows, "strengths"),
        recurringPracticeAreas: repeatedPhrases(rows, "practiceAreas"),
      };
    })
    .sort((left, right) => left.subjectId.localeCompare(right.subjectId) || left.topic.localeCompare(right.topic));
}

export function parseLearningProgressFilters(filters: LearningProgressFilters = {}): LearningProgressFilters {
  const parseDate = (value: string | undefined, field: string) => {
    if (value === undefined || value === "") return undefined;
    if (typeof value !== "string") throw new InputError({ [field]: "Enter a valid calendar date." });
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(parsed.valueOf()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      throw new InputError({ [field]: "Enter a valid calendar date." });
    }
    return value;
  };
  const fromDate = parseDate(filters.fromDate, "fromDate");
  const toDate = parseDate(filters.toDate, "toDate");
  if (fromDate && toDate && fromDate > toDate)
    throw new InputError({ toDate: "End date must not precede start date." });
  const topic = filters.topic
    ? {
        subjectId: parseRecordId(filters.topic.subjectId, "topic.subjectId"),
        topic: filters.topic.topic.trim(),
      }
    : undefined;
  if (topic && (!topic.topic || topic.topic.length > 200)) throw new InputError({ topic: "Choose a valid topic." });
  return {
    goalId: filters.goalId ? parseRecordId(filters.goalId, "goalId") : undefined,
    topic,
    tutorId: filters.tutorId ? parseRecordId(filters.tutorId, "tutorId") : undefined,
    fromDate,
    toDate,
  };
}

export function filterTopicRecords(
  records: LearningTopicRecord[],
  filters: LearningProgressFilters,
): LearningTopicRecord[] {
  const topicKey = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  const from = filters.fromDate ? Date.parse(`${filters.fromDate}T00:00:00.000Z`) : null;
  const to = filters.toDate ? Date.parse(`${filters.toDate}T23:59:59.999Z`) : null;
  return records.filter((record) => {
    if (filters.goalId && !record.goalIds?.includes(filters.goalId)) return false;
    if (
      filters.topic &&
      (record.subjectId !== filters.topic.subjectId || topicKey(record.topic) !== topicKey(filters.topic.topic))
    )
      return false;
    if (filters.tutorId && record.tutorId !== filters.tutorId) return false;
    const occurred = Date.parse(record.occurredAt);
    if (from !== null && (!Number.isFinite(occurred) || occurred < from)) return false;
    if (to !== null && (!Number.isFinite(occurred) || occurred > to)) return false;
    return true;
  });
}

function databaseFailure(error: { code?: string }, field = "details"): never {
  if (error.code === PgErrorCode.insufficientPrivilege) throw new DomainError("forbidden");
  if (error.code === PgErrorCode.invalidParameterValue) {
    throw new InputError({
      [field]: "This learning record no longer matches the current rules. Refresh and try again.",
    });
  }
  if (error.code === PgErrorCode.uniqueViolation) {
    throw new InputError({ [field]: "This change conflicts with a newer record. Refresh and try again." });
  }
  throw new DomainError("unavailable");
}

function requireLearningRole(actor: Actor): void {
  if (!hasRole(actor, "student") && !hasRole(actor, "tutor")) throw new DomainError("forbidden");
}

async function requireOwnedTutor(client: SupabaseClient, actor: Actor, tutorId: string): Promise<void> {
  requireRole(actor, "tutor");
  const { data, error } = await client
    .from("tutor_profiles")
    .select("id")
    .eq("id", tutorId)
    .eq("user_id", actor.id)
    .maybeSingle();
  if (error) throw new DomainError("unavailable");
  if (!data) throw new DomainError("forbidden");
}

async function ownsTutor(client: SupabaseClient, actor: Actor, tutorId: string | null): Promise<boolean> {
  if (!tutorId) return false;
  if (!hasRole(actor, "tutor")) return false;
  const { data, error } = await client
    .from("tutor_profiles")
    .select("id")
    .eq("id", tutorId)
    .eq("user_id", actor.id)
    .maybeSingle();
  if (error) throw new DomainError("unavailable");
  return Boolean(data);
}

async function readAssessment(client: SupabaseClient, id: string): Promise<Assessment> {
  const { data, error } = await client
    .from("assessments")
    .select(ASSESSMENT_FIELDS)
    .eq("id", id)
    .maybeSingle<Assessment>();
  if (error) throw new DomainError("unavailable");
  if (!data) throw new DomainError("forbidden");
  return data;
}

async function readAssignment(client: SupabaseClient, id: string): Promise<Assignment> {
  const { data, error } = await client
    .from("assignments")
    .select(ASSIGNMENT_FIELDS)
    .eq("id", id)
    .maybeSingle<Assignment>();
  if (error) throw new DomainError("unavailable");
  if (!data) throw new DomainError("forbidden");
  return data;
}

function assessmentPayload(input: CreateAssessmentInput | UpdateAssessmentInput) {
  return {
    title: input.title,
    instructions: input.instructions,
    purpose: input.purpose,
    due_at: input.dueAt,
    questions: input.questions.map((question, index) => ({
      position: index + 1,
      prompt: question.prompt,
      kind: question.kind,
      choices: question.choices,
      points: question.points,
      correct_choice: question.correctChoice,
      topic: question.topic,
    })),
  };
}

/** Safe participant choices for tutor assignment and student workspaces. */
async function readLearningRelationships(client: SupabaseClient): Promise<LearningRelationship[]> {
  const { data, error } = await client.rpc("list_learning_relationships");
  if (error) throw new DomainError("unavailable");
  return (data ?? []).map((row: Record<string, unknown>) => ({
    bookingId: row.booking_id as string,
    tutorId: row.tutor_id as string,
    studentId: row.student_id as string,
    subjectId: row.subject_id as string,
    subjectName: row.subject_name as string,
    endsAt: row.ends_at as string,
    studentName: row.student_name as string,
    tutorName: row.tutor_name as string,
  }));
}

export async function listLearningRelationships(client: SupabaseClient): Promise<LearningRelationship[]> {
  const actor = await getActor(client);
  requireLearningRole(actor);
  return readLearningRelationships(client);
}

async function requireRelationship(
  client: SupabaseClient,
  actor: Actor,
  tutorId: string,
  studentId: string,
  bookingId: string | null,
  subjectId?: string,
): Promise<void> {
  await requireOwnedTutor(client, actor, tutorId);
  const relationships = await readLearningRelationships(client);
  const found = relationships.some(
    (relationship) =>
      relationship.tutorId === tutorId &&
      relationship.studentId === studentId &&
      (!bookingId || relationship.bookingId === bookingId) &&
      (!subjectId || relationship.subjectId === subjectId),
  );
  if (!found) throw new DomainError("forbidden");
}

export async function getLearningWorkspace(client: SupabaseClient) {
  const actor = await getActor(client);
  requireLearningRole(actor);
  const [relationships, assessments, assignments, studyPlans] = await Promise.all([
    listLearningRelationships(client),
    listAssessments(client),
    listAssignments(client),
    listStudyPlans(client),
  ]);
  return { actor, relationships, assessments, assignments, studyPlans };
}

export async function listAssessments(client: SupabaseClient): Promise<Assessment[]> {
  const actor = await getActor(client);
  requireLearningRole(actor);
  const { data, error } = await client
    .from("assessments")
    .select(ASSESSMENT_FIELDS)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new DomainError("unavailable");
  return (data ?? []) as Assessment[];
}

export async function getAssessment(client: SupabaseClient, assessmentId: unknown): Promise<AssessmentDetail> {
  const id = parseRecordId(assessmentId, "assessmentId");
  const actor = await getActor(client);
  requireLearningRole(actor);
  const assessment = await readAssessment(client, id);
  const tutorView = await ownsTutor(client, actor, assessment.tutor_id);
  if (!tutorView && assessment.student_id !== actor.id) throw new DomainError("forbidden");
  if (!tutorView) requireRole(actor, "student");

  const [questions, attempts] = await Promise.all([
    client.from("assessment_questions").select(QUESTION_FIELDS).eq("assessment_id", id).order("position"),
    client.from("assessment_attempts").select(ATTEMPT_FIELDS).eq("assessment_id", id).order("attempt_no"),
  ]);
  if (questions.error || attempts.error) throw new DomainError("unavailable");
  const answerKeys =
    tutorView && questions.data?.length
      ? await client
          .from("assessment_answer_keys")
          .select("question_id,correct_choice,created_at")
          .in(
            "question_id",
            questions.data.map((row) => row.id),
          )
      : { data: [], error: null };
  if (answerKeys.error) throw new DomainError("unavailable");
  return {
    assessment,
    questions: (questions.data ?? []) as AssessmentQuestion[],
    attempts: (attempts.data ?? []) as AssessmentAttempt[],
    answerKeys: tutorView ? ((answerKeys.data ?? []) as AssessmentAnswerKey[]) : null,
  };
}

export async function createAssessment(client: SupabaseClient, input: unknown): Promise<Assessment> {
  const parsed = parseCreateAssessment(input);
  const actor = await getActor(client);
  await requireRelationship(client, actor, parsed.tutorId, parsed.studentId, parsed.bookingId, parsed.subjectId);
  const { data, error } = await client.rpc("create_tagged_learning_assessment", {
    tutor: parsed.tutorId,
    student: parsed.studentId,
    subject: parsed.subjectId,
    booking: parsed.bookingId,
    payload: assessmentPayload(parsed),
  });
  if (error) databaseFailure(error);
  if (typeof data !== "string") throw new DomainError("unavailable");
  return readAssessment(client, data);
}

export async function updateAssessment(
  client: SupabaseClient,
  assessmentId: unknown,
  input: unknown,
): Promise<Assessment> {
  const id = parseRecordId(assessmentId, "assessmentId");
  const parsed = parseUpdateAssessment(input);
  const actor = await getActor(client);
  const assessment = await readAssessment(client, id);
  await requireOwnedTutor(client, actor, assessment.tutor_id);
  if (assessment.status !== "draft") throw new InputError({ title: "Only draft assessments can be edited." });
  const { error } = await client.rpc("update_tagged_learning_assessment", {
    assessment: id,
    payload: assessmentPayload(parsed),
  });
  if (error) databaseFailure(error);
  return readAssessment(client, id);
}

export async function assignAssessment(client: SupabaseClient, assessmentId: unknown): Promise<Assessment> {
  const id = parseRecordId(assessmentId, "assessmentId");
  const actor = await getActor(client);
  const assessment = await readAssessment(client, id);
  await requireOwnedTutor(client, actor, assessment.tutor_id);
  const { error } = await client.rpc("assign_learning_assessment", { assessment: id });
  if (error) databaseFailure(error);
  return readAssessment(client, id);
}

/** A scored assessment can be reopened by its tutor for another append-only attempt. */
export async function authorizeAssessmentRetake(client: SupabaseClient, assessmentId: unknown): Promise<Assessment> {
  const id = parseRecordId(assessmentId, "assessmentId");
  const actor = await getActor(client);
  const assessment = await readAssessment(client, id);
  await requireOwnedTutor(client, actor, assessment.tutor_id);
  const { error } = await client.rpc("authorize_assessment_retake", { assessment: id });
  if (error) databaseFailure(error, "assessment");
  return readAssessment(client, id);
}

export async function saveAssessmentAttempt(
  client: SupabaseClient,
  assessmentId: unknown,
  answers: unknown,
  finalize: boolean,
): Promise<AssessmentAttempt> {
  const id = parseRecordId(assessmentId, "assessmentId");
  const parsedAnswers = parseAssessmentAnswers(answers);
  if (typeof finalize !== "boolean") throw new InputError({ finalize: "Choose whether to submit your answers." });
  const actor = await getActor(client);
  requireRole(actor, "student");
  const assessment = await readAssessment(client, id);
  if (assessment.student_id !== actor.id) throw new DomainError("forbidden");
  const { data: attemptId, error } = await client.rpc("submit_assessment_attempt", {
    assessment: id,
    answers: parsedAnswers,
    finalize,
  });
  if (error) databaseFailure(error, "answers");
  if (typeof attemptId !== "string") throw new DomainError("unavailable");
  const { data, error: readError } = await client
    .from("assessment_attempts")
    .select(ATTEMPT_FIELDS)
    .eq("id", attemptId)
    .single<AssessmentAttempt>();
  if (readError || !data) throw new DomainError("unavailable");
  return data;
}

export async function scoreAssessmentAttempt(
  client: SupabaseClient,
  attemptId: unknown,
  input: unknown,
): Promise<AssessmentAttempt> {
  const id = parseRecordId(attemptId, "attemptId");
  const parsed = parseAssessmentScore(input);
  const actor = await getActor(client);
  requireRole(actor, "tutor");
  const { data: attempt, error: attemptError } = await client
    .from("assessment_attempts")
    .select("id,assessment_id")
    .eq("id", id)
    .maybeSingle<{ id: string; assessment_id: string }>();
  if (attemptError) throw new DomainError("unavailable");
  if (!attempt) throw new DomainError("forbidden");
  const assessment = await readAssessment(client, attempt.assessment_id);
  await requireOwnedTutor(client, actor, assessment.tutor_id);
  const { error } = await client.rpc("score_assessment_attempt", {
    attempt: id,
    tutor_points: parsed.tutorPoints,
    feedback: parsed.feedback,
  });
  if (error) databaseFailure(error, "tutorPoints");
  const { data, error: readError } = await client
    .from("assessment_attempts")
    .select(ATTEMPT_FIELDS)
    .eq("id", id)
    .single<AssessmentAttempt>();
  if (readError || !data) throw new DomainError("unavailable");
  return data;
}

export async function listAssignments(client: SupabaseClient): Promise<Assignment[]> {
  const actor = await getActor(client);
  requireLearningRole(actor);
  const { data, error } = await client
    .from("assignments")
    .select(ASSIGNMENT_FIELDS)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new DomainError("unavailable");
  return (data ?? []) as Assignment[];
}

/** Current, tutor-owned milestone choices for assignment linkage; old revisions are never offered. */
export async function listAssignmentMilestoneOptions(client: SupabaseClient): Promise<AssignmentMilestoneOption[]> {
  const actor = await getActor(client);
  requireRole(actor, "tutor");
  const plans = (await listStudyPlans(client)).filter((plan) => plan.tutor_id !== null && plan.booking_id !== null);
  if (!plans.length) return [];
  const ownedTutorIds = await client.from("tutor_profiles").select("id").eq("user_id", actor.id);
  if (ownedTutorIds.error) throw new DomainError("unavailable");
  const owned = new Set((ownedTutorIds.data ?? []).map((row) => row.id as string));
  const eligible = plans.filter((plan) => plan.tutor_id !== null && owned.has(plan.tutor_id));
  if (!eligible.length) return [];
  const { data, error } = await client
    .from("study_plan_revisions")
    .select("plan_id,revision_no,goals")
    .in(
      "plan_id",
      eligible.map((plan) => plan.id),
    );
  if (error) throw new DomainError("unavailable");
  const options: AssignmentMilestoneOption[] = [];
  for (const plan of eligible) {
    const revision = (data ?? []).find((row) => row.plan_id === plan.id && row.revision_no === plan.current_revision);
    const goals = revision?.goals;
    if (!Array.isArray(goals)) continue;
    for (const rawGoal of goals) {
      if (!rawGoal || typeof rawGoal !== "object" || Array.isArray(rawGoal)) continue;
      const goal = rawGoal as Record<string, unknown>;
      const topic = typeof goal.topic === "string" ? goal.topic : "";
      if (!topic || !Array.isArray(goal.milestones)) continue;
      for (const rawMilestone of goal.milestones) {
        if (!rawMilestone || typeof rawMilestone !== "object" || Array.isArray(rawMilestone)) continue;
        const milestone = rawMilestone as Record<string, unknown>;
        if (typeof milestone.id !== "string" || typeof milestone.title !== "string") continue;
        options.push({
          planId: plan.id,
          planTitle: plan.title,
          bookingId: plan.booking_id!,
          milestoneId: milestone.id,
          milestoneTitle: milestone.title,
          studentId: plan.student_id,
          subjectId: plan.subject_id!,
          topic,
        });
      }
    }
  }
  return options;
}

export async function getAssignment(client: SupabaseClient, assignmentId: unknown): Promise<AssignmentDetail> {
  const id = parseRecordId(assignmentId, "assignmentId");
  const actor = await getActor(client);
  requireLearningRole(actor);
  const assignment = await readAssignment(client, id);
  const tutorView = await ownsTutor(client, actor, assignment.tutor_id);
  if (!tutorView && assignment.student_id !== actor.id) throw new DomainError("forbidden");
  if (!tutorView) requireRole(actor, "student");
  const { data: submissions, error } = await client
    .from("assignment_submissions")
    .select(SUBMISSION_FIELDS)
    .eq("assignment_id", id)
    .order("attempt_no");
  if (error) throw new DomainError("unavailable");
  const rows = (submissions ?? []) as AssignmentSubmission[];
  const feedback = rows.length
    ? await client
        .from("assignment_feedback")
        .select(FEEDBACK_FIELDS)
        .in(
          "submission_id",
          rows.map((row) => row.id),
        )
    : { data: [], error: null };
  if (feedback.error) throw new DomainError("unavailable");
  const draftResult = !tutorView
    ? await client
        .from("assignment_submission_drafts")
        .select("assignment_id,student_id,body,link_url,updated_at")
        .eq("assignment_id", id)
        .maybeSingle<AssignmentSubmissionDraft>()
    : { data: null, error: null };
  if (draftResult.error) throw new DomainError("unavailable");
  return {
    assignment,
    draft: draftResult.data,
    submissions: rows.map((submission) => ({
      ...submission,
      feedback:
        ((feedback.data ?? []) as AssignmentFeedback[]).find((item) => item.submission_id === submission.id) ?? null,
    })),
  };
}

export async function createAssignment(client: SupabaseClient, input: unknown): Promise<Assignment> {
  const parsed = parseCreateAssignment(input);
  const actor = await getActor(client);
  await requireRelationship(client, actor, parsed.tutorId, parsed.studentId, parsed.bookingId);
  const { data, error } = await client.rpc("create_tagged_learning_assignment", {
    tutor: parsed.tutorId,
    student: parsed.studentId,
    booking: parsed.bookingId,
    title: parsed.title,
    instructions: parsed.instructions,
    submission_type: parsed.submissionType,
    due_at: parsed.dueAt,
    accepts_late: parsed.acceptsLate,
    topic: parsed.topic,
    study_plan: parsed.studyPlanId,
    milestone: parsed.milestoneId,
  });
  if (error) databaseFailure(error);
  if (typeof data !== "string") throw new DomainError("unavailable");
  return readAssignment(client, data);
}

export async function updateAssignment(
  client: SupabaseClient,
  assignmentId: unknown,
  input: unknown,
): Promise<Assignment> {
  const id = parseRecordId(assignmentId, "assignmentId");
  const parsed = parseUpdateAssignment(input);
  const actor = await getActor(client);
  const assignment = await readAssignment(client, id);
  await requireOwnedTutor(client, actor, assignment.tutor_id);
  if (assignment.status !== "draft") throw new InputError({ title: "Only draft assignments can be edited." });
  const { error } = await client.rpc("update_tagged_learning_assignment", {
    assignment: id,
    title: parsed.title,
    instructions: parsed.instructions,
    submission_type: parsed.submissionType,
    due_at: parsed.dueAt,
    accepts_late: parsed.acceptsLate,
    topic: parsed.topic,
    study_plan: parsed.studyPlanId,
    milestone: parsed.milestoneId,
  });
  if (error) databaseFailure(error);
  return readAssignment(client, id);
}

export async function cancelAssignment(
  client: SupabaseClient,
  assignmentId: unknown,
  reasonInput: unknown,
): Promise<Assignment> {
  const id = parseRecordId(assignmentId, "assignmentId");
  const reason = parseAssignmentCancellationReason(reasonInput);
  const actor = await getActor(client);
  requireRole(actor, "tutor");
  const current = await readAssignment(client, id);
  await requireOwnedTutor(client, actor, current.tutor_id);
  const { error } = await client.rpc("cancel_learning_assignment", { assignment: id, reason });
  if (error) databaseFailure(error, "reason");
  return readAssignment(client, id);
}

/** Save student work as a private draft; a separate action is required to submit it. */
export async function saveAssignmentDraft(
  client: SupabaseClient,
  assignmentId: unknown,
  input: unknown,
): Promise<string> {
  const id = parseRecordId(assignmentId, "assignmentId");
  const parsed = parseAssignmentDraft(input);
  const actor = await getActor(client);
  requireRole(actor, "student");
  const assignment = await readAssignment(client, id);
  if (assignment.student_id !== actor.id) throw new DomainError("forbidden");
  if (assignment.submission_type === "text" && (!parsed.body || parsed.linkUrl))
    throw new InputError({ body: "Save text for this assignment." });
  if (assignment.submission_type === "link" && (!parsed.linkUrl || parsed.body))
    throw new InputError({ linkUrl: "Save one HTTPS link for this assignment." });
  if (assignment.submission_type === "file")
    throw new InputError({ draft: "File assignments are submitted in one step." });
  const { data, error } = await client.rpc("save_assignment_submission_draft", {
    assignment: id,
    body: parsed.body,
    link_url: parsed.linkUrl,
  });
  if (error) databaseFailure(error, "draft");
  if (typeof data !== "string") throw new DomainError("unavailable");
  return data;
}

/** Convert a saved text/link draft into an immutable assignment submission. */
export async function submitAssignmentDraft(
  client: SupabaseClient,
  assignmentId: unknown,
): Promise<AssignmentSubmission> {
  const id = parseRecordId(assignmentId, "assignmentId");
  const actor = await getActor(client);
  requireRole(actor, "student");
  const assignment = await readAssignment(client, id);
  if (assignment.student_id !== actor.id) throw new DomainError("forbidden");
  const { data: submissionId, error } = await client.rpc("submit_assignment_submission_draft", { assignment: id });
  if (error) databaseFailure(error, "submission");
  if (typeof submissionId !== "string") throw new DomainError("unavailable");
  const { data, error: readError } = await client
    .from("assignment_submissions")
    .select(SUBMISSION_FIELDS)
    .eq("id", submissionId)
    .single<AssignmentSubmission>();
  if (readError || !data) throw new DomainError("unavailable");
  return data;
}

export async function assignAssignment(client: SupabaseClient, assignmentId: unknown): Promise<Assignment> {
  const id = parseRecordId(assignmentId, "assignmentId");
  const actor = await getActor(client);
  const assignment = await readAssignment(client, id);
  await requireOwnedTutor(client, actor, assignment.tutor_id);
  const { error } = await client.rpc("assign_learning_assignment", { assignment: id });
  if (error) databaseFailure(error);
  return readAssignment(client, id);
}

function fileExtension(mime: string): string {
  return { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "text/plain": ".txt" }[mime] ?? "";
}

export async function submitAssignment(
  client: SupabaseClient,
  assignmentId: unknown,
  input: unknown,
): Promise<AssignmentSubmission> {
  const id = parseRecordId(assignmentId, "assignmentId");
  const parsed = parseAssignmentSubmission(input);
  const actor = await getActor(client);
  requireRole(actor, "student");
  const { assignment } = await getAssignment(client, id);
  if (assignment.student_id !== actor.id) throw new DomainError("forbidden");
  if (assignment.submission_type === "text" && !parsed.body) throw new InputError({ body: "Enter your work." });
  if (assignment.submission_type === "link" && !parsed.linkUrl) throw new InputError({ linkUrl: "Enter a link." });
  if (assignment.submission_type === "file" && !parsed.file) throw new InputError({ file: "Choose a file." });
  if (assignment.submission_type !== "file" && parsed.file)
    throw new InputError({ file: "This assignment does not accept files." });

  let filePath: string | null = null;
  if (parsed.file) {
    const safeName = `${randomUUID()}${fileExtension(parsed.file.type)}`;
    filePath = `${id}/${actor.id}/${safeName}`;
    const { error } = await client.storage.from(BUCKET).upload(filePath, parsed.file, {
      contentType: parsed.file.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw new DomainError("unavailable");
  }

  const { data: submissionId, error } = await client.rpc("submit_assignment_with_file", {
    assignment: id,
    body: parsed.body,
    link_url: parsed.linkUrl,
    file_path: filePath,
    file_mime: parsed.file?.type ?? null,
    file_size_bytes: parsed.file?.size ?? null,
  });
  if (error) {
    if (filePath)
      await client.storage
        .from(BUCKET)
        .remove([filePath])
        .catch(() => undefined);
    databaseFailure(error, "submission");
  }
  if (typeof submissionId !== "string") throw new DomainError("unavailable");
  const { data, error: readError } = await client
    .from("assignment_submissions")
    .select(SUBMISSION_FIELDS)
    .eq("id", submissionId)
    .single<AssignmentSubmission>();
  if (readError || !data) throw new DomainError("unavailable");
  return data;
}

/** Creates a short lived URL only after the signed-in student or assigned tutor has read access. */
export async function getAssignmentDownload(client: SupabaseClient, submissionId: unknown): Promise<string> {
  const id = parseRecordId(submissionId, "submissionId");
  const actor = await getActor(client);
  requireLearningRole(actor);
  const { data: submission, error } = await client
    .from("assignment_submissions")
    .select("id,assignment_id,file_path")
    .eq("id", id)
    .maybeSingle<{ id: string; assignment_id: string; file_path: string | null }>();
  if (error) throw new DomainError("unavailable");
  if (!submission?.file_path) throw new DomainError("forbidden");
  const assignment = await readAssignment(client, submission.assignment_id);
  const allowed =
    (hasRole(actor, "student") && assignment.student_id === actor.id) ||
    (await ownsTutor(client, actor, assignment.tutor_id));
  if (!allowed) throw new DomainError("forbidden");
  const { data, error: storageError } = await client.storage.from(BUCKET).createSignedUrl(submission.file_path, 120);
  if (storageError || !data?.signedUrl) throw new DomainError("unavailable");
  return data.signedUrl;
}

export async function giveAssignmentFeedback(
  client: SupabaseClient,
  submissionId: unknown,
  input: unknown,
): Promise<AssignmentFeedback> {
  const id = parseRecordId(submissionId, "submissionId");
  const parsed = parseAssignmentFeedback(input);
  const actor = await getActor(client);
  requireRole(actor, "tutor");
  const { data: submission, error: submissionError } = await client
    .from("assignment_submissions")
    .select("id,assignment_id")
    .eq("id", id)
    .maybeSingle<{ id: string; assignment_id: string }>();
  if (submissionError) throw new DomainError("unavailable");
  if (!submission) throw new DomainError("forbidden");
  const assignment = await readAssignment(client, submission.assignment_id);
  await requireOwnedTutor(client, actor, assignment.tutor_id);
  const { data: feedbackId, error } = await client.rpc("give_assignment_feedback", {
    submission: id,
    feedback: parsed.feedback,
    score: parsed.score,
    outcome: parsed.outcome,
  });
  if (error) databaseFailure(error, "feedback");
  if (typeof feedbackId !== "string") throw new DomainError("unavailable");
  const { data, error: readError } = await client
    .from("assignment_feedback")
    .select(FEEDBACK_FIELDS)
    .eq("id", feedbackId)
    .single<AssignmentFeedback>();
  if (readError || !data) throw new DomainError("unavailable");
  return data;
}

export async function closeAssignmentSubmissions(client: SupabaseClient, assignmentId: unknown): Promise<Assignment> {
  const id = parseRecordId(assignmentId, "assignmentId");
  const actor = await getActor(client);
  const assignment = await readAssignment(client, id);
  await requireOwnedTutor(client, actor, assignment.tutor_id);
  const { error } = await client.rpc("close_assignment_submissions", { assignment: id });
  if (error) databaseFailure(error, "assignment");
  return readAssignment(client, id);
}

function normalizeGoals(goals: StudyGoalDraft[]): StudyGoalDraft[] {
  return goals.map((goal, goalIndex) => ({
    ...goal,
    position: goalIndex + 1,
    milestones: goal.milestones.map((milestone, milestoneIndex) => ({
      ...milestone,
      position: milestoneIndex + 1,
      links: milestone.links.map((link) => ({ ...link })),
    })),
  }));
}

async function requirePlanTutor(client: SupabaseClient, actor: Actor, planId: string): Promise<StudyPlan> {
  const { data, error } = await client
    .from("study_plans")
    .select(PLAN_FIELDS)
    .eq("id", planId)
    .maybeSingle<StudyPlan>();
  if (error) throw new DomainError("unavailable");
  if (!data) throw new DomainError("forbidden");
  if (!data.tutor_id) throw new DomainError("forbidden");
  await requireOwnedTutor(client, actor, data.tutor_id);
  return data;
}

export async function listStudyPlans(client: SupabaseClient): Promise<StudyPlanListItem[]> {
  const actor = await getActor(client);
  requireLearningRole(actor);
  const { data: plans, error } = await client
    .from("study_plans")
    .select(PLAN_FIELDS)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new DomainError("unavailable");
  const rows = (plans ?? []) as StudyPlan[];
  if (!rows.length) return [];
  const { data: revisions, error: revisionError } = await client
    .from("study_plan_revisions")
    .select("plan_id,revision_no,title")
    .in(
      "plan_id",
      rows.map((plan) => plan.id),
    );
  if (revisionError) throw new DomainError("unavailable");
  return rows.map((plan) => {
    const current = (revisions ?? []).find(
      (revision) => revision.plan_id === plan.id && revision.revision_no === plan.current_revision,
    );
    if (!current) throw new DomainError("unavailable");
    return { ...plan, title: current.title as string };
  });
}

export async function getStudyPlan(client: SupabaseClient, planId: unknown): Promise<StudyPlanDetail> {
  const id = parseRecordId(planId, "planId");
  const actor = await getActor(client);
  requireLearningRole(actor);
  const { data: plan, error } = await client
    .from("study_plans")
    .select(PLAN_FIELDS)
    .eq("id", id)
    .maybeSingle<StudyPlan>();
  if (error) throw new DomainError("unavailable");
  if (!plan) throw new DomainError("forbidden");
  const tutorView = await ownsTutor(client, actor, plan.tutor_id);
  if (!tutorView && plan.student_id !== actor.id) throw new DomainError("forbidden");
  const studentOwner = plan.student_id === actor.id && hasRole(actor, "student");
  if (!tutorView && !studentOwner) throw new DomainError("forbidden");
  const [revisionsResult, evidenceResult, historyResult, proposalsResult] = await Promise.all([
    client.from("study_plan_revisions").select(REVISION_FIELDS).eq("plan_id", id).order("revision_no"),
    client.from("study_plan_evidence").select(EVIDENCE_FIELDS).eq("plan_id", id).order("created_at"),
    client.from("study_plan_replanning_history").select(REPLANNING_FIELDS).eq("plan_id", id).order("created_at"),
    client
      .from("study_plan_proposals")
      .select(PROPOSAL_FIELDS)
      .eq("plan_id", id)
      .order("created_at", { ascending: false }),
  ]);
  if (revisionsResult.error || evidenceResult.error || historyResult.error || proposalsResult.error) {
    throw new DomainError("unavailable");
  }
  let revisions: StudyPlanRevision[];
  try {
    revisions = ((revisionsResult.data ?? []) as Array<Record<string, unknown>>).map((revision) => ({
      id: revision.id as string,
      plan_id: revision.plan_id as string,
      revision_no: Number(revision.revision_no),
      title: revision.title as string,
      description: (revision.description as string | null) ?? null,
      goals: parsePlanGoalSnapshot(revision.goals),
      authored_by: revision.authored_by as string,
      created_at: revision.created_at as string,
    }));
  } catch {
    throw new DomainError("unavailable");
  }
  const evidence = (evidenceResult.data ?? []) as StudyPlanEvidence[];
  const replanningHistory = (historyResult.data ?? []) as StudyPlanReplanningHistory[];
  const proposals = (proposalsResult.data ?? []) as StudyPlanProposal[];
  const current = revisions.find((revision) => revision.revision_no === plan.current_revision);
  if (!current) throw new DomainError("unavailable");
  const milestones = (current.goals as StudyGoal[]).flatMap((goal) => goal.milestones);
  const evidenceMilestones = new Set(
    evidence
      .filter((item) => milestones.some((milestone) => milestone.id === item.milestone_id))
      .map((item) => item.milestone_id),
  );
  return {
    plan,
    access: plan.tutor_id === null ? "personal" : "shared",
    canRevise: studentOwner || tutorView,
    canPropose: tutorView && plan.tutor_id !== null && plan.status === "active",
    revisions,
    evidence,
    replanningHistory,
    proposals,
    progress: {
      evidenceCount: evidence.filter((item) => milestones.some((milestone) => milestone.id === item.milestone_id))
        .length,
      milestonesWithEvidence: evidenceMilestones.size,
      totalMilestones: milestones.length,
    },
  };
}

export async function createPersonalStudyPlan(client: SupabaseClient, input: unknown): Promise<StudyPlanDetail> {
  const parsed = parseCreatePersonalStudyPlan(input);
  const actor = await getActor(client);
  requireRole(actor, "student");
  const { data, error } = await client.rpc("create_personal_study_plan", {
    subject: parsed.subjectId,
    title: parsed.title,
    description: parsed.description,
    goals: normalizeGoals(parsed.goals),
  });
  if (error) databaseFailure(error, "subjectId");
  if (typeof data !== "string") throw new DomainError("unavailable");
  return getStudyPlan(client, data);
}

export async function revisePersonalStudyPlan(
  client: SupabaseClient,
  planId: unknown,
  input: unknown,
): Promise<StudyPlanDetail> {
  const id = parseRecordId(planId, "planId");
  const parsed = parseReviseStudyPlan(input);
  const actor = await getActor(client);
  requireRole(actor, "student");
  const { data: plan, error: readError } = await client
    .from("study_plans")
    .select(PLAN_FIELDS)
    .eq("id", id)
    .maybeSingle<StudyPlan>();
  if (readError) throw new DomainError("unavailable");
  if (!plan || plan.student_id !== actor.id) throw new DomainError("forbidden");
  const { error } = await client.rpc("revise_owned_study_plan", {
    study_plan: id,
    expected_revision: parsed.expectedRevision,
    title: parsed.title,
    description: parsed.description,
    goals: normalizeGoals(parsed.goals),
  });
  if (error) databaseFailure(error, "goals");
  return getStudyPlan(client, id);
}

export async function sharePersonalStudyPlan(
  client: SupabaseClient,
  planId: unknown,
  bookingId: unknown,
): Promise<StudyPlanDetail> {
  const id = parseRecordId(planId, "planId");
  const booking = parseRecordId(bookingId, "bookingId");
  const actor = await getActor(client);
  requireRole(actor, "student");
  const { data: plan, error: readError } = await client
    .from("study_plans")
    .select(PLAN_FIELDS)
    .eq("id", id)
    .maybeSingle<StudyPlan>();
  if (readError) throw new DomainError("unavailable");
  if (!plan || plan.student_id !== actor.id) throw new DomainError("forbidden");
  const { error } = await client.rpc("share_personal_study_plan", { study_plan: id, booking });
  if (error) databaseFailure(error, "bookingId");
  return getStudyPlan(client, id);
}

export async function createStudyPlan(client: SupabaseClient, input: unknown): Promise<StudyPlanDetail> {
  const parsed = parseCreateStudyPlan(input);
  const actor = await getActor(client);
  await requireRelationship(
    client,
    actor,
    parsed.tutorId,
    parsed.studentId,
    parsed.bookingId,
    parsed.subjectId ?? undefined,
  );
  const { data, error } = await client.rpc("create_study_plan", {
    tutor: parsed.tutorId,
    student: parsed.studentId,
    subject: parsed.subjectId,
    booking: parsed.bookingId,
    title: parsed.title,
    description: parsed.description,
    goals: normalizeGoals(parsed.goals),
  });
  if (error) databaseFailure(error);
  if (typeof data !== "string") throw new DomainError("unavailable");
  return getStudyPlan(client, data);
}

export async function reviseStudyPlan(
  client: SupabaseClient,
  planId: unknown,
  input: unknown,
): Promise<StudyPlanDetail> {
  const id = parseRecordId(planId, "planId");
  const parsed = parseReviseStudyPlan(input);
  const actor = await getActor(client);
  await requirePlanTutor(client, actor, id);
  const { error } = await client.rpc("revise_study_plan", {
    study_plan: id,
    expected_revision: parsed.expectedRevision,
    title: parsed.title,
    description: parsed.description,
    goals: normalizeGoals(parsed.goals),
  });
  if (error) databaseFailure(error);
  return getStudyPlan(client, id);
}

export async function createStudyPlanProposal(
  client: SupabaseClient,
  planId: unknown,
  input: unknown,
): Promise<StudyPlanProposal> {
  const id = parseRecordId(planId, "planId");
  const parsed = parseStudyPlanProposal(input);
  const actor = await getActor(client);
  await requirePlanTutor(client, actor, id);
  const detail = await getStudyPlan(client, id);
  const current = detail.revisions.find((revision) => revision.revision_no === detail.plan.current_revision);
  if (!current?.goals.some((goal) => goal.milestones.some((milestone) => milestone.id === parsed.milestoneId))) {
    throw new InputError({ milestoneId: "Choose a milestone in the current plan." });
  }
  const { data: proposalId, error } = await client.rpc("create_study_plan_proposal", {
    study_plan: id,
    milestone: parsed.milestoneId,
    target_date: parsed.proposedTargetDate,
    summary: parsed.summary,
  });
  if (error) databaseFailure(error, "proposal");
  if (typeof proposalId !== "string") throw new DomainError("unavailable");
  const { data, error: readError } = await client
    .from("study_plan_proposals")
    .select(PROPOSAL_FIELDS)
    .eq("id", proposalId)
    .single<StudyPlanProposal>();
  if (readError || !data) throw new DomainError("unavailable");
  return data;
}

export async function rescheduleStudyMilestone(
  client: SupabaseClient,
  planId: unknown,
  milestoneId: unknown,
  input: unknown,
): Promise<StudyPlanDetail> {
  const id = parseRecordId(planId, "planId");
  const milestone = parseRecordId(milestoneId, "milestoneId");
  const parsed = parseRescheduleMilestone(input);
  const actor = await getActor(client);
  await requirePlanTutor(client, actor, id);
  const { error } = await client.rpc("reschedule_study_milestone", {
    study_plan: id,
    milestone,
    expected_revision: parsed.expectedRevision,
    target_date: parsed.targetDate,
    reason: parsed.reason,
    proposal: null,
  });
  if (error) databaseFailure(error, "targetDate");
  return getStudyPlan(client, id);
}

export async function reschedulePersonalStudyMilestone(
  client: SupabaseClient,
  planId: unknown,
  milestoneId: unknown,
  input: unknown,
): Promise<StudyPlanDetail> {
  const id = parseRecordId(planId, "planId");
  const milestone = parseRecordId(milestoneId, "milestoneId");
  const parsed = parseRescheduleMilestone(input);
  const actor = await getActor(client);
  requireRole(actor, "student");
  const { data: plan, error: readError } = await client
    .from("study_plans")
    .select(PLAN_FIELDS)
    .eq("id", id)
    .maybeSingle<StudyPlan>();
  if (readError) throw new DomainError("unavailable");
  if (!plan || plan.student_id !== actor.id || plan.tutor_id !== null) throw new DomainError("forbidden");
  const { error } = await client.rpc("reschedule_study_milestone", {
    study_plan: id,
    milestone,
    expected_revision: parsed.expectedRevision,
    target_date: parsed.targetDate,
    reason: parsed.reason,
    proposal: null,
  });
  if (error) databaseFailure(error, "targetDate");
  return getStudyPlan(client, id);
}

async function respondStudyPlanProposal(
  client: SupabaseClient,
  proposalId: unknown,
  response: "accept" | "dismiss",
  reason: string,
): Promise<StudyPlanDetail> {
  const id = parseRecordId(proposalId, "proposalId");
  const actor = await getActor(client);
  requireRole(actor, "student");
  const { data: proposal, error: readError } = await client
    .from("study_plan_proposals")
    .select("id,plan_id")
    .eq("id", id)
    .maybeSingle<{ id: string; plan_id: string }>();
  if (readError) throw new DomainError("unavailable");
  if (!proposal) throw new DomainError("forbidden");
  const { error } = await client.rpc("respond_study_plan_proposal", {
    proposal: id,
    response,
    reason,
  });
  if (error) databaseFailure(error, "proposal");
  return getStudyPlan(client, proposal.plan_id);
}

export async function confirmStudyPlanProposal(
  client: SupabaseClient,
  proposalId: unknown,
  reason: string,
): Promise<StudyPlanDetail> {
  return respondStudyPlanProposal(client, proposalId, "accept", parseProposalConfirmationReason(reason));
}

export async function dismissStudyPlanProposal(
  client: SupabaseClient,
  proposalId: unknown,
  reason: string,
): Promise<StudyPlanDetail> {
  return respondStudyPlanProposal(client, proposalId, "dismiss", parseProposalConfirmationReason(reason));
}

export async function setTopicMastery(client: SupabaseClient, input: unknown): Promise<TopicMasteryObservation> {
  const parsed = parseTopicMastery(input);
  const actor = await getActor(client);
  requireRole(actor, "tutor");
  const { data: candidateRows, error: candidateError } = await client.rpc("list_topic_evidence_candidates", {
    student: parsed.studentId,
    subject: parsed.subjectId,
  });
  if (candidateError) throw new DomainError("unavailable");
  const eligible = (candidateRows ?? []).some(
    (candidate: Record<string, unknown>) =>
      candidate.source_kind === parsed.sourceKind && candidate.source_id === parsed.sourceId,
  );
  if (!eligible) throw new InputError({ sourceId: "Choose dated evidence for this learner and subject." });
  const { data: id, error } = await client.rpc("set_topic_mastery", {
    student: parsed.studentId,
    subject: parsed.subjectId,
    topic: parsed.topic,
    label: parsed.label,
    source_kind: parsed.sourceKind,
    source_id: parsed.sourceId,
    observed_at: parsed.observedAt,
    note: parsed.note,
  });
  if (error) databaseFailure(error, "label");
  if (typeof id !== "string") throw new DomainError("unavailable");
  const { data, error: readError } = await client
    .from("topic_mastery_observations")
    .select(MASTERY_FIELDS)
    .eq("id", id)
    .single<TopicMasteryObservation>();
  if (readError || !data) throw new DomainError("unavailable");
  return data;
}

export async function listTopicMastery(
  client: SupabaseClient,
  studentId: unknown,
  subjectId?: unknown,
): Promise<TopicMasteryObservation[]> {
  const student = parseRecordId(studentId, "studentId");
  const subject = subjectId === undefined || subjectId === null ? null : parseRecordId(subjectId, "subjectId");
  const actor = await getActor(client);
  const ownsStudentContext = hasRole(actor, "student") && actor.id === student;
  let hasTutorRelationship = false;
  if (hasRole(actor, "tutor")) {
    const relationships = await listLearningRelationships(client);
    hasTutorRelationship = relationships.some(
      (relationship) => relationship.studentId === student && (!subject || relationship.subjectId === subject),
    );
  }
  if (!ownsStudentContext && !hasTutorRelationship) throw new DomainError("forbidden");
  let query = client.from("topic_mastery_observations").select(MASTERY_FIELDS).eq("student_id", student);
  if (subject) query = query.eq("subject_id", subject);
  const { data, error } = await query.order("observed_at", { ascending: false }).limit(100);
  if (error) throw new DomainError("unavailable");
  return (data ?? []) as TopicMasteryObservation[];
}

export async function listTopicEvidenceCandidates(
  client: SupabaseClient,
  studentId: unknown,
  subjectId: unknown,
): Promise<TopicEvidenceCandidate[]> {
  const student = parseRecordId(studentId, "studentId");
  const subject = parseRecordId(subjectId, "subjectId");
  const actor = await getActor(client);
  requireRole(actor, "tutor");
  const relationships = await listLearningRelationships(client);
  if (!relationships.some((relationship) => relationship.studentId === student && relationship.subjectId === subject)) {
    throw new DomainError("forbidden");
  }
  const { data, error } = await client.rpc("list_topic_evidence_candidates", { student, subject });
  if (error) throw new DomainError("unavailable");
  return (data ?? []).map((candidate: Record<string, unknown>) => ({
    sourceKind: candidate.source_kind as TopicEvidenceCandidate["sourceKind"],
    sourceId: candidate.source_id as string,
    label: candidate.label as string,
    occurredAt: candidate.occurred_at as string,
    sourcePath: candidate.source_path as string,
  }));
}

export async function deleteSessionReflection(client: SupabaseClient, bookingId: unknown): Promise<boolean> {
  const booking = parseRecordId(bookingId, "bookingId");
  const actor = await getActor(client);
  requireRole(actor, "student");
  const { data, error } = await client.rpc("delete_session_reflection", { booking });
  if (error) databaseFailure(error, "reflection");
  return data === true;
}

export async function getLearningProgress(
  client: SupabaseClient,
  studentId?: unknown,
  filtersInput: LearningProgressFilters = {},
): Promise<LearningProgressOverview> {
  const filters = parseLearningProgressFilters(filtersInput);
  const cappedSources = new Set<LearningProgressCappedSource>();
  const noteCapped = (
    source: LearningProgressCappedSource,
    rows: readonly unknown[] | null | undefined,
    requested: number,
  ) => {
    if (progressQueryAtEffectiveCap(rows?.length ?? 0, requested)) cappedSources.add(source);
  };
  const actor = await getActor(client);
  requireLearningRole(actor);
  const student =
    studentId === undefined || studentId === null
      ? hasRole(actor, "student")
        ? actor.id
        : parseRecordId(studentId, "studentId")
      : parseRecordId(studentId, "studentId");
  const relationships = await readLearningRelationships(client);
  noteCapped("learning_relationships", relationships, PROGRESS_POSTGREST_ROW_CAP);
  const ownsStudentContext = hasRole(actor, "student") && actor.id === student;
  const hasTutorRelationship =
    hasRole(actor, "tutor") && relationships.some((relationship) => relationship.studentId === student);
  if (!ownsStudentContext && !hasTutorRelationship) throw new DomainError("forbidden");
  // Load each source collection in bounded batches. RLS remains the authorization boundary;
  // this avoids repeated per-plan/per-assessment/per-assignment detail calls on the dashboard.
  const [planResult, assignmentResult, assessmentResult, masteryResult, eventResult] = await Promise.all([
    client
      .from("study_plans")
      .select(PLAN_FIELDS)
      .eq("student_id", student)
      .order("updated_at", { ascending: false })
      .order("id")
      .limit(100),
    client
      .from("assignments")
      .select(ASSIGNMENT_FIELDS)
      .eq("student_id", student)
      .order("updated_at", { ascending: false })
      .order("id")
      .limit(100),
    client
      .from("assessments")
      .select(ASSESSMENT_FIELDS)
      .eq("student_id", student)
      .order("updated_at", { ascending: false })
      .order("id")
      .limit(100),
    (() => {
      let query = client.from("topic_mastery_observations").select(MASTERY_FIELDS).eq("student_id", student);
      if (filters.fromDate) query = query.gte("observed_at", `${filters.fromDate}T00:00:00.000Z`);
      if (filters.toDate) query = query.lte("observed_at", `${filters.toDate}T23:59:59.999Z`);
      return query.order("observed_at", { ascending: false }).order("id").limit(100);
    })(),
    (() => {
      let query = client.from("learning_progress_events").select(PROGRESS_EVENT_FIELDS).eq("student_id", student);
      if (filters.fromDate) query = query.gte("occurred_at", `${filters.fromDate}T00:00:00.000Z`);
      if (filters.toDate) query = query.lte("occurred_at", `${filters.toDate}T23:59:59.999Z`);
      return query.order("occurred_at", { ascending: false }).order("id").limit(200);
    })(),
  ]);
  if (
    planResult.error ||
    assignmentResult.error ||
    assessmentResult.error ||
    masteryResult.error ||
    eventResult.error
  ) {
    throw new DomainError("unavailable");
  }
  noteCapped("study_plans", planResult.data, 100);
  noteCapped("assignments", assignmentResult.data, 100);
  noteCapped("assessments", assessmentResult.data, 100);
  noteCapped("topic_mastery", masteryResult.data, 100);
  noteCapped("progress_events", eventResult.data, 200);
  const planRows = (planResult.data ?? []) as StudyPlan[];
  const tasks = (assignmentResult.data ?? []) as Assignment[];
  const assessmentRows = (assessmentResult.data ?? []) as Assessment[];
  const currentRevisionFilter = planRows
    .map((plan) => `and(plan_id.eq.${plan.id},revision_no.eq.${plan.current_revision})`)
    .join(",");
  const [revisionResult, evidenceResult, attemptResult, submissionResult] = await Promise.all([
    planRows.length
      ? client
          .from("study_plan_revisions")
          .select(REVISION_FIELDS)
          .or(currentRevisionFilter)
          .order("plan_id")
          .limit(planRows.length)
      : Promise.resolve({ data: [], error: null }),
    planRows.length
      ? client
          .from("study_plan_evidence")
          .select(EVIDENCE_FIELDS)
          .in(
            "plan_id",
            planRows.map((plan) => plan.id),
          )
          .order("created_at")
          .order("id")
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    assessmentRows.length
      ? client
          .from("assessment_attempts")
          .select(ATTEMPT_FIELDS)
          .in(
            "assessment_id",
            assessmentRows.map((item) => item.id),
          )
          .order("attempt_no")
          .order("id")
          .limit(2000)
      : Promise.resolve({ data: [], error: null }),
    tasks.length
      ? (() => {
          let query = client
            .from("assignment_submissions")
            .select(SUBMISSION_FIELDS)
            .in(
              "assignment_id",
              tasks.map((item) => item.id),
            );
          if (filters.fromDate) query = query.gte("submitted_at", `${filters.fromDate}T00:00:00.000Z`);
          if (filters.toDate) query = query.lte("submitted_at", `${filters.toDate}T23:59:59.999Z`);
          return query.order("attempt_no").order("id").limit(2000);
        })()
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (revisionResult.error || evidenceResult.error || attemptResult.error || submissionResult.error) {
    throw new DomainError("unavailable");
  }
  noteCapped("plan_evidence", evidenceResult.data, 1000);
  noteCapped("assessment_attempts", attemptResult.data, 2000);
  noteCapped("assignment_submissions", submissionResult.data, 2000);
  const revisions: StudyPlanRevision[] = ((revisionResult.data ?? []) as Array<Record<string, unknown>>).map(
    (revision) => ({
      id: revision.id as string,
      plan_id: revision.plan_id as string,
      revision_no: Number(revision.revision_no),
      title: revision.title as string,
      description: (revision.description as string | null) ?? null,
      goals: parsePlanGoalSnapshot(revision.goals),
      authored_by: revision.authored_by as string,
      created_at: revision.created_at as string,
    }),
  );
  const evidenceRows = (evidenceResult.data ?? []) as StudyPlanEvidence[];
  const plans = planRows.map((plan) => ({
    plan,
    revisions: revisions.filter((revision) => revision.plan_id === plan.id),
    evidence: evidenceRows.filter((evidence) => evidence.plan_id === plan.id),
  }));
  const attempts = (attemptResult.data ?? []) as AssessmentAttempt[];
  const [questionTopicOptionResult, masteryTopicOptionResult] = await Promise.all([
    assessmentRows.length
      ? client
          .from("assessment_questions")
          .select("assessment_id,topic")
          .in(
            "assessment_id",
            assessmentRows.map((item) => item.id),
          )
          .order("assessment_id")
          .order("id")
          .limit(2000)
      : Promise.resolve({ data: [], error: null }),
    client
      .from("topic_mastery_observations")
      .select("subject_id,topic")
      .eq("student_id", student)
      .order("subject_id")
      .order("topic")
      .order("id")
      .limit(2000),
  ]);
  if (questionTopicOptionResult.error || masteryTopicOptionResult.error) throw new DomainError("unavailable");
  noteCapped("assessment_question_topics", questionTopicOptionResult.data, 2000);
  noteCapped("mastery_topic_options", masteryTopicOptionResult.data, 2000);
  const assessments = assessmentRows.map((assessment) => ({
    assessment,
    attempts: attempts.filter((attempt) => attempt.assessment_id === assessment.id),
  }));
  const submissions = (submissionResult.data ?? []) as AssignmentSubmission[];
  const feedbackResult = submissions.length
    ? await client
        .from("assignment_feedback")
        .select(FEEDBACK_FIELDS)
        .in(
          "submission_id",
          submissions.map((submission) => submission.id),
        )
        .order("submission_id")
        .order("id")
        .limit(1000)
    : { data: [], error: null };
  if (feedbackResult.error) throw new DomainError("unavailable");
  noteCapped("assignment_feedback", feedbackResult.data, 1000);
  const feedbackBySubmission = new Map(
    ((feedbackResult.data ?? []) as AssignmentFeedback[]).map((feedback) => [feedback.submission_id, feedback]),
  );
  const taskDetails = tasks.map((assignment) => ({
    assignment,
    submissions: submissions
      .filter((submission) => submission.assignment_id === assignment.id)
      .map((submission) => ({ ...submission, feedback: feedbackBySubmission.get(submission.id) ?? null })),
  }));
  const masteryRows = (masteryResult.data ?? []) as TopicMasteryObservation[];
  const eventRows = eventResult;
  const planTitle = new Map(
    plans.map((detail) => [
      detail.plan.id,
      detail.revisions.find((revision) => revision.revision_no === detail.plan.current_revision)?.title ?? "Study plan",
    ]),
  );
  const goalBySource = new Map<string, Set<string>>();
  const addGoalSource = (key: string, goalId: string) => {
    const ids = goalBySource.get(key) ?? new Set<string>();
    ids.add(goalId);
    goalBySource.set(key, ids);
  };
  const goalByAssessment = new Map<string, Set<string>>();
  const goalByAssignment = new Map<string, Set<string>>();
  const goalByPlanMilestone = new Map<string, string>();
  const addLinkedGoal = (index: Map<string, Set<string>>, sourceId: string, goalId: string) => {
    const ids = index.get(sourceId) ?? new Set<string>();
    ids.add(goalId);
    index.set(sourceId, ids);
  };
  for (const detail of plans) {
    const milestoneGoals = new Map<string, string>();
    for (const revision of detail.revisions) {
      for (const goal of revision.goals) {
        for (const milestone of goal.milestones) {
          milestoneGoals.set(milestone.id, goal.id);
          goalByPlanMilestone.set(`${detail.plan.id}:${milestone.id}`, goal.id);
          for (const link of milestone.links) {
            if (link.kind === "assessment") addLinkedGoal(goalByAssessment, link.id, goal.id);
            if (link.kind === "assignment") addLinkedGoal(goalByAssignment, link.id, goal.id);
          }
        }
      }
    }
    for (const evidence of detail.evidence) {
      const goalId = milestoneGoals.get(evidence.milestone_id);
      if (goalId) addGoalSource(`${evidence.source_kind}:${evidence.source_id}`, goalId);
    }
  }
  const assignmentById = new Map(tasks.map((assignment) => [assignment.id, assignment]));
  for (const attempt of attempts) {
    for (const goalId of goalByAssessment.get(attempt.assessment_id) ?? []) {
      addGoalSource(`assessment_attempt:${attempt.id}`, goalId);
    }
  }
  for (const submission of submissions) {
    const assignment = assignmentById.get(submission.assignment_id);
    const linkedGoals = new Set(goalByAssignment.get(submission.assignment_id) ?? []);
    if (assignment?.study_plan_id && assignment.milestone_id) {
      const goalId = goalByPlanMilestone.get(`${assignment.study_plan_id}:${assignment.milestone_id}`);
      if (goalId) linkedGoals.add(goalId);
    }
    for (const goalId of linkedGoals) addGoalSource(`assignment_submission:${submission.id}`, goalId);
  }
  const activeGoals = plans.flatMap((detail) => {
    const current = detail.revisions.find((revision) => revision.revision_no === detail.plan.current_revision);
    return detail.plan.status === "active" && current
      ? current.goals.map((goal) => ({
          planId: detail.plan.id,
          subjectId: detail.plan.subject_id ?? "",
          tutorId: detail.plan.tutor_id,
          planTitle: planTitle.get(detail.plan.id) ?? "Study plan",
          revisionNo: current.revision_no,
          goal,
        }))
      : [];
  });
  const milestones = plans.flatMap((detail) => {
    const current = detail.revisions.find((revision) => revision.revision_no === detail.plan.current_revision);
    return current
      ? current.goals.flatMap((goal) =>
          goal.milestones.map((milestone) => ({
            planId: detail.plan.id,
            subjectId: detail.plan.subject_id ?? "",
            tutorId: detail.plan.tutor_id,
            goalId: goal.id,
            goalTopic: goal.topic,
            milestone,
            evidence: detail.evidence.filter((evidence) => evidence.milestone_id === milestone.id),
          })),
        )
      : [];
  });
  const learnerRelationships = relationships.filter((relationship) => relationship.studentId === student);
  const loadRecaps = (applyDateRange: boolean) => {
    let query = client
      .from("session_recaps")
      .select("booking_id,topics,strengths,practice_areas,published_at")
      .in(
        "booking_id",
        learnerRelationships.map((row) => row.bookingId),
      );
    if (applyDateRange && filters.fromDate) query = query.gte("published_at", `${filters.fromDate}T00:00:00.000Z`);
    if (applyDateRange && filters.toDate) query = query.lte("published_at", `${filters.toDate}T23:59:59.999Z`);
    return query.order("published_at", { ascending: false }).order("booking_id").limit(1000);
  };
  const allRecapsPromise = learnerRelationships.length ? loadRecaps(false) : Promise.resolve({ data: [], error: null });
  const selectedRecapsPromise =
    filters.fromDate || filters.toDate
      ? learnerRelationships.length
        ? loadRecaps(true)
        : Promise.resolve({ data: [], error: null })
      : allRecapsPromise;
  const [recaps, recapOptionsResult] = await Promise.all([selectedRecapsPromise, allRecapsPromise]);
  if (recaps.error || recapOptionsResult.error) throw new DomainError("unavailable");
  noteCapped("session_recaps", recaps.data, 1000);
  noteCapped("session_recaps", recapOptionsResult.data, 1000);
  const recapIds = new Set((recapOptionsResult.data ?? []).map((recap: { booking_id: string }) => recap.booking_id));
  let assessmentTopicQuery = client
    .from("assessment_topic_evidence")
    .select("id,attempt_id,question_id,student_id,tutor_id,subject_id,topic,points_earned,points_possible,occurred_at")
    .eq("student_id", student);
  if (filters.fromDate)
    assessmentTopicQuery = assessmentTopicQuery.gte("occurred_at", `${filters.fromDate}T00:00:00.000Z`);
  if (filters.toDate) assessmentTopicQuery = assessmentTopicQuery.lte("occurred_at", `${filters.toDate}T23:59:59.999Z`);
  const assessmentTopicRows = await assessmentTopicQuery
    .order("occurred_at", { ascending: false })
    .order("id")
    .limit(500);
  if (assessmentTopicRows.error) throw new DomainError("unavailable");
  noteCapped("assessment_topic_evidence", assessmentTopicRows.data, 500);
  const sourceRoute = new Map<string, { label: string; path: string }>();
  for (const assessment of assessments)
    for (const attempt of assessment.attempts) {
      sourceRoute.set(`assessment_attempt:${attempt.id}`, {
        label: `Assessment: ${assessment.assessment.title} · attempt ${attempt.attempt_no}`,
        path: `/assessments/${assessment.assessment.id}`,
      });
    }
  for (const detail of taskDetails)
    for (const submission of detail.submissions) {
      sourceRoute.set(`assignment_submission:${submission.id}`, {
        label: `Assignment: ${detail.assignment.title} · submission ${submission.attempt_no}`,
        path: `/assignments/${detail.assignment.id}`,
      });
    }
  for (const relationship of learnerRelationships)
    if (recapIds.has(relationship.bookingId)) {
      sourceRoute.set(`session_recap:${relationship.bookingId}`, {
        label: `Session: ${relationship.subjectName}`,
        path: `/sessions/${relationship.bookingId}`,
      });
    }
  const topicEvidence = masteryRows.map((observation) => ({
    ...observation,
    ...(sourceRoute.get(`${observation.source_kind}:${observation.source_id}`)
      ? {
          sourceLabel: sourceRoute.get(`${observation.source_kind}:${observation.source_id}`)!.label,
          sourcePath: sourceRoute.get(`${observation.source_kind}:${observation.source_id}`)!.path,
        }
      : {}),
  }));
  const assessmentByAttempt = new Map<string, { assessment: Assessment; attempt: AssessmentAttempt }>();
  for (const item of assessments)
    for (const attempt of item.attempts) assessmentByAttempt.set(attempt.id, { assessment: item.assessment, attempt });
  const recapByBooking = new Map((recaps.data ?? []).map((row) => [row.booking_id as string, row]));
  const recapOptionsByBooking = new Map((recapOptionsResult.data ?? []).map((row) => [row.booking_id as string, row]));
  const topicRecords: LearningTopicRecord[] = [];
  for (const evidence of assessmentTopicRows.data ?? []) {
    const parent = assessmentByAttempt.get(evidence.attempt_id as string);
    if (!parent) continue;
    topicRecords.push({
      id: evidence.id as string,
      subjectId: evidence.subject_id as string,
      topic: evidence.topic as string,
      tutorId: parent.assessment.tutor_id,
      goalIds: [
        ...new Set([
          ...(goalBySource.get(`assessment_attempt:${evidence.attempt_id as string}`) ?? []),
          ...(goalByAssessment.get(parent.assessment.id) ?? []),
        ]),
      ],
      sourceKind: "assessment_question",
      sourceId: evidence.attempt_id as string,
      occurredAt: evidence.occurred_at as string,
      sourceLabel: `Assessment: ${parent.assessment.title} · attempt ${parent.attempt.attempt_no}`,
      sourcePath: `/assessments/${parent.assessment.id}`,
      assessmentPoints: { earned: evidence.points_earned as number, possible: evidence.points_possible as number },
    });
  }
  for (const detail of taskDetails) {
    const topic = detail.assignment.topic?.trim();
    if (!topic) continue;
    for (const submission of detail.submissions) {
      topicRecords.push({
        id: submission.id,
        subjectId: detail.assignment.subject_id ?? "",
        topic,
        tutorId: detail.assignment.tutor_id,
        goalIds: [
          ...new Set([
            ...(goalBySource.get(`assignment_submission:${submission.id}`) ?? []),
            ...(goalByAssignment.get(detail.assignment.id) ?? []),
          ]),
        ],
        sourceKind: "assignment_submission",
        sourceId: submission.id,
        occurredAt: submission.submitted_at,
        sourceLabel: `Assignment: ${detail.assignment.title} · submission ${submission.attempt_no}`,
        sourcePath: `/assignments/${detail.assignment.id}`,
        assignmentFeedback: submission.feedback
          ? {
              score: submission.feedback.score,
              outcome: submission.feedback.outcome,
              updatedAt: submission.feedback.updated_at,
            }
          : { score: null, outcome: null, updatedAt: null },
      });
    }
  }
  for (const relationship of learnerRelationships) {
    const recap = recapByBooking.get(relationship.bookingId);
    const topics = Array.isArray(recap?.topics)
      ? recap.topics.filter((topic): topic is string => typeof topic === "string")
      : [];
    for (const topic of topics) {
      if (!topic.trim()) continue;
      topicRecords.push({
        id: `${relationship.bookingId}:${topic.trim().toLocaleLowerCase("en-US")}`,
        subjectId: relationship.subjectId,
        topic: topic.trim(),
        tutorId: relationship.tutorId,
        goalIds: [...(goalBySource.get(`session_recap:${relationship.bookingId}`) ?? [])],
        sourceKind: "session_recap",
        sourceId: relationship.bookingId,
        occurredAt: recap?.published_at as string,
        sourceLabel: `Session recap: ${relationship.subjectName}`,
        sourcePath: `/sessions/${relationship.bookingId}`,
        recapNarrative: {
          strengths: typeof recap?.strengths === "string" ? recap.strengths : null,
          practiceAreas: typeof recap?.practice_areas === "string" ? recap.practice_areas : null,
        },
      });
    }
  }
  for (const observation of topicEvidence) {
    const source = sourceRoute.get(`${observation.source_kind}:${observation.source_id}`);
    topicRecords.push({
      id: observation.id,
      subjectId: observation.subject_id,
      topic: observation.topic,
      tutorId: observation.tutor_id,
      goalIds: [...(goalBySource.get(`${observation.source_kind}:${observation.source_id}`) ?? [])],
      sourceKind: "tutor_observation",
      sourceId: observation.source_id,
      occurredAt: observation.observed_at,
      sourceLabel: `Tutor observation: ${observation.topic}`,
      sourcePath: source?.path ?? "/progress",
      tutorObservation: { label: observation.label, observedAt: observation.observed_at, note: observation.note },
    });
  }
  topicRecords.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  const topicFilterKey = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  const filterOptions: LearningProgressFilterOptions = {
    goals: activeGoals
      .map((item) => ({
        goalId: item.goal.id,
        planId: item.planId,
        planTitle: item.planTitle,
        subjectId: item.subjectId,
        topic: item.goal.topic ?? "",
        title: item.goal.title,
      }))
      .filter((item) => item.subjectId && item.topic),
    topics: (() => {
      const options = new Map<string, { subjectId: string; topic: string }>();
      const add = (subjectId: string | null | undefined, topic: string | null | undefined) => {
        const label = topic?.trim();
        if (!subjectId || !label) return;
        options.set(`${subjectId}:${topicFilterKey(label)}`, { subjectId, topic: label });
      };
      for (const row of questionTopicOptionResult.data ?? []) {
        const assessment = assessmentRows.find((item) => item.id === row.assessment_id);
        add(assessment?.subject_id, row.topic as string | null);
      }
      for (const assignment of tasks) add(assignment.subject_id, assignment.topic);
      for (const relationship of learnerRelationships) {
        const recap = recapOptionsByBooking.get(relationship.bookingId);
        if (Array.isArray(recap?.topics))
          for (const topic of recap.topics) add(relationship.subjectId, typeof topic === "string" ? topic : null);
      }
      for (const row of masteryTopicOptionResult.data ?? []) add(row.subject_id as string, row.topic as string);
      for (const item of activeGoals) add(item.subjectId, item.goal.topic);
      return [...options.values()];
    })(),
    tutors: [
      ...new Map(
        learnerRelationships.map((relationship) => [
          relationship.tutorId,
          {
            tutorId: relationship.tutorId,
            tutorName: relationship.tutorName,
          },
        ]),
      ).values(),
    ],
  };
  const filteredRecords = filterTopicRecords(topicRecords, filters);
  const topicSummaries = summarizeLearningTopicEvidence(filteredRecords);
  const visibleSourceKeys = new Set(
    filteredRecords.map((record) => {
      const sourceKind = record.sourceKind === "assessment_question" ? "assessment_attempt" : record.sourceKind;
      if (record.sourceKind === "tutor_observation") {
        const observation = topicEvidence.find((item) => item.id === record.id);
        return observation ? `${observation.source_kind}:${observation.source_id}` : "";
      }
      return `${sourceKind}:${record.sourceId}`;
    }),
  );
  const filteredEvents = ((eventRows.data ?? []) as LearningProgressEvent[]).filter((event) => {
    if ((filters.goalId || filters.topic) && !visibleSourceKeys.has(`${event.source_kind}:${event.source_id}`))
      return false;
    if (filters.tutorId && event.tutor_id !== filters.tutorId) return false;
    const occurred = Date.parse(event.occurred_at);
    if (filters.fromDate && occurred < Date.parse(`${filters.fromDate}T00:00:00.000Z`)) return false;
    if (filters.toDate && occurred > Date.parse(`${filters.toDate}T23:59:59.999Z`)) return false;
    return true;
  });
  const filteredGoals = activeGoals.filter((item) => {
    if (filters.goalId && item.goal.id !== filters.goalId) return false;
    if (
      filters.topic &&
      (item.subjectId !== filters.topic.subjectId ||
        topicFilterKey(item.goal.topic ?? "") !== topicFilterKey(filters.topic.topic))
    )
      return false;
    if (filters.tutorId && item.tutorId !== filters.tutorId) return false;
    return true;
  });
  const filteredGoalIds = new Set(filteredGoals.map((item) => item.goal.id));
  const filteredMilestones = milestones.filter((item) => {
    if (!filteredGoalIds.has(item.goalId)) return false;
    if (
      filters.topic &&
      (item.subjectId !== filters.topic.subjectId ||
        topicFilterKey(item.goalTopic ?? "") !== topicFilterKey(filters.topic.topic))
    )
      return false;
    if (filters.tutorId && item.tutorId !== filters.tutorId) return false;
    return true;
  });
  const filteredTopicEvidence = topicEvidence.filter((observation) =>
    filteredRecords.some((record) => record.sourceKind === "tutor_observation" && record.id === observation.id),
  );
  return {
    studentId: student,
    activeGoals: filteredGoals,
    milestones: filteredMilestones,
    sessions: learnerRelationships.map((relationship) => ({
      bookingId: relationship.bookingId,
      tutorId: relationship.tutorId,
      tutorName: relationship.tutorName,
      subjectId: relationship.subjectId,
      subjectName: relationship.subjectName,
      endsAt: relationship.endsAt,
      recapAvailable: recapIds.has(relationship.bookingId),
    })),
    tasks,
    assessments,
    topicEvidence: filteredTopicEvidence,
    topicRecords: filteredRecords,
    topicSummaries,
    filterOptions,
    coverage: {
      bounded: cappedSources.size > 0,
      cappedSources: [...cappedSources].sort(),
      rowCap: PROGRESS_POSTGREST_ROW_CAP,
    },
    events: filteredEvents.map((event) => ({
      ...event,
      ...(sourceRoute.get(`${event.source_kind}:${event.source_id}`)
        ? {
            sourceLabel: sourceRoute.get(`${event.source_kind}:${event.source_id}`)!.label,
            sourcePath: sourceRoute.get(`${event.source_kind}:${event.source_id}`)!.path,
          }
        : {}),
    })),
    observedAt: new Date().toISOString(),
  };
}

export async function recordMilestoneEvidence(
  client: SupabaseClient,
  planId: unknown,
  milestoneId: unknown,
  input: unknown,
): Promise<StudyPlanDetail> {
  const id = parseRecordId(planId, "planId");
  const milestone = parseRecordId(milestoneId, "milestoneId");
  const source = parseEvidenceSource(input);
  const actor = await getActor(client);
  const plan = await requirePlanTutor(client, actor, id);
  const detail = await getStudyPlan(client, id);
  const currentMilestones =
    detail.revisions
      .find((revision) => revision.revision_no === plan.current_revision)
      ?.goals.flatMap((goal) => goal.milestones) ?? [];
  if (!currentMilestones.some((item) => item.id === milestone))
    throw new InputError({ milestoneId: "Choose a milestone in the current plan." });
  const { error } = await client.rpc("record_study_evidence", {
    study_plan: id,
    milestone,
    source_kind: source.sourceKind,
    source_id: source.sourceId,
  });
  if (error) databaseFailure(error, "sourceId");
  return getStudyPlan(client, id);
}

/** Candidate IDs are filtered by the current tutor/student relationship; the SQL writer checks them again. */
export async function listStudyEvidenceCandidates(
  client: SupabaseClient,
  planId: unknown,
): Promise<StudyEvidenceCandidate[]> {
  const id = parseRecordId(planId, "planId");
  const actor = await getActor(client);
  await requirePlanTutor(client, actor, id);
  const { data, error } = await client.rpc("list_study_evidence_candidates", { study_plan: id });
  if (error) throw new DomainError("unavailable");
  return (data ?? []).map((candidate: Record<string, unknown>) => ({
    sourceKind: candidate.source_kind as StudyEvidenceCandidate["sourceKind"],
    sourceId: candidate.source_id as string,
    label: candidate.label as string,
    occurredAt: candidate.occurred_at as string,
  }));
}
