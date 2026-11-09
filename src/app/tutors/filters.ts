import { InputError } from "../../domains/shared/errors";
import { parseTutorSearchFilters } from "../../domains/marketplace/validation";
import type { TutorSearchFilters } from "../../domains/marketplace/types";
export type DiscoveryQuery = Record<string, string | string[] | undefined>;
/** Ambiguous or incomplete hard constraints are rejected, never silently broadened. */
export function parseDiscoveryQuery(query: DiscoveryQuery): TutorSearchFilters {
  const read = (key: string) => {
    const value = query[key];
    if (Array.isArray(value)) throw new InputError({ [key]: "Choose one value for each tutor filter." });
    return value?.trim() ?? "";
  };
  const mode = read("mode");
  if (mode && mode !== "virtual" && mode !== "in_person")
    throw new InputError({ mode: "Choose a valid teaching mode." });
  const latitude = read("latitude"),
    longitude = read("longitude"),
    radius = read("radius");
  if ([latitude, longitude, radius].some(Boolean) && ![latitude, longitude, radius].every(Boolean))
    throw new InputError({ location: "Enter latitude, longitude and a radius together to filter nearby tutors." });
  const rate = read("rate"),
    minRate = read("minRate"),
    rating = read("rating"),
    page = read("page"),
    duration = read("duration"),
    sort = read("sort");
  const available = read("availableAt");
  const monetary = (value: string, field: string) => {
    if (!value) return undefined;
    if (!/^(?:\d+|\d*\.\d{1,2})$/.test(value))
      throw new InputError({ [field]: "Enter a non-negative rate with at most two decimal places." });
    return Math.round(Number(value) * 100);
  };
  const input = {
    query: read("q") || undefined,
    subjectId: read("subject") || undefined,
    mode: mode || undefined,
    minHourlyRateMinor: monetary(minRate, "minRate"),
    maxHourlyRateMinor: monetary(rate, "rate"),
    minimumRating: rating ? Number(rating) : undefined,
    languageTags: [read("language"), ...read("otherLanguage").split(/[,\n]/)]
      .map((value) => value.trim())
      .filter(Boolean),
    page: page ? Number(page) : 1,
    pageSize: 12,
    sort: sort || undefined,
    near:
      latitude && longitude && radius
        ? { latitude: Number(latitude), longitude: Number(longitude), radiusKm: Number(radius) }
        : undefined,
    availableAt: available || undefined,
    durationMinutes: duration ? Number(duration) : undefined,
  };
  return parseTutorSearchFilters(input);
}
