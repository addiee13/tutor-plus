export function formatMoney(minorUnits: number, currency: string): string {
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
  const precision = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minorUnits / 10 ** precision);
}

export function formatUtc(value: string): string {
  return new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export function localDate(value: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  return ["year", "month", "day"].map((name) => parts.find((part) => part.type === name)?.value).join("-");
}
