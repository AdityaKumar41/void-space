/**
 * Studio API application factory (VS2-SRS-1.0 §6.4).
 *
 * The surface is deliberately small and is the *control plane* only — see
 * docs/VOID-STUDIO.md §2.2. Nothing here stores a Creator's scene; the routes exist to
 * establish who they are, to keep the thin project index, and to make the one
 * deliberate crossing into VOID·SPACE (§3.5.2).
 */
import type { HttpTransport } from '@void-space/studio-ai';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { assertStudioRlsEnforced, studioPrisma } from '@void-space/studio-db';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import type { StudioApiEnv } from './env';
import { buildStudioAi, type StudioAi } from './lib/ai';
import { isAppError } from './lib/errors';
import { buildVoidSpaceBridge, type VoidSpaceBridge } from './lib/gateway';
import { auditRoutes } from './modules/audit';
import { bridgeRoutes } from './modules/bridge';
import { copilotRoutes } from './modules/copilot';
import { registerJobRoutes } from './modules/jobs';
import { projectRoutes } from './modules/projects';

export interface StudioApp {
  readonly app: FastifyInstance;
  readonly bridge: VoidSpaceBridge;
  readonly ai: StudioAi;
}

/**
 * Injection points, so a suite can drive the real routes without a network.
 *
 * `transport` reaches the AI client and nothing else. It exists because §7.5's controls — the hard
 * timeout, the bounded retry, the redaction — are the one behaviour that cannot be verified against a
 * real provider, and a suite that calls api.anthropic.com is a suite that fails when someone else's
 * deploy is slow.
 */
export interface StudioAppOptions {
  readonly transport?: HttpTransport;
}

export async function buildStudioApp(
  env: StudioApiEnv,
  options: StudioAppOptions = {},
): Promise<StudioApp> {
  const app = Fastify({
    // Tests assert on responses, not logs; a silent transport keeps their output readable.
    logger: env.NODE_ENV === 'test' ? false : { level: env.LOG_LEVEL },
    // Uploads arrive base64-encoded, which inflates them by ~4/3 before decoding.
    bodyLimit: Math.ceil(env.STUDIO_MAX_UPLOAD_BYTES * 1.4),
  });

  const bridge = buildVoidSpaceBridge(env);
  const ai = buildStudioAi(env, options);

  await app.register(cors, {
    origin: env.STUDIO_CORS_ORIGINS,
    credentials: true,
    // The Studio's UI renders from a different origin than this API (the fork runs on
    // its own port), so the preflight has to be answered rather than assumed.
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  /*
   * Registered with VOID·SPACE's own signing secret, so a VOID·SPACE access token is
   * accepted here without a second credential for a Creator to manage (§3.5.1). The
   * known cost of a shared secret is recorded in docs/VOID-STUDIO.md §2.3.
   */
  await app.register(jwt, { secret: env.STUDIO_JWT_ACCESS_SECRET });

  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      /*
       * A 5xx message may carry an upstream hostname or a driver string, so by default it is
       * logged in full and returned generically — with the structured `details` preserved,
       * which is the sanctioned channel for anything the caller can act on.
       *
       * `expose` is what lets a deliberate 5xx opt out of that blanket rule. The AI
       * subsystem's "no provider is configured" reply is the case that needs it: its whole
       * value is naming the environment variable to add, and masking it with the generic
       * sentence would turn an actionable message into a shrug. The flag defaults to false
       * for 5xx, so an upstream error still cannot leak a hostname by being wrapped here.
       */
      if (error.statusCode >= 500 && !error.expose) {
        request.log.error({ err: error, code: error.code }, 'studio request failed');
        return reply.code(error.statusCode).send({
          statusCode: error.statusCode,
          code: error.code,
          message: 'The Studio could not complete this request.',
          ...(error.details === undefined ? {} : { details: error.details }),
          requestId: request.id,
        });
      }

      if (error.statusCode >= 500) {
        request.log.warn({ code: error.code }, 'studio request failed (exposed)');
      }

      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
        requestId: request.id,
      });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: {
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        requestId: request.id,
      });
    }

    const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled studio error');
      return reply.code(500).send({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'The Studio could not complete this request.',
        requestId: request.id,
      });
    }

    return reply.code(statusCode).send({
      statusCode,
      code: error.code ?? 'REQUEST_ERROR',
      message: error.message,
      requestId: request.id,
    });
  });

  // §6.4's surface, under a prefix that is deliberately *not* VOID·SPACE's /api/v1:
  // a shared path prefix is how two products end up proxying each other's routes.
  await app.register(bridgeRoutes, { prefix: '/studio/api/v1', bridge });
  await app.register(projectRoutes, { prefix: '/studio/api/v1', bridge });
  await app.register(copilotRoutes, { prefix: '/studio/api/v1', ai });
  await app.register(auditRoutes, { prefix: '/studio/api/v1', ai });
  await app.register(registerJobRoutes, { prefix: '/studio/api/v1' });

  app.get('/', async () => ({
    service: 'VOID·STUDIO API',
    spec: 'VS2-SRS-1.0 §6.4',
    prefix: '/studio/api/v1',
    voidspace: { mode: bridge.mode, apiBaseUrl: bridge.apiBaseUrl ?? '(in-process mock)' },
    // Reported here as well as on the health route, because "is the Copilot available" is the first
    // question a Creator asks and the last thing anyone thinks to check when a button does nothing.
    ai: { configured: ai.configured, model: ai.configured ? ai.model : null },
  }));

  return { app, bridge, ai };
}

/**
 * Verifies the service can safely serve before it starts listening.
 *
 * The RLS assertion is a hard failure rather than a warning: a mis-set
 * `STUDIO_DATABASE_URL` would silently disable tenant isolation, and a service that
 * starts anyway is one that appears healthy while leaking across tenants (§5.2).
 */
export async function preflightStudio(env: StudioApiEnv): Promise<string[]> {
  const warnings: string[] = [];

  const roleInfo = await assertStudioRlsEnforced(studioPrisma);
  warnings.push(`studio database role ${roleInfo.currentUser} (RLS enforced)`);

  if (!env.STUDIO_VOIDSPACE_API_KEY && env.VOIDSPACE_CLIENT_MODE === 'live') {
    warnings.push(
      'STUDIO_VOIDSPACE_API_KEY is unset — catalogue browsing works, publishing is disabled',
    );
  }
  if (env.VOIDSPACE_CLIENT_MODE === 'mock') {
    warnings.push(
      'VOIDSPACE_CLIENT_MODE=mock — publishes are simulated, no VOID·SPACE call is made',
    );
  }
  if (!env.STUDIO_JWT_ACCESS_SECRET) {
    warnings.push('STUDIO_JWT_ACCESS_SECRET is unset — no session can be verified');
  }
  if (!env.ANTHROPIC_API_KEY) {
    warnings.push(
      'ANTHROPIC_API_KEY is unset — the Copilot is unavailable and the pre-publish check runs on ' +
        'measurements alone; publishing is unaffected (§7.5)',
    );
  }

  return warnings;
}
