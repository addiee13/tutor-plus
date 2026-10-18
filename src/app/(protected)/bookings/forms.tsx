"use client";

import { useActionState, useId, useState } from "react";
import type { BookingActionState, PublicSubject, PublicTutor, TutorSubject } from "@/domains/bookings/types";
import { formatMoney } from "@/domains/bookings/presentation";
import { FormResult } from "@/components/form-controls";
import { cancelBookingAction, requestBookingAction } from "./actions";

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
  onAnother,
}: RequestFormProps & { onAnother: () => void }) {
  const [state, action, pending] = useActionState(requestBookingAction, initial);
  const [selectedId, setSelectedId] = useState(tutors[0]?.id ?? "");
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
        <div className="field">
          <label htmlFor="starts_at">Start time (ISO UTC)</label>
          <input
            id="starts_at"
            name="starts_at"
            type="text"
            placeholder="2026-10-02T14:00:00Z"
            required
            maxLength={24}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!state.fields?.starts_at}
            aria-describedby="starts_at-help"
          />
          <Help
            name="starts_at"
            state={state}
            hint="Use UTC, ending in Z. This is not your browser or profile time zone. Enter a future time within the tutor’s shared availability."
          />
        </div>
        <div className="field">
          <label htmlFor="ends_at">End time (ISO UTC)</label>
          <input
            id="ends_at"
            name="ends_at"
            type="text"
            placeholder="2026-10-02T15:00:00Z"
            required
            maxLength={24}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!state.fields?.ends_at}
            aria-describedby="ends_at-help"
          />
          <Help
            name="ends_at"
            state={state}
            hint="Use UTC, ending in Z. This form accepts whole-minute sessions of 15–180 minutes; database policy remains authoritative."
          />
        </div>
        <p className="hint">
          Schedule summaries are not bookable slot guarantees. The database rechecks subject, mode, lead time, buffers
          and competing reservations atomically when you submit.
        </p>
        <button
          className="button primary full"
          type="submit"
          disabled={pending || state.success || !selected || !offeredSubjects.length}
        >
          {pending ? "Saving reservation…" : "Request reservation — no charge"}
        </button>
      </fieldset>
      <FormResult state={state} />
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
