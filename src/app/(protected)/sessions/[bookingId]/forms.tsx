"use client";

import { useActionState } from "react";
import type { SessionActionState } from "@/domains/sessions/types";
import { FormResult } from "@/components/form-controls";
import {
  markCompletedAction,
  publishRecapAction,
  saveAgendaAction,
  saveGoalsAction,
  saveReflectionAction,
} from "./actions";
import styles from "../sessions.module.css";

const initial: SessionActionState = { message: "" };

type AreaProps = {
  name: string;
  label: string;
  state: SessionActionState;
  saved: string | null | undefined;
  maxLength: number;
  hint: string;
  required?: boolean;
  rows?: number;
};

/** A textarea that keeps the user's text after a refused save and shows the saved text after a successful one. */
function TextArea({ name, label, state, saved, maxLength, hint, required = false, rows = 4 }: AreaProps) {
  const error = state.fields?.[name];
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <textarea
        id={name}
        name={name}
        className={styles.textarea}
        rows={rows}
        maxLength={maxLength}
        required={required}
        defaultValue={state.values?.[name] ?? saved ?? ""}
        aria-invalid={!!error}
        aria-describedby={`${name}-help`}
      />
      <span id={`${name}-help`} className={error ? "field-error" : "hint"}>
        {error ?? hint}
      </span>
    </div>
  );
}

function Submit({ pending, children }: { pending: boolean; children: string }) {
  return (
    <button className="button primary" type="submit" disabled={pending}>
      {pending ? "Saving…" : children}
      <span aria-hidden="true">→</span>
    </button>
  );
}

export function GoalsForm({
  bookingId,
  goals,
  questions,
}: {
  bookingId: string;
  goals?: string | null;
  questions?: string | null;
}) {
  const [state, action, pending] = useActionState(saveGoalsAction, initial);
  return (
    <form className="form" action={action} aria-label="Save session goals">
      <input type="hidden" name="booking" value={bookingId} />
      <fieldset className="form-fields" disabled={pending}>
        <TextArea
          name="goals"
          label="Goals for this session"
          state={state}
          saved={goals}
          maxLength={2000}
          required
          hint="What would make this session a success? Required, up to 2,000 characters."
        />
        <TextArea
          name="questions"
          label="Questions for your tutor"
          state={state}
          saved={questions}
          maxLength={2000}
          rows={3}
          hint="Optional, up to 2,000 characters."
        />
        <Submit pending={pending}>Save goals</Submit>
      </fieldset>
      <FormResult state={state} />
    </form>
  );
}

export function AgendaForm({ bookingId, agenda }: { bookingId: string; agenda?: string | null }) {
  const [state, action, pending] = useActionState(saveAgendaAction, initial);
  return (
    <form className="form" action={action} aria-label="Save session agenda">
      <input type="hidden" name="booking" value={bookingId} />
      <fieldset className="form-fields" disabled={pending}>
        <TextArea
          name="agenda"
          label="Session agenda"
          state={state}
          saved={agenda}
          maxLength={4000}
          rows={6}
          required
          hint="Outline the plan for the lesson. Required, up to 4,000 characters."
        />
        <Submit pending={pending}>Save agenda</Submit>
      </fieldset>
      <FormResult state={state} />
    </form>
  );
}

export function CompleteSessionForm({ bookingId }: { bookingId: string }) {
  const [state, action, pending] = useActionState(markCompletedAction, initial);
  return (
    <form className="form" action={action} aria-label="Mark session delivered">
      <input type="hidden" name="booking" value={bookingId} />
      <button className="button secondary" type="submit" disabled={pending || state.success}>
        {pending ? "Saving…" : "Mark session as delivered"}
      </button>
      <FormResult state={{ ...state, message: state.fields?.booking ?? state.message }} />
    </form>
  );
}

type RecapProps = {
  bookingId: string;
  summary?: string | null;
  masteryNotes?: string | null;
  nextSteps?: string | null;
  published: boolean;
};

export function RecapForm({ bookingId, summary, masteryNotes, nextSteps, published }: RecapProps) {
  const [state, action, pending] = useActionState(publishRecapAction, initial);
  return (
    <form className="form" action={action} aria-label="Publish session recap">
      <input type="hidden" name="booking" value={bookingId} />
      <fieldset className="form-fields" disabled={pending}>
        <TextArea
          name="summary"
          label="What you covered"
          state={state}
          saved={summary}
          maxLength={4000}
          rows={4}
          required
          hint="Required, up to 4,000 characters. Your student can read the published recap."
        />
        <TextArea
          name="mastery_notes"
          label="Mastery notes"
          state={state}
          saved={masteryNotes}
          maxLength={2000}
          rows={3}
          hint="Optional. Strengths and areas to practise, based on what you observed."
        />
        <TextArea
          name="next_steps"
          label="Next steps"
          state={state}
          saved={nextSteps}
          maxLength={2000}
          rows={3}
          hint="Optional. Practice or preparation for the next session."
        />
        <Submit pending={pending}>{published ? "Update recap" : "Publish recap"}</Submit>
      </fieldset>
      <FormResult state={state} />
    </form>
  );
}

export function ReflectionForm({ bookingId, reflection }: { bookingId: string; reflection?: string | null }) {
  const [state, action, pending] = useActionState(saveReflectionAction, initial);
  return (
    <form className="form" action={action} aria-label="Save private reflection">
      <input type="hidden" name="booking" value={bookingId} />
      <fieldset className="form-fields" disabled={pending}>
        <TextArea
          name="reflection"
          label="Your private reflection"
          state={state}
          saved={reflection}
          maxLength={4000}
          rows={4}
          required
          hint="Only you can read this. Your tutor never sees it. Up to 4,000 characters."
        />
        <Submit pending={pending}>Save reflection</Submit>
      </fieldset>
      <FormResult state={state} />
    </form>
  );
}
