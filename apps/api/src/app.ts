/**
 * Fastify application factory (SRS §3.1 "API-first").
 *
 * Phase 0 provides the skeleton: logging with correlation ids, CORS restricted to
 * the edge origins, a health endpoint that reports dependency status, and a
 * startup assertion that the runtime database role is genuinely subject to
 * Row-Level Security. Feature modules (auth, assets, review, licensing, …) are
 * mounted here in later phases.
 */
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import type { HealthResponse } from '@void-space/types';
import Fastify, { type FastifyInstance } from 'fastify';

import { assertRlsEnforced, prisma } from '@void-space/db';

import type { ApiEnv } from './env';

const API_VERSION = '2.0.0';

interface DependencyCheck {
  readonly status: 'up' | 'down' | 'disabled';
  readonly detail?: string;
}

async function checkPostgres(): Promise<DependencyCheck> {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return { status: 'up' };
  } catch (error) {
    return { status: 'down', detail: (error as Error).message };
  }
}

async function checkHttp(endpoint: string, init?: RequestInit): Promise<DependencyCheck> {
  try {
    const response = await fetch(endpoint, { ...init, signal: AbortSignal.timeout(1_500) });
    return response.ok ? { status: 'up' } : { status: 'down', detail: `HTTP ${response.status}` };
  } catch (error) {
    return { status: 'down', detail: (error as Error).message };
  }
}

/** Anvil answers a JSON-RPC eth_blockNumber call — the documented readiness probe (§9.3). */
async function checkAnvil(rpcUrl: string): Promise<DependencyCheck> {
  return checkHttp(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  });
}

export async function buildApp(env: ApiEnv): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Correlation ids per request (§3.2 observability, NFR-MAINT.1).
      genReqId: (request) => {
        const header = request.headers['x-request-id'];
        return typeof header === 'string' && header.length > 0 ? header : crypto.randomUUID();
      },
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' } }
          : undefined,
    },
    trustProxy: true,
    disableRequestLogging: false,
  });

  await app.register(sensible);
  await app.register(cookie, { secret: env.JWT_REFRESH_SECRET });
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // --- health (used by nginx/compose and by the web app) --------------------
  const startedAt = Date.now();
  app.get('/api/v1/health', async (): Promise<HealthResponse> => {
    const [postgres, ipfs, anvil] = await Promise.all([
      checkPostgres(),
      checkHttp(`${env.IPFS_API_URL}/api/v0/version`, { method: 'POST' }),
      checkAnvil(env.ANVIL_RPC_URL),
    ]);

    const dependencies = {
      postgres,
      ipfs,
      anvil,
      // Optional integrations degrade gracefully (NFR-REL.1).
      claude: env.ANTHROPIC_API_KEY
        ? ({ status: 'up', detail: 'api key configured' } as const)
        : ({ status: 'disabled', detail: 'offline enricher fallback in use' } as const),
      contract: env.CONTRACT_ADDRESS
        ? ({ status: 'up', detail: env.CONTRACT_ADDRESS } as const)
        : ({ status: 'disabled', detail: 'run pnpm dev:up to deploy' } as const),
    };

    const degraded = Object.values(dependencies).some((dependency) => dependency.status === 'down');

    return {
      status: degraded ? 'degraded' : 'ok',
      version: API_VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      dependencies,
    };
  });

  // --- not-yet-implemented routes answer 501, not 404 -----------------------
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `${request.method} ${request.url} is not a known route`,
      requestId: request.id,
    });
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      statusCode,
      error: error.name ?? 'InternalServerError',
      message: statusCode >= 500 ? 'Internal server error' : error.message,
      requestId: request.id,
    });
  });

  return app;
}

/**
 * Validates that the API can safely talk to its dependencies, then returns the
 * list of startup warnings (e.g. RLS not enforced ⇒ hard failure).
 */
export async function preflight(env: ApiEnv): Promise<string[]> {
  const warnings: string[] = [];

  // Hard failure: a superuser/BYPASSRLS connection would silently disable tenant
  // isolation (FR-1.6, NFR-SEC.5).
  const roleInfo = await assertRlsEnforced(prisma);
  warnings.push(`runtime role ${roleInfo.currentUser} (RLS enforced)`);

  if (!env.CONTRACT_ADDRESS) {
    warnings.push('CONTRACT_ADDRESS is unset — run `pnpm dev:up` to deploy the licence contract');
  }
  if (!env.ANTHROPIC_API_KEY) {
    warnings.push('ANTHROPIC_API_KEY unset — AI enrichment will use the offline enricher');
  }
  return warnings;
}
