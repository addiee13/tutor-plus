import type { Actor } from "../auth/policy";

export type AssessmentPurpose = "diagnostic" | "pre_session" | "post_session" | "milestone";
export type AssessmentStatus = "draft" | "assigned" | "submitted" | "scored";
export type AssessmentQuestionKind = "single_choice" | "short_answer";

export type LearningRelationship = {
  bookingId: string;
  tutorId: string;
  studentId: string;
  subjectId: string;
  subjectName: string;
  endsAt: string;
  studentName: string;
  tutorName: string;
};

export type Assessment = {
  id: string;
  tutor_id: string;
  student_id: string;
  subject_id: string;
  booking_id: string | null;
  title: string;
  instructions: string | null;
  purpose: AssessmentPurpose;
  status: AssessmentStatus;
  definition_version: number;
  due_at: string | null;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AssessmentQuestion = {
  id: string;
  assessment_id: string;
  position: number;
  prompt: string;
  kind: AssessmentQuestionKind;
  choices: string[] | null;
  points: number;
  /** Explicit author-entered topic. Null means the historical record was not tagged. */
  topic: string | null;
  created_at: string;
};

export type AssessmentAnswerKey = { question_id: string; correct_choice: string; created_at: string };

export type AssessmentAttempt = {
  id: string;
  assessment_id: string;
  student_id: string;
  attempt_no: number;
  definition_version: number;
  answers: Record<string, string>;
  status: "in_progress" | "submitted" | "scored";
  auto_score: number | null;
  tutor_score: number | null;
  score: number | null;
  max_score: number | null;
  tutor_feedback: string | null;
  submitted_at: string | null;
  scored_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AssessmentDetail = {
  assessment: Assessment;
  questions: AssessmentQuestion[];
  attempts: AssessmentAttempt[];
  /** Null for students. Answer keys are never queried for a student response. */
  answerKeys: AssessmentAnswerKey[] | null;
};

export type AssessmentQuestionInput = {
  prompt: string;
  kind: AssessmentQuestionKind;
  choices: string[] | null;
  points: number;
  correctChoice: string | null;
  topic: string;
};

export type CreateAssessmentInput = {
  tutorId: string;
  studentId: string;
  subjectId: string;
  bookingId: string | null;
  title: string;
  instructions: string | null;
  purpose: AssessmentPurpose;
  dueAt: string | null;
  questions: AssessmentQuestionInput[];
};

export type UpdateAssessmentInput = Omit<CreateAssessmentInput, "tutorId" | "studentId" | "subjectId" | "bookingId">;

export type AssignmentStatus = "draft" | "assigned" | "submitted" | "returned" | "completed" | "cancelled";
export type AssignmentSubmissionType = "text" | "link" | "file";

export type Assignment = {
  id: string;
  tutor_id: string;
  student_id: string;
  booking_id: string | null;
  subject_id: string | null;
  topic: string | null;
  study_plan_id: string | null;
  plan_revision_no: number | null;
  milestone_id: string | null;
  title: string;
  instructions: string;
  submission_type: AssignmentSubmissionType;
  due_at: string;
  accepts_late: boolean;
  submissions_closed_at: string | null;
  status: AssignmentStatus;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AssignmentSubmission = {
  id: string;
  assignment_id: string;
  student_id: string;
  attempt_no: number;
  body: string | null;
  link_url: string | null;
  file_path: string | null;
  file_mime: string | null;
  file_size_bytes: number | null;
  is_late: boolean;
  submitted_at: string;
};

export type AssignmentFeedback = {
  id: string;
  submission_id: string;
  tutor_id: string;
  feedback: string;
  score: number | null;
  outcome: "returned" | "completed";
  created_at: string;
  updated_at: string;
};

export type AssignmentSubmissionDraft = {
  assignment_id: string;
  student_id: string;
  body: string | null;
  link_url: string | null;
  updated_at: string;
};

export type AssignmentDetail = {
  assignment: Assignment;
  submissions: Array<AssignmentSubmission & { feedback: AssignmentFeedback | null }>;
  /** Visible to the assigned student only; tutor views always receive null. */
  draft: AssignmentSubmissionDraft | null;
};

export type AssignmentMilestoneOption = {
  planId: string;
  planTitle: string;
  bookingId: string;
  milestoneId: string;
  milestoneTitle: string;
  studentId: string;
  subjectId: string;
  topic: string;
};

export type CreateAssignmentInput = {
  tutorId: string;
  studentId: string;
  bookingId: string;
  title: string;
  instructions: string;
  submissionType: AssignmentSubmissionType;
  dueAt: string;
  acceptsLate: boolean;
  topic: string;
  studyPlanId: string | null;
  milestoneId: string | null;
};

export type UpdateAssignmentInput = Omit<CreateAssignmentInput, "tutorId" | "studentId" | "bookingId">;

export type AssignmentSubmissionInput = {
  body?: string | null;
  linkUrl?: string | null;
  file?: File | null;
};

export type AssignmentDraftInput = { body?: string | null; linkUrl?: string | null };

export type AssignmentFeedbackInput = {
  feedback: string;
  score: number | null;
  outcome: "returned" | "completed";
};

export type StudyGoalInput = {
  id?: string;
  position?: number;
  title: string;
  topic: string;
  targetDate: string;
  baseline: string;
  schedule: string;
  successCriterion: string;
  description: string | null;
  milestones: StudyMilestoneInput[];
};

export type StudyMilestoneStatus = "planned" | "in_progress" | "completed" | "blocked" | "unspecified";
export type StudyMilestoneLink =
  { kind: "resource"; id: string } | { kind: "assignment"; id: string } | { kind: "assessment"; id: string };

export type StudyMilestoneInput = {
  id?: string;
  position?: number;
  title: string;
  description: string | null;
  status: Exclude<StudyMilestoneStatus, "unspecified">;
  targetDate: string | null;
  links: StudyMilestoneLink[];
};

export type StudyMilestoneDraft = Omit<StudyMilestoneInput, "id" | "position"> & { id: string; position: number };
export type StudyGoalDraft = Omit<StudyGoalInput, "id" | "position" | "milestones"> & {
  id: string;
  position: number;
  milestones: StudyMilestoneDraft[];
};

export type StudyGoal = Omit<
  StudyGoalInput,
  "id" | "position" | "topic" | "targetDate" | "baseline" | "schedule" | "successCriterion" | "milestones"
> & {
  id: string;
  position: number;
  topic: string | null;
  targetDate: string | null;
  baseline: string | null;
  schedule: string | null;
  successCriterion: string | null;
  milestones: StudyMilestone[];
};
export type StudyMilestone = Omit<StudyMilestoneInput, "id" | "position" | "status" | "links"> & {
  id: string;
  position: number;
  status: StudyMilestoneStatus;
  links: StudyMilestoneLink[];
};

export type StudyPlan = {
  id: string;
  tutor_id: string | null;
  student_id: string;
  subject_id: string | null;
  booking_id: string | null;
  status: "active" | "completed" | "archived";
  current_revision: number;
  created_at: string;
  updated_at: string;
};

export type StudyPlanListItem = StudyPlan & { title: string };

export type StudyPlanRevision = {
  id: string;
  plan_id: string;
  revision_no: number;
  title: string;
  description: string | null;
  goals: StudyGoal[];
  authored_by: string;
  created_at: string;
};

export type StudyPlanEvidence = {
  id: string;
  plan_id: string;
  revision_no: number;
  milestone_id: string;
  source_kind: "assessment_attempt" | "assignment_submission" | "session_recap";
  source_id: string;
  recorded_by: string;
  created_at: string;
};

export type StudyPlanDetail = {
  plan: StudyPlan;
  access: "personal" | "shared";
  canRevise: boolean;
  canPropose: boolean;
  revisions: StudyPlanRevision[];
  evidence: StudyPlanEvidence[];
  replanningHistory: StudyPlanReplanningHistory[];
  proposals: StudyPlanProposal[];
  progress: { evidenceCount: number; milestonesWithEvidence: number; totalMilestones: number };
};

export type StudyPlanReplanningHistory = {
  id: string;
  plan_id: string;
  milestone_id: string;
  revision_no: number;
  from_target_date: string | null;
  to_target_date: string;
  reason: string;
  authored_by: string;
  created_at: string;
};

export type StudyPlanProposal = {
  id: string;
  plan_id: string;
  milestone_id: string;
  proposed_target_date: string;
  summary: string;
  proposed_by: string;
  status: "pending" | "accepted" | "dismissed";
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  created_at: string;
};

export type CreateStudyPlanInput = {
  tutorId: string;
  studentId: string;
  subjectId: string | null;
  bookingId: string | null;
  title: string;
  description: string | null;
  goals: StudyGoalInput[];
};

export type ReviseStudyPlanInput = {
  expectedRevision: number;
  title: string;
  description: string | null;
  goals: StudyGoalInput[];
};

export type StudyEvidenceSource = {
  sourceKind: StudyPlanEvidence["source_kind"];
  sourceId: string;
};

export type StudyEvidenceCandidate = StudyEvidenceSource & { label: string; occurredAt: string };

export type TopicMasteryObservation = {
  id: string;
  student_id: string;
  tutor_id: string;
  subject_id: string;
  topic: string;
  label: "needs_work" | "improving" | "confident";
  source_kind: StudyPlanEvidence["source_kind"];
  source_id: string;
  recorded_by: string;
  observed_at: string;
  note: string | null;
  created_at: string;
  sourceLabel?: string;
  sourcePath?: string;
};

export type TopicMasteryInput = {
  studentId: string;
  subjectId: string;
  topic: string;
  label: TopicMasteryObservation["label"];
  sourceKind: StudyPlanEvidence["source_kind"];
  sourceId: string;
  observedAt: string;
  note: string | null;
};

export type LearningProgressEvent = {
  id: string;
  student_id: string;
  tutor_id: string;
  subject_id: string | null;
  event_type: "assessment_scored" | "assignment_completed" | "session_recap_published";
  source_kind: "assessment_attempt" | "assignment_submission" | "session_recap";
  source_id: string;
  occurred_at: string;
  created_at: string;
  sourceLabel?: string;
  sourcePath?: string;
};

export type LearningTopicRecord = {
  id: string;
  subjectId: string;
  topic: string;
  /** Tutor profile ID attached to this saved source, when the source has one. */
  tutorId: string | null;
  /** Current/older goal IDs only when an explicit milestone link or evidence row connects the source. */
  goalIds?: string[];
  sourceKind: "assessment_question" | "assignment_submission" | "session_recap" | "tutor_observation";
  sourceId: string;
  occurredAt: string;
  sourceLabel: string;
  sourcePath: string;
  assessmentPoints?: { earned: number; possible: number };
  assignmentFeedback?: { score: number | null; outcome: "returned" | "completed" | null; updatedAt: string | null };
  recapNarrative?: { strengths: string | null; practiceAreas: string | null };
  tutorObservation?: { label: TopicMasteryObservation["label"]; observedAt: string; note: string | null };
};

export type RepeatedRecapPhrase = {
  text: string;
  recapCount: number;
  sources: Array<{ bookingId: string; occurredAt: string; sourcePath: string }>;
};

export type LearningTopicSummary = {
  subjectId: string;
  topic: string;
  recordCount: number;
  assessmentQuestionCount: number;
  assignmentSubmissionCount: number;
  recapCount: number;
  tutorObservationCount: number;
  assessmentPoints: { earned: number; possible: number };
  scoredAssignmentFeedbackCount: number;
  latestTutorObservation: {
    label: TopicMasteryObservation["label"];
    observedAt: string;
    sourceLabel: string;
    sourcePath: string;
  } | null;
  recurringStrengths: RepeatedRecapPhrase[];
  recurringPracticeAreas: RepeatedRecapPhrase[];
};

export type LearningProgressFilters = {
  goalId?: string;
  topic?: { subjectId: string; topic: string };
  tutorId?: string;
  fromDate?: string;
  toDate?: string;
};

export type LearningProgressFilterOptions = {
  goals: Array<{ goalId: string; planId: string; planTitle: string; subjectId: string; topic: string; title: string }>;
  topics: Array<{ subjectId: string; topic: string }>;
  tutors: Array<{ tutorId: string; tutorName: string }>;
};

export type LearningProgressCappedSource =
  | "learning_relationships"
  | "study_plans"
  | "assignments"
  | "assessments"
  | "topic_mastery"
  | "progress_events"
  | "plan_evidence"
  | "assessment_attempts"
  | "assignment_submissions"
  | "assignment_feedback"
  | "assessment_question_topics"
  | "mastery_topic_options"
  | "session_recaps"
  | "assessment_topic_evidence";

export type LearningProgressCoverage = {
  /** A source query reached its row cap; records may be omitted from this overview. */
  bounded: boolean;
  cappedSources: LearningProgressCappedSource[];
  rowCap: 1000;
};

export type TopicEvidenceCandidate = {
  sourceKind: StudyPlanEvidence["source_kind"];
  sourceId: string;
  label: string;
  occurredAt: string;
  sourcePath: string;
};

export type LearningProgressOverview = {
  studentId: string;
  activeGoals: Array<{ planId: string; planTitle: string; revisionNo: number; goal: StudyGoal }>;
  milestones: Array<{
    planId: string;
    goalId: string;
    goalTopic: string | null;
    milestone: StudyMilestone;
    evidence: StudyPlanEvidence[];
  }>;
  sessions: Array<{
    bookingId: string;
    tutorId: string;
    tutorName: string;
    subjectId: string;
    subjectName: string;
    endsAt: string;
    recapAvailable: boolean;
  }>;
  tasks: Assignment[];
  assessments: Array<{ assessment: Assessment; attempts: AssessmentAttempt[] }>;
  topicEvidence: TopicMasteryObservation[];
  topicRecords: LearningTopicRecord[];
  topicSummaries: LearningTopicSummary[];
  filterOptions: LearningProgressFilterOptions;
  coverage: LearningProgressCoverage;
  events: LearningProgressEvent[];
  observedAt: string;
};

export type LearningWorkspace = {
  actor: Actor;
  relationships: LearningRelationship[];
  assessments: Assessment[];
  assignments: Assignment[];
  studyPlans: StudyPlanListItem[];
};
