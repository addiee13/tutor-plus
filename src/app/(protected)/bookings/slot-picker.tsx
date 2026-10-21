import { useEffect, useMemo, useState, useTransition, type CSSProperties } from "react";
import { TIME_ZONES } from "@/lib/time-zones";
import { SLOT_DURATIONS, type BookableSlot, type SlotListResult } from "@/domains/bookings/types";
import { sessionHourCoverage } from "@/domains/bookings/presentation";
import { listTutorSlotsAction } from "./actions";
import styles from "./bookings.module.css";

const DAYS_SHOWN = 14;
const WEEK = 7;

type LocalSlot = BookableSlot & { day: string; minute: number };
type Day = { key: string; label: string; weekday: number; slots: LocalSlot[] };
type Loaded = { requestedFor: string } & SlotListResult;
type Cell = { day: string; hour: number };

type Props = {
  tutorId: string;
  /** IANA zone the tutor's weekly hours are written in, shown beside the student's pick. */
  tutorZone?: string;
  initialZone: string;
  error?: string;
  onSelectionChange: (selected: boolean) => void;
};

function formatters(zone: string) {
  return {
    parts: new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
    time: new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }),
    day: new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric" }),
    long: new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long", month: "long", day: "numeric" }),
    zone: new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }),
  };
}

