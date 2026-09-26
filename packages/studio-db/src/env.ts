/**
 * Minimal root-.env loader shared by this package's Node/tsx scripts.
 *
 * The Studio schema's datasource reads `STUDIO_DATABASE_URL`, and Prisma only
 * auto-loads a `.env` sitting next to the schema — this monorepo keeps one `.env` at
 * the repository root (§9.4), so scripts read it explicitly. Values already present
 * in the environment always win, so CI can override without editing the file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function parseEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of contents.split('\n')) {
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
    parsed[key] = value;
  }
  return parsed;
}

/** Loads the repository-root .env (if present) without clobbering real env vars. */
export function loadRootEnv(): Record<string, string> {
  const envPath = resolve(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return {};

  const parsed = parseEnvFile(readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return parsed;
}

/**
 * The migration connection string (schema owner), which is the only role that may run
 * DDL. Falls back to `STUDIO_DATABASE_URL` so the package still works in
 * single-role environments (a CI Postgres with one superuser, for instance).
 */
export function studioMigrateDatabaseUrl(): string {
  loadRootEnv();
  const url = process.env.STUDIO_MIGRATE_DATABASE_URL ?? process.env.STUDIO_DATABASE_URL;
  if (!url) {
    throw new Error(
      'STUDIO_MIGRATE_DATABASE_URL (or STUDIO_DATABASE_URL) must be set — see .env.example (SRS §9.4)',
    );
  }
  return url;
}
