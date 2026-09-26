/**
 * Environment validation for the Studio API (VS2-SRS-1.0 §9.4).
 *
 * The process refuses to start on a missing or malformed configuration, which matters
 * more here than in most services: a mis-set `STUDIO_DATABASE_URL` would silently
 * disable tenant isolation (§5.2), and a missing publish credential would turn a
 * Publish press into a confusing 500 after a Creator had already been told their work
 * was ready.
 */
import { z } from 'zod';

/**
 * An empty string in the environment means "not configured".
 *
 * `VAR=` is how a blank value is written in a `.env` file, and zod cannot tell it from
 * a real one: an empty string is *present*, so `.optional()` does not apply and
 * `.url()` rejects it — turning a line an operator believes is inert into a hard boot
 * failure. Safe to read empty as absent here because every setting using it is an
 * optional integration whose contract is "absent means degrade gracefully".
 */
const blankAsUnset = (value: unknown) => (value === '' ? undefined : value);
const optionalString = z.preprocess(blankAsUnset, z.string().optional());

/**
 * A URL that must be an **origin**: scheme, host and optional port, and nothing after it.
 *
 * Enforced rather than merely documented, because the mistake it prevents is silent. `VoidSpaceClient`
 * appends its own versioned path, so a base of `https://host/api/v1` yields
 * `https://host/api/v1/api/v1/public/catalog` — a 404 that reads like a missing route on the
 * VOID·SPACE side rather than a mis-set URL on this one, which is the most expensive kind of
 * configuration error to diagnose. A trailing slash is accepted: it is what copying an address out
 * of a browser bar produces.
 */
const originOnlyUrl = z.preprocess(
  blankAsUnset,
  z
    .string()
    .url()
    .refine((value) => {
      const { pathname } = new URL(value);
      return pathname === '' || pathname === '/';
    }, 'must be the VOID·SPACE origin (scheme://host[:port]) with no path — the client appends its own /api/v1')
    .optional(),
);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /**
   * 4100, matching the upstream the Studio edge already proxies to
   * (`docker/studio/nginx.conf`). Changing one without the other yields a 502 that
   * looks like the API is down when it is merely unreachable at that address.
   */
  STUDIO_API_PORT: z.coerce.number().int().min(1).max(65535).default(4100),

  /** Comma-separated browser origins allowed to call this API. */
  STUDIO_CORS_ORIGINS: z
    .string()
    .default('https://localhost:8443,http://localhost:5007,http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),

  // --- data tier (§5) --------------------------------------------------------
  STUDIO_DATABASE_URL: z.string().url(),
  STUDIO_PLATFORM_DATABASE_URL: z.string().url(),

  // --- federated identity (§3.5.1) -------------------------------------------
  /**
   * The same secret VOID·SPACE signs its access tokens with, so the Studio can verify
   * a VOID·SPACE-issued JWT locally (§3.5.1's "shared signing-key verification").
   *
   * The cost is recorded in docs/VOID-STUDIO.md rather than hidden: a shared HS256
   * secret means this service can *mint* VOID·SPACE tokens. That is acceptable while
   * both products are one team in one repository; the target is an asymmetric keypair
   * plus a public-key endpoint on the VOID·SPACE side.
   */
  STUDIO_JWT_ACCESS_SECRET: z.string().min(16),
  STUDIO_SESSION_TTL: z.string().default('12h'),

  // --- the VOID·SPACE bridge (§3.5.2) ----------------------------------------
  /** `live` talks to a deployed VOID·SPACE; `mock` uses the §9.1 in-memory gateway. */
  VOIDSPACE_CLIENT_MODE: z.enum(['mock', 'live']).default('live'),
  /**
   * The VOID·SPACE **origin** — scheme, host and port only, e.g. `https://void.space`.
   *
   * Not the `/api/v1` root: `VoidSpaceClient` appends its own versioned path, so
   * including it here yields `https://host/api/v1/api/v1/public/catalog` and a 404 that
   * reads like a missing route rather than a mis-set URL. `originOnlyUrl` enforces the
   * rule at boot instead of leaving it to this comment.
   */
  STUDIO_VOIDSPACE_API_BASE_URL: originOnlyUrl,
  /**
   * A tenant-level Developer API key (VS-SRS-2.0 FR-12.3), exchanged per publish for a
   * short-lived bearer. Server-side only — in a browser every Creator in the tenant
   * could read it.
   */
  STUDIO_VOIDSPACE_API_KEY: optionalString,
  /**
   * Where a Creator is sent to view a published asset in VOID·SPACE, and the console
   * root. Used to build the links the Studio's UI shows, so a Creator can follow a
   * publish through to the platform that owns it (§3.5.2) instead of being told a
   * status and left there.
   */
  VOIDSPACE_CONSOLE_URL: z.string().default('https://localhost'),

  /**
   * Hard ceiling on an upload the API will accept, in bytes (VS-SRS-2.0 FR-3.1).
   */
  STUDIO_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(220 * 1024 * 1024),

  /**
   * How often an in-flight publish is re-read from VOID·SPACE (FR-14.3), in milliseconds.
   *
   * Served to the editor through `/voidspace/status` rather than configured there, so one value
   * governs every client and a deployment can slow the poll down without shipping a new bundle. The
   * floor is enforced here because this value ends up driving browser timers: a 1 ms interval is a
   * denial of service aimed at this API by configuration.
   */
  STUDIO_PUBLISH_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(30_000),
});

export type StudioApiEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): StudioApiEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `[studio-api] invalid environment configuration:\n${details}\n` +
        'Check your .env against .env.example (SRS §9.4).',
    );
  }
  return parsed.data;
}
