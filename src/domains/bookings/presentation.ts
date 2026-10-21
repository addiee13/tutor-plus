export function formatMoney(minorUnits: number, currency: string): string {
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
  const precision = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minorUnits / 10 ** precision);
}

export function formatUtc(value: string): string {
  return new Date(value)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

export function localDate(value: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  return ["year", "month", "day"].map((name) => parts.find((part) => part.type === name)?.value).join("-");
}

/** Portions of local clock hours occupied by a session, using its actual UTC interval.
 * Walking real minutes also handles midnight and daylight-saving clock changes.
 */
export function sessionHourCoverage(startsAt: string, endsAt: string, timezone: string) {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const cells = new Map<string, { day: string; hour: number; from: number; to: number }>();
  for (let instant = Date.parse(startsAt); instant < Date.parse(endsAt); instant += 60_000) {
    const parts = Object.fromEntries(format.formatToParts(instant).map((part) => [part.type, part.value]));
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    const hour = Number(parts.hour) % 24;
    const minute = Number(parts.minute);
    const key = `${day}:${hour}`;
    const previous = cells.get(key);
    cells.set(key, {
      day,
      hour,
      from: Math.min(previous?.from ?? 60, minute),
      to: Math.max(previous?.to ?? 0, minute + 1),
    });
  }
  return cells;
}
