"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/domains/shared/errors";
import { FormResult } from "@/components/form-controls";
import { DateTimeField } from "@/components/date-time-field";

export type WorkflowField = {
  name: string;
  label: string;
  type?:
    "text" | "textarea" | "number" | "date" | "time" | "url" | "select" | "checkbox" | "choices" | "datetime" | "file";
  value?: string;
  checked?: boolean;
  options?: readonly { value: string; label: string }[];
  selected?: readonly string[];
  hint?: string;
  required?: boolean;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  maxLength?: number;
  wide?: boolean;
  accept?: string;
  readOnly?: boolean;
};

export type WorkflowAction = (state: ActionState, form: FormData) => Promise<ActionState>;

/** Small, labelled forms share a pending state, retained inputs, and a focused validation summary. */
export function WorkflowForm({
  action,
  fields = [],
  hidden = {},
  submit,
  title,
  disabled = false,
  refresh = true,
  footer,
  onFieldChange,
}: {
  action: WorkflowAction;
  fields?: readonly WorkflowField[];
  hidden?: Record<string, string>;
  submit: string;
  title: string;
  disabled?: boolean;
  refresh?: boolean;
  footer?: ReactNode;
  onFieldChange?: (name: string, value: string) => void;
}) {
  const [state, dispatch, pending] = useActionState(action, { message: "" });
  const id = useId();
  const summary = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [submitted, setSubmitted] = useState<FormData | null>(null);
  useEffect(() => {
    if (state.message && !state.success) summary.current?.focus();
    if (state.success && refresh) router.refresh();
  }, [state, router, refresh]);
  return (
    <form
      action={dispatch}
      onSubmit={(event) => {
        setSubmitted(new FormData(event.currentTarget));
      }}
      onChange={(event) => {
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement
        )
          onFieldChange?.(target.name, target.value);
      }}
      className="form workflow-form"
      aria-label={title}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {state.message && !state.success && (
        <div ref={summary} tabIndex={-1} className="notice warning workflow-errors" role="alert">
          <strong>{state.message}</strong>
          {!!Object.keys(state.fields ?? {}).length && (
            <ul>
              {Object.entries(state.fields ?? {}).map(([name, message]) => (
                <li key={name}>
                  {fields.some((field) => field.name === name) ? <a href={`#${id}-${name}`}>{message}</a> : message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <fieldset disabled={disabled || pending} className="form-fields">
        <div className="workflow-fields">
          {fields.map((field) => {
            const error = state.fields?.[field.name];
            const failed = !!state.message && !state.success;
            const retained = failed ? (state.values?.[field.name] ?? submitted?.get(field.name)) : undefined;
            const value = typeof retained === "string" ? retained : (field.value ?? "");
            const checked = failed && submitted ? submitted.has(field.name) : field.checked;
            const selected = failed && submitted ? submitted.getAll(field.name).map(String) : field.selected;
            const fieldId = `${id}-${field.name}`;
            const help = error ?? field.hint;
            const props = {
              id: fieldId,
              name: field.name,
              required: field.required,
              readOnly: field.readOnly,
              "aria-invalid": !!error,
              "aria-describedby": help ? `${fieldId}-help` : undefined,
            };
            return (
              <div key={field.name} className={`field ${field.wide ? "field-wide" : ""}`}>
                {field.type === "datetime" ? (
                  <DateTimeField
                    id={fieldId}
                    name={field.name}
                    label={field.label}
                    hint={field.hint ?? "Choose a date and time in UTC."}
                    error={error}
                    required={field.required ?? false}
                    defaultValue={value}
                  />
                ) : field.type === "checkbox" ? (
                  <label className="checkbox" htmlFor={fieldId}>
                    <input {...props} type="checkbox" defaultChecked={checked} />
                    <span>{field.label}</span>
                  </label>
                ) : field.type === "choices" ? (
                  <fieldset className="workflow-choices" id={fieldId} aria-describedby={props["aria-describedby"]}>
                    <legend>{field.label}</legend>
                    {field.options?.map((option) => (
                      <label className="checkbox" key={option.value}>
                        <input
                          type="checkbox"
                          name={field.name}
                          value={option.value}
                          defaultChecked={selected?.includes(option.value)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                    {!field.options?.length && <p className="hint">No eligible choices are available yet.</p>}
                  </fieldset>
                ) : (
                  <>
                    <label htmlFor={fieldId}>
                      {field.label}
                      {!field.required && <span className="hint"> (optional)</span>}
                    </label>
                    {field.type === "textarea" ? (
                      <textarea {...props} rows={4} maxLength={field.maxLength} defaultValue={value} />
                    ) : field.type === "select" ? (
                      <select {...props} key={`${field.name}:${failed ? value : "initial"}`} defaultValue={value}>
                        <option value="">Choose…</option>
                        {field.options?.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : field.type === "file" ? (
                      <input {...props} type="file" accept={field.accept} />
                    ) : (
                      <input
                        {...props}
                        type={field.type ?? "text"}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        maxLength={field.maxLength}
                        defaultValue={value}
                      />
                    )}
                  </>
                )}
                {help && field.type !== "datetime" && (
                  <span id={`${fieldId}-help`} className={error ? "field-error" : "hint"}>
                    {help}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {footer}
        <button className="button primary" type="submit" disabled={disabled || pending}>
          {pending ? "Saving…" : submit}
          <span aria-hidden="true">→</span>
        </button>
      </fieldset>
      {state.success && (
        <>
          <FormResult state={state} />
          {state.values?.savedHref && (
            <Link className="button secondary" href={state.values.savedHref}>
              Open saved work →
            </Link>
          )}
        </>
      )}
    </form>
  );
}
