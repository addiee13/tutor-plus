import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../auth/service";
import { hasRole, requireRole, type Actor } from "../auth/policy";
import { DomainError, InputError } from "../shared/errors";
import { PgErrorCode } from "../shared/postgres";
import {
  explainTutorMatches,
  normalizeTeachingMethodPreferences,
  scoreTeachingMethods,
  sortRankedTutorMatches,
} from "./matching";
import {
  parseAvailabilityExceptionInput,
  parseAvailabilityRuleInput,
  parseBookingPrivateDetailsInput,
  parseLearningProfileInput,
  parseTutorLanguagesInput,
  parseRescheduleInput,
  parseTutorListingInput,
  parseTutorSearchFilters,
} from "./validation";
import type {
  ApproximateLocation,
  AvailabilityException,
  AvailabilityExceptionInput,
  AvailabilityRule,
  FactualTutorBadge,
  AvailabilityRuleInput,
  BookingPrivateDetails,
  BookingRescheduleHistory,
  LearningProfile,
  MarketplaceSubject,
  PublicAvailabilityException,
  PublicAvailabilityRule,
  PublicTutorCard,
  PublicTutorDetail,
  PublicTutorReview,
  SaveTutorLanguagesInput,
  RescheduleBookingInput,
  RescheduledBooking,
  SaveBookingPrivateDetailsInput,
  SaveLearningProfileInput,
  TutorListing,
  TutorListingInput,
  TutorBadgeProgress,
  TutorMatchInput,
  TutorMatchPage,
  RankedTutorMatch,
  TutorMatchCandidate,
  TutorOffering,
  TutorSearchFilters,
  TutorSearchPage,
} from "./types";

const LISTING_FIELDS =
  "id,user_id,version,public_display_name,public_avatar_url,headline,bio,credentials_text,experience_years,hourly_rate_minor,currency,supports_virtual,supports_in_person,service_area_label,approximate_location,service_radius_km,publication_state,tutor_languages";
const PUBLIC_FIELDS =
  "id,public_display_name,public_avatar_url,headline,bio,credentials_text,experience_years,hourly_rate_minor,currency,supports_virtual,supports_in_person,service_area_label,service_radius_km,tutor_languages";
const RULE_FIELDS = "id,tutor_id,weekday,local_start,local_end,timezone,valid_from,valid_until,active";
const EXCEPTION_FIELDS = "id,tutor_id,local_date,local_start,local_end,timezone,exception_type,reason";
const PRIVATE_DETAILS_FIELDS = "booking_id,meeting_url,meeting_place,created_at,updated_at";
const DB_INPUT_ERRORS: ReadonlySet<string> = new Set([
  PgErrorCode.invalidParameterValue,
  PgErrorCode.exclusionViolation,
  PgErrorCode.uniqueViolation,
  "40001",
]);

type DbError = { code?: string; message?: string };
type ListingRow = {
  id: string;
  user_id: string;
  version: number;
  public_display_name: string;
  public_avatar_url: string | null;
  headline: string;
  bio: string;
  credentials_text: string | null;
  experience_years: number;
  hourly_rate_minor: number | string | null;
  currency: string;
  supports_virtual: boolean;
  supports_in_person: boolean;
  service_area_label: string | null;
  approximate_location: unknown;
  service_radius_km: number | string | null;
  publication_state: TutorListing["publicationState"];
  tutor_languages: string[];
};
type PublicRow = Omit<ListingRow, "user_id" | "approximate_location" | "publication_state"> & {
  rating_count: number;
  rating_average: number | string | null;
  distance_km: number | string | null;
  tutor_languages: string[];
};
type SubjectRow = { id: string; parent_id: string | null; name: string; slug: string; sort_order: number };
type OfferingRow = { subject_id: string; expertise: string | null; rate_override_minor: number | string | null };
type PublicOfferingRow = {
  subject_id: string;
  name: string;
  slug: string;
  hourly_rate_minor: number | string;
  currency: string;
};
type PublicOfferingBatchRow = PublicOfferingRow & { tutor_id: string };
type RuleRow = {
  id: string;
  tutor_id: string;
  weekday: number;
  local_start: string;
  local_end: string;
  timezone: string;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
};
type ExceptionRow = {
  id: string;
  tutor_id: string;
  local_date: string;
  local_start: string | null;
  local_end: string | null;
  timezone: string;
  exception_type: AvailabilityException["exceptionType"];
  reason: string | null;
};
type SearchRow = Omit<PublicRow, "user_id" | "approximate_location" | "publication_state"> & {
  subject_ids: string[];
};
type ReviewRow = { id: string; rating: number; comment: string | null; recommended: boolean; created_at: string };
type PublicTutorFactsRow = {
  tutor_id: string;
  completed_session_count: number;
  recommended_count: number;
  badge_policy_version: number;
  badges: FactualTutorBadge[];
};
type FactorVersionRow = {
  version: number;
  factors: Array<{ key: string; label: string; weight: number; active: boolean }>;
  created_at: string;
};
type ProfileRow = {
  id: string;
  display_name: string;
  bio: string | null;
  timezone: string;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string | null;
  learning_preferences: Record<string, unknown>;
  learning_interests: string[];
  preferred_mode: LearningProfile["preferredMode"];
};

function failDatabase(error: DbError, field: string, message: string): never {
  if (error.code === PgErrorCode.insufficientPrivilege) throw new DomainError("forbidden");
  if (DB_INPUT_ERRORS.has(error.code ?? "")) throw new InputError({ [field]: message });
  // No SQL text, table names, or provider details cross the domain boundary.
  throw new DomainError("unavailable");
}

function toSubject(row: SubjectRow): MarketplaceSubject {
  return { id: row.id, name: row.name, slug: row.slug, parentId: row.parent_id, sortOrder: row.sort_order };
}

function toOffering(
  row: OfferingRow,
  subject: SubjectRow | undefined,
  baseRate: number | null,
  currency: string,
): TutorOffering | null {
  if (!subject) return null;
  const rateOverrideMinor = row.rate_override_minor === null ? null : Number(row.rate_override_minor);
  return {
    subjectId: row.subject_id,
    name: subject.name,
    slug: subject.slug,
    expertise: row.expertise,
    rateOverrideMinor,
    hourlyRateMinor: rateOverrideMinor ?? baseRate,
    currency,
  };
}

