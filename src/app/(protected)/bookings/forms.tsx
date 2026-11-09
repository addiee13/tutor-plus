"use client";

import Link from "next/link";
import { useActionState, useCallback, useId, useState } from "react";
import type { BookingActionState, PublicSubject, PublicTutor, TutorSubject } from "@/domains/bookings/types";
import { formatMoney } from "@/domains/bookings/presentation";
import { FormResult } from "@/components/form-controls";
import styles from "./bookings.module.css";
import { cancelBookingAction, requestBookingAction, rescheduleBookingAction } from "./actions";
import { SlotPicker } from "./slot-picker";

const initial: BookingActionState = { message: "" };

function Help({ name, state, hint }: { name: string; state: BookingActionState; hint: string }) {
  return (
    <span id={`${name}-help`} className={state.fields?.[name] ? "field-error" : "hint"}>
      {state.fields?.[name] ?? hint}
    </span>
  );
}

type RequestFormProps = {
  tutors: PublicTutor[];
  subjects: PublicSubject[];
  links: TutorSubject[];
  readableSubjectTutorIds: string[];
  requestKey: string;
  /** The student's profile time zone, used as the picker's starting display zone. */
  timezone: string;
  /** Each tutor's availability time zone, keyed by tutor ID. */
  tutorZones: Record<string, string>;
  initialTutorId?: string;
};

/** Remounts the request form with a fresh idempotency key when the student starts another reservation. */
export function BookingRequestForm(props: RequestFormProps) {
  const [requestKey, setRequestKey] = useState(props.requestKey);
  return (
    <RequestForm
      key={requestKey}
      {...props}
      requestKey={requestKey}
      onAnother={() => setRequestKey(crypto.randomUUID())}
    />
  );
}

function RequestForm({
  tutors,
  subjects,
  links,
  readableSubjectTutorIds,
  requestKey,
  timezone,
  tutorZones,
  onAnother,
  initialTutorId,
}: RequestFormProps & { onAnother: () => void }) {
  const [state, action, pending] = useActionState(requestBookingAction, initial);
  const [selectedId, setSelectedId] = useState(
    tutors.some((tutor) => tutor.id === initialTutorId) ? initialTutorId! : (tutors[0]?.id ?? ""),
  );
  const [hasSlot, setHasSlot] = useState(false);
  const onSlotChange = useCallback((selected: boolean) => setHasSlot(selected), []);
  const selected = tutors.find((tutor) => tutor.id === selectedId);
  const readableLinks = links.filter((link) => link.tutor_id === selectedId);
  const subjectsReadable = readableSubjectTutorIds.includes(selectedId);
  const offeredSubjects = subjectsReadable
    ? subjects.filter((subject) => readableLinks.some((link) => link.subject_id === subject.id))
    : [];
  return (
    <form className="form" action={action} aria-label="Request a booking">
      <input type="hidden" name="request_key" value={requestKey} />
      <fieldset className="form-fields" disabled={pending || state.success || !tutors.length}>
        <div className="field">
          <label htmlFor="tutor">Published tutor</label>
          <select
            id="tutor"
            name="tutor"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            required
            aria-invalid={!!state.fields?.tutor}
            aria-describedby="tutor-help"
          >
            {tutors.map((tutor) => (
              <option key={tutor.id} value={tutor.id}>
                {tutor.public_display_name} · {formatMoney(tutor.hourly_rate_minor, tutor.currency)}/hour
              </option>
            ))}
          </select>
          <Help
            name="tutor"
            state={state}
            hint="Only currently published tutor listings are offered. You cannot reserve your own tutor listing."
          />
        </div>
        <div className="field">
          <label htmlFor="subject">Subject</label>
          <select
            key={selectedId}
            id="subject"
            name="subject"
            required
            defaultValue=""
            aria-invalid={!!state.fields?.subject}
            aria-describedby="subject-help"
          >
            <option value="" disabled>
              Choose a subject
            </option>
            {offeredSubjects.map((subject) => {
              const offering = readableLinks.find((link) => link.subject_id === subject.id);
              return (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                  {offering ? ` · ${formatMoney(offering.hourly_rate_minor, offering.currency)}/hour` : ""}
                </option>
              );
            })}
          </select>
          <Help
            name="subject"
            state={state}
            hint={
              offeredSubjects.length
                ? "Published subjects and effective hourly rates are read through the safe public catalog RPC. SQL rechecks both on submission."
                : "No published subject offerings could be loaded for this tutor. Refresh or choose another tutor; requests are disabled rather than inventing an offering."
            }
          />
        </div>
        <div className="field">
          <label htmlFor="mode">Session mode</label>
          <select
            key={selectedId}
            id="mode"
            name="mode"
            required
            aria-invalid={!!state.fields?.mode}
            aria-describedby="mode-help"
          >
            {selected?.supports_virtual && <option value="virtual">Virtual</option>}
            {selected?.supports_in_person && <option value="in_person">In person</option>}
          </select>
          <Help
            name="mode"
            state={state}
            hint="Only modes on the public listing are offered. Meeting details are not created by this reservation."
          />
        </div>
        <details className="workspace-details">
          <summary>Add learning context & private notes (optional)</summary>
          <div className="form-fields">
            <div className="field">
              <label htmlFor="request-learning-goal">Learning goal</label>
              <textarea id="request-learning-goal" name="learningGoal" rows={3} maxLength={500} />
            </div>
            <div className="field">
              <label htmlFor="request-topics">Topics</label>
              <input id="request-topics" name="topics" maxLength={800} />
              <span className="hint">Separate topics with commas.</span>
            </div>
            <div className="field">
              <label htmlFor="request-questions">Questions for the session</label>
              <textarea id="request-questions" name="questions" rows={3} maxLength={2000} />
            </div>
            <label className="checkbox">
              <input type="checkbox" name="shareWithTutor" />
              <span>Share this goal, topics and questions with the tutor on this request.</span>
            </label>
            <div className="field">
              <label htmlFor="request-private-note">Private note — only you</label>
              <textarea id="request-private-note" name="privateNote" rows={3} maxLength={1000} />
            </div>
          </div>
        </details>
        <fieldset className={`field ${styles.slotField}`}>
          <legend>Choose a time</legend>
          <SlotPicker
            key={selectedId}
            tutorId={selectedId}
            tutorZone={tutorZones[selectedId]}
            initialZone={timezone}
            error={state.fields?.starts_at ?? state.fields?.ends_at}
            onSelectionChange={onSlotChange}
          />
        </fieldset>
        <p className="hint">
          Only open times can be picked. The database rechecks the time, subject and mode when you submit, so a slot
          taken in the meantime is refused rather than double-booked.
        </p>
        <button
          className="button primary full"
          type="submit"
          disabled={pending || state.success || !selected || !offeredSubjects.length || !hasSlot}
        >
          {pending ? "Saving reservation…" : "Request reservation — no charge"}
        </button>
      </fieldset>
      <FormResult state={state} />
      {state.success && state.bookingId && (
        <Link className="button secondary" href={`/bookings/${state.bookingId}`}>
          Review saved booking & notes →
        </Link>
      )}
      {state.success && (
        <button className="button secondary" type="button" onClick={onAnother}>
          Start another reservation
        </button>
      )}
    </form>
  );
}

