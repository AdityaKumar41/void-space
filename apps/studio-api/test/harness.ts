/**
 * Shared bootstrap for this app's suites.
 *
 * The env has to be installed *before* `src/app.ts` is imported, and that is the whole reason this
 * module exists: `@void-space/studio-db` builds its Prisma clients at import time and refuses to
 * load without `STUDIO_DATABASE_URL` / `STUDIO_PLATFORM_DATABASE_URL` (see its `client.ts`). A
 * static import of the app in a test file would therefore run before any assignment could happen,
 * so the app is imported *dynamically* from `buildTestApp`.
 *
 * No suite here connects to a database. The URLs below are deliberately unreachable: the tests that
 * would need a query assert the unauthenticated path instead, which is rejected before any query is
 * issued (`resolveSession` throws on a missing or invalid token). Coverage that needs real rows
 * belongs in the publish-handoff integration suite against a migrated database, not here.
 */
import type { StudioApp } from '../src/app';
import { loadEnv, type StudioApiEnv } from '../src/env';

/**
 * The configuration every suite runs against.
 *
 * `VOIDSPACE_CLIENT_MODE=mock` is the default on purpose: §9.1 requires the publish/browse surface
 * to be exercisable with no VOID·SPACE running, and that is what lets these suites drive the real
 * Fastify routes end to end without a second product.
 */
export const STUDIO_TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  STUDIO_API_PORT: '4100',
  STUDIO_CORS_ORIGINS: 'https://localhost:8443,http://localhost:5007',
  STUDIO_DATABASE_URL: 'postgresql://studio_app:pw@127.0.0.1:5433/voidstudio?schema=public',
  STUDIO_PLATFORM_DATABASE_URL:
    'postgresql://studio_platform:pw@127.0.0.1:5433/voidstudio?schema=public',
  STUDIO_JWT_ACCESS_SECRET: 'void-studio-test-secret-value',
  VOIDSPACE_CLIENT_MODE: 'mock',
  VOIDSPACE_CONSOLE_URL: 'https://void.example',
};

/**
 * Installs {@link STUDIO_TEST_ENV} into `process.env` and returns the validated result.
 *
 * A `undefined` override *removes* the key rather than skipping it, so a test can assert on an
 * absent optional setting (the state a fresh clone is in).
 */
export function applyStudioTestEnv(
  overrides: Readonly<Record<string, string | undefined>> = {},
): StudioApiEnv {
  for (const [key, value] of Object.entries({ ...STUDIO_TEST_ENV, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return loadEnv(process.env);
}

/** Builds the real application factory over the test environment. */
export async function buildTestApp(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Promise<StudioApp> {
  applyStudioTestEnv(overrides);
  const { buildStudioApp } = await import('../src/app');
  return buildStudioApp(loadEnv(process.env));
}