function toPublicOffering(row: PublicOfferingRow): TutorOffering {
  return {
    subjectId: row.subject_id,
    name: row.name,
    slug: row.slug,
    expertise: null,
    rateOverrideMinor: null,
    hourlyRateMinor: Number(row.hourly_rate_minor),
    currency: row.currency,
  };
}

async function listPublicOfferings(client: SupabaseClient, tutorId: string): Promise<TutorOffering[]> {
  const { data, error } = await client.rpc("list_public_tutor_subjects", { tutor: tutorId });
  if (error || !Array.isArray(data)) throw new DomainError("unavailable");
  return (data as PublicOfferingRow[]).map(toPublicOffering);
}

async function listPrivateOfferings(
  client: SupabaseClient,
  tutorId: string,
  baseRate: number | null,
  currency: string,
): Promise<TutorOffering[]> {
  const { data: links, error: linksError } = await client
    .from("tutor_subjects")
    .select("subject_id,expertise,rate_override_minor")
    .eq("tutor_id", tutorId);
  if (linksError) throw new DomainError("unavailable");
  const rows = (links ?? []) as OfferingRow[];
  if (!rows.length) return [];
  const { data: subjects, error: subjectsError } = await client
    .from("subjects")
    .select("id,parent_id,name,slug,sort_order")
    .in(
      "id",
      rows.map((row) => row.subject_id),
    );
  if (subjectsError) throw new DomainError("unavailable");
  const byId = new Map(((subjects ?? []) as SubjectRow[]).map((row) => [row.id, row]));
  return rows.flatMap((row) => {
    const offering = toOffering(row, byId.get(row.subject_id), baseRate, currency);
    return offering ? [offering] : [];
  });
}

function parseLocation(value: unknown): ApproximateLocation | null {
  if (!value || typeof value !== "object") return null;
  const geo = value as { type?: unknown; coordinates?: unknown };
  if (geo.type === "Point" && Array.isArray(geo.coordinates)) {
    const [longitude, latitude] = geo.coordinates;
    if (typeof latitude === "number" && typeof longitude === "number") return { latitude, longitude };
  }
  return null;
}

function mapListing(row: ListingRow, offerings: TutorOffering[]): TutorListing {
  return {
    id: row.id,
    version: row.version,
    userId: row.user_id,
    publicDisplayName: row.public_display_name,
    publicAvatarUrl: row.public_avatar_url,
    headline: row.headline,
    bio: row.bio,
    credentialsText: row.credentials_text,
    experienceYears: row.experience_years,
    hourlyRateMinor: row.hourly_rate_minor === null ? null : Number(row.hourly_rate_minor),
    languages: row.tutor_languages ?? [],
    currency: row.currency,
    supportsVirtual: row.supports_virtual,
    supportsInPerson: row.supports_in_person,
    serviceAreaLabel: row.service_area_label,
    location: parseLocation(row.approximate_location),
    serviceRadiusKm: row.service_radius_km === null ? null : Number(row.service_radius_km),
    publicationState: row.publication_state,
    offerings,
  };
}

function mapPublicCard(row: PublicRow, offerings: TutorOffering[], facts: PublicTutorFactsRow): PublicTutorCard {
  const completedSessionCount = Number(facts.completed_session_count);
  return {
    id: row.id,
    publicDisplayName: row.public_display_name,
    publicAvatarUrl: row.public_avatar_url,
    headline: row.headline,
    bio: row.bio,
    credentialsText: row.credentials_text,
    experienceYears: row.experience_years,
    hourlyRateMinor: Number(row.hourly_rate_minor),
    languages: row.tutor_languages ?? [],
    currency: row.currency,
    supportsVirtual: row.supports_virtual,
    supportsInPerson: row.supports_in_person,
    serviceAreaLabel: row.service_area_label,
    serviceRadiusKm: row.service_radius_km === null ? null : Number(row.service_radius_km),
    ratingCount: row.rating_count,
    ratingAverage: row.rating_average === null ? null : Number(row.rating_average),
    completedSessionCount,
    recommendedCount: Number(facts.recommended_count),
    badgePolicyVersion: facts.badge_policy_version,
    badges: facts.badges,
    distanceKm: row.distance_km === null ? null : Number(row.distance_km),
    offerings,
  };
}

async function requireOwnedTutor(client: SupabaseClient, actor: Actor, tutorId: string): Promise<void> {
  requireRole(actor, "tutor");
  const { data, error } = await client
    .from("tutor_profiles")
    .select("id")
    .eq("id", tutorId)
    .eq("user_id", actor.id)
    .maybeSingle<{ id: string }>();
  if (error) throw new DomainError("unavailable");
  if (!data) throw new DomainError("forbidden");
}

