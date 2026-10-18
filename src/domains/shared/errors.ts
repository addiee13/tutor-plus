export type ErrorCode =
  | "configuration"
  | "validation"
  | "unauthenticated"
  | "unverified"
  | "expired"
  | "forbidden"
  | "unavailable"
  | "credentials"
  | "onboarding"
  | "rateLimited";

const messages: Record<ErrorCode, string> = {
  configuration: "Account services are not connected yet. Please try again after setup is complete.",
  validation: "Please check the highlighted details and try again.",
  unauthenticated: "Please sign in to continue.",
  unverified: "Please verify your email before continuing.",
  expired: "Your session has ended. Please sign in again.",
  forbidden: "This action is not available for your account.",
  unavailable: "We couldn’t complete that right now. Please try again shortly.",
  credentials: "We couldn’t sign you in. Check your details and verify your email.",
  onboarding: "Please finish setting up your account to continue.",
  rateLimited: "Too many emails were requested recently. Please wait before trying again.",
};

export class DomainError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(messages[code]);
    this.name = "DomainError";
  }
}

/** Maps provider failures without logging tokens, email addresses, or provider response bodies. */
export function providerError(error: { status?: number; code?: string }): DomainError {
  const rateLimited =
    error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit";
  return new DomainError(rateLimited ? "rateLimited" : "unavailable");
}

export type FieldErrors = Record<string, string>;

/** A validation failure that carries a user-facing message for each offending form field. */
export class InputError extends DomainError {
  constructor(public readonly fields: FieldErrors) {
    super("validation");
    this.name = "InputError";
  }
}

export function isDomainError(error: unknown, code?: ErrorCode): error is DomainError {
  return error instanceof DomainError && (code === undefined || error.code === code);
}

export type ActionState = {
  message: string;
  success?: boolean;
  fields?: FieldErrors;
  values?: Record<string, string>;
};

/** Never leaks unexpected error details to the browser. */
export function safeMessage(error: unknown): string {
  return error instanceof DomainError ? error.message : messages.unavailable;
}
