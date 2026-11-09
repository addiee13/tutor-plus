import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActor } from "../auth/service";
import { requireOwner } from "../auth/policy";
import { parseProfile } from "../auth/validation";
import { DomainError, InputError } from "../shared/errors";

export type Profile = {
  id: string;
  display_name: string;
  timezone: string;
  adult_attested: boolean;
  status: string;
  avatarUrl: string | null;
};
export type EditableProfile = Pick<Profile, "id" | "display_name" | "timezone">;

const AVATAR_BUCKET = "profile-avatars";
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function hasImageSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (file.type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === "image/png")
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  return (
    file.type === "image/webp" &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

async function signedAvatarUrl(client: SupabaseClient, ownerId: string, path: string | null): Promise<string | null> {
  if (!path || !path.startsWith(`${ownerId}/`) || path.includes("..")) return null;
  const { data, error } = await client.storage.from(AVATAR_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function readOwnProfile(client: SupabaseClient): Promise<Profile> {
  const actor = await getActor(client);
  const { data, error } = await client
    .from("profiles")
    .select("id,display_name,timezone,adult_attested,status,avatar_path")
    .eq("id", actor.id)
    .single<Omit<Profile, "avatarUrl"> & { avatar_path: string | null }>();
  if (error || !data) throw new DomainError("unavailable");
  requireOwner(actor, data.id);
  const { avatar_path, ...profile } = data;
  return { ...profile, avatarUrl: await signedAvatarUrl(client, data.id, avatar_path) };
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

/** Uploads an owner-only image into the private avatar bucket and returns a short-lived signed URL. */
export async function uploadProfileAvatar(client: SupabaseClient, file: File): Promise<{ avatarUrl: string }> {
  const actor = await getActor(client);
  if (!(file instanceof File) || file.size < 1 || file.size > AVATAR_MAX_BYTES || !AVATAR_MIME_EXTENSIONS[file.type]) {
    throw new InputError({ avatar: "Use a PNG, JPEG or WebP image up to 2 MB." });
  }
  if (!(await hasImageSignature(file)))
    throw new InputError({ avatar: "The image content does not match its file type." });
  const extension = AVATAR_MIME_EXTENSIONS[file.type];
  const path = `${actor.id}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await client.storage.from(AVATAR_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: "300",
    upsert: false,
  });
  if (uploadError) throw new DomainError("unavailable");
  // Verify that the new object is readable before changing the profile pointer. A provider signing
  // failure must leave the existing avatar reference and object untouched.
  const avatarUrl = await signedAvatarUrl(client, actor.id, path);
  if (!avatarUrl) {
    await client.storage.from(AVATAR_BUCKET).remove([path]);
    throw new DomainError("unavailable");
  }
  const { data: oldProfile, error: readError } = await client
    .from("profiles")
    .select("avatar_path")
    .eq("id", actor.id)
    .single<{ avatar_path: string | null }>();
  if (readError || !oldProfile) {
    await client.storage.from(AVATAR_BUCKET).remove([path]);
    throw new DomainError("unavailable");
  }
  let update = client.from("profiles").update({ avatar_path: path }).eq("id", actor.id);
  update =
    oldProfile.avatar_path === null ? update.is("avatar_path", null) : update.eq("avatar_path", oldProfile.avatar_path);
  const { data: updated, error: updateError } = await update.select("id").maybeSingle<{ id: string }>();
  if (updateError || !updated) {
    await client.storage.from(AVATAR_BUCKET).remove([path]);
    throw new DomainError("unavailable");
  }
  if (oldProfile.avatar_path?.startsWith(`${actor.id}/`) && !oldProfile.avatar_path.includes("..")) {
    await client.storage.from(AVATAR_BUCKET).remove([oldProfile.avatar_path]);
  }
  return { avatarUrl };
}

/** Clears the owner's avatar reference before removing the private storage object. */
export async function deleteOwnProfileAvatar(client: SupabaseClient): Promise<void> {
  const actor = await getActor(client);
  const { data, error: readError } = await client
    .from("profiles")
    .select("avatar_path")
    .eq("id", actor.id)
    .single<{ avatar_path: string | null }>();
  if (readError || !data) throw new DomainError("unavailable");
  let update = client.from("profiles").update({ avatar_path: null }).eq("id", actor.id);
  update = data.avatar_path === null ? update.is("avatar_path", null) : update.eq("avatar_path", data.avatar_path);
  const { data: updated, error: updateError } = await update.select("id").maybeSingle<{ id: string }>();
  if (updateError || !updated) throw new DomainError("unavailable");
  if (data.avatar_path?.startsWith(`${actor.id}/`) && !data.avatar_path.includes("..")) {
    const { error } = await client.storage.from(AVATAR_BUCKET).remove([data.avatar_path]);
    if (error) throw new DomainError("unavailable");
  }
}
