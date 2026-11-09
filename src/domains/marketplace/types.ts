/** Safe, application-facing marketplace contracts. Private profile and account fields are intentionally absent. */

export type PublicationState = "draft" | "review_ready" | "published" | "paused";
export type TutoringMode = "virtual" | "in_person";
export type TeachingMethod =
  "step-by-step" | "visual examples" | "worked examples" | "practice problems" | "discussion";

export type MarketplaceSubject = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
};

export type TutorOffering = {
  subjectId: string;
  name: string;
  slug: string;
  expertise: string | null;
  rateOverrideMinor: number | null;
  hourlyRateMinor: number | null;
  currency: string;
};

export type ApproximateLocation = { latitude: number; longitude: number };

export type TutorListing = {
  id: string;
  version: number;
  userId: string;
  publicDisplayName: string;
  publicAvatarUrl: string | null;
  headline: string;
  bio: string;
  credentialsText: string | null;
  experienceYears: number;
  hourlyRateMinor: number | null;
  languages: string[];
  currency: string;
  supportsVirtual: boolean;
  supportsInPerson: boolean;
  serviceAreaLabel: string | null;
  location: ApproximateLocation | null;
  serviceRadiusKm: number | null;
  publicationState: PublicationState;
  offerings: TutorOffering[];
};

/** Public DTO: contains only tutor-approved snapshot fields plus public reputation and subject offerings. */
export type PublicTutorCard = {
  id: string;
  publicDisplayName: string;
  publicAvatarUrl: string | null;
  headline: string;
  bio: string;
  credentialsText: string | null;
  experienceYears: number;
  hourlyRateMinor: number;
  languages: string[];
  currency: string;
  supportsVirtual: boolean;
  supportsInPerson: boolean;
  serviceAreaLabel: string | null;
  serviceRadiusKm: number | null;
  ratingCount: number;
  ratingAverage: number | null;
  /** Counted from completed platform bookings; no unverifiable claims are attached. */
  completedSessionCount: number;
  recommendedCount: number;
  badgePolicyVersion: number;
  badges: FactualTutorBadge[];
  distanceKm: number | null;
  offerings: TutorOffering[];
};

export type PublicTutorReview = {
  id: string;
  rating: number;
  comment: string | null;
  recommended: boolean;
  createdAt: string;
};

export type AvailabilityRule = {
  id: string;
  tutorId: string;
  weekday: number;
  localStart: string;
  localEnd: string;
  timezone: string;
  validFrom: string;
  validUntil: string | null;
  active: boolean;
};

export type AvailabilityRuleInput = Omit<AvailabilityRule, "id" | "tutorId"> & { id?: string };

export type AvailabilityException = {
  id: string;
  tutorId: string;
  localDate: string;
  localStart: string | null;
  localEnd: string | null;
  timezone: string;
  exceptionType: "unavailable" | "additional";
  reason: string | null;
};

export type AvailabilityExceptionInput = Omit<AvailabilityException, "id" | "tutorId" | "reason"> & {
  id?: string;
  reason?: string | null;
};

export type PublicAvailabilityRule = Omit<AvailabilityRule, "id" | "tutorId" | "active">;
export type PublicAvailabilityException = Omit<AvailabilityException, "id" | "tutorId" | "reason">;

export type PublicTutorDetail = PublicTutorCard & {
  reviews: PublicTutorReview[];
  availabilityRules: PublicAvailabilityRule[];
  availabilityExceptions: PublicAvailabilityException[];
};

export type TutorListingInput = {
  listingId?: string;
  /** Required for updates; stale versions are rejected by the database. */
  expectedVersion?: number;
  publicDisplayName: string;
  publicAvatarUrl?: string | null;
  headline: string;
  bio: string;
  credentialsText?: string | null;
  experienceYears: number;
  hourlyRateMinor?: number | null;
  currency?: string;
  supportsVirtual: boolean;
  supportsInPerson: boolean;
  serviceAreaLabel?: string | null;
  location?: ApproximateLocation | null;
  serviceRadiusKm?: number | null;
  offerings: Array<{
    subjectId: string;
    expertise?: string | null;
    rateOverrideMinor?: number | null;
  }>;
};

export type SaveTutorLanguagesInput = {
  listingId: string;
  expectedVersion: number;
  languages: string[];
};