export function BookingCancellationForm({ bookingId }: { bookingId: string }) {
  const [state, action, pending] = useActionState(cancelBookingAction, initial);
  const reasonId = useId();
  return (
    <form className="form" action={action} aria-label="Cancel this reservation">
      <input type="hidden" name="booking" value={bookingId} />
      <fieldset className="form-fields" disabled={pending || state.success}>
        <div className="field">
          <label htmlFor={reasonId}>Cancellation reason</label>
          <textarea
            id={reasonId}
            name="reason"
            required
            minLength={1}
            maxLength={500}
            rows={3}
            aria-invalid={!!state.fields?.reason}
            aria-describedby={`${reasonId}-help`}
          />
          <span id={`${reasonId}-help`} className={state.fields?.reason ? "field-error" : "hint"}>
            {state.fields?.reason ??
              "Required, up to 500 characters. The recorded reason is visible to the booking participants."}
          </span>
        </div>
        <button type="submit" className="button secondary" disabled={pending || state.success}>
          {pending ? "Saving cancellation…" : "Save cancellation"}
        </button>
      </fieldset>
      <FormResult state={state} />
    </form>
  );
}

type RescheduleProps = {
  booking: { id: string; tutor_id: string; subject_id: string; mode: string; status: string };
  timezone: string;
  requestKey: string;
};
/** Load slot availability only when a participant opens this booking's time-change form. */
export function BookingRescheduleControls(props: RescheduleProps) {
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.cancel} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {props.booking.status === "confirmed" ? "Reschedule confirmed session" : "Move pending reservation"}
      </summary>
      {open && <BookingRescheduleForm {...props} />}
    </details>
  );
}

export function BookingRescheduleForm({
  booking,
  timezone,
  requestKey,
}: {
  booking: { id: string; tutor_id: string; subject_id: string; mode: string; status: string };
  timezone: string;
  requestKey: string;
}) {
  const [state, action, pending] = useActionState(rescheduleBookingAction, initial);
  const [hasSlot, setHasSlot] = useState(false);
  const onSlotChange = useCallback((selected: boolean) => setHasSlot(selected), []);
  return (
    <form
      action={action}
      className="form"
      aria-label={booking.status === "confirmed" ? "Reschedule confirmed session" : "Reschedule pending reservation"}
    >
      <input type="hidden" name="bookingId" value={booking.id} />
      <input type="hidden" name="tutorId" value={booking.tutor_id} />
      <input type="hidden" name="subjectId" value={booking.subject_id} />
      <input type="hidden" name="mode" value={booking.mode} />
      <input type="hidden" name="requestKey" value={requestKey} />
      <fieldset className="form-fields" disabled={pending || state.success}>
        <p className="hint">
          Choose a new open time with the same tutor, subject and mode. If the change cannot be saved, your original
          time stays in place.
        </p>
        <SlotPicker
          tutorId={booking.tutor_id}
          initialZone={timezone}
          error={state.fields?.startsAt ?? state.fields?.starts_at}
          onSelectionChange={onSlotChange}
        />
        {booking.status === "confirmed" && (
          <>
            <div className="field">
              <label htmlFor={`reschedule-reason-${booking.id}`}>Reason for the time change</label>
              <textarea id={`reschedule-reason-${booking.id}`} name="reason" required maxLength={500} rows={3} />
            </div>
            <label className="checkbox">
              <input type="checkbox" name="confirmed_move" required />
              <span>I confirm this change to the confirmed session time.</span>
            </label>
            <p className="hint">
              The existing booking and financial records are retained. This time change creates no charge.
            </p>
          </>
        )}
        <button type="submit" className="button secondary" disabled={pending || state.success || !hasSlot}>
          {pending
            ? "Saving new time…"
            : booking.status === "confirmed"
              ? "Confirm new session time"
              : "Move pending reservation"}
        </button>
      </fieldset>
      <FormResult state={state} />
    </form>
  );
}