export async function listSubjects(client: SupabaseClient): Promise<MarketplaceSubject[]> {
  const { data, error } = await client
    .from("subjects")
    .select("id,parent_id,name,slug,sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .limit(500);
  if (error) throw new DomainError("unavailable");
  return ((data ?? []) as SubjectRow[]).map(toSubject);
}

/** Reads the authenticated tutor's private source listing and only their own subject offers. */
export async function readOwnTutorListing(client: SupabaseClient): Promise<TutorListing | null> {
  const actor = await getActor(client);
  requireRole(actor, "tutor");
  const { data, error } = await client
    .from("tutor_profiles")
    .select(LISTING_FIELDS)
    .eq("user_id", actor.id)
    .maybeSingle<ListingRow>();
  if (error) throw new DomainError("unavailable");
  if (!data) return null;
  const offerings = await listPrivateOfferings(
    client,
    data.id,
    data.hourly_rate_minor === null ? null : Number(data.hourly_rate_minor),
    data.currency,
  );
  return mapListing(data, offerings);
}

/** Atomically saves the tutor-approved listing fields and the complete set of offered subjects. */
export async function saveTutorListing(client: SupabaseClient, value: TutorListingInput): Promise<TutorListing> {
  const actor = await getActor(client);
  requireRole(actor, "tutor");
  const input = parseTutorListingInput(value);
  const { data: id, error } = await client.rpc("save_tutor_listing", {
    listing: input.listingId ?? null,
    expected_version: input.expectedVersion ?? null,
    public_display_name: input.publicDisplayName,
    public_avatar_url: input.publicAvatarUrl,
    headline: input.headline,
    bio: input.bio,
    credentials_text: input.credentialsText,
    experience_years: input.experienceYears,
    hourly_rate_minor: input.hourlyRateMinor ?? null,
    currency: input.currency,
    supports_virtual: input.supportsVirtual,
    supports_in_person: input.supportsInPerson,
    service_area_label: input.serviceAreaLabel,
    latitude: input.location?.latitude ?? null,
    longitude: input.location?.longitude ?? null,
    service_radius_km: input.serviceRadiusKm,
    offerings: input.offerings.map((offering) => ({
      subject_id: offering.subjectId,
      expertise: offering.expertise,
      rate_override_minor: offering.rateOverrideMinor,
    })),
  });
  if (error)
    failDatabase(
      error,
      "offerings",
      "Check that every offered subject is active and not required by an existing booking.",
    );
  if (typeof id !== "string") throw new DomainError("unavailable");
  const listing = await readOwnTutorListing(client);
  if (!listing || listing.id !== id) throw new DomainError("unavailable");
  return listing;
}

/** Saves the tutor's public language facts as a separate versioned edit to their own listing. */
export async function saveTutorLanguages(
  client: SupabaseClient,
  value: SaveTutorLanguagesInput,
): Promise<TutorListing> {
  const actor = await getActor(client);
  const input = parseTutorLanguagesInput(value);
  await requireOwnedTutor(client, actor, input.listingId);
  const { error } = await client.rpc("save_tutor_languages", {
    tutor: input.listingId,
    expected_version: input.expectedVersion,
    languages: input.languages,
  });
  if (error) failDatabase(error, "languages", "Refresh the listing and check the language tags.");
  const saved = await readOwnTutorListing(client);
  if (!saved || saved.id !== input.listingId) throw new DomainError("unavailable");
  return saved;
}

/** Changes publication state; the database readiness trigger is authoritative for publishing. */
export async function setTutorPublication(
  client: SupabaseClient,
  listingId: string,
  state: "draft" | "published" | "paused",
): Promise<TutorListing["publicationState"]> {
  const actor = await getActor(client);
  await requireOwnedTutor(client, actor, listingId);
  const { data, error } = await client
    .from("tutor_profiles")
    .update({ publication_state: state })
    .eq("id", listingId)
    .eq("user_id", actor.id)
    .select("publication_state")
    .maybeSingle<{ publication_state: TutorListing["publicationState"] }>();
  if (error)
    failDatabase(
      error,
      "publicationState",
      "Publishing requires an active offer and future availability. Check any in-person service details.",
    );
  if (!data) throw new DomainError("forbidden");
  return data.publication_state;
}

/** Own profile fields stay private; no role, adult-attestation, or account-state field is accepted. */
export async function readLearningProfile(client: SupabaseClient): Promise<LearningProfile> {
  const actor = await getActor(client);
  const { data, error } = await client
    .from("profiles")
    .select(
      "id,display_name,bio,timezone,city,region,postal_code,country_code,learning_preferences,learning_interests,preferred_mode",
    )
    .eq("id", actor.id)
    .single<ProfileRow>();
  if (error || !data) throw new DomainError("unavailable");
  return {
    id: data.id,
    displayName: data.display_name,
    bio: data.bio,
    timezone: data.timezone,
    city: data.city,
    region: data.region,
    postalCode: data.postal_code,
    countryCode: data.country_code,
    learningPreferences: data.learning_preferences,
    interests: data.learning_interests ?? [],
    preferredMode: data.preferred_mode,
  };
}

export async function saveLearningProfile(
  client: SupabaseClient,
  value: SaveLearningProfileInput,
): Promise<LearningProfile> {
  const actor = await getActor(client);
  const input = parseLearningProfileInput(value);
  const update = {
    display_name: input.displayName,
    bio: input.bio,
    timezone: input.timezone,
    city: input.city,
    region: input.region,
    postal_code: input.postalCode,
    country_code: input.countryCode,
    learning_preferences: input.learningPreferences,
    ...(input.interests === undefined ? {} : { learning_interests: input.interests }),
    ...(input.preferredMode === undefined ? {} : { preferred_mode: input.preferredMode }),
  };
  const { data, error } = await client
    .from("profiles")
    .update(update)
    .eq("id", actor.id)
    .select(
      "id,display_name,bio,timezone,city,region,postal_code,country_code,learning_preferences,learning_interests,preferred_mode",
    )
    .maybeSingle<ProfileRow>();
  if (error) failDatabase(error, "profile", "Check the profile details and try again.");
  if (!data) throw new DomainError("forbidden");
  return {
    id: data.id,
    displayName: data.display_name,
    bio: data.bio,
    timezone: data.timezone,
    city: data.city,
    region: data.region,
    postalCode: data.postal_code,
    countryCode: data.country_code,
    learningPreferences: data.learning_preferences,
    interests: data.learning_interests ?? [],
    preferredMode: data.preferred_mode,
  };
}

export async function listOwnAvailability(
  client: SupabaseClient,
  listingId: string,
): Promise<{ rules: AvailabilityRule[]; exceptions: AvailabilityException[] }> {
  const actor = await getActor(client);
  await requireOwnedTutor(client, actor, listingId);
  const [rules, exceptions] = await Promise.all([
    client
      .from("availability_rules")
      .select(RULE_FIELDS)
      .eq("tutor_id", listingId)
      .order("weekday")
      .order("local_start"),
    client
      .from("availability_exceptions")
      .select(EXCEPTION_FIELDS)
      .eq("tutor_id", listingId)
      .order("local_date")
      .order("local_start"),
  ]);
  if (rules.error || exceptions.error) throw new DomainError("unavailable");
  return {
    rules: ((rules.data ?? []) as RuleRow[]).map(mapRule),
    exceptions: ((exceptions.data ?? []) as ExceptionRow[]).map(mapException),
  };
}

function mapRule(row: RuleRow): AvailabilityRule {
  return {
    id: row.id,
    tutorId: row.tutor_id,
    weekday: row.weekday,
    localStart: row.local_start,
    localEnd: row.local_end,
    timezone: row.timezone,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    active: row.active,
  };
}

function mapException(row: ExceptionRow): AvailabilityException {
  return {
    id: row.id,
    tutorId: row.tutor_id,
    localDate: row.local_date,
    localStart: row.local_start,
    localEnd: row.local_end,
    timezone: row.timezone,
    exceptionType: row.exception_type,
    reason: row.reason,
  };
}

export async function saveAvailabilityRule(
  client: SupabaseClient,
  listingId: string,
  value: AvailabilityRuleInput,
): Promise<AvailabilityRule> {
  const actor = await getActor(client);
  await requireOwnedTutor(client, actor, listingId);
  const input = parseAvailabilityRuleInput(value);
  const values = {
    tutor_id: listingId,
    weekday: input.weekday,
    local_start: input.localStart,
    local_end: input.localEnd,
    timezone: input.timezone,
    valid_from: input.validFrom,
    valid_until: input.validUntil,
    active: input.active,
  };
  const query = input.id
    ? client.from("availability_rules").update(values).eq("id", input.id).eq("tutor_id", listingId)
    : client.from("availability_rules").insert(values);
  const { data, error } = await query.select(RULE_FIELDS).single<RuleRow>();
  if (error || !data) {
    if (error)
      failDatabase(error, "availability", "That rule overlaps another rule or conflicts with a reserved session.");
    throw new DomainError("unavailable");
  }
  return mapRule(data);
}

export async function deleteAvailabilityRule(client: SupabaseClient, listingId: string, ruleId: string): Promise<void> {
  const actor = await getActor(client);
  await requireOwnedTutor(client, actor, listingId);
  const { data, error } = await client
    .from("availability_rules")
    .delete()
    .eq("id", ruleId)
    .eq("tutor_id", listingId)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error)
    failDatabase(
      error,
      "availability",
      "This availability rule is required by a reserved session and cannot be removed.",
    );
  if (!data) throw new DomainError("forbidden");
}

