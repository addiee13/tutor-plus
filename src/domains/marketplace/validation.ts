import { InputError } from "../shared/errors";
import type {
  AvailabilityExceptionInput,
  AvailabilityRuleInput,
  SaveLearningProfileInput,
  SaveTutorLanguagesInput,
  TutorListingInput,
  TutorSearchFilters,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/;

function fail(field: string, message: string): never {
  throw new InputError({ [field]: message });
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(field, "Enter valid details.");
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, maximum: number, required = false): string | null {
  if (value === null || value === undefined || value === "") {
    if (required) fail(field, "This field is required.");
    return null;
  }
  if (typeof value !== "string") fail(field, "Enter text.");
  const cleaned = value.replace(/\r\n?/g, "\n").trim();
  if ((required && !cleaned) || cleaned.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(cleaned)) {
    fail(field, required ? `Use 1 to ${maximum} characters.` : `Use at most ${maximum} characters.`);
  }
  return cleaned || null;
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(field, `Enter a whole number from ${minimum} to ${maximum}.`);
  }
  return value;
}

function optionalInteger(value: unknown, field: string, minimum: number, maximum: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  return integer(value, field, minimum, maximum);
}

function optionalDecimal(value: unknown, field: string, minimum: number, maximum: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(field, `Enter a number greater than ${minimum === 0 ? "or equal to 0" : "0"} and at most ${maximum}.`);
  }
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(field, "Choose an option.");
  return value;
}

function uuid(value: unknown, field: string, optional = false): string | undefined {
  if ((value === undefined || value === null || value === "") && optional) return undefined;
  if (typeof value !== "string" || !UUID.test(value)) fail(field, "Choose a valid item.");
  return value.toLowerCase();
}

function validDate(value: unknown, field: string, optional = false): string | null {
  if ((value === undefined || value === null || value === "") && optional) return null;
  if (typeof value !== "string") fail(field, "Enter a valid date.");
  const match = DATE.exec(value);
  if (!match) fail(field, "Enter a valid date.");
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.toISOString().slice(0, 10) !== value) fail(field, "Enter a real calendar date.");
  return value;
}

function validTime(value: unknown, field: string, optional = false): string | null {
  if ((value === undefined || value === null || value === "") && optional) return null;
  if (typeof value !== "string") fail(field, "Enter a valid local time.");
  const match = TIME.exec(value);
  if (!match) fail(field, "Enter a valid local time.");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) fail(field, "Enter a valid local time.");
  return `${match[1]}:${match[2]}:${match[3] ?? "00"}${match[4] ? `.${match[4]}` : ""}`;
}

function timezone(value: unknown, field = "timezone"): string {
  if (typeof value !== "string" || value.length > 100 || !value.trim()) fail(field, "Choose an IANA time zone.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).format(0);
  } catch {
    fail(field, "Choose an IANA time zone.");
  }
  return value.trim();
}

function utcInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)) {
    fail(field, "Enter a date and time in UTC.");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) fail(field, "Enter a valid date and time.");
  const normalized = new Date(timestamp).toISOString();
  const components = value.slice(0, 19);
  if (new Date(`${components}Z`).toISOString().slice(0, 19) !== components)
    fail(field, "Enter a real calendar date and time.");
  return normalized;
}

function location(value: unknown): { latitude: number; longitude: number } | null {
  if (value === undefined || value === null) return null;
  const input = record(value, "location");
  const latitude = input.latitude;
  const longitude = input.longitude;
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    fail("location", "Enter approximate coordinates within the valid latitude and longitude ranges.");
  }
  return { latitude, longitude };
}