export type TutorSearchFilters = {
  query?: string;
  subjectId?: string;
  mode?: TutoringMode;
  minHourlyRateMinor?: number;
  maxHourlyRateMinor?: number;
  /** Currency used for rate bounds; current discovery and matching forms default to USD. */
  budgetCurrency?: string;
  minimumRating?: number;
  /** A tutor must list at least one of the selected BCP-47 language tags. */
  languageTags?: string[];
  near?: { latitude: number; longitude: number; radiusKm: number };
  /** If present, results must have this exact buffered slot free for the requested duration. */
  availableAt?: string;
  durationMinutes?: number;
  sort?: "relevance" | "rating" | "rate" | "name" | "distance";
  page?: number;
  pageSize?: number;
};

export type TutorSearchPage = {
  items: TutorMatchCandidate[];
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type MatchCriteria = {
  subjectId?: string;
  mode?: TutoringMode;
  maxHourlyRateMinor?: number;
  budgetCurrency?: string;
  languageTags?: string[];
  location?: { latitude: number; longitude: number; radiusKm: number };
  startAt?: string;
};

export type TutorMatchInput = {
  subjectId: string;
  mode: TutoringMode;
  maxHourlyRateMinor: number;
  /** Budget minor units are interpreted in this currency; default is USD. */
  budgetCurrency?: string;
  availableAt: string;
  durationMinutes: number;
  location?: { latitude: number; longitude: number; radiusKm: number };
  /** User-entered public teaching preferences; maximum five short phrases. */
  preferredStrategies?: string[];
  /** Hard-filter: at least one selected language must match the tutor's public language list. */
  languageTags?: string[];
  /** Optional learner intake, retained for transparent context but not scored without an explicit tutor fact. */
  topic?: string;
  level?: string;
  learningGoal?: string;
  page?: number;
  pageSize?: number;
};

export type MatchingFactorKey = "rate_fit" | "teaching_preference" | "rating" | "experience" | "completed_sessions";

export type MatchFactorExplanation = {
  key: MatchingFactorKey;
  label: string;
  weight: number;
  score: number;
  fact: string | null;
  rationale: string;
  applied: boolean;
};

export type FactualTutorBadge = {
  key: "completed_sessions" | "visible_reviews" | "rating_average" | "recommendations";
  label: string;
  policyVersion: number;
  fact: "completed_sessions" | "visible_reviews" | "rating_average" | "recommendations";
  value: number;
  threshold: number;
};

export type TutorBadgeProgress = {
  tutorId: string;
  policyVersion: number;
  facts: {
    completed_sessions: number;
    visible_reviews: number;
    rating_average: number | null;
    recommendations: number;
  };
  thresholds: Array<{ fact: FactualTutorBadge["fact"]; threshold: number; label: string }>;
};

export type RankedTutorMatch = ExplainedTutorMatch & {
  score: number;
  factors: MatchFactorExplanation[];
  factorVersion: number;
  eligibilityFacts: string[];
};

export type TutorMatchPage = {
  items: RankedTutorMatch[];
  factorVersion: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type MatchReason =
  | "subject_unavailable"
  | "mode_unavailable"
  | "over_budget"
  | "currency_unavailable"
  | "language_unavailable"
  | "outside_radius"
  | "no_open_slot";

export type TutorMatchCandidate = PublicTutorCard & { openSlotStartsAt?: readonly string[] };

export type ExplainedTutorMatch = {
  tutor: TutorMatchCandidate;
  eligible: boolean;
  reasons: MatchReason[];
};

export type BookingPrivateDetails = {
  bookingId: string;
  meetingUrl: string | null;
  meetingPlace: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SaveBookingPrivateDetailsInput = {
  meetingUrl?: string | null;
  meetingPlace?: string | null;
};

export type RescheduleBookingInput = {
  bookingId: string;
  tutorId: string;
  subjectId: string;
  startsAt: string;
  endsAt: string;
  mode: TutoringMode;
  requestKey: string;
  confirmedMove?: boolean;
  reason?: string;
};

export type RescheduledBooking = {
  id: string;
  studentId: string;
  tutorId: string;
  subjectId: string;
  startsAt: string;
  endsAt: string;
  mode: TutoringMode;
  priceMinor: number;
  currency: string;
  status: string;
};

export type BookingRescheduleHistory = {
  id: string;
  bookingId: string;
  actorId: string;
  oldStartsAt: string;
  oldEndsAt: string;
  newStartsAt: string;
  newEndsAt: string;
  reason: string;
  bookingVersion: number;
  createdAt: string;
};

export type LearningProfile = {
  id: string;
  displayName: string;
  bio: string | null;
  timezone: string;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  learningPreferences: Record<string, unknown>;
  interests: string[];
  preferredMode: "virtual" | "in_person" | "no_preference";
};

export type SaveLearningProfileInput = Omit<LearningProfile, "id" | "interests" | "preferredMode"> &
  Partial<Pick<LearningProfile, "interests" | "preferredMode">>;
