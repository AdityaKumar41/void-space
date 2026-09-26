/**
 * The one error type callers of this SDK catch.
 *
 * VOID·SPACE's API answers every non-2xx with the same envelope and a stable `code`
 * (`apiErrorSchema` in `@void-space/types`, SDD §1.1). The `code` — not the HTTP status
 * and never the message — is what a caller branches on, so it is lifted onto the error
 * as a first-class field. `requestId` is carried too, because it is the join key between
 * a failure a Creator sees in VOID·STUDIO and the API log line that explains it.
 */

/** Codes that mean "this credential is no good" — the caller should re-exchange (§1.2). */
const CREDENTIAL_CODES: readonly string[] = [
  'NO_TOKEN',
  'TOKEN_INVALID',
  'API_KEY_INVALID',
  'INVALID_CREDENTIALS',
];

export class VoidSpaceError extends Error {
  /** HTTP status, or 0 when the request never completed (network/timeout/DNS). */
  readonly status: number;
  /** Stable discriminator from the API's error envelope; synthesized for transport failures. */
  readonly code: string;
  /** Structured detail the API chose to disclose (e.g. which permission was missing). */
  readonly details: unknown;
  /** Correlates with the API's request log (SDD §1.1). Absent on transport failures. */
  readonly requestId: string | undefined;

  constructor(
    message: string,
    options: { status: number; code: string; details?: unknown; requestId?: string | undefined },
  ) {
    super(message);
    this.name = 'VoidSpaceError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId;
  }

  /**
   * True when the API rejected the credential rather than the request.
   *
   * Callers use this to re-exchange exactly once: retrying with a token the API has
   * already refused just burns the rate limit and hides the real failure. A network
   * failure is deliberately *not* included — it says nothing about the credential, and
   * treating it as one would discard a perfectly good token on a transient blip.
   */
  get isCredentialFailure(): boolean {
    return this.status === 401 || CREDENTIAL_CODES.includes(this.code);
  }

  /**
   * True when retrying the identical request could plausibly succeed.
   *
   * A publish handoff is the only caller that acts on this. It matters that a *rejected*
   * request (`VALIDATION_ERROR`, `INSUFFICIENT_PERMISSION`) is not retried — those fail
   * the same way every time, and the SRS is explicit that an asset must not be re-uploaded
   * in a loop because a validation error looked like a transient one.
   */
  get isRetryable(): boolean {
    if (this.status === 0) return true;
    if (this.status === 429 || this.status >= 500) return true;
    return this.code === 'RATE_LIMITED';
  }
}
