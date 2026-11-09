import "server-only";
import type { UserClient } from "@/lib/supabase/server";
import { geocodeTutorLocation } from "@/domains/platform/service";
import { InputError } from "@/domains/shared/errors";
import type { DiscoveryQuery } from "./filters";
/** A failed lookup preserves the explicit radius and returns no broadened search. */
export async function resolveDiscoveryLocation(client: UserClient, query: DiscoveryQuery): Promise<DiscoveryQuery> {
  const read = (key: string) => {
    const value = query[key];
    if (Array.isArray(value)) throw new InputError({ [key]: "Choose one value for each location field." });
    return value?.trim() ?? "";
  };
  const latitude = read("latitude"),
    longitude = read("longitude"),
    city = read("city"),
    postalCode = read("postal"),
    countryCode = read("country"),
    region = read("region");
  if (latitude || longitude) return query;
  if (!city && !postalCode) return query;
  if (!read("radius")) throw new InputError({ radius: "Choose a search radius for the location you entered." });
  if (!countryCode) throw new InputError({ country: "Choose a country for the location lookup." });
  const result = await geocodeTutorLocation(client, {
    city,
    postalCode: postalCode || null,
    region: region || null,
    countryCode,
  });
  if (!result.configured || result.error === "not_configured")
    throw new InputError({
      location:
        "Location lookup is not configured. Your radius is still applied only after you supply a readable location. Retry later or enter approximate coordinates.",
    });
  if (result.error || !result.location)
    throw new InputError({
      location:
        result.error === "not_found"
          ? "We couldn’t find that place. Check the location or enter approximate coordinates; your radius has been retained."
          : "Location lookup is temporarily unavailable. Retry or enter approximate coordinates; your radius has been retained.",
    });
  return { ...query, latitude: String(result.location.latitude), longitude: String(result.location.longitude) };
}
