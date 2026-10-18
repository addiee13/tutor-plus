import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../auth/service";
import { requireOwner } from "../auth/policy";
import { parseProfile } from "../auth/validation";
import { DomainError } from "../shared/errors";

export type Profile = {
  id: string;
  display_name: string;
  timezone: string;
  adult_attested: boolean;
  status: string;
};
export type EditableProfile = Pick<Profile, "id" | "display_name" | "timezone">;

export async function readOwnProfile(client: SupabaseClient): Promise<Profile> {
  const actor = await getActor(client);
  const { data, error } = await client
    .from("profiles")
    .select("id,display_name,timezone,adult_attested,status")
    .eq("id", actor.id)
    .single<Profile>();
  if (error || !data) throw new DomainError("unavailable");
  requireOwner(actor, data.id);
  return data;
}

export async function saveOwnProfile(client: SupabaseClient, form: FormData): Promise<EditableProfile> {
  const actor = await getActor(client);
  const fields = parseProfile(form);
  const { data, error } = await client
    .from("profiles")
    .update(fields)
    .eq("id", actor.id)
    .select("id,display_name,timezone")
    .single<EditableProfile>();
  if (error || !data) throw new DomainError("unavailable");
  requireOwner(actor, data.id);
  return data;
}
