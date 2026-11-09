import type { ExplainedTutorMatch, MatchCriteria, MatchReason, TutorMatchCandidate } from "./types";
import { InputError } from "../shared/errors";

/** Only these explicit, non-sensitive method choices may influence the teaching-preference score. */
export const teachingMethodOptions = [
  "step-by-step",
  "visual examples",
  "worked examples",
  "practice problems",
  "discussion",
] as const;

export type TeachingMethodOption = (typeof teachingMethodOptions)[number];

export function normalizeTeachingMethodPreferences(value: unknown): TeachingMethodOption[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 5)
    throw new InputError({ preferredStrategies: "Choose up to five listed teaching methods." });
  const normalized = value.map((entry) => {
    if (typeof entry !== "string") throw new InputError({ preferredStrategies: "Choose listed teaching methods." });
    const match = teachingMethodOptions.find((method) => method === entry.trim().toLocaleLowerCase("en-US"));
    if (!match) throw new InputError({ preferredStrategies: "Choose listed teaching methods." });
    return match;
  });
  if (new Set(normalized).size !== normalized.length)
    throw new InputError({ preferredStrategies: "Remove duplicate teaching methods." });
  return normalized;
}

export function matchedTeachingMethods(profileText: string, selected: readonly string[]): TeachingMethodOption[] {
  const normalized = profileText.toLocaleLowerCase("en-US");
  return selected.filter((method): method is TeachingMethodOption => {
    if (!(teachingMethodOptions as readonly string[]).includes(method)) return false;
    const escaped = method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(normalized);
  });
}

export function scoreTeachingMethods(
  profileText: string,
  selected: readonly string[],
): { score: number; matches: TeachingMethodOption[]; fact: string } {
  const matches = matchedTeachingMethods(profileText, selected);
  return {
    score: selected.length ? matches.length / selected.length : 0,
    matches,
    fact: matches.length
      ? `Public profile mentions: ${matches.join(", ")}.`
      : "No selected teaching method appears in the public profile.",
  };
}

/**
 * Hard eligibility only: no demographic, identity, account, learning-record, or inferred sensitive attributes
 * are read. An explicit requested location/time fails closed when the candidate was not searched for it.
 */
export function explainTutorMatches(
  candidates: readonly TutorMatchCandidate[],
  criteria: MatchCriteria,
): ExplainedTutorMatch[] {
  const requestedStart = criteria.startAt ? Date.parse(criteria.startAt) : undefined;
  const normalizedStart =
    requestedStart !== undefined && Number.isFinite(requestedStart)
      ? new Date(requestedStart).toISOString()
      : undefined;

  const results = candidates.map((tutor): ExplainedTutorMatch => {
    const reasons: MatchReason[] = [];
    if (criteria.subjectId && !tutor.offerings.some((offering) => offering.subjectId === criteria.subjectId)) {
      reasons.push("subject_unavailable");
    }
    if (criteria.mode && !(criteria.mode === "virtual" ? tutor.supportsVirtual : tutor.supportsInPerson)) {
      reasons.push("mode_unavailable");
    }
    if (criteria.maxHourlyRateMinor !== undefined) {
      const rate = criteria.subjectId
        ? tutor.offerings.find((offering) => offering.subjectId === criteria.subjectId)?.hourlyRateMinor
        : tutor.hourlyRateMinor;
      const budgetCurrency = criteria.budgetCurrency ?? "USD";
      const rateCurrency = criteria.subjectId
        ? tutor.offerings.find((offering) => offering.subjectId === criteria.subjectId)?.currency
        : tutor.currency;
      if (rateCurrency !== budgetCurrency) {
        reasons.push("currency_unavailable");
      } else if (rate === undefined || rate === null || rate > criteria.maxHourlyRateMinor) {
        reasons.push("over_budget");
      }
    }
    if (
      criteria.languageTags?.length &&
      !criteria.languageTags.some((language) =>
        tutor.languages.some((listed) => listed.toLowerCase() === language.toLowerCase()),
      )
    ) {
      reasons.push("language_unavailable");
    }
    if (criteria.location && (tutor.distanceKm === null || tutor.distanceKm > criteria.location.radiusKm)) {
      reasons.push("outside_radius");
    }
    if (
      criteria.startAt &&
      (!normalizedStart || !tutor.openSlotStartsAt?.some((slot) => new Date(slot).toISOString() === normalizedStart))
    ) {
      reasons.push("no_open_slot");
    }
    return { tutor, eligible: reasons.length === 0, reasons };
  });

  // Keep ranking transparent and deterministic: eligible results precede ineligible results, then we use
  // proximity when available, server-computed rating, and display name. There is no opaque weighted score.
  return results.sort((left, right) => {
    if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
    const leftDistance = left.tutor.distanceKm;
    const rightDistance = right.tutor.distanceKm;
    if (leftDistance !== null && rightDistance !== null && leftDistance !== rightDistance)
      return leftDistance - rightDistance;
    const ratingDifference = (right.tutor.ratingAverage ?? 0) - (left.tutor.ratingAverage ?? 0);
    if (ratingDifference !== 0) return ratingDifference;
    const countDifference = right.tutor.ratingCount - left.tutor.ratingCount;
    if (countDifference !== 0) return countDifference;
    return left.tutor.publicDisplayName.localeCompare(right.tutor.publicDisplayName);
  });
}

/** Smart-match ties use only the opaque tutor profile ID, never display identity text. */
export function sortRankedTutorMatches<T extends { score: number; tutor: { id: string } }>(matches: readonly T[]): T[] {
  return [...matches].sort((left, right) => right.score - left.score || left.tutor.id.localeCompare(right.tutor.id));
}
