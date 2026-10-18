/** Reads a trimmed string field; missing or file-valued entries read as an empty string. */
export function readText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Echoes submitted values back to the form so a failed submission keeps the user's input. */
export function readValues<const K extends string>(form: FormData, names: readonly K[]): Record<K, string> {
  return Object.fromEntries(names.map((name) => [name, String(form.get(name) ?? "")])) as Record<K, string>;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
