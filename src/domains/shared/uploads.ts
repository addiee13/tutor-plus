import { InputError } from "./errors";

export type PrivateUploadMetadata = { mime: string; bytes: number };
export type PreparedPrivateUpload = { bucket: string; path: string; token: string };

const extensions: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "text/plain": ".txt",
};
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

/** Validate the small upload request; Storage and the registration RPC verify the actual object again. */
export function parsePrivateUploadMetadata(mime: unknown, bytes: unknown): PrivateUploadMetadata {
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 1 || bytes > 10 * 1024 * 1024)
    throw new InputError({ file: "Files must be 10 MiB or smaller." });
  if (typeof mime !== "string" || !Object.hasOwn(extensions, mime))
    throw new InputError({ file: "Use a PDF, PNG, JPEG, or plain-text file." });
  return { mime, bytes };
}

export function privateUploadExtension(mime: string): string {
  return extensions[mime] ?? "";
}

/** Never pass an arbitrary client path to registration or orphan cleanup. */
export function parsePrivateUploadPath(path: unknown, parentId: string, actorId: string, mime: string): string {
  const prefix = `${parentId}/${actorId}/`;
  if (
    typeof path !== "string" ||
    !path.startsWith(prefix) ||
    !new RegExp(`^${UUID}\\.(pdf|png|jpg|txt)$`, "i").test(path.slice(prefix.length)) ||
    !path.endsWith(privateUploadExtension(mime))
  )
    throw new InputError({ file: "Choose and upload your file again." });
  return path;
}
