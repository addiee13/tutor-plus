export type ErrorCode = "configuration" | "validation" | "unauthenticated" | "unverified" | "expired" | "forbidden" | "unavailable" | "credentials";

const messages: Record<ErrorCode, string> = {
  configuration: "Account services are not connected yet. Please try again after setup is complete.",
  validation: "Please check the highlighted details and try again.",
  unauthenticated: "Please sign in to continue.",
  unverified: "Please verify your email before continuing.",
  expired: "Your session has ended. Please sign in again.",
  forbidden: "This action is not available for your account.",
  unavailable: "We couldn’t complete that right now. Please try again shortly.",
  credentials: "We couldn’t sign you in. Check your details and verify your email."
};

export class DomainError extends Error {
  constructor(public readonly code: ErrorCode) { super(messages[code]); }
}

export type ActionState = { message: string; success?: boolean; fields?: Record<string, string>; values?: Record<string, string> };

export function safeMessage(error: unknown): string {
  return error instanceof DomainError ? error.message : messages.unavailable;
}
