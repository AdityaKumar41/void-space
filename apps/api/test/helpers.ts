/**
 * Integration test harness.
 *
 * Builds the *real* application (same plugins, same guards, same database) and
 * drives it through `app.inject()`, so a test that passes here exercises the
 * shipping code path rather than a mock of it. The dockerized Postgres must be up
 * and seeded (`pnpm dev:up` / `pnpm db:seed`).
 */
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app';
import { loadEnv, type ApiEnv } from '../src/env';

export const DEMO = {
  password: 'VoidSpace!2026',
  tenants: {
    platformSlug: 'void-space-platform',
    auroraSlug: 'aurora-industrial',
    northwindSlug: 'northwind-safety',
  },
  users: {
    superAdmin: 'superadmin@void-space.dev',
    auroraAdmin: 'admin@aurora.dev',
    auroraCreator: 'creator@aurora.dev',
    auroraAssessor: 'assessor@aurora.dev',
    auroraDeveloper: 'developer@aurora.dev',
    auroraViewer: 'viewer@aurora.dev',
    northwindAdmin: 'admin@northwind.dev',
    /** Present in both Aurora and Northwind — exercises FR-1.4. */
    multiTenant: 'priya@void-space.dev',
  },
} as const;

export interface TestApp {
  readonly app: FastifyInstance;
  readonly env: ApiEnv;
  close(): Promise<void>;
}

/** Boots the API against the real database, with a probe route for RBAC checks. */
export async function createTestApp(): Promise<TestApp> {
  const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
  const app = await buildApp(env);

  // A route that throws a known AppError, so tests can assert the error envelope
  // (a root-registered route, mirroring how every feature module is mounted).
  app.get('/api/v1/__test/probe-errors', async () => {
    const { ValidationError } = await import('../src/lib/errors');
    throw new ValidationError('probe failure', { from: 'probe' });
  });

  // A route that exists only in tests: it lets us assert the §3.6 permission
  // gate (403 paths) without depending on a Phase-4 business endpoint.
  app.get(
    '/api/v1/__test/permission/audit',
    { preHandler: app.requirePermission('audit:view') },
    async () => ({ ok: true }),
  );
  app.post(
    '/api/v1/__test/permission/audit',
    { preHandler: app.requirePermission('audit:view') },
    async () => ({ ok: true }),
  );

  await app.ready();

  return {
    app,
    env,
    close: async () => {
      await app.close();
    },
  };
}

/** Extracts a cookie value from a response's Set-Cookie header(s). */
export function readCookie(setCookie: string[] | string | undefined, name: string): string | null {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const header of headers) {
    const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(header);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

/** Returns the raw `name=value` form, suitable for the `cookie` request header. */
export function cookieHeader(
  setCookie: string[] | string | undefined,
  ...names: string[]
): string {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const parts: string[] = [];
  for (const name of names) {
    for (const header of headers) {
      if (header.startsWith(`${name}=`)) {
        parts.push(header.split(';')[0] as string);
        break;
      }
    }
  }
  return parts.join('; ');
}

export interface LoginResult {
  readonly statusCode: number;
  readonly body: Record<string, unknown>;
  readonly cookies: string[];
  readonly accessToken: string;
  readonly refreshToken: string;
}

/** Logs a demo user in and returns the tokens that the cookies carry. */
export async function login(
  app: FastifyInstance,
  email: string,
  password: string = DEMO.password,
  tenantId?: string,
): Promise<LoginResult> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password, ...(tenantId ? { tenantId } : {}) },
  });

  const setCookie = response.headers['set-cookie'];
  return {
    statusCode: response.statusCode,
    body: response.json() as Record<string, unknown>,
    cookies: Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [],
    accessToken: readCookie(setCookie, 'vs_access') ?? '',
    refreshToken: readCookie(setCookie, 'vs_refresh') ?? '',
  };
}
