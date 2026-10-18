"use client";

import { useState } from "react";

/** Default date/time control. The picker shows UTC; the server receives strict ISO UTC. */
export function DateTimeField({
  name,
  label,
  hint,
  error,
}: {
  name: string;
  label: string;
  hint: string;
  error?: string;
}) {
  const [value, setValue] = useState("");
  const helpId = `${name}-help`;
  return (
    <div className="field">
      <label htmlFor={name}>{label} (UTC)</label>
      <input
        id={name}
        type="datetime-local"
        required
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
