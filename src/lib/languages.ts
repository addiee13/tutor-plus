export const TEACHING_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "ar", label: "Arabic" },
  { value: "zh", label: "Chinese" },
  { value: "hi", label: "Hindi" },
  { value: "pt", label: "Portuguese" },
  { value: "de", label: "German" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "it", label: "Italian" },
  { value: "bn", label: "Bengali" },
  { value: "ur", label: "Urdu" },
  { value: "ru", label: "Russian" },
] as const;
export function languageLabel(tag: string): string {
  return TEACHING_LANGUAGES.find((language) => language.value === tag)?.label ?? tag;
}
