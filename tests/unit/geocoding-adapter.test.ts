import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { geocodeTutorLocation } from "../../src/domains/platform/service";
import { InputError } from "../../src/domains/shared/errors";
vi.mock("server-only", () => ({}));
const client = {} as SupabaseClient;
const locality = { city: "Atlanta", region: "GA", postalCode: "30303", countryCode: "US" };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Sprint4 manual geocoding adapter partitions (deterministic HTTP double)", () => {
  it("reports missing configuration without issuing a provider request", async () => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await geocodeTutorLocation(client, locality)).toMatchObject({
      configured: false,
      location: null,
      error: "not_configured",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("converts an explicit city/postal locality to coordinates without returning the server token", async () => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "pk.deterministic-fixture-not-live");
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ features: [{ geometry: { coordinates: [-84.39, 33.75] }, properties: { name: "Atlanta" } }] }),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await geocodeTutorLocation(client, locality);
    expect(result).toEqual({
      configured: true,
      location: { latitude: 33.75, longitude: -84.39 },
      label: "Atlanta",
      error: null,
    });
    const request = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(request.origin).toBe("https://api.mapbox.com");
    expect(request.searchParams.get("q")).toContain("30303");
    expect(request.searchParams.get("country")).toBe("us");
    expect(request.searchParams.get("limit")).toBe("1");
    expect(JSON.stringify(result).includes("pk.deterministic-fixture-not-live")).toBe(false);
  });
  it.each(["status", "exception", "coordinates"])(
    "keeps provider %s failures distinct from an empty successful location",
    async (variant) => {
      vi.stubEnv("MAPBOX_ACCESS_TOKEN", "pk.deterministic-fixture-not-live");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (variant === "exception") throw new Error("PRIVATE_GEOCODING_SENTINEL");
          if (variant === "status") return new Response("PRIVATE_GEOCODING_SENTINEL", { status: 503 });
          return Response.json({ features: [{ geometry: { coordinates: [500, 500] } }] });
        }),
      );
      expect(await geocodeTutorLocation(client, locality)).toMatchObject({
        configured: true,
        location: null,
        error: "provider_unavailable",
      });
    },
  );
  it("returns a truthful no-result state for a valid provider response without a locality", async () => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "pk.deterministic-fixture-not-live");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ features: [] })),
    );
    expect(await geocodeTutorLocation(client, locality)).toMatchObject({
      configured: true,
      location: null,
      error: "not_found",
    });
  });
  it("rejects ambiguous batch punctuation before contacting the provider", async () => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "pk.deterministic-fixture-not-live");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(geocodeTutorLocation(client, { ...locality, city: "Atlanta; elsewhere" })).rejects.toBeInstanceOf(
      InputError,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
