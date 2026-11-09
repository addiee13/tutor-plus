export const notificationCategories = [
  "booking",
  "session",
  "assessment",
  "assignment",
  "study_plan",
  "review",
  "safety",
  "system",
] as const;

export type NotificationCategory = (typeof notificationCategories)[number];

export type NotificationItem = {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  targetPath: string | null;
  readAt: string | null;
  createdAt: string;
  deliveryState?:
    | "queued"
    | "accepted"
    | "delivered"
    | "bounced"
    | "complained"
    | "failed"
    | "disabled"
    | "not_configured"
    | "retrying";
};

export type NotificationPreference = {
  category: NotificationCategory;
  emailEnabled: boolean;
  required: boolean;
};

export type NotificationWorkspace = {
  notifications: NotificationItem[];
  preferences: NotificationPreference[];
};

export type ResourceType = "article" | "video" | "practice" | "reference" | "other";

export type Resource = {
  id: string;
  subjectId: string | null;
  title: string;
  description: string;
  url: string;
  resourceType: ResourceType;
  attribution: string | null;
  active: boolean;
};

export type Subject = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  active: boolean;
  sortOrder: number;
};

export type SafetyReportState = "open" | "reviewing" | "resolved" | "dismissed";

export type SafetyReport = {
  id: string;
  reporterId: string;
  targetUserId: string | null;
  targetReviewId: string | null;
  reason: string;
  state: SafetyReportState;
  resolutionReason?: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type AdminUser = {
  id: string;
  email: string | null;
  displayName: string;
  status: "active" | "inactive";
  roles: string[];
  createdAt: string;
};

export type AdminReview = {
  id: string;
  tutorId: string;
  rating: number;
  comment: string | null;
  recommended: boolean;
  moderationStatus: "visible" | "hidden";
  createdAt: string;
};

export type NotificationTemplate = {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  targetPath: string | null;
  active: boolean;
  version: number;
  updatedAt: string;
};

export type MatchingFactorKey = "rate_fit" | "teaching_preference" | "rating" | "experience" | "completed_sessions";

export type MatchingFactor = {
  key: MatchingFactorKey;
  label: string;
  weight: number;
  active: boolean;
};

export type MatchingFactorVersion = {
  version: number;
  factors: MatchingFactor[];
  createdAt: string;
};

export type AuditEntry = {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  createdAt: string;
};

export type SafetyWorkspace = {
  reports: SafetyReport[];
  subjects: Subject[];
  resources: Resource[];
  audit: AuditEntry[];
  templates: NotificationTemplate[];
  matchingFactors: MatchingFactorVersion | null;
};

export type AdminWorkspace = SafetyWorkspace & {
  users: AdminUser[];
  reviews: AdminReview[];
  hasMoreUsers: boolean;
  matchingFactorAudit: AuditEntry[];
  assistantReports: AssistantResponseReport[];
  operationalHealth: OperationalHealthMetric[];
  badgePolicy: BadgePolicy | null;
};

export type AssessmentTemplateQuestion = {
  prompt: string;
  kind: "single_choice" | "short_answer";
  choices: string[] | null;
  points: number;
  correctChoice: string | null;
  topic: string;
};

export type AssessmentTemplate = {
  id: string;
  version: number;
  title: string;
  description: string;
  subjectId: string | null;
  purpose: "diagnostic" | "pre_session" | "post_session" | "milestone";
  active: boolean;
  questions: AssessmentTemplateQuestion[];
  createdAt: string;
};

export type TutorAssessmentTemplate = Omit<AssessmentTemplate, "active">;

export type SaveAssessmentTemplateInput = {
  id?: string;
  expectedVersion?: number;
  title: string;
  description: string;
  subjectId?: string | null;
  purpose: AssessmentTemplate["purpose"];
  active: boolean;
  questions: AssessmentTemplateQuestion[];
  confirmed: true;
  reason: string;
};

export type BadgeFact = "completed_sessions" | "visible_reviews" | "rating_average" | "recommendations";

export type BadgeThreshold = {
  fact: BadgeFact;
  threshold: number;
  label: string;
};

export type BadgePolicy = {
  version: number;
  thresholds: BadgeThreshold[];
  createdAt: string;
};

export type SaveBadgePolicyInput = {
  expectedVersion: number;
  thresholds: BadgeThreshold[];
  confirmed: true;
  reason: string;
};

export type AssistantResponseReport = {
  id: string;
  reporterId: string;
  requestId: string;
  reason: string;
  state: "open" | "reviewing" | "resolved" | "dismissed";
  resolvedBy: string | null;
  resolutionReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type ResolveAssistantResponseReportInput = {
  id: string;
  state: "reviewing" | "resolved" | "dismissed";
  confirmed: true;
  reason: string;
};

export type OperationalHealthMetric = { key: string; value: number; windowStart: string | null };

export type SaveNotificationPreferenceInput = {
  category: NotificationCategory;
  emailEnabled: boolean;
};

export type AskLearningAssistantInput = {
  question: string;
  bookingId?: string;
  planId?: string;
  resourceIds?: string[];
};

export type LearningAssistantResult = {
  /** Opaque owner-checked request handle; it contains no prompt, selected context, or answer. */
  requestId: string;
  answer: string;
  resources: Resource[];
  draftOnly: true;
  caveat: string;
};

export type SafetyReportInput = {
  targetTutorId?: string;
  targetUserId?: string;
  targetReviewId?: string;
  reason: string;
};

export type ResolveSafetyReportInput = {
  id: string;
  state: "reviewing" | "resolved" | "dismissed";
  reason: string;
  confirmed: true;
};

export type ModerateReviewInput = {
  id: string;
  status: "visible" | "hidden";
  reason: string;
  confirmed: true;
};

export type SaveResourceInput = {
  id?: string;
  subjectId?: string | null;
  title: string;
  description: string;
  url: string;
  resourceType: ResourceType;
  attribution?: string | null;
  active: boolean;
  confirmed: true;
  reason: string;
};

export type SaveSubjectInput = {
  id?: string;
  name: string;
  slug: string;
  parentId?: string | null;
  active: boolean;
  sortOrder: number;
  confirmed: true;
  reason: string;
};

export type SaveNotificationTemplateInput = {
  id?: string;
  category: NotificationCategory;
  title: string;
  body: string;
  targetPath?: string | null;
  active: boolean;
  confirmed: true;
  reason: string;
};

export type SetAdminUserStatusInput = {
  userId: string;
  active: boolean;
  confirmed: true;
  reason: string;
};

export type SetAdminUserRoleInput = {
  userId: string;
  role: "student" | "tutor" | "administrator";
  operation: "grant" | "revoke";
  confirmed: true;
  reason: string;
};

export type SaveMatchingFactorsInput = {
  factors: MatchingFactor[];
  confirmed: true;
  reason: string;
};

export type ReadAdminWorkspaceOptions = {
  query?: string;
  page?: number;
  pageSize?: number;
};

export type GeocodeTutorLocationInput = {
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  countryCode: string;
};

export type GeocodeTutorLocationResult = {
  configured: boolean;
  location: { latitude: number; longitude: number } | null;
  label: string | null;
  error: "not_configured" | "not_found" | "provider_unavailable" | null;
};

export type AssistantStatus = { configured: boolean; promptLimit: number };

export type OutboxWorkerResult = {
  claimed: number;
  accepted: number;
  notConfigured: number;
  retrying: number;
  exhausted: number;
};

export type ResendDeliveryWebhookHeaders = {
  id?: string | null;
  timestamp?: string | null;
  signature?: string | null;
};

export type ObservedDeliveryWebhookResult = {
  duplicate: boolean;
  matched: boolean;
  deliveryState: string | null;
};
