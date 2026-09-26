/**
 * Automated schema audit for VOID·STUDIO's tenant isolation (VS2-SRS-1.0 §5.2, §5.3).
 *
 * Reads PostgreSQL's own catalogues rather than the Prisma schema, so it fails if a
 * migration adds a table and forgets to protect it — a check the schema file itself
 * cannot make, because "has a policy" is not a property Prisma models.
 *
 * The rule this enforces is deliberately uniform. Every table is either tenant-scoped
 * (it has a `tenant_id`) or is `tenants` itself, so there is no exception list to
 * keep in step and nothing to forget. `material_textures` carries its own `tenant_id`
 * purely to keep that true.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { studioPlatformPrisma, studioPrisma } from '../src/client';

/** Prisma's own bookkeeping table: no application data, and its privileges are revoked. */
const NOT_APPLICATION_DATA = '_prisma_migrations';

/** §5.1 — the identity mirror, keyed by the primary key rather than a `tenant_id`. */
const TENANT_KEYED_TABLE = 'tenants';

interface RlsRow {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  policy_count: bigint;
  has_tenant_id: boolean;
}

interface PrivilegeRow {
  table_name: string;
  can_select: boolean;
}

const RLS_QUERY = `SELECT c.relname AS table_name,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count,
        EXISTS (
          SELECT 1 FROM pg_attribute a
           WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
        ) AS has_tenant_id
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relname`;

/** Table privileges per role, keyed on OIDs so the check cannot be fooled by search_path. */
const PRIVILEGE_QUERY = `SELECT t.relname AS table_name,
        has_table_privilege($1, t.oid, 'SELECT') AS can_select
   FROM pg_class t
   JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' AND t.relkind = 'r'
  ORDER BY t.relname`;

describe('studio schema audit', () => {
  afterAll(async () => {
    await studioPrisma.$disconnect();
    await studioPlatformPrisma.$disconnect();
  });

  it('scopes every application table to a tenant', async () => {
    const rows = await studioPrisma.$queryRawUnsafe<RlsRow[]>(RLS_QUERY);
    const scoped = rows.filter((row) => row.table_name !== NOT_APPLICATION_DATA);

    expect(scoped.length).toBeGreaterThan(0);

    const missingTenantColumn = scoped
      .filter((row) => row.table_name !== TENANT_KEYED_TABLE && !row.has_tenant_id)
      .map((row) => row.table_name);
    expect(missingTenantColumn).toEqual([]);
  });

  it('enables, forces and policies every application table', async () => {
    const rows = await studioPrisma.$queryRawUnsafe<RlsRow[]>(RLS_QUERY);
    const scoped = rows.filter((row) => row.table_name !== NOT_APPLICATION_DATA);

    expect(scoped.filter((row) => !row.rls_enabled).map((row) => row.table_name)).toEqual([]);
    /*
     * FORCE is the assertion that would catch a real regression. A table's *owner*
     * bypasses its own policies, and migrations run as the owner, so without FORCE an
     * `UPDATE` or `DELETE` inside a future migration would walk through the isolation
     * policy while this audit still reported RLS as "enabled".
     */
    expect(scoped.filter((row) => !row.rls_forced).map((row) => row.table_name)).toEqual([]);
    expect(
      scoped.filter((row) => Number(row.policy_count) === 0).map((row) => row.table_name),
    ).toEqual([]);
  });

  it('gives the runtime role no access to migration history', async () => {
    const rows = await studioPrisma.$queryRawUnsafe<PrivilegeRow[]>(
      PRIVILEGE_QUERY,
      'voidstudio_app',
    );
    const migrations = rows.find((row) => row.table_name === NOT_APPLICATION_DATA);

    expect(migrations?.can_select).toBe(false);
  });

  it('restricts the platform role to the identity mirror (§5.3)', async () => {
    const rows = await studioPrisma.$queryRawUnsafe<PrivilegeRow[]>(
      PRIVILEGE_QUERY,
      'voidstudio_platform',
    );
    const readable = rows.filter((row) => row.can_select).map((row) => row.table_name);

    /*
     * Exactly `tenants` and `users`. §5.1 makes those two the federated identity
     * mirror, reconciled before a tenant is known — the one thing a tenant-scoped role
     * cannot do. Everything else must be denied at the database-permission level, so a
     * mistake in this role fails with a permission error instead of leaking.
     */
    expect(readable.sort()).toEqual(['tenants', 'users']);
  });

  it('runs the application client as a non-privileged, RLS-subject role', async () => {
    const [row] = await studioPrisma.$queryRawUnsafe<
      { current_user: string; is_superuser: boolean; bypass_rls: boolean }[]
    >(
      `SELECT current_user AS current_user,
              current_setting('is_superuser') = 'on' AS is_superuser,
              r.rolbypassrls AS bypass_rls
         FROM pg_roles r
        WHERE r.rolname = current_user`,
    );

    expect(row?.current_user).toBe('voidstudio_app');
    expect(row?.is_superuser).toBe(false);
    expect(row?.bypass_rls).toBe(false);
  });
});
