import { DomainError, InputError, type FieldErrors } from "../shared/errors";
import { readText, UUID_PATTERN } from "../shared/form";

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 80;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const REASON_MAX = 500;
const EMAIL_MAX = 254;
const TIME_ZONE_MAX = 100;

export const oauthProviders = ["github", "google"] as const;
export type OAuthProvider = (typeof oauthProviders)[number];

const roleIntents = ["student", "tutor"] as const;
const applicationRoles = ["student", "tutor", "administrator"] as const;
const roleOperations = ["grant", "revoke"] as const;
const accountStatuses = ["active", "inactive"] as const;

function isOneOf<T extends string>(options: readonly T[], value: string): value is T {
  return (options as readonly string[]).includes(value);
}

export function isTimeZone(value: string): boolean {
  if (!value || value.length > TIME_ZONE_MAX || (!value.includes("/") && value !== "UTC")) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function parseProfile(form: FormData) {
  const displayName = readText(form, "display_name");
  const timezone = readText(form, "timezone");
  const fields: FieldErrors = {};
  if (
    displayName.length < DISPLAY_NAME_MIN ||
    displayName.length > DISPLAY_NAME_MAX ||
    /[\u0000-\u001f\u007f]/.test(displayName)
  ) {
    fields.display_name = `Use a name between ${DISPLAY_NAME_MIN} and ${DISPLAY_NAME_MAX} characters.`;
  }
  if (!isTimeZone(timezone)) fields.timezone = "Choose an IANA time zone, such as America/New_York.";
  if (Object.keys(fields).length) throw new InputError(fields);
  return { display_name: displayName, timezone };
}

export function parseEmail(form: FormData): string {
  const email = readText(form, "email").toLowerCase();
  if (email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InputError({ email: "Enter a valid email address." });
  }
  return email;
}

/** `strong` enforces the registration length policy; sign-in only requires a non-empty value. */
export function parsePassword(form: FormData, strong = true): string {
  const password = form.get("password");
  const min = strong ? PASSWORD_MIN : 1;
  if (typeof password !== "string" || password.length < min || password.length > PASSWORD_MAX) {
    throw new InputError({
      password: strong
        ? `Use a password between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`
        : "Enter your password.",
    });
  }
  return password;
}

function parseIntent(form: FormData) {
  const roleIntent = readText(form, "role_intent");
  if (!isOneOf(roleIntents, roleIntent)) throw new InputError({ role_intent: "Choose Student or Tutor." });
  if (form.get("adult_attested") !== "on") {
    throw new InputError({ adult_attested: "You must confirm you are at least 18 years old." });
  }
  return { role_intent: roleIntent };
}

export function parseSignup(form: FormData) {
  const profile = parseProfile(form);
  const email = parseEmail(form);
  const password = parsePassword(form);
  return { ...profile, ...parseIntent(form), email, password, adult_attested: true };
}

export function parseOnboarding(form: FormData) {
  const profile = parseProfile(form);
  return {
    chosen_name: profile.display_name,
    chosen_timezone: profile.timezone,
    requested_role: parseIntent(form).role_intent,
  };
}

export function parseOtp(form: FormData): string {
  const token = readText(form, "code").replace(/\s+/g, "");
  if (!/^\d{6,8}$/.test(token)) throw new InputError({ code: "Enter the code from your email." });
  return token;
}

export function parseProvider(form: FormData): OAuthProvider {
  const provider = readText(form, "provider");
  if (!isOneOf(oauthProviders, provider)) throw new DomainError("validation");
  return provider;
}

function parseUserId(form: FormData, field: string): string {
  const target = readText(form, field);
  if (!UUID_PATTERN.test(target)) throw new InputError({ [field]: "Enter the account’s full user ID." });
  return target;
}

export function parseRoleChange(form: FormData) {
  const target = parseUserId(form, "target");
  const role = readText(form, "requested_role");
  const operation = readText(form, "operation");
  if (!isOneOf(applicationRoles, role)) throw new InputError({ requested_role: "Choose an application role." });
  if (!isOneOf(roleOperations, operation)) throw new InputError({ operation: "Choose Grant or Revoke." });
  return { target, requested_role: role, operation };
}

export function parseStatusChange(form: FormData) {
  const target = parseUserId(form, "status_target");
  const requestedStatus = readText(form, "requested_status");
  const reason = readText(form, "reason");
  if (!isOneOf(accountStatuses, requestedStatus)) {
    throw new InputError({ requested_status: "Choose an account status." });
  }
  if (!reason || reason.length > REASON_MAX) {
    throw new InputError({ reason: `Give a reason between 1 and ${REASON_MAX} characters.` });
  }
  return { target, requested_status: requestedStatus, reason };
}
