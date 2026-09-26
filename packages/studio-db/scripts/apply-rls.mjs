#!/usr/bin/env node
/**
 * Applies the Studio's Row-Level Security policies and runtime grants
 * (VS2-SRS-1.0 §5.2, §5.3).
 *
 * Run with:  pnpm studio:db:rls
 *
 * Steps:
 *   1. create the runtime roles (voidstudio_app, voidstudio_platform) if missing,
 *      using the passwords from STUDIO_APP_DB_PASSWORD / STUDIO_PLATFORM_DB_PASSWORD
 *   2. execute every statement in prisma/sql/rls.sql as the schema owner
 *   3. print a per-table summary of RLS enablement so drift is visible
 *
 * Idempotent: safe to run after each migration.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, '..');
const repoRoot = resolve(packageDir, '../..');
const rlsPath = resolve(packageDir, 'prisma/sql/rls.sql');
const STATEMENT_SEPARATOR = '-- @statement';

function loadRootEnv() {
  const envPath = resolve(repoRoot, '.env');
  if (!existsSync(envPath)) return;
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

function splitStatements(sql) {
  // Only a line that is *exactly* the marker separates statements, so the marker can
  // be discussed in comments without breaking the split.
  const chunks = [];
  let current = [];

  for (const line of sql.split('\n')) {
    if (line.trim() === STATEMENT_SEPARATOR) {
      chunks.push(current.join('\n'));
      current = [];
      continue;
    }
    current.push(line);
  }
  chunks.push(current.join('\n'));

  return chunks
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((chunk) => chunk.length > 0);
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

loadRootEnv();

const migrateUrl = process.env.STUDIO_MIGRATE_DATABASE_URL ?? process.env.STUDIO_DATABASE_URL;
if (!migrateUrl) {
  console.error(
    '[studio-rls] STUDIO_MIGRATE_DATABASE_URL (or STUDIO_DATABASE_URL) must be set — see .env.example',
  );
  process.exit(2);
}

const appPassword = process.env.STUDIO_APP_DB_PASSWORD ?? 'voidstudio_app_pw';
const platformPassword = process.env.STUDIO_PLATFORM_DB_PASSWORD ?? 'voidstudio_platform_pw';

const require = createRequire(import.meta.url);
const { PrismaClient } = require(resolve(packageDir, 'generated/client/index.js'));

const prisma = new PrismaClient({ datasources: { db: { url: migrateUrl } } });

async function ensureRole(name, password, { bypassRls }) {
  const [{ exists }] = await prisma.$queryRawUnsafe(
    'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
    name,
  );
  if (exists) {
    // Keep the password in sync with the environment so STUDIO_DATABASE_URL always works.
    await prisma.$executeRawUnsafe(
      `ALTER ROLE ${name} WITH LOGIN PASSWORD ${quoteLiteral(password)} NOSUPERUSER ${
        bypassRls ? 'BYPASSRLS' : 'NOBYPASSRLS'
      }`,
    );
    console.log(`[studio-rls] role ${name} already exists (password re-synced)`);
    return;
  }
  await prisma.$executeRawUnsafe(
    `CREATE ROLE ${name} LOGIN PASSWORD ${quoteLiteral(password)} NOSUPERUSER ${
      bypassRls ? 'BYPASSRLS' : 'NOBYPASSRLS'
    }`,
  );
  console.log(`[studio-rls] created role ${name}`);
}

async function main() {
  await ensureRole('voidstudio_app', appPassword, { bypassRls: false });
  await ensureRole('voidstudio_platform', platformPassword, { bypassRls: true });

  const statements = splitStatements(readFileSync(rlsPath, 'utf8'));
  console.log(`[studio-rls] applying ${statements.length} statements from prisma/sql/rls.sql`);

  let summary = [];
  for (const [index, statement] of statements.entries()) {
    const head = statement.split('\n')[0].slice(0, 72).replace(/\s+/g, ' ');
    if (/^select/i.test(statement)) {
      summary = await prisma.$queryRawUnsafe(statement);
      console.log(
        `[studio-rls] ${index + 1}/${statements.length} ${head} … (${summary.length} rows)`,
      );
    } else {
      await prisma.$executeRawUnsafe(statement);
      console.log(`[studio-rls] ${index + 1}/${statements.length} ${head} …`);
    }
  }

  const protectedTables = summary.filter((row) => row.rls_enabled);
  /*
   * `_prisma_migrations` is Prisma's own bookkeeping table: it holds no application
   * data, no manager writes it, and its privileges are revoked outright by rls.sql.
   * Excluding it here is not a loophole — it is the one table the rule does not
   * apply to, named explicitly so that a *different* unprotected table still fails
   * the run.
   */
  const ignored = new Set(['_prisma_migrations']);
  const unprotected = summary.filter(
    (row) => Number(row.policy_count) === 0 && !ignored.has(row.table_name),
  );
  const notForced = summary.filter((row) => row.rls_enabled && !row.rls_forced);
  console.log(
    `[studio-rls] ${protectedTables.length} tables have RLS enabled; ${summary.length} tables inspected`,
  );
  if (unprotected.length > 0) {
    console.error(
      `[studio-rls] ERROR: no policy on: ${unprotected.map((r) => r.table_name).join(', ')}`,
    );
    process.exitCode = 1;
  }
  if (notForced.length > 0) {
    // FORCE is what stops the table owner — i.e. any future migration — from walking
    // through the policy. Enabled-but-not-forced is therefore a real gap, not a style nit.
    console.error(
      `[studio-rls] ERROR: RLS enabled but not FORCED on: ${notForced
        .map((r) => r.table_name)
        .join(', ')}`,
    );
    process.exitCode = 1;
  }
  console.log('[studio-rls] done');
}

main()
  .catch((error) => {
    console.error('[studio-rls] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