export async function saveAvailabilityException(
  client: SupabaseClient,
  listingId: string,
  value: AvailabilityExceptionInput,
): Promise<AvailabilityException> {
  const actor = await getActor(client);
  await requireOwnedTutor(client, actor, listingId);
  const input = parseAvailabilityExceptionInput(value);
  const values = {
    tutor_id: listingId,
    local_date: input.localDate,
    local_start: input.localStart,
    local_end: input.localEnd,
    timezone: input.timezone,
    exception_type: input.exceptionType,
    reason: input.reason,
  };
  const query = input.id
    ? client.from("availability_exceptions").update(values).eq("id", input.id).eq("tutor_id", listingId)
    : client.from("availability_exceptions").insert(values);
  const { data, error } = await query.select(EXCEPTION_FIELDS).single<ExceptionRow>();
  if (error || !data) {
    if (error)
      failDatabase(error, "exception", "That exception conflicts with a reserved session or has invalid details.");
    throw new DomainError("unavailable");
  }
  return mapException(data);
}

export async function deleteAvailabilityException(
  client: SupabaseClient,
  listingId: string,
  exceptionId: string,
): Promise<void> {
  const actor = await getActor(client);
  await requireOwnedTutor(client, actor, listingId);
  const { data, error } = await client
    .from("availability_exceptions")
    .delete()
    .eq("id", exceptionId)
    .eq("tutor_id", listingId)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error)
    failDatabase(error, "exception", "This exception conflicts with a reserved session and cannot be removed.");
  if (!data) throw new DomainError("forbidden");
}

async function listPublicTutorFacts(
  client: SupabaseClient,
  tutorIds: string[],
): Promise<Map<string, PublicTutorFactsRow>> {
  if (!tutorIds.length) return new Map();
  const [activity, badges] = await Promise.all([
    client.rpc("list_public_tutor_activity", { tutors: tutorIds }),
    client.rpc("list_public_tutor_badges", { tutors: tutorIds }),
  ]);
  if (activity.error || badges.error || !Array.isArray(activity.data) || !Array.isArray(badges.data))
    throw new DomainError("unavailable");
  const badgeByTutor = new Map(
    (badges.data as Array<{ tutor_id: string; policy_version: number; badges: unknown }>).map((row) => [
      row.tutor_id,
      row,
    ]),
  );
  const facts = new Map(
    (activity.data as Array<{ tutor_id: string; completed_session_count: number; recommended_count: number }>).map(
      (row): [string, PublicTutorFactsRow] => {
        const badge = badgeByTutor.get(row.tutor_id);
        if (!badge || !Array.isArray(badge.badges)) throw new DomainError("unavailable");
        return [
          row.tutor_id,
          {
            ...row,
            badge_policy_version: badge.policy_version,
            badges: badge.badges as FactualTutorBadge[],
          },
        ];
      },
    ),
  );
  if (tutorIds.some((tutorId) => !facts.has(tutorId))) throw new DomainError("unavailable");
  return facts;
}

/** Shows own private listing reputation against the published factual policy, even while the listing is paused. */
export async function readOwnTutorBadgeProgress(client: SupabaseClient): Promise<TutorBadgeProgress | null> {
  const actor = await getActor(client);
  requireRole(actor, "tutor");
  const { data, error } = await client.rpc("read_own_tutor_badge_progress");
  if (error) {
    if (error?.code === PgErrorCode.insufficientPrivilege) throw new DomainError("forbidden");
    throw new DomainError("unavailable");
  }
  if (!Array.isArray(data)) throw new DomainError("unavailable");
  if (!data[0]) return null;
  const row = data[0] as {
    tutor_id: string;
    policy_version: number;
    completed_sessions: number | string;
    visible_reviews: number | string;
    rating_average: number | string | null;
    recommendations: number | string;
    thresholds: unknown;
  };
  if (!Array.isArray(row.thresholds)) throw new DomainError("unavailable");
  return {
    tutorId: row.tutor_id,
    policyVersion: row.policy_version,
    facts: {
      completed_sessions: Number(row.completed_sessions),
      visible_reviews: Number(row.visible_reviews),
      rating_average: row.rating_average === null ? null : Number(row.rating_average),
      recommendations: Number(row.recommendations),
    },
    thresholds: row.thresholds as TutorBadgeProgress["thresholds"],
  };
}

