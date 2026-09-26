import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

// Load the repository-root .env into process.env *before* the workers spawn.
// The Prisma clients are constructed at module-evaluation time, so a setup file
// would be too late for STUDIO_DATABASE_URL / STUDIO_PLATFORM_DATABASE_URL.
const envPath = resolve(here, '../../.env');
if (existsSync(envPath)) {
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // These suites talk to the real dockerized studio Postgres (port 5433), so keep
    // them serial — the isolation suite deliberately writes as two tenants, and
    // interleaving it with the schema audit would produce misleading failures.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
