"use client";

import { useState } from "react";

/** Default date/time control. The picker shows UTC; the server receives strict ISO UTC. */
export function DateTimeField({
  name,
  label,
  hint,
  error,
  defaultValue = "",
  required = true,
  id = name,
}: {
  name: string;
  label: string;
  hint: string;
  error?: string;
  defaultValue?: string;
  required?: boolean;
  id?: string;
}) {
  const [value, setValue] = useState(defaultValue.replace(/Z$/, "").slice(0, 16));
  const helpId = `${id}-help`;
  return (
    <div className="field">
      <label htmlFor={id}>{label} (UTC)</label>
      <input
        id={id}
        type="datetime-local"
        required={required}
        step={60}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-invalid={!!error}
        aria-describedby={helpId}
      />
      <input type="hidden" name={name} value={value ? `${value}Z` : ""} />
      <span id={helpId} className={error ? "field-error" : "hint"}>
        {error ?? hint}
      </span>
    </div>
  );
}