function publicCardFromSearch(
  row: SearchRow,
  offerings: TutorOffering[],
  facts: PublicTutorFactsRow,
  availableAt?: string,
) {
  const card = mapPublicCard(row, offerings, facts);
  return availableAt ? { ...card, openSlotStartsAt: [availableAt] } : card;
}

/**
 * Executes bounded, server-side hard filters. A requested location or exact time is passed through as a required
 * predicate; the service never drops a filter because a coordinate, time policy, or query field is unavailable.
 */
export async function searchTutors(client: SupabaseClient, value: TutorSearchFilters): Promise<TutorSearchPage> {
  const filters = parseTutorSearchFilters(value);
  const { data, error } = await client.rpc("list_public_tutors_v3", {
    search_query: filters.query ?? null,
    subject: filters.subjectId ?? null,
    requested_mode: filters.mode ?? null,
    min_rate: filters.minHourlyRateMinor ?? null,
    max_rate: filters.maxHourlyRateMinor ?? null,
    budget_currency: filters.budgetCurrency,
    min_rating: filters.minimumRating ?? null,
    language_tags: filters.languageTags ?? [],
    search_latitude: filters.near?.latitude ?? null,
    search_longitude: filters.near?.longitude ?? null,
    max_distance_km: filters.near?.radiusKm ?? null,
    available_at: filters.availableAt ?? null,
    duration_minutes: filters.durationMinutes ?? null,
    sort_by: filters.sort,
    page_size: filters.pageSize + 1,
    page_offset: (filters.page - 1) * filters.pageSize,
  });
  if (error || !Array.isArray(data)) {
    if (error)
      failDatabase(
        error,
        "filters",
        "Some search filters were not accepted. Check the location, rate or availability window.",
      );
    throw new DomainError("unavailable");
  }
  const rows = data as SearchRow[];
  const pageRows = rows.slice(0, filters.pageSize);
  const facts = await listPublicTutorFacts(
    client,
    pageRows.map((row) => row.id),
  );
  const cards = await Promise.all(
    pageRows.map(async (row) => {
      const offers = await listPublicOfferings(client, row.id);
      const activity = facts.get(row.id);
      if (!activity) throw new DomainError("unavailable");
      return publicCardFromSearch(row, offers, activity, filters.availableAt);
    }),
  );
  return {
    items: cards,
    page: filters.page,
    pageSize: filters.pageSize,
    hasMore: rows.length > filters.pageSize,
  };
}

function selectedText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new InputError({ [field]: "Enter a short text value." });
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maximum || /[\x00-\x1f\x7f]/.test(cleaned))
    throw new InputError({ [field]: `Use 1 to ${maximum} characters.` });
  return cleaned;
}

function formatMinor(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(
      value / 100,
    );
  } catch {
    return `${currency} ${(value / 100).toFixed(2)}`;
  }
}

function validateMatchInput(
  value: TutorMatchInput,
): TutorMatchInput & Required<Pick<TutorMatchInput, "page" | "pageSize" | "preferredStrategies" | "budgetCurrency">> {
  if (!value || typeof value !== "object") throw new InputError({ matching: "Enter matching criteria." });
  const checked = parseTutorSearchFilters({
    subjectId: value.subjectId,
    mode: value.mode,
    maxHourlyRateMinor: value.maxHourlyRateMinor,
    budgetCurrency: value.budgetCurrency ?? "USD",
    languageTags: value.languageTags,
    near: value.location,
    availableAt: value.availableAt,
    durationMinutes: value.durationMinutes,
    page: 1,
    pageSize: 50,
    sort: "relevance",
  });
  if (
    !checked.subjectId ||
    !checked.mode ||
    checked.maxHourlyRateMinor === undefined ||
    !checked.availableAt ||
    !checked.durationMinutes
  ) {
    throw new InputError({ matching: "Subject, mode, budget and an exact available time are required." });
  }
  const preferredStrategies = normalizeTeachingMethodPreferences(value.preferredStrategies);
  const page = value.page === undefined ? 1 : value.page;
  const pageSize = value.pageSize === undefined ? 12 : value.pageSize;
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
    throw new InputError({ page: "Choose a valid result page." });
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50)
    throw new InputError({ pageSize: "Show between 1 and 50 results." });
  const topic = selectedText(value.topic, "topic", 120);
  const level = selectedText(value.level, "level", 80);
  const learningGoal = selectedText(value.learningGoal, "learningGoal", 200);
  return {
    subjectId: checked.subjectId,
    mode: checked.mode,
    maxHourlyRateMinor: checked.maxHourlyRateMinor,
    budgetCurrency: checked.budgetCurrency,
    availableAt: checked.availableAt,
    durationMinutes: checked.durationMinutes,
    ...(checked.near ? { location: checked.near } : {}),
    ...(checked.languageTags ? { languageTags: checked.languageTags } : {}),
    preferredStrategies,
    ...(topic ? { topic } : {}),
    ...(level ? { level } : {}),
    ...(learningGoal ? { learningGoal } : {}),
    page,
    pageSize,
  };
}

async function readPublicFactorVersion(client: SupabaseClient): Promise<FactorVersionRow> {
  const { data, error } = await client.rpc("read_matching_factor_version");
  if (error || !data) throw new DomainError("unavailable");
  const row = (Array.isArray(data) ? data[0] : data) as FactorVersionRow | undefined;
  if (!row || !Number.isSafeInteger(row.version) || !Array.isArray(row.factors)) throw new DomainError("unavailable");
  if (row.factors.some((factor) => !Number.isFinite(factor.weight) || factor.weight < 0 || factor.weight > 1))
    throw new DomainError("unavailable");
  return row;
}

