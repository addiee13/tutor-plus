import { DomainError } from "../shared/errors";

export class InputError extends DomainError {
  constructor(public readonly fields: Record<string, string>) { super("validation"); }
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function isTimeZone(value: string): boolean {
  if (!value || value.length > 100 || (!value.includes("/") && value !== "UTC")) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}

export function parseProfile(form: FormData) {
  const displayName = text(form, "display_name");
  const timezone = text(form, "timezone");
  const fields: Record<string, string> = {};
  if (displayName.length < 2 || displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName)) fields.display_name = "Use a name between 2 and 80 characters.";
  if (!isTimeZone(timezone)) fields.timezone = "Choose an IANA time zone, such as America/New_York.";
  if (Object.keys(fields).length) throw new InputError(fields);
  return { display_name: displayName, timezone };
}

export function parseEmail(form: FormData): string {
  const email = text(form, "email").toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError({ email: "Enter a valid email address." });
  return email;
}

export function parsePassword(form: FormData, strong = true): string {
  const password = form.get("password");
  if (typeof password !== "string" || password.length > 128 || password.length < (strong ? 12 : 1)) throw new InputError({ password: strong ? "Use a password between 12 and 128 characters." : "Enter your password." });
  return password;
}

export function parseSignup(form: FormData) {
  const profile = parseProfile(form);
  const email = parseEmail(form);
  const password = parsePassword(form);
  const roleIntent = text(form, "role_intent");
  if (roleIntent !== "student" && roleIntent !== "tutor") throw new InputError({ role_intent: "Choose Student or Tutor." });
  if (form.get("adult_attested") !== "on") throw new InputError({ adult_attested: "You must confirm you are at least 18 years old." });
  return { ...profile, email, password, role_intent: roleIntent, adult_attested: true };
}

export function parseRoleChange(form: FormData) {
  const target = text(form, "target");
  const role = text(form, "requested_role");
  const operation = text(form, "operation");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) throw new InputError({ target: "Enter the account’s full user ID." });
  if (role !== "student" && role !== "tutor" && role !== "administrator") throw new InputError({ requested_role: "Choose an application role." });
  if (operation !== "grant" && operation !== "revoke") throw new InputError({ operation: "Choose Grant or Revoke." });
  return { target, requested_role: role, operation };
}

export function parseStatusChange(form: FormData) {
  const target = text(form, "status_target");
  const requested_status = text(form, "requested_status");
  const reason = text(form, "reason");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) throw new InputError({ status_target: "Enter the account’s full user ID." });
  if (requested_status !== "active" && requested_status !== "inactive") throw new InputError({ requested_status: "Choose an account status." });
  if (!reason || reason.length > 500) throw new InputError({ reason: "Give a reason between 1 and 500 characters." });
  return { target, requested_status, reason };
}
