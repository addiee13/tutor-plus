import type { ReactNode } from "react";
import type { ActionState } from "@/domains/shared/errors";
import { TIME_ZONES } from "@/lib/time-zones";

type FieldProps = {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  minLength?: number;
  maxLength?: number;
  inputMode?: "numeric" | "email" | "text";
  pattern?: string;
};

export function Field({ label, name, error, hint, ...inputProps }: FieldProps) {
  const help = error || hint;
  const helpId = `${name}-help`;
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        required
        aria-invalid={!!error}
        aria-describedby={help ? helpId : undefined}
        {...inputProps}
      />
      {help && (
        <span id={helpId} className={error ? "field-error" : "hint"}>
          {help}
        </span>
      )}
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  return message ? <span className="field-error">{message}</span> : null;
}

/** Announces the outcome of a submission: politely on success, assertively on failure. */
export function FormResult({ state }: { state: Pick<ActionState, "message" | "success"> }) {
  if (!state.message) return null;
  return (
    <div className={`notice ${state.success ? "success" : "warning"}`} role={state.success ? "status" : "alert"}>
      {state.message}
    </div>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button className="button primary" disabled={pending} type="submit">
      {pending ? "Please wait…" : children}
      <span aria-hidden="true">→</span>
    </button>
  );
}

export function RoleIntentField({ defaultValue = "student", error }: { defaultValue?: string; error?: string }) {
  return (
    <div className="field">
      <label htmlFor="role_intent">I’m here to</label>
      <select id="role_intent" name="role_intent" defaultValue={defaultValue}>
        <option value="student">Learn as a student</option>
        <option value="tutor">Teach as a tutor</option>
      </select>
      <FieldError message={error} />
    </div>
  );
}

const TIME_ZONE_GROUPS = TIME_ZONES.reduce<Map<string, string[]>>((groups, zone) => {
  const region = zone.includes("/") ? zone.slice(0, zone.indexOf("/")) : "General";
  groups.set(region, [...(groups.get(region) ?? []), zone]);
  return groups;
}, new Map());

export function TimeZoneField({ defaultValue, hint, error }: { defaultValue: string; hint?: string; error?: string }) {
  const help = error || hint;
  const helpId = "timezone-help";
  // Keep a previously saved zone selectable even if this ICU snapshot no longer lists it.
  const legacy = defaultValue && !TIME_ZONES.includes(defaultValue) ? defaultValue : null;
  return (
    <div className="field">
      <label htmlFor="timezone">Time zone</label>
      <select
        id="timezone"
        name="timezone"
        required
        defaultValue={defaultValue}
        aria-invalid={!!error}
        aria-describedby={help ? helpId : undefined}
      >
        {legacy && <option value={legacy}>{legacy.replaceAll("_", " ")}</option>}
        {[...TIME_ZONE_GROUPS].map(([region, zones]) => (
          <optgroup key={region} label={region}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {help && (
        <span id={helpId} className={error ? "field-error" : "hint"}>
          {help}
        </span>
      )}
    </div>
  );
}

export function AdultAttestationField({ error }: { error?: string }) {
  return (
    <>
      <label className="checkbox">
        <input type="checkbox" name="adult_attested" required />
        <span>I confirm that I am at least 18 years old.</span>
      </label>
      <FieldError message={error} />
    </>
  );
}