/** Applies hard filters in the database first, then ranks only eligible public cards with a versioned factor set. */
export async function matchTutors(client: SupabaseClient, value: TutorMatchInput): Promise<TutorMatchPage> {
  const actor = await getActor(client);
  requireRole(actor, "student");
  const input = validateMatchInput(value);
  const selfTutorIds = new Set<string>();
  if (hasRole(actor, "tutor")) {
    const { data: owned, error } = await client.from("tutor_profiles").select("id").eq("user_id", actor.id).limit(10);
    if (error) throw new DomainError("unavailable");
    for (const row of owned ?? []) selfTutorIds.add(row.id as string);
  }
  const factorsPromise = readPublicFactorVersion(client);
  const candidates: TutorMatchCandidate[] = [];
  let upstreamHasMore = false;
  for (let page = 1; page <= 4; page += 1) {
    const result = await searchTutors(client, {
      subjectId: input.subjectId,
      mode: input.mode,
      maxHourlyRateMinor: input.maxHourlyRateMinor,
      budgetCurrency: input.budgetCurrency,
      ...(input.languageTags ? { languageTags: input.languageTags } : {}),
      availableAt: input.availableAt,
      durationMinutes: input.durationMinutes,
      ...(input.location ? { near: input.location } : {}),
      sort: "relevance",
      page,
      pageSize: 50,
    });
    candidates.push(...result.items);
    if (!result.hasMore) break;
    if (page === 4) upstreamHasMore = true;
  }
  const factorVersion = await factorsPromise;
  const hardEligible = explainTutorMatches(
    candidates.filter((candidate) => !selfTutorIds.has(candidate.id)),
    {
      subjectId: input.subjectId,
      mode: input.mode,
      maxHourlyRateMinor: input.maxHourlyRateMinor,
      budgetCurrency: input.budgetCurrency,
      ...(input.languageTags ? { languageTags: input.languageTags } : {}),
      ...(input.location ? { location: input.location } : {}),
      startAt: input.availableAt,
    },
  ).filter((item) => item.eligible);
  const activeFactors = factorVersion.factors.filter((factor) => factor.active);
  const weightTotal = activeFactors.reduce((sum, factor) => sum + factor.weight, 0);
  if (weightTotal <= 0) throw new DomainError("unavailable");
  const ranked: RankedTutorMatch[] = sortRankedTutorMatches(
    hardEligible.map((result) => {
      const tutor = result.tutor;
      const offering = tutor.offerings.find((item) => item.subjectId === input.subjectId);
      if (!offering || offering.hourlyRateMinor === null) throw new DomainError("unavailable");
      const factors: RankedTutorMatch["factors"] = [];
      const content = `${tutor.headline}\n${tutor.bio}`.toLocaleLowerCase("en-US");
      for (const factor of activeFactors) {
        let score: number | null = null;
        let fact: string | null = null;
        let rationale = "No public evidence was available, so this factor was not applied.";
        if (factor.key === "rate_fit") {
          score = Math.max(
            0,
            Math.min(1, (input.maxHourlyRateMinor - offering.hourlyRateMinor) / input.maxHourlyRateMinor),
          );
          fact = `Rate ${formatMinor(offering.hourlyRateMinor, input.budgetCurrency)} is within budget ${formatMinor(input.maxHourlyRateMinor, input.budgetCurrency)}.`;
          rationale = "The listed subject rate is within the selected maximum.";
        } else if (factor.key === "teaching_preference" && input.preferredStrategies.length) {
          const methodScore = scoreTeachingMethods(content, input.preferredStrategies);
          score = methodScore.score;
          fact = methodScore.fact;
          rationale = methodScore.matches.length
            ? "This public profile explicitly mentions a selected teaching preference."
            : "No public profile phrase matched the selected preference.";
        } else if (factor.key === "rating" && tutor.ratingAverage !== null && tutor.ratingCount > 0) {
          score = tutor.ratingAverage / 5;
          fact = `${tutor.ratingAverage.toFixed(2)} average from ${tutor.ratingCount} visible reviews.`;
          rationale = "Uses the public, moderation-filtered review aggregate.";
        } else if (factor.key === "experience") {
          score = Math.min(tutor.experienceYears / 10, 1);
          fact = `${tutor.experienceYears} years listed as tutor experience.`;
          rationale = "Uses the tutor's public self-reported experience field.";
        } else if (factor.key === "completed_sessions") {
          score = Math.min(tutor.completedSessionCount / 20, 1);
          fact = `${tutor.completedSessionCount} completed platform sessions.`;
          rationale = "Counts booking records that reached completed status; it is not an external credential.";
        }
        const applied = score !== null;
        factors.push({
          key: factor.key as RankedTutorMatch["factors"][number]["key"],
          label: factor.label,
          weight: factor.weight,
          score: score ?? 0,
          fact,
          rationale,
          applied,
        });
      }
      const usedWeight = factors.reduce((sum, factor) => sum + (factor.applied ? factor.weight : 0), 0);
      const score =
        usedWeight === 0
          ? 0
          : factors.reduce((sum, factor) => sum + (factor.applied ? factor.weight * factor.score : 0), 0) / usedWeight;
      const subjectName = offering.name;
      const eligibilityFacts = [
        `Listed for ${subjectName}.`,
        `Supports ${input.mode} tutoring.`,
        `Hourly rate ${formatMinor(offering.hourlyRateMinor, input.budgetCurrency)} is within selected maximum ${formatMinor(input.maxHourlyRateMinor, input.budgetCurrency)}.`,
        `Available at ${input.availableAt} for ${input.durationMinutes} minutes.`,
        ...(input.location && tutor.distanceKm !== null
          ? [`${tutor.distanceKm.toFixed(1)} km away, within ${input.location.radiusKm} km.`]
          : []),
      ];
      return { ...result, score, factors, factorVersion: factorVersion.version, eligibilityFacts };
    }),
  );
  const start = (input.page - 1) * input.pageSize;
  const end = start + input.pageSize;
  return {
    items: ranked.slice(start, end),
    factorVersion: factorVersion.version,
    page: input.page,
    pageSize: input.pageSize,
    hasMore: upstreamHasMore || ranked.length > end,
  };
}

