import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../auth/service";
import { requireOwner } from "../auth/policy";
import { parseProfile } from "../auth/validation";
import { DomainError } from "../shared/errors";

export async function readOwnProfile(client: SupabaseClient) {
  const actor = await getActor(client);
  const { data, error } = await client.from("profiles").select("id,display_name,timezone,adult_attested,status").eq("id", actor.id).single();
  if (error || !data) throw new DomainError("unavailable");
  requireOwner(actor, data.id);
  return data as { id: string; display_name: string; timezone: string; adult_attested: boolean; status: string };
}

export async function saveOwnProfile(client: SupabaseClient, form: FormData) {
  const actor = await getActor(client);
  const fields = parseProfile(form);
  const { data, error } = await client.from("profiles").update(fields).eq("id", actor.id).select("id,display_name,timezone").single();
  if (error || !data) throw new DomainError("unavailable");
  requireOwner(actor, data.id);
  return data as { id: string; display_name: string; timezone: string };
}