export function parseTutorListingInput(value: unknown): TutorListingInput {
  const input = record(value, "listing");
  const listingId = uuid(input.listingId, "listingId", true);
  const expectedVersion = optionalInteger(input.expectedVersion, "expectedVersion", 1, 1000000000);
  if (listingId && expectedVersion === null)
    fail("expectedVersion", "Refresh this listing before saving your changes.");
  if (!listingId && expectedVersion !== null)
    fail("expectedVersion", "A version is only accepted when updating an existing listing.");
  const publicDisplayName = text(input.publicDisplayName, "publicDisplayName", 100, true) as string;
  const publicAvatarUrl = text(input.publicAvatarUrl, "publicAvatarUrl", 500);
  if (publicAvatarUrl && !/^https:\/\//i.test(publicAvatarUrl))
    fail("publicAvatarUrl", "Use a secure HTTPS image URL.");
  const headline = text(input.headline, "headline", 200, true) as string;
  const bio = text(input.bio, "bio", 4000, true) as string;
  const credentialsText = text(input.credentialsText, "credentialsText", 2000);
  const experienceYears = integer(input.experienceYears, "experienceYears", 0, 80);
  const hourlyRateMinor = optionalInteger(input.hourlyRateMinor, "hourlyRateMinor", 1, 100_000_000);
  const currencyValue = input.currency === undefined ? "USD" : input.currency;
  if (typeof currencyValue !== "string" || !/^[A-Z]{3}$/.test(currencyValue))
    fail("currency", "Use a three-letter uppercase currency code.");
  const supportsVirtual = boolean(input.supportsVirtual, "supportsVirtual");
  const supportsInPerson = boolean(input.supportsInPerson, "supportsInPerson");
  if (!supportsVirtual && !supportsInPerson) fail("supportsVirtual", "Offer at least one tutoring mode.");
  const serviceAreaLabel = text(input.serviceAreaLabel, "serviceAreaLabel", 200);
  const approximateLocation = location(input.location);
  const serviceRadiusKm = optionalDecimal(input.serviceRadiusKm, "serviceRadiusKm", 0.01, 1000);
  if (!Array.isArray(input.offerings) || input.offerings.length > 100) fail("offerings", "Choose up to 100 subjects.");
  const seen = new Set<string>();
  const offerings = input.offerings.map((value, index) => {
    const item = record(value, `offerings.${index}`);
    const subjectId = uuid(item.subjectId, `offerings.${index}.subjectId`) as string;
    if (seen.has(subjectId)) fail("offerings", "Each subject can be selected once.");
    seen.add(subjectId);
    const expertise = text(item.expertise, `offerings.${index}.expertise`, 1000);
    const rateOverrideMinor = optionalInteger(
      item.rateOverrideMinor,
      `offerings.${index}.rateOverrideMinor`,
      1,
      100_000_000,
    );
    return { subjectId, expertise, rateOverrideMinor };
  });

  return {
    ...(listingId ? { listingId } : {}),
    ...(expectedVersion !== null ? { expectedVersion } : {}),
    publicDisplayName,
    publicAvatarUrl,
    headline,
    bio,
    credentialsText,
    experienceYears,
    hourlyRateMinor,
    currency: currencyValue,
    supportsVirtual,
    supportsInPerson,
    serviceAreaLabel,
    location: approximateLocation,
    serviceRadiusKm: serviceRadiusKm ?? (typeof input.serviceRadiusKm === "number" ? input.serviceRadiusKm : null),
    offerings,
  };
}

export function parseTutorLanguagesInput(value: unknown): SaveTutorLanguagesInput {
  const input = record(value, "languages");
  const listingId = uuid(input.listingId, "listingId") as string;
  const expectedVersion = integer(input.expectedVersion, "expectedVersion", 1, 1_000_000_000);
  if (!Array.isArray(input.languages) || input.languages.length > 20) {
    fail("languages", "Choose up to 20 languages.");
  }
  const languages = input.languages.map((raw, index) => {
    const value = text(raw, `languages.${index}`, 10, true) as string;
    if (!/^[a-z]{2,3}(?:-(?:[A-Z]{2}|[A-Z][a-z]{3}))?$/.test(value)) {
      fail(`languages.${index}`, "Use a language tag such as en, es, en-US or zh-Hans.");
    }
    return value;
  });
  if (new Set(languages.map((language) => language.toLowerCase())).size !== languages.length) {
    fail("languages", "Remove duplicate languages.");
  }
  return { listingId, expectedVersion, languages };
}

export function parseAvailabilityRuleInput(value: unknown): AvailabilityRuleInput {
  const input = record(value, "availability");
  const id = uuid(input.id, "id", true);
  const weekday = integer(input.weekday, "weekday", 0, 6);
  const localStart = validTime(input.localStart, "localStart") as string;
  const localEnd = validTime(input.localEnd, "localEnd") as string;
  if (localStart >= localEnd)
    fail("localEnd", "End time must be later than start time. Split overnight hours across two days.");
  const timezoneValue = timezone(input.timezone);
  const validFrom = validDate(input.validFrom, "validFrom") as string;
  const validUntil = validDate(input.validUntil, "validUntil", true);
  if (validUntil && validUntil < validFrom) fail("validUntil", "End date cannot be before start date.");
  const active = boolean(input.active, "active");
  return {
    ...(id ? { id } : {}),
    weekday,
    localStart,
    localEnd,
    timezone: timezoneValue,
    validFrom,
    validUntil,
    active,
  };
}

export function parseAvailabilityExceptionInput(value: unknown): AvailabilityExceptionInput {
  const input = record(value, "exception");
  const id = uuid(input.id, "id", true);
  const localDate = validDate(input.localDate, "localDate") as string;
  const localStart = validTime(input.localStart, "localStart", true);
  const localEnd = validTime(input.localEnd, "localEnd", true);
  if (
    (localStart === null) !== (localEnd === null) ||
    (localStart !== null && localEnd !== null && localStart >= localEnd)
  ) {
    fail("localEnd", "Enter an ordered start and end time, or leave both blank for a full-day block.");
  }
  if (input.exceptionType !== "unavailable" && input.exceptionType !== "additional") {
    fail("exceptionType", "Choose unavailable or additional time.");
  }
  if (input.exceptionType === "additional" && localStart === null) {
    fail("localStart", "Additional availability needs a start and end time.");
  }
  if (input.exceptionType === "unavailable" && localStart === null && localEnd === null) {
    // The schema represents this as a full-day exception.
  }
  const reason = text(input.reason, "reason", 500);
  return {
    ...(id ? { id } : {}),
    localDate,
    localStart,
    localEnd,
    timezone: timezone(input.timezone),
    exceptionType: input.exceptionType,
    reason,
  };
}

export function parseLearningProfileInput(value: unknown): SaveLearningProfileInput {
  const input = record(value, "profile");
  const displayName = text(input.displayName, "displayName", 100, true) as string;
  const bio = text(input.bio, "bio", 4000);
  const city = text(input.city, "city", 100);
  const region = text(input.region, "region", 100);
  const postalCode = text(input.postalCode, "postalCode", 20);
  const countryCode = text(input.countryCode, "countryCode", 2);
  if (countryCode !== null && !/^[A-Z]{2}$/.test(countryCode))
    fail("countryCode", "Use a two-letter uppercase country code.");
  const preferencesValue = input.learningPreferences === undefined ? {} : input.learningPreferences;
  if (preferencesValue === null || typeof preferencesValue !== "object" || Array.isArray(preferencesValue)) {
    fail("learningPreferences", "Learning preferences must be an object.");
  }
  let preferences: Record<string, unknown>;
  let serialized: string;
  try {
    preferences = JSON.parse(JSON.stringify(preferencesValue)) as Record<string, unknown>;
    serialized = JSON.stringify(preferences);
  } catch {
    fail("learningPreferences", "Enter valid learning preferences.");
  }
  if (new TextEncoder().encode(serialized).byteLength > 4096)
    fail("learningPreferences", "Keep learning preferences under 4 KB.");
  let interests: string[] | undefined;
  if (input.interests !== undefined) {
    if (!Array.isArray(input.interests) || input.interests.length > 20) {
      fail("interests", "Choose up to 20 learning interests.");
    }
    interests = input.interests.map((interest, index) => {
      const parsed = text(interest, `interests.${index}`, 80, true) as string;
      return parsed;
    });
    if (new Set(interests.map((interest) => interest.toLocaleLowerCase("en-US"))).size !== interests.length) {
      fail("interests", "Remove duplicate learning interests.");
    }
  }
  let preferredMode: SaveLearningProfileInput["preferredMode"];
  if (input.preferredMode !== undefined) {
    if (!["virtual", "in_person", "no_preference"].includes(String(input.preferredMode))) {
      fail("preferredMode", "Choose virtual, in-person or no preference.");
    }
    preferredMode = input.preferredMode as NonNullable<SaveLearningProfileInput["preferredMode"]>;
  }
  return {
    displayName,
    bio,
    timezone: timezone(input.timezone),
    city,
    region,
    postalCode,
    countryCode,
    learningPreferences: preferences,
    ...(interests === undefined ? {} : { interests }),
    ...(preferredMode === undefined ? {} : { preferredMode }),
  };
}

export function parseRescheduleInput(value: unknown): {
  bookingId: string;
  tutorId: string;
  subjectId: string;
  startsAt: string;
  endsAt: string;
  mode: "virtual" | "in_person";
  requestKey: string;
  confirmedMove: boolean;
  reason: string | null;
} {
  const input = record(value, "booking");
  const bookingId = uuid(input.bookingId, "bookingId") as string;
  const tutorId = uuid(input.tutorId, "tutorId") as string;
  const subjectId = uuid(input.subjectId, "subjectId") as string;
  const startsAt = utcInstant(input.startsAt, "startsAt");
  const endsAt = utcInstant(input.endsAt, "endsAt");
  if (Date.parse(endsAt) <= Date.parse(startsAt)) fail("endsAt", "End time must be after start time.");
  if (input.mode !== "virtual" && input.mode !== "in_person") fail("mode", "Choose a supported tutoring mode.");
  const requestKey = uuid(input.requestKey, "requestKey") as string;
  const confirmedMove = input.confirmedMove === undefined ? false : boolean(input.confirmedMove, "confirmedMove");
  const reason = text(input.reason, "reason", 500, confirmedMove);
  return { bookingId, tutorId, subjectId, startsAt, endsAt, mode: input.mode, requestKey, confirmedMove, reason };
}

export function parseBookingPrivateDetailsInput(value: unknown): {
  meetingUrl: string | null;
  meetingPlace: string | null;
} {
  const input = record(value, "meeting");
  const meetingUrl = text(input.meetingUrl, "meetingUrl", 1000);
  const meetingPlace = text(input.meetingPlace, "meetingPlace", 1000);
  if (meetingUrl && !/^https:\/\//i.test(meetingUrl)) fail("meetingUrl", "Use a secure HTTPS meeting link.");
  return { meetingUrl, meetingPlace };
}

export function parseTutorSearchFilters(
  value: unknown,
): Required<Pick<TutorSearchFilters, "page" | "pageSize" | "sort" | "budgetCurrency">> & TutorSearchFilters {
  const input = record(value, "filters");
  const query = text(input.query, "query", 120);
  const subjectId = input.subjectId ? uuid(input.subjectId, "subjectId") : undefined;
  const mode = input.mode === undefined || input.mode === "" ? undefined : input.mode;
  if (mode !== undefined && mode !== "virtual" && mode !== "in_person")
    fail("mode", "Choose a supported tutoring mode.");
  const minHourlyRateMinor =
    optionalInteger(input.minHourlyRateMinor, "minHourlyRateMinor", 0, 100_000_000) ?? undefined;
  const maxHourlyRateMinor =
    optionalInteger(input.maxHourlyRateMinor, "maxHourlyRateMinor", 0, 100_000_000) ?? undefined;
  if (minHourlyRateMinor !== undefined && maxHourlyRateMinor !== undefined && minHourlyRateMinor > maxHourlyRateMinor) {
    fail("maxHourlyRateMinor", "Maximum rate must be at least the minimum rate.");
  }
  const budgetCurrency = text(input.budgetCurrency ?? "USD", "budgetCurrency", 3, true) as string;
  if (!/^[A-Z]{3}$/.test(budgetCurrency)) fail("budgetCurrency", "Use a three-letter uppercase currency code.");
  const minimumRating =
    input.minimumRating === undefined || input.minimumRating === null || input.minimumRating === ""
      ? undefined
      : input.minimumRating;
  if (
    minimumRating !== undefined &&
    (typeof minimumRating !== "number" || !Number.isFinite(minimumRating) || minimumRating < 1 || minimumRating > 5)
  ) {
    fail("minimumRating", "Choose a rating from 1 to 5.");
  }
  let near: TutorSearchFilters["near"];
  if (input.near !== undefined && input.near !== null) {
    const point = record(input.near, "near");
    const coordinates = location(point);
    const radius = point.radiusKm;
    if (!coordinates || typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0 || radius > 1000) {
      fail("near", "Provide a valid location and search radius from 0 to 1,000 km.");
    }
    near = { ...coordinates, radiusKm: radius };
  }
  const sort = input.sort === undefined ? "relevance" : input.sort;
  if (!["relevance", "rating", "rate", "name", "distance"].includes(String(sort)))
    fail("sort", "Choose a supported sort order.");
  if (sort === "distance" && !near) fail("sort", "Distance sorting needs a search location.");
  const page = input.page === undefined ? 1 : integer(input.page, "page", 1, 1001);
  const pageSize = input.pageSize === undefined ? 20 : integer(input.pageSize, "pageSize", 1, 50);
  const availableAt =
    input.availableAt === undefined || input.availableAt === null || input.availableAt === ""
      ? undefined
      : utcInstant(input.availableAt, "availableAt");
  const durationMinutes =
    input.durationMinutes === undefined || input.durationMinutes === null || input.durationMinutes === ""
      ? undefined
      : integer(input.durationMinutes, "durationMinutes", 15, 180);
  if ((availableAt === undefined) !== (durationMinutes === undefined)) {
    fail("availableAt", "Choose both a time and session duration to filter for a free slot.");
  }
  let languageTags: string[] | undefined;
  if (input.languageTags !== undefined && input.languageTags !== null) {
    if (!Array.isArray(input.languageTags) || input.languageTags.length > 20) {
      fail("languageTags", "Choose up to 20 languages.");
    }
    languageTags = input.languageTags.map((raw, index) => {
      const language = text(raw, `languageTags.${index}`, 10, true) as string;
      if (!/^[a-z]{2,3}(?:-(?:[A-Z]{2}|[A-Z][a-z]{3}))?$/.test(language)) {
        fail(`languageTags.${index}`, "Use a language tag such as en, es, en-US or zh-Hans.");
      }
      return language;
    });
    if (new Set(languageTags.map((language) => language.toLowerCase())).size !== languageTags.length) {
      fail("languageTags", "Remove duplicate languages.");
    }
  }
  return {
    ...(query ? { query } : {}),
    ...(subjectId ? { subjectId } : {}),
    ...(mode ? { mode } : {}),
    ...(minHourlyRateMinor === undefined ? {} : { minHourlyRateMinor }),
    ...(maxHourlyRateMinor === undefined ? {} : { maxHourlyRateMinor }),
    budgetCurrency,
    ...(minimumRating === undefined ? {} : { minimumRating }),
    ...(languageTags?.length ? { languageTags } : {}),
    ...(near ? { near } : {}),
    ...(availableAt ? { availableAt } : {}),
    ...(durationMinutes === undefined ? {} : { durationMinutes }),
    sort: sort as NonNullable<TutorSearchFilters["sort"]>,
    page,
    pageSize,
  };
}
