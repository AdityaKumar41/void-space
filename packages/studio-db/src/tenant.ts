/**
 * Tenant context for VOID·STUDIO — the single way application code reaches
 * tenant-scoped Studio data (VS2-SRS-1.0 §5.2, §5.3).
 *
 * The mechanism is VOID·SPACE's, unchanged (see `packages/db/src/tenant.ts`), and
 * that is the point: one tenancy model across both products means a reviewer only
 * has to trust one. It works as follows.
 *
 *  1. `withStudioTenant(tenantId, fn)` opens an interactive transaction on the
 *     `voidstudio_app` pool.
 *  2. It sets the transaction-local session variable `app.current_tenant_id` via
 *     `set_config(..., is_local => true)`. Being transaction-scoped, it cannot leak
 *     to the next request that borrows the same pooled connection.
 *  3. PostgreSQL RLS policies compare each row's `tenant_id` against that variable,
 *     so a cross-tenant read or write is impossible even if a query forgets its
 *     `WHERE` clause — including an `INSERT`, because the policy carries `WITH CHECK`.
 *  4. The transaction client is published on AsyncLocalStorage, so helpers such as
 *     quota accounting run in the same context. Calling `studioDb()` outside a
 *     context throws rather than silently issuing an unscoped query.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import { studioPlatformPrisma, studioPrisma } from './client';
import type { Prisma } from '../generated/client';

export type StudioTenantClient = Prisma.TransactionClient;

interface TenantStore {
  readonly tenantId: string;
  readonly db: StudioTenantClient;
}

const storage = new AsyncLocalStorage<TenantStore>();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class StudioTenantContextMissingError extends Error {
  constructor(operation: string) {
    super(
      `[studio-db] "${operation}" was called without an active tenant context. ` +
        'Wrap tenant-scoped work in withStudioTenant(tenantId, fn) — a query issued ' +
        'outside that wrapper would be rejected by Row-Level Security anyway.',
    );
    this.name = 'StudioTenantContextMissingError';
  }
}

export function isStudioUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function assertUuid(tenantId: string): void {
  // Checked in application code as well as in the database so the failure names the
  // argument rather than surfacing as a Postgres cast error from inside a policy.
  if (!isStudioUuid(tenantId)) {
    throw new Error(
      `[studio-db] withStudioTenant() requires a UUID tenantId (received: ${tenantId})`,
    );
  }
}

export interface WithStudioTenantOptions {
  /** Interactive-transaction timeout in ms (default 20 s; a publish handoff may need more). */
  readonly timeoutMs?: number;
  /** Max time to wait for a pooled connection (default 5 s). */
  readonly maxWaitMs?: number;
}

/**
 * Runs `fn` with tenant isolation enforced by the database.
 *
 * @example
 *   const projects = await withStudioTenant(tenantId, (db) =>
 *     db.project.findMany({ where: { status: 'active' } }),
 *   );
 */
export async function withStudioTenant<T>(
  tenantId: string,
  fn: (db: StudioTenantClient) => Promise<T>,
  options: WithStudioTenantOptions = {},
): Promise<T> {
  assertUuid(tenantId);

  return studioPrisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return storage.run({ tenantId, db: tx }, () => fn(tx));
    },
    {
      maxWait: options.maxWaitMs ?? 5_000,
      timeout: options.timeoutMs ?? 20_000,
    },
  );
}

/**
 * Runs `fn` with the administrative (BYPASSRLS) client.
 *
 * Only for operations that are inherently cross-tenant or happen before a tenant is
 * known:
 *  - mirroring the Tenant/User rows from a federated JWT on first login (§5.1),
 *  - resolving which tenants a user may switch between (§3.5.1).
 *
 * It cannot touch project, version, publish, copilot or job data — that is denied at
 * the database-permission level (§5.3), not by convention, so a mistake here fails
 * with a permission error instead of a leak.
 */
export async function withStudioPlatform<T>(
  fn: (db: typeof studioPlatformPrisma) => Promise<T>,
): Promise<T> {
  return fn(studioPlatformPrisma);
}

/** The tenant-scoped transaction client for the current async context. */
export function studioDb(): StudioTenantClient {
  const store = storage.getStore();
  if (!store) throw new StudioTenantContextMissingError('studioDb()');
  return store.db;
}

/** The active tenant id, or a thrown error when there is no context. */
export function currentStudioTenantId(): string {
  const store = storage.getStore();
  if (!store) throw new StudioTenantContextMissingError('currentStudioTenantId()');
  return store.tenantId;
}

/** Non-throwing variant, for code paths that adapt to the presence of a context. */
export function tryCurrentStudioTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}

/** True when the current async context is tenant-scoped. */
export function hasStudioTenantContext(): boolean {
  return storage.getStore() !== undefined;
}
