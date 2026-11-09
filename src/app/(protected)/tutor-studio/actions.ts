"use server";

import { createUserClient } from "@/lib/supabase/server";
import { actionFailure } from "@/lib/action-state";
import type { ActionState } from "@/domains/shared/errors";
import { InputError } from "@/domains/shared/errors";
import {
  readOwnTutorListing,
  saveTutorListing,
  setTutorPublication,
  saveAvailabilityRule,
  deleteAvailabilityRule,
  saveAvailabilityException,
  deleteAvailabilityException,
} from "@/domains/marketplace/service";
import type { TutorListingInput } from "@/domains/marketplace/types";

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}
function optionalNumber(form: FormData, key: string) {
  const value = text(form, key);
  return value ? Number(value) : null;
}
function minor(form: FormData, key: string) {
  return Math.round(Number(text(form, key)) * 100);
}
function values(form: FormData) {
  return Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string")) as Record<
    string,
    string
  >;
}

export async function saveListingAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const client = await createUserClient();
    const input: TutorListingInput = {
      listingId: text(form, "listingId") || undefined,
      expectedVersion: text(form, "expectedVersion") ? Number(text(form, "expectedVersion")) : undefined,
      publicDisplayName: text(form, "publicDisplayName"),
      publicAvatarUrl: text(form, "publicAvatarUrl") || null,
      headline: text(form, "headline"),
      bio: text(form, "bio"),
      credentialsText: text(form, "credentialsText") || null,
      experienceYears: Number(text(form, "experienceYears")),
      hourlyRateMinor: text(form, "hourlyRate") ? minor(form, "hourlyRate") : null,
      currency: text(form, "currency"),
      supportsVirtual: form.has("supportsVirtual"),
      supportsInPerson: form.has("supportsInPerson"),
      serviceAreaLabel: text(form, "serviceAreaLabel") || null,
      location:
        text(form, "latitude") && text(form, "longitude")
          ? { latitude: Number(text(form, "latitude")), longitude: Number(text(form, "longitude")) }
          : null,
      serviceRadiusKm: optionalNumber(form, "serviceRadiusKm"),
      offerings: form.getAll("subjectIds").map((id) => ({
        subjectId: String(id),
        expertise: text(form, `expertise:${id}`) || null,
        rateOverrideMinor: text(form, `rate:${id}`) ? minor(form, `rate:${id}`) : null,
      })),
    };
    await saveTutorListing(client, input);
    return {
      success: true,
      message: "Your tutor listing and subject offerings were saved. Publication is managed separately below.",
    };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}

export async function publicationAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const state = text(form, "state");
    if (state !== "published" && state !== "paused" && state !== "draft")
      throw new InputError({ state: "Choose a valid publication state." });
    await setTutorPublication(await createUserClient(), text(form, "listingId"), state);
    return {
      success: true,
      message:
        state === "published"
          ? "Your tutor listing is published. Students can find your public profile."
          : "Your publication state was saved.",
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function availabilityAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await saveAvailabilityRule(await createUserClient(), text(form, "listingId"), {
      weekday: Number(text(form, "weekday")),
      localStart: text(form, "localStart"),
      localEnd: text(form, "localEnd"),
      timezone: text(form, "timezone"),
      validFrom: text(form, "validFrom"),
      validUntil: text(form, "validUntil") || null,
      active: true,
    });
    return { success: true, message: "Your weekly availability was saved." };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}

export async function exceptionAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const exceptionType = text(form, "exceptionType");
    if (exceptionType !== "unavailable" && exceptionType !== "additional")
      throw new InputError({ exceptionType: "Choose an exception type." });
    await saveAvailabilityException(await createUserClient(), text(form, "listingId"), {
      localDate: text(form, "localDate"),
      localStart: text(form, "localStart") || null,
      localEnd: text(form, "localEnd") || null,
      timezone: text(form, "timezone"),
      exceptionType,
      reason: text(form, "reason") || null,
    });
    return { success: true, message: "Your date-specific availability was saved." };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}

export async function deleteAvailabilityAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const client = await createUserClient();
    const listing = await readOwnTutorListing(client);
    if (!listing || listing.id !== text(form, "listingId"))
      throw new InputError({ listingId: "Reload your tutor listing before changing availability." });
    if (text(form, "kind") === "exception") await deleteAvailabilityException(client, listing.id, text(form, "id"));
    else await deleteAvailabilityRule(client, listing.id, text(form, "id"));
    return { success: true, message: "That availability entry was removed." };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function tutorLanguagesAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { saveTutorLanguages } = await import("@/domains/marketplace/service");
    const languages = [
      ...form.getAll("languages").map(String),
      ...text(form, "otherLanguages")
        .split(/[,\n]/)
        .map((value) => value.trim())
        .filter(Boolean),
    ];
    await saveTutorLanguages(await createUserClient(), {
      listingId: text(form, "listingId"),
      expectedVersion: Number(text(form, "expectedVersion")),
      languages: [...new Set(languages)],
    });
    return {
      success: true,
      message: "Your chosen teaching languages were saved. They are available as public tutor information.",
    };
  } catch (error) {
    return actionFailure(error, values(form));
  }
}
