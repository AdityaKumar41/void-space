/**
 * Installs the test environment as an import side effect.
 *
 * This module exists to be imported **first** in a suite, and it is separate from `harness.ts` so that
 * ordering requirement is visible at the call site rather than implied by a hook. The reason it is
 * needed at all: `src/**` reaches `@void-space/studio-db`, which constructs its Prisma clients at
 * import time and refuses to load without `STUDIO_DATABASE_URL` and `STUDIO_PLATFORM_DATABASE_URL`.
 * A `beforeAll` hook runs *after* a suite's imports have been evaluated, so it is too late to set
 * them there.
 */
import { applyStudioTestEnv } from './harness';

applyStudioTestEnv();