/** Reads one currently public listing; private profile, contact, account, and learning fields are never selected. */
export async function getPublicTutor(client: SupabaseClient, tutorId: string): Promise<PublicTutorDetail | null> {
  const { data, error } = await client
    .from("public_tutor_snapshots")
    .select(PUBLIC_FIELDS)
    .eq("id", tutorId)
    .maybeSingle<Omit<PublicRow, "rating_count" | "rating_average" | "distance_km">>();
  if (error) throw new DomainError("unavailable");
  if (!data) return null;
  const [offerings, summary, reviewRows, rules, exceptions, activityMap] = await Promise.all([
    listPublicOfferings(client, tutorId),
    client
      .from("tutor_rating_summaries")
      .select("rating_count,rating_avg,recommendation_count")
      .eq("tutor_id", tutorId)
      .maybeSingle<{
        rating_count: number;
        rating_avg: number | string | null;
        recommendation_count: number;
      }>(),
    client.rpc("list_public_tutor_reviews", { tutor: tutorId }),
    client.rpc("list_public_tutor_availability", { tutor: tutorId }),
    client.rpc("list_public_tutor_exceptions", {
      tutor: tutorId,
      from_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      to_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    }),
    listPublicTutorFacts(client, [tutorId]),
  ]);
  if (summary.error || reviewRows.error || rules.error || exceptions.error) throw new DomainError("unavailable");
  const activity = activityMap.get(tutorId);
  if (!activity) throw new DomainError("unavailable");
  const card = mapPublicCard(
    {
      ...data,
      rating_count: summary.data?.rating_count ?? 0,
      rating_average: summary.data?.rating_avg ?? null,
      distance_km: null,
    },
    offerings,
    { ...activity, recommended_count: summary.data?.recommendation_count ?? activity.recommended_count },
  );
  const publicRules = (
    (rules.data ?? []) as Array<
      Omit<AvailabilityRule, "id" | "tutorId" | "active"> & {
        local_start: string;
        local_end: string;
        valid_from: string;
        valid_until: string | null;
      }
    >
  ).map((rule): PublicAvailabilityRule => ({
    weekday: rule.weekday,
    localStart: rule.local_start,
    localEnd: rule.local_end,
    timezone: rule.timezone,
    validFrom: rule.valid_from,
    validUntil: rule.valid_until,
  }));
  const publicExceptions = (
    (exceptions.data ?? []) as Array<{
      local_date: string;
      local_start: string | null;
      local_end: string | null;
      timezone: string;
      exception_type: AvailabilityException["exceptionType"];
    }>
  ).map((exception): PublicAvailabilityException => ({
    localDate: exception.local_date,
    localStart: exception.local_start,
    localEnd: exception.local_end,
    timezone: exception.timezone,
    exceptionType: exception.exception_type,
  }));
  const reviews: PublicTutorReview[] = ((reviewRows.data ?? []) as ReviewRow[]).map((review) => ({
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    recommended: review.recommended,
    createdAt: review.created_at,
  }));
  return { ...card, reviews, availabilityRules: publicRules, availabilityExceptions: publicExceptions };
}

const TUTOR_PROFILE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Save a currently published tutor; the database enforces Student role, no self-save and idempotency. */
export async function saveTutor(client: SupabaseClient, tutorProfileId: string): Promise<void> {
  const actor = await getActor(client);
  requireRole(actor, "student");
  if (typeof tutorProfileId !== "string" || !TUTOR_PROFILE_UUID.test(tutorProfileId))
    throw new InputError({ tutorProfileId: "Choose a valid tutor." });
  const { error } = await client.rpc("save_public_tutor", { tutor: tutorProfileId.toLowerCase() });
  if (error) failDatabase(error, "tutorProfileId", "Choose a currently published tutor.");
}

/** Remove only the current Student's bookmark; repeated removal is safe. */
export async function unsaveTutor(client: SupabaseClient, tutorProfileId: string): Promise<void> {
  const actor = await getActor(client);
  requireRole(actor, "student");
  if (typeof tutorProfileId !== "string" || !TUTOR_PROFILE_UUID.test(tutorProfileId))
    throw new InputError({ tutorProfileId: "Choose a valid tutor." });
  const { error } = await client.rpc("unsave_tutor", { tutor: tutorProfileId.toLowerCase() });
  if (error) failDatabase(error, "tutorProfileId", "The saved tutor could not be removed.");
}

