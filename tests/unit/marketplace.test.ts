import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../../src/domains/auth/service";
import type { Actor } from "../../src/domains/auth/policy";
import { DomainError, InputError } from "../../src/domains/shared/errors";
import {
  explainTutorMatches,
  normalizeTeachingMethodPreferences,
  scoreTeachingMethods,
  sortRankedTutorMatches,
} from "../../src/domains/marketplace/matching";
import { searchTutors, setTutorPublication, saveTutorListing } from "../../src/domains/marketplace/service";
import {
  parseAvailabilityExceptionInput,
  parseAvailabilityRuleInput,
  parseLearningProfileInput,
  parseTutorLanguagesInput,
  parseTutorListingInput,
  parseTutorSearchFilters,
} from "../../src/domains/marketplace/validation";
import type { PublicTutorCard } from "../../src/domains/marketplace/types";

vi.mock("server-only", () => ({}));
vi.mock("../../src/domains/auth/service", () => ({ getActor: vi.fn() }));

const actor: Actor = { id: "tutor-owner", roles: ["tutor"], sessionStartedAt: "2026-11-08T10:00:00Z" };
const tutorId = "00000000-0000-4000-8000-000000000001";
const subjectId = "00000000-0000-4000-8000-000000000002";

function listing(overrides: Record<string, unknown> = {}) {
  return {
    publicDisplayName: "Tutor",
    publicAvatarUrl: null,
    headline: "Math support",
    bio: "Structured practice and clear explanations.",
    credentialsText: null,
    experienceYears: 3,
    hourlyRateMinor: 4500,
    languages: [],
    currency: "USD",
    supportsVirtual: true,
    supportsInPerson: false,
    serviceAreaLabel: null,
    location: null,
    serviceRadiusKm: null,
    offerings: [{ subjectId, expertise: "Algebra", rateOverrideMinor: null }],
    ...overrides,
  };
}

