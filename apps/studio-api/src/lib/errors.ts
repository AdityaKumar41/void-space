/**
 * Application error taxonomy for the Studio API.
 *
 * The same shape as VOID·SPACE's (`apps/api/src/lib/errors.ts`) on purpose: a client
 * written against one product's error envelope should not need a second code path for
 * the other, and the two are already linked in the browser (§3.5.2's status mirroring
 * runs alongside calls to this service).
 *
 * Every error carries a stable `code` the UI branches on instead of matching prose,
 * and an `expose` flag controlling whether the message is safe to return — an upstream
 * provider message can carry a hostname or a driver string.
 */

export interface AppErrorOptions {
  readonly statusCode?: number;
  readonly code: string;
  readonly details?: unknown;
  readonly expose?: boolean;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(message: string, options: AppErrorOptions) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code;
    this.details = options.details;
    this.expose = options.expose ?? this.statusCode < 500;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { statusCode: 400, code: 'VALIDATION_ERROR', details });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHENTICATED') {
    super(message, { statusCode: 401, code });
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'You do not have permission to perform this action',
    code = 'FORBIDDEN',
    details?: unknown,
  ) {
    super(message, { statusCode: 403, code, details });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, { statusCode: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT', details?: unknown) {
    super(message, { statusCode: 409, code, details });
  }
}

/**
 * The VOID·SPACE bridge could not complete a call.
 *
 * A distinct code because the remedies differ: a 409 on this service means "fix your
 * request", whereas `UPSTREAM_FAILURE` may mean VOID·SPACE is down and the reply is
 * worth retrying unchanged. Collapsing them would make the UI either retry a
 * validation error forever or discard a publish that a retry would have completed.
 */
export class UpstreamError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { statusCode: 502, code: 'UPSTREAM_FAILURE', details });
  }
}

/**
 * A capability this deployment does not have configured.
 *
 * 503 rather than 501 or 500: the route exists and works, and would work here if the missing
 * setting were filled in. `expose: true` is deliberate and load-bearing — the default rule for a
 * 5xx masks the message, which is right for an upstream driver string but exactly wrong for this,
 * whose entire value is naming the setting to add. See the error handler in `app.ts`.
 */
export class UnavailableError extends AppError {
  constructor(message: string, code: string, details?: unknown) {
    super(message, { statusCode: 503, code, details, expose: true });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
