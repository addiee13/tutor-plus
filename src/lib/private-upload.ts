"use client";

import { createClient } from "@supabase/supabase-js";
import { DomainError } from "@/domains/shared/errors";
import type { PreparedPrivateUpload } from "@/domains/shared/uploads";
import { publicConfig } from "@/lib/supabase/config";

/** The single-object upload token grants no session access; authentication stays in HttpOnly cookies. */
export async function uploadPrivateFile(upload: PreparedPrivateUpload, file: File): Promise<void> {
  const config = publicConfig();
  if (!config) throw new DomainError("configuration");
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.storage.from(upload.bucket).uploadToSignedUrl(upload.path, upload.token, file, {
    contentType: file.type,
    cacheControl: "3600",
  });
  if (error) throw new DomainError("unavailable");
}