/** Re-reads current public snapshots and reputation. Stale bookmarks for unpublished listings are omitted. */
export async function listSavedTutors(client: SupabaseClient): Promise<PublicTutorCard[]> {
  const actor = await getActor(client);
  requireRole(actor, "student");
  const { data: saved, error: savedError } = await client
    .from("saved_tutors")
    .select("tutor_profile_id,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (savedError) throw new DomainError("unavailable");
  const savedIds = (saved ?? []).map((row) => (row as { tutor_profile_id: string }).tutor_profile_id);
  if (!savedIds.length) return [];
  const { data: snapshots, error: snapshotError } = await client
    .from("public_tutor_snapshots")
    .select(PUBLIC_FIELDS)
    .in("id", savedIds)
    .limit(50);
  if (snapshotError) throw new DomainError("unavailable");
  const rows = (snapshots ?? []) as Array<Omit<PublicRow, "rating_count" | "rating_average" | "distance_km">>;
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [summaries, facts, offeringResult] = await Promise.all([
    client
      .from("tutor_rating_summaries")
      .select("tutor_id,rating_count,rating_avg,recommendation_count")
      .in("tutor_id", ids),
    listPublicTutorFacts(client, ids),
    client.rpc("list_public_tutor_subjects_batch", { tutors: ids }),
  ]);
  if (summaries.error || offeringResult.error || !Array.isArray(offeringResult.data))
    throw new DomainError("unavailable");
  const offeringsByTutor = new Map<string, TutorOffering[]>();
  for (const row of offeringResult.data as PublicOfferingBatchRow[]) {
    const offerings = offeringsByTutor.get(row.tutor_id) ?? [];
    offerings.push(toPublicOffering(row));
    offeringsByTutor.set(row.tutor_id, offerings);
  }
  const summaryById = new Map(
    (
      (summaries.data ?? []) as Array<{
        tutor_id: string;
        rating_count: number;
        rating_avg: number | string | null;
        recommendation_count: number;
      }>
    ).map((row) => [row.tutor_id, row]),
  );
  return rows.map((row) => {
    const activity = facts.get(row.id);
    if (!activity) throw new DomainError("unavailable");
    const summary = summaryById.get(row.id);
    const offerings = offeringsByTutor.get(row.id) ?? [];
    return mapPublicCard(
      {
        ...row,
        rating_count: summary?.rating_count ?? 0,
        rating_average: summary?.rating_avg ?? null,
        distance_km: null,
      },
      offerings,
      { ...activity, recommended_count: summary?.recommendation_count ?? activity.recommended_count },
    );
  });
}

/** Read access is participant-only through the database policy and checked again against the current actor. */
export async function readBookingPrivateDetails(
  client: SupabaseClient,
  bookingId: string,
): Promise<BookingPrivateDetails | null> {
  const actor = await getActor(client);
  if (!hasRole(actor, "student") && !hasRole(actor, "tutor")) throw new DomainError("forbidden");
  const { data: booking, error: bookingError } = await client
    .from("bookings")
    .select("id,student_id,tutor_id")
    .eq("id", bookingId)
    .maybeSingle<{ id: string; student_id: string; tutor_id: string }>();
  if (bookingError) throw new DomainError("unavailable");
  if (!booking) throw new DomainError("forbidden");
  if (booking.student_id !== actor.id) {
    const { data: ownTutor } = await client
      .from("tutor_profiles")
      .select("id")
      .eq("id", booking.tutor_id)
      .eq("user_id", actor.id)
      .maybeSingle<{ id: string }>();
    if (!hasRole(actor, "tutor") || !ownTutor) throw new DomainError("forbidden");
  }
  const { data, error } = await client
    .from("booking_private_details")
    .select(PRIVATE_DETAILS_FIELDS)
    .eq("booking_id", bookingId)
    .maybeSingle<{
      booking_id: string;
      meeting_url: string | null;
      meeting_place: string | null;
      created_at: string;
      updated_at: string;
    }>();
  if (error) throw new DomainError("unavailable");
  return data
    ? {
        bookingId: data.booking_id,
        meetingUrl: data.meeting_url,
        meetingPlace: data.meeting_place,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      }
    : null;
}

/** Only the booked Tutor can edit private meeting coordinates/links; the DB write policy enforces this independently. */
export async function saveBookingPrivateDetails(
  client: SupabaseClient,
  bookingId: string,
  value: SaveBookingPrivateDetailsInput,
): Promise<BookingPrivateDetails> {
  const actor = await getActor(client);
  requireRole(actor, "tutor");
  const input = parseBookingPrivateDetailsInput(value);
  const { data: booking, error: bookingError } = await client
    .from("bookings")
    .select("id,tutor_id")
    .eq("id", bookingId)
    .maybeSingle<{ id: string; tutor_id: string }>();
  if (bookingError) throw new DomainError("unavailable");
  if (!booking) throw new DomainError("forbidden");
  await requireOwnedTutor(client, actor, booking.tutor_id);
  const { error } = await client.rpc("save_booking_private_details", {
    booking: bookingId,
    meeting_url: input.meetingUrl,
    meeting_place: input.meetingPlace,
  });
  if (error) failDatabase(error, "meeting", "Only the booked tutor can save secure meeting details.");
  const saved = await readBookingPrivateDetails(client, bookingId);
  if (!saved) throw new DomainError("unavailable");
  return saved;
}

/** Atomically replaces an unpaid, unprepared hold; any failure leaves the original booking intact. */
export async function rescheduleBooking(
  client: SupabaseClient,
  value: RescheduleBookingInput,
): Promise<RescheduledBooking> {
  const actor = await getActor(client);
  requireRole(actor, "student");
  const input = parseRescheduleInput(value);
  const { data: id, error } = await client.rpc("reschedule_booking_v2", {
    booking: input.bookingId,
    tutor: input.tutorId,
    subject: input.subjectId,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    mode: input.mode,
    request_key: input.requestKey,
    confirmed_move: input.confirmedMove,
    reason: input.reason,
  });
  if (error)
    failDatabase(error, "startsAt", "That booking cannot be rescheduled. Check the requested slot and try again.");
  if (typeof id !== "string") throw new DomainError("unavailable");
  const { data, error: readError } = await client
    .from("bookings")
    .select("id,student_id,tutor_id,subject_id,starts_at,ends_at,mode,price_minor,currency,status")
    .eq("id", id)
    .single<{
      id: string;
      student_id: string;
      tutor_id: string;
      subject_id: string;
      starts_at: string;
      ends_at: string;
      mode: "virtual" | "in_person";
      price_minor: number;
      currency: string;
      status: string;
    }>();
  if (readError || !data) throw new DomainError("unavailable");
  if (data.student_id !== actor.id) throw new DomainError("forbidden");
  return {
    id: data.id,
    studentId: data.student_id,
    tutorId: data.tutor_id,
    subjectId: data.subject_id,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    mode: data.mode,
    priceMinor: Number(data.price_minor),
    currency: data.currency,
    status: data.status,
  };
}

/** Reads the append-only old/new interval audit for a booking participant. */
export async function listBookingRescheduleHistory(
  client: SupabaseClient,
  bookingId: string,
): Promise<BookingRescheduleHistory[]> {
  const actor = await getActor(client);
  if (!hasRole(actor, "student") && !hasRole(actor, "tutor")) throw new DomainError("forbidden");
  const target = typeof bookingId === "string" && /^[0-9a-f-]{36}$/i.test(bookingId) ? bookingId : null;
  if (!target) throw new InputError({ bookingId: "Choose a valid booking." });
  const { data, error } = await client
    .from("booking_reschedule_history")
    .select(
      "id,booking_id,actor_id,old_starts_at,old_ends_at,new_starts_at,new_ends_at,reason,booking_version,created_at",
    )
    .eq("booking_id", target)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) failDatabase(error, "bookingId", "This booking history is unavailable.");
  return (
    (data ?? []) as Array<{
      id: string;
      booking_id: string;
      actor_id: string;
      old_starts_at: string;
      old_ends_at: string;
      new_starts_at: string;
      new_ends_at: string;
      reason: string;
      booking_version: number;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    bookingId: row.booking_id,
    actorId: row.actor_id,
    oldStartsAt: row.old_starts_at,
    oldEndsAt: row.old_ends_at,
    newStartsAt: row.new_starts_at,
    newEndsAt: row.new_ends_at,
    reason: row.reason,
    bookingVersion: row.booking_version,
    createdAt: row.created_at,
  }));
}