function localParts(format: Intl.DateTimeFormat, instant: number) {
  const parts = Object.fromEntries(format.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minute: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

function hourLabel(hour: number): string {
  return `${hour % 12 || 12}${hour < 12 ? "a" : "p"}`;
}

function hourRange(hour: number): string {
  const format = (value: number) => `${value % 12 || 12}:00 ${value % 24 < 12 ? "AM" : "PM"}`;
  return `${format(hour)}–${format(hour + 1)}`;
}

/** Calendar days in the student's zone, built from date arithmetic so DST changes cannot skip or repeat a day. */
function buildDays(slots: BookableSlot[], zone: string, observedAt: number): Day[] {
  const format = formatters(zone).parts;
  const [year, month, date] = localParts(format, observedAt).day.split("-").map(Number);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", day: "numeric" });
  const days: Day[] = Array.from({ length: DAYS_SHOWN }, (_, index) => {
    const noon = Date.UTC(year, month - 1, date + index, 12);
    return {
      key: new Date(noon).toISOString().slice(0, 10),
      label: label.format(noon),
      weekday: new Date(noon).getUTCDay(),
      slots: [],
    };
  });
  const byKey = new Map(days.map((day) => [day.key, day]));
  for (const slot of slots) {
    const start = Date.parse(slot.startsAt);
    // Starts that have already passed are not choices at all, so they are left out rather than shown as too soon.
    if (start <= observedAt) continue;
    const local = localParts(format, start);
    byKey.get(local.day)?.slots.push({ ...slot, ...local });
  }
  return days;
}

function cellSlots(day: Day, hour: number): LocalSlot[] {
  return day.slots.filter((slot) => Math.floor(slot.minute / 60) === hour);
}

function cellState(slots: LocalSlot[]) {
  const open = slots.filter((slot) => slot.status === "open").length;
  if (open) return { tone: open > 1 ? "many" : "few", text: `${open} open start${open > 1 ? "s" : ""}` };
  if (slots.some((slot) => slot.status === "booked" || slot.status === "student_busy")) {
    return { tone: "booked", text: "booked" };
  }
  if (slots.length) return { tone: "soon", text: "too soon to book" };
  return { tone: "off", text: "tutor not available" };
}

const STATUS_TEXT: Record<BookableSlot["status"], string> = {
  open: "Open",
  booked: "Booked",
  too_soon: "Too soon",
  student_busy: "You're busy",
};

/** UC-04 slot picker: quick picks plus a week heatmap of the tutor's real bookable start times. Rendered only from the client request form. */
export function SlotPicker({ tutorId, tutorZone, initialZone, error, onSelectionChange }: Props) {
  const [duration, setDuration] = useState<number>(60);
  const [zone, setZone] = useState(initialZone);
  const [week, setWeek] = useState(0);
  const [cell, setCell] = useState<Cell | null>(null);
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reloads, setReloads] = useState(0);
  const [loading, startLoading] = useTransition();
  const requestedFor = `${tutorId}:${duration}:${reloads}`;

  useEffect(() => {
    let current = true;
    startLoading(async () => {
      const result = await listTutorSlotsAction(tutorId, duration);
      if (current) setLoaded({ requestedFor, ...result });
    });
    return () => {
      current = false;
    };
  }, [tutorId, duration, requestedFor]);

  // Keep showing the previous list while a refresh loads, but never a list for another tutor or length.
  const fresh = loaded && loaded.requestedFor.startsWith(`${tutorId}:${duration}:`) ? loaded : null;
  const slots = useMemo(() => (fresh && "slots" in fresh ? fresh.slots : []), [fresh]);
  const observedAt = fresh && "slots" in fresh ? fresh.observedAt : 0;
  const format = useMemo(() => formatters(zone), [zone]);
  const days = useMemo(() => (observedAt ? buildDays(slots, zone, observedAt) : []), [slots, zone, observedAt]);
  const open = useMemo(() => days.flatMap((day) => day.slots.filter((slot) => slot.status === "open")), [days]);
  const selected = open.find((slot) => slot.startsAt === selectedStart) ?? null;
  const coverage = useMemo<ReturnType<typeof sessionHourCoverage>>(
    () => (selected ? sessionHourCoverage(selected.startsAt, selected.endsAt, zone) : new Map()),
    [selected, zone],
  );

  useEffect(() => onSelectionChange(selected !== null), [selected, onSelectionChange]);

  const visible = days.slice(week * WEEK, week * WEEK + WEEK);
  const hours = visible.flatMap((day) => [
    ...day.slots.map((slot) => Math.floor(slot.minute / 60)),
    ...[...coverage.values()].filter((part) => part.day === day.key).map((part) => part.hour),
  ]);
  const firstHour = hours.length ? Math.min(...hours) : 0;
  const lastHour = hours.length ? Math.max(...hours) : -1;
  const columns = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index);

  const picks = [
    { label: "Soonest", hint: "First open time", slot: open[0] },
    {
      label: "After 5 PM",
      hint: "5–9 PM your time",
      slot: open.find((slot) => slot.minute >= 17 * 60 && slot.minute < 21 * 60),
    },
    {
      label: "Weekend",
      hint: "Saturday or Sunday",
      slot: open.find((slot) => [0, 6].includes(days.find((day) => day.key === slot.day)?.weekday ?? -1)),
    },
    { label: "Morning", hint: "Before noon your time", slot: open.find((slot) => slot.minute < 12 * 60) },
  ]
    .filter((pick): pick is { label: string; hint: string; slot: LocalSlot } => Boolean(pick.slot))
    // A later suggestion that lands on an earlier one's slot adds nothing, so only the first label is kept.
    .filter((pick, index, all) => all.findIndex((other) => other.slot.startsAt === pick.slot.startsAt) === index);

  function choose(slot: LocalSlot) {
    setSelectedStart(slot.startsAt);
    setCell({ day: slot.day, hour: Math.floor(slot.minute / 60) });
    setWeek(Math.floor(days.findIndex((day) => day.key === slot.day) / WEEK));
  }

  const cellDay = cell ? visible.find((day) => day.key === cell.day) : undefined;
  const detail = cellDay && cell ? cellSlots(cellDay, cell.hour) : [];
  const zoneName = (instant: string) =>
    format.zone.formatToParts(Date.parse(instant)).find((part) => part.type === "timeZoneName")?.value ?? zone;
  const tutorFormat = tutorZone && tutorZone !== zone ? formatters(tutorZone) : null;
  const timeRange = (slot: BookableSlot) =>
    `${format.time.format(Date.parse(slot.startsAt))}–${format.time.format(Date.parse(slot.endsAt))}`;

  return (
    <div className={styles.picker}>
      <div className={styles.pickerControls}>
        <div className="field">
          <span className={styles.controlLabel} id="duration-label">
            Session length
          </span>
          <div className={styles.segmented} role="group" aria-labelledby="duration-label">
            {SLOT_DURATIONS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                aria-pressed={duration === minutes}
                onClick={() => setDuration(minutes)}
              >
                {minutes} min
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="slot-zone">Show times in</label>
          <select id="slot-zone" value={zone} onChange={(event) => setZone(event.target.value)}>
            {(TIME_ZONES.includes(zone) ? TIME_ZONES : [zone, ...TIME_ZONES]).map((name) => (
              <option key={name} value={name}>
                {name.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!fresh ? (
        <p className={styles.pickerNote} role="status">
          Loading {duration}-minute times…
        </p>
      ) : "message" in fresh ? (
        <div className="notice warning" role="alert">
          {fresh.message}{" "}
          <button className="button subtle compact" type="button" onClick={() => setReloads((count) => count + 1)}>
            Try again
          </button>
        </div>
      ) : !slots.length ? (
        <p className={styles.pickerNote}>
          This tutor has no open {duration}-minute times in the next two weeks. Try a shorter session or another tutor.
        </p>
      ) : (
        <>
          {!open.length && (
            <p className={styles.pickerNote}>
              No open {duration}-minute times. Choose a booked square to see unavailable ranges, or try a shorter
              session.
            </p>
          )}
          <div className={styles.picks} role="group" aria-label="Suggested times">
            {picks.map(({ label, hint, slot }) => (
              <button
                key={label}
                type="button"
                className={styles.pick}
                aria-pressed={selectedStart === slot.startsAt}
                onClick={() => choose(slot)}
              >
                <span className={styles.pickLabel}>{label}</span>
                <span className={styles.pickTime}>
                  {format.day.format(Date.parse(slot.startsAt))} · {timeRange(slot)}
                </span>
                <span className={styles.pickHint}>{hint}</span>
              </button>
            ))}
          </div>

          <div className={styles.weekBar}>
            <span className={styles.controlLabel}>{week === 0 ? "This week" : "Next week"}</span>
            <div className={styles.weekNav}>
              <button className="button subtle compact" type="button" disabled={week === 0} onClick={() => setWeek(0)}>
                ← This week
              </button>
              <button className="button subtle compact" type="button" disabled={week === 1} onClick={() => setWeek(1)}>
                Next week →
              </button>
            </div>
          </div>

          {columns.length ? (
            <div className={styles.heatScroll}>
              <div
                className={styles.heatmap}
                style={{ gridTemplateColumns: `4.25rem repeat(${columns.length}, minmax(1.1rem, 1fr))` }}
                aria-label={`Open times by hour in ${zone.replaceAll("_", " ")}`}
              >
                <span />
                {columns.map((hour) => (
                  <span key={hour} className={styles.heatHour} aria-hidden="true">
                    {(hour - firstHour) % 2 === 0 ? hourLabel(hour) : ""}
                  </span>
                ))}
                {visible.map((day) => (
                  <div key={day.key} className={styles.heatRow}>
                    <span className={styles.heatDay}>{day.label}</span>
                    {columns.map((hour) => {
                      const inCell = cellSlots(day, hour);
                      const state = cellState(inCell);
                      const openStarts = inCell.filter((slot) => slot.status === "open");
                      const occupied = coverage.get(`${day.key}:${hour}`);
                      const label = `${day.label}, ${hourRange(hour)}: ${state.text}${occupied && selected ? `; selected session ${timeRange(selected)}` : ""}`;
                      return (
                        <button
                          key={hour}
                          type="button"
                          className={styles.heatCell}
                          data-tone={state.tone}
                          data-active={(!occupied && cell?.day === day.key && cell.hour === hour) || undefined}
                          data-selected={Boolean(occupied) || undefined}
                          style={
                            occupied
                              ? ({
                                  "--selection-from": `${(occupied.from / 60) * 100}%`,
                                  "--selection-to": `${(occupied.to / 60) * 100}%`,
                                } as CSSProperties)
                              : undefined
                          }
                          data-slot-starts={openStarts.map((slot) => slot.startsAt).join(" ") || undefined}
                          disabled={!inCell.length}
                          aria-label={label}
                          title={label}
                          onClick={() => setCell({ day: day.key, hour })}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className={styles.pickerNote}>No times this week. Check next week.</p>
          )}

          <ul className={styles.legend} aria-label="Legend">
            <li>
              <i data-selected /> Selected session
            </li>
            <li>
              <i data-tone="many" /> Several open starts
            </li>
            <li>
              <i data-tone="few" /> One open start
            </li>
            <li>
              <i data-tone="booked" /> Booked
            </li>
            <li>
              <i data-tone="soon" /> Too soon to book
            </li>
            <li>
              <i data-tone="off" /> Tutor not available
            </li>
          </ul>

          {cell && detail.length ? (
            <div className={styles.cellDetail}>
              <span className={styles.controlLabel}>
                {cellDay?.label}, starts between {hourRange(cell.hour)}
              </span>
              <div className={styles.slotChips}>
                {detail.map((slot) => (
                  <button
                    key={slot.startsAt}
                    type="button"
                    className={styles.slotChip}
                    data-status={slot.status}
                    data-starts-at={slot.startsAt}
                    aria-pressed={slot.status === "open" ? selectedStart === slot.startsAt : undefined}
                    disabled={slot.status !== "open"}
                    onClick={() => choose(slot)}
                  >
                    {timeRange(slot)}
                    {slot.status !== "open" && <small>{STATUS_TEXT[slot.status]}</small>}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className={styles.pickerNote}>
              Choose a square to see full session ranges. A selected session highlights its entire duration.
            </p>
          )}
        </>
      )}

      <div className={styles.choice} aria-live="polite">
        {selected ? (
          <>
            <span className={styles.controlLabel}>Your session</span>
            <strong className={styles.choiceWhen}>
              {format.long.format(Date.parse(selected.startsAt))} · {format.time.format(Date.parse(selected.startsAt))}–
              {format.time.format(Date.parse(selected.endsAt))} {zoneName(selected.startsAt)}
            </strong>
            {tutorFormat && (
              <span className="hint">
                Tutor&apos;s time: {tutorFormat.day.format(Date.parse(selected.startsAt))},{" "}
                {tutorFormat.time.format(Date.parse(selected.startsAt))}–
                {tutorFormat.time.format(Date.parse(selected.endsAt))} ({tutorZone!.replaceAll("_", " ")})
              </span>
            )}
          </>
        ) : (
          <span className="hint">Pick an open time above. It will appear here.</span>
        )}
        {error && (
          <span id="starts_at-help" className="field-error">
            {error}{" "}
            <button className="button subtle compact" type="button" onClick={() => setReloads((count) => count + 1)}>
              Refresh times
            </button>
          </span>
        )}
        {loading && fresh && <span className="hint">Refreshing times…</span>}
      </div>
      <input type="hidden" name="starts_at" value={selected?.startsAt ?? ""} />
      <input type="hidden" name="ends_at" value={selected?.endsAt ?? ""} />
    </div>
  );
}