function card(overrides: Partial<PublicTutorCard> = {}): PublicTutorCard {
  return {
    id: tutorId,
    publicDisplayName: "Tutor",
    publicAvatarUrl: null,
    headline: "Math support",
    bio: "Structured practice.",
    credentialsText: null,
    experienceYears: 3,
    hourlyRateMinor: 4500,
    languages: [],
    currency: "USD",
    supportsVirtual: true,
    supportsInPerson: false,
    serviceAreaLabel: null,
    serviceRadiusKm: null,
    ratingCount: 4,
    ratingAverage: 4.75,
    completedSessionCount: 2,
    recommendedCount: 1,
    badgePolicyVersion: 1,
    badges: [
      {
        key: "completed_sessions",
        fact: "completed_sessions",
        policyVersion: 1,
        label: "Completed sessions",
        value: 2,
        threshold: 1,
      },
    ],
    distanceKm: null,
    offerings: [
      {
        subjectId,
        name: "Mathematics",
        slug: "mathematics",
        expertise: null,
        rateOverrideMinor: null,
        hourlyRateMinor: 4500,
        currency: "USD",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActor).mockResolvedValue(actor);
});

describe("marketplace input validation", () => {
  it("restricts match preference inputs to the non-sensitive teaching-method vocabulary", () => {
    expect(normalizeTeachingMethodPreferences(["STEP-BY-STEP", "visual examples"])).toEqual([
      "step-by-step",
      "visual examples",
    ]);
    expect(() => normalizeTeachingMethodPreferences(["female"])).toThrow(InputError);
    expect(() => normalizeTeachingMethodPreferences(["white"])).toThrow(InputError);
  });

  it("keeps teaching-preference scores and tie ordering invariant to protected demographic text", () => {
    const method = ["worked examples"] as const;
    const tutorA = {
      id: "00000000-0000-4000-8000-000000000011",
      displayName: "A tutor",
      profile: "Uses worked examples. Female tutor.",
    };
    const tutorB = {
      ...tutorA,
      id: "00000000-0000-4000-8000-000000000012",
      profile: "Uses worked examples. Male tutor.",
    };
    const firstRanking = sortRankedTutorMatches(
      [tutorA, tutorB].map((tutor) => ({
        tutor: { id: tutor.id, displayName: tutor.displayName },
        score: scoreTeachingMethods(tutor.profile, method).score,
      })),
    );
    const changedDemographics = sortRankedTutorMatches(
      [
        { ...tutorA, displayName: "Z tutor", profile: "Uses worked examples. Male tutor." },
        { ...tutorB, displayName: "Y tutor", profile: "Uses worked examples. Female tutor." },
      ].map((tutor) => ({
        tutor: { id: tutor.id, displayName: tutor.displayName },
        score: scoreTeachingMethods(tutor.profile, method).score,
      })),
    );
    expect(changedDemographics.map((item) => item.tutor.id)).toEqual(firstRanking.map((item) => item.tutor.id));
    expect(changedDemographics.map((item) => item.score)).toEqual(firstRanking.map((item) => item.score));
  });

  it("normalizes textarea line endings before enforcing the tutor bio limit", () => {
    const crlfBio = `${"x".repeat(3998)}\r\ny`;
    const crBio = `${"x".repeat(3998)}\ry`;
    expect(parseTutorListingInput(listing({ bio: crlfBio })).bio).toBe(`${"x".repeat(3998)}\ny`);
    expect(parseTutorListingInput(listing({ bio: crBio })).bio).toBe(`${"x".repeat(3998)}\ny`);
    expect(() => parseTutorListingInput(listing({ bio: `${"x".repeat(3999)}\r\ny` }))).toThrow(InputError);
  });

  it("accepts a private virtual-first listing with validated subjects and integer minor-unit prices", () => {
    expect(parseTutorListingInput(listing({ serviceRadiusKm: undefined }))).toMatchObject({
      publicDisplayName: "Tutor",
      currency: "USD",
      hourlyRateMinor: 4500,
      offerings: [{ subjectId, rateOverrideMinor: null }],
    });
  });

  it("allows incomplete in-person drafts but keeps coordinates validated", () => {
    expect(parseTutorListingInput(listing({ supportsInPerson: true }))).toMatchObject({
      supportsInPerson: true,
      serviceAreaLabel: null,
      location: null,
      serviceRadiusKm: null,
    });
    expect(() =>
      parseTutorListingInput(
        listing({
          supportsInPerson: true,
          serviceAreaLabel: "Boston area",
          location: { latitude: 42.36, longitude: -71.06 },
          serviceRadiusKm: 20.5,
        }),
      ),
    ).not.toThrow();
    expect(() => parseTutorListingInput(listing({ location: { latitude: 95, longitude: 0 } }))).toThrow(InputError);
  });

  it("defaults bounded searches to USD and accepts only a valid explicit budget currency", () => {
    expect(parseTutorSearchFilters({ maxHourlyRateMinor: 3000 }).budgetCurrency).toBe("USD");
    expect(parseTutorSearchFilters({ minHourlyRateMinor: 3000, budgetCurrency: "EUR" }).budgetCurrency).toBe("EUR");
    expect(() => parseTutorSearchFilters({ maxHourlyRateMinor: 3000, budgetCurrency: "usd" })).toThrow(InputError);
    expect(() => parseTutorSearchFilters({ budgetCurrency: "US" })).toThrow(InputError);
  });

  it("rejects missing modes, duplicate subjects, unsafe avatar links and decimal currency amounts", () => {
    expect(() => parseTutorListingInput(listing({ supportsVirtual: false }))).toThrow(InputError);
    expect(() => parseTutorListingInput(listing({ offerings: [{ subjectId }, { subjectId }] }))).toThrow(InputError);
    expect(() => parseTutorListingInput(listing({ publicAvatarUrl: "http://example.test/avatar.png" }))).toThrow(
      InputError,
    );
    expect(() => parseTutorListingInput(listing({ hourlyRateMinor: 45.5 }))).toThrow(InputError);
  });

  it("accepts bounded unique public BCP-47 language tags and rejects duplicate or malformed tags", () => {
    expect(
      parseTutorLanguagesInput({ listingId: tutorId, expectedVersion: 4, languages: ["en", "es", "zh-Hans"] }),
    ).toMatchObject({ languages: ["en", "es", "zh-Hans"], expectedVersion: 4 });
    expect(() => parseTutorLanguagesInput({ listingId: tutorId, expectedVersion: 4, languages: ["en", "EN"] })).toThrow(
      InputError,
    );
    expect(() => parseTutorLanguagesInput({ listingId: tutorId, expectedVersion: 4, languages: ["English"] })).toThrow(
      InputError,
    );
  });

  it("validates local rule time zones, date bounds, and prohibits overnight rules", () => {
    const valid = parseAvailabilityRuleInput({
      weekday: 1,
      localStart: "09:00",
      localEnd: "12:30",
      timezone: "America/New_York",
      validFrom: "2026-11-09",
      validUntil: "2027-01-01",
      active: true,
    });
    expect(valid.localStart).toBe("09:00:00");
    expect(() => parseAvailabilityRuleInput({ ...valid, localStart: "22:00", localEnd: "02:00" })).toThrow(InputError);
    expect(() => parseAvailabilityRuleInput({ ...valid, timezone: "Mars/Olympus" })).toThrow(InputError);
    expect(() => parseAvailabilityRuleInput({ ...valid, validUntil: "2026-11-08" })).toThrow(InputError);
  });

  it("allows full-day unavailable exceptions but requires a time range for added hours", () => {
    expect(
      parseAvailabilityExceptionInput({
        localDate: "2026-11-12",
        localStart: null,
        localEnd: null,
        timezone: "UTC",
        exceptionType: "unavailable",
      }),
    ).toMatchObject({ exceptionType: "unavailable", localStart: null, localEnd: null });
    expect(() =>
      parseAvailabilityExceptionInput({
        localDate: "2026-11-12",
        localStart: null,
        localEnd: null,
        timezone: "UTC",
        exceptionType: "additional",
      }),
    ).toThrow(InputError);
  });

  it("keeps discovery filters bounded and treats coordinates and requested slots as required pairs", () => {
    expect(() => parseTutorSearchFilters({ pageSize: 51 })).toThrow(InputError);
    expect(() => parseTutorSearchFilters({ near: { latitude: 40, radiusKm: 10 } })).toThrow(InputError);
    expect(() => parseTutorSearchFilters({ availableAt: "2026-11-12T13:00:00Z" })).toThrow(InputError);
    expect(
      parseTutorSearchFilters({
        near: { latitude: 40, longitude: -73, radiusKm: 12.5 },
        availableAt: "2026-11-12T13:00:00Z",
        durationMinutes: 60,
        pageSize: 25,
      }),
    ).toMatchObject({ page: 1, pageSize: 25, durationMinutes: 60, near: { radiusKm: 12.5 } });
    expect(() => parseTutorSearchFilters({ sort: "distance" })).toThrow(InputError);
  });

  it("allows only bounded private learning preferences and ignores authorization-shaped extras", () => {
    const saved = parseLearningProfileInput({
      displayName: "Student",
      bio: "I want steady practice.",
      timezone: "America/New_York",
      city: "Boston",
      region: "MA",
      postalCode: "02108",
      countryCode: "US",
      learningPreferences: { goals: ["fractions"], contactPreference: "email" },
      adultAttested: false,
      role: "administrator",
    });
    expect(saved).not.toHaveProperty("adultAttested");
    expect(saved).not.toHaveProperty("role");
    expect(() => parseLearningProfileInput({ ...saved, learningPreferences: { huge: "x".repeat(5000) } })).toThrow(
      InputError,
    );
  });
});

describe("hard-eligibility matching", () => {
  it("reports each unmet requirement and fails closed when location or requested availability was not checked", () => {
    const candidate = { ...card(), distanceKm: null, openSlotStartsAt: undefined };
    const [result] = explainTutorMatches([candidate], {
      subjectId,
      mode: "in_person",
      maxHourlyRateMinor: 3000,
      location: { latitude: 42, longitude: -71, radiusKm: 15 },
      startAt: "2026-11-12T13:00:00.000Z",
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(["mode_unavailable", "over_budget", "outside_radius", "no_open_slot"]);
  });

  it("never treats an equal minor-unit amount in another currency as within budget", () => {
    const euro = card({
      currency: "EUR",
      hourlyRateMinor: 3000,
      offerings: [
        {
          subjectId,
          name: "Math",
          slug: "math",
          expertise: null,
          rateOverrideMinor: null,
          hourlyRateMinor: 3000,
          currency: "EUR",
        },
      ],
    });
    const dollar = card({
      currency: "USD",
      hourlyRateMinor: 3000,
      offerings: [
        {
          subjectId,
          name: "Math",
          slug: "math",
          expertise: null,
          rateOverrideMinor: null,
          hourlyRateMinor: 3000,
          currency: "USD",
        },
      ],
    });
    expect(
      explainTutorMatches([euro], { subjectId, maxHourlyRateMinor: 3000, budgetCurrency: "USD" })[0],
    ).toMatchObject({ eligible: false, reasons: ["currency_unavailable"] });
    expect(
      explainTutorMatches([dollar], { subjectId, maxHourlyRateMinor: 3000, budgetCurrency: "USD" })[0],
    ).toMatchObject({ eligible: true, reasons: [] });
    expect(explainTutorMatches([euro], {})[0]).toMatchObject({ eligible: true, reasons: [] });
  });

  it("checks subject-specific override rate and returns an eligible explanation without hidden fields", () => {
    const candidate = {
      ...card({
        offerings: [
          {
            subjectId,
            name: "Math",
            slug: "math",
            expertise: null,
            rateOverrideMinor: 2500,
            hourlyRateMinor: 2500,
            currency: "USD",
          },
        ],
        distanceKm: 4,
      }),
      openSlotStartsAt: ["2026-11-12T13:00:00.000Z"],
    };
    const [result] = explainTutorMatches([candidate], {
      subjectId,
      mode: "virtual",
      maxHourlyRateMinor: 2500,
      location: { latitude: 42, longitude: -71, radiusKm: 10 },
      startAt: "2026-11-12T13:00:00Z",
    });
    expect(result).toMatchObject({ eligible: true, reasons: [] });
    expect(Object.keys(result.tutor)).not.toContain("userId");
  });

  it("applies language as a hard eligibility rule with any-selected-language semantics", () => {
    const candidate = card({ languages: ["es-MX"] });
    expect(explainTutorMatches([candidate], { languageTags: ["en", "es-MX"] })[0]?.eligible).toBe(true);
    expect(explainTutorMatches([candidate], { languageTags: ["en", "fr"] })[0]?.reasons).toContain(
      "language_unavailable",
    );
  });

  it("places eligible tutors first and uses transparent ties without fixed match weights", () => {
    const results = explainTutorMatches(
      [card({ id: "eligible", ratingAverage: 4.2 }), card({ id: "blocked", supportsVirtual: false })],
      { mode: "virtual" },
    );
    expect(results.map((result) => result.tutor.id)).toEqual(["eligible", "blocked"]);
    expect(results[1]?.reasons).toEqual(["mode_unavailable"]);
  });
});

describe("marketplace discovery service", () => {
  it("passes USD explicitly for bounded rate searches while preserving unpriced search", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const client = { rpc } as unknown as SupabaseClient;
    await expect(searchTutors(client, { maxHourlyRateMinor: 3000 })).resolves.toMatchObject({ items: [] });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "list_public_tutors_v3",
      expect.objectContaining({
        min_rate: null,
        max_rate: 3000,
        budget_currency: "USD",
      }),
    );

    rpc.mockClear();
    await expect(searchTutors(client, {})).resolves.toMatchObject({ items: [] });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "list_public_tutors_v3",
      expect.objectContaining({
        min_rate: null,
        max_rate: null,
        budget_currency: "USD",
      }),
    );
  });
});

describe("marketplace authorization", () => {
  it("prevents a non-tutor from attempting listing writes", async () => {
    vi.mocked(getActor).mockResolvedValue({ ...actor, roles: ["student"] });
    const rpc = vi.fn();
    await expect(saveTutorListing({ rpc } as unknown as SupabaseClient, listing() as never)).rejects.toMatchObject<
      Partial<DomainError>
    >({
      code: "forbidden",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("scopes publication updates to the verified owner's listing and rejects rows hidden by RLS", async () => {
    const builders: Array<{ eq: ReturnType<typeof vi.fn> }> = [];
    let fromCount = 0;
    const from = vi.fn(() => {
      const currentCall = fromCount++;
      const query = {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () =>
          currentCall === 0 ? { data: { id: tutorId }, error: null } : { data: null, error: null },
        ),
      };
      builders.push(query);
      return query;
    });
    await expect(
      setTutorPublication({ from } as unknown as SupabaseClient, tutorId, "published"),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(from).toHaveBeenCalledWith("tutor_profiles");
    expect(builders[0]?.eq).toHaveBeenCalledWith("user_id", actor.id);
    expect(builders[1]?.eq).toHaveBeenCalledWith("user_id", actor.id);
  });
});
