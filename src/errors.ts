/**
 * Stable error codes for safe-fragment.
 *
 * These strings are part of the public API: application code is expected to
 * switch on `SafeFragmentError#code`, not on `#message` (message text may
 * change between patch versions; codes will not, except via a major bump).
 */
export type SafeFragmentErrorCode =
  // Source resolution
  | "AMBIGUOUS_SOURCE"
  | "NO_SOURCE"
  /** A source value that is not a string (e.g. `el.html = {}`); never rendered as `[object Object]`. */
  | "INVALID_SOURCE"
  /** The source exceeds `maxInputLength` (bounds the sanitizer's worst-case cost). */
  | "SOURCE_TOO_LARGE"
  // Profiles
  | "UNKNOWN_PROFILE"
  /** A profile definition whose name and `version` disagree (e.g. `"x-v2"` declaring version 1). */
  | "PROFILE_MISMATCH"
  /** `registerProfile`/`defineProfile` called with missing or invalid arguments, or colliding with a built-in. */
  | "INVALID_PROFILE"
  // Sanitization
  | "SANITIZE_FAILED"
  | "SANITIZER_UNAVAILABLE"
  | "SANITIZER_NOT_READY"
  // Remote `src` fetch policy
  | "FETCH_DISABLED"
  | "FETCH_ORIGIN_NOT_ALLOWED"
  | "FETCH_REDIRECT_NOT_ALLOWED"
  | "FETCH_SIZE_EXCEEDED"
  | "FETCH_TIMEOUT"
  | "FETCH_ABORTED"
  | "FETCH_FAILED"
  | "FETCH_NON_2XX"
  | "FETCH_SUPERSEDED"
  // Element / environment state
  | "DISABLED"
  | "UNSUPPORTED_ENVIRONMENT"
  | "RENDER_ABORTED";

export interface SafeFragmentErrorOptions {
  cause?: unknown;
  details?: Record<string, unknown>;
}

/**
 * The single error type safe-fragment throws or attaches to `reject`
 * events. Always carries a stable `code` in addition to a human-readable
 * `message`.
 */
export class SafeFragmentError extends Error {
  readonly code: SafeFragmentErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: SafeFragmentErrorCode, message: string, options: SafeFragmentErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "SafeFragmentError";
    this.code = code;
    this.details = options.details;
  }
}

/** Type guard for `SafeFragmentError`, safe to use across realms (checks `.code` shape, not `instanceof`). */
export function isSafeFragmentError(value: unknown): value is SafeFragmentError {
  return typeof value === "object" && value !== null && "code" in value && "message" in value && (value as { name?: unknown }).name === "SafeFragmentError";
}
