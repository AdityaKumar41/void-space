/**
 * @void-space/studio-db — VOID·STUDIO's persistence layer (VS2-SRS-1.0 §5).
 *
 * Own Prisma schema, own database, own roles. No table here is shared with or
 * written by VOID·SPACE, and the only cross-product data path is the opaque
 * `publish_records.voidspace_asset_id` (§5.3).
 *
 * Deliberately a sibling of `packages/db` rather than an extension of it, despite
 * §3.7's "extended, not forked" phrasing for the shared packages. Two mechanical
 * reasons make it the only workable shape: Prisma cannot carry two datasources in
 * one schema (so the generated client is necessarily separate), and `packages/db`
 * already defines its own `Tenant`, `User`, `Job` and `JobStatus` — two structurally
 * different `Tenant` types in one package's export surface is a mistake waiting to
 * happen. A sibling package also turns §5.3's boundary into an import boundary,
 * which is the version a reviewer can check.
 */
export {
  studioPrisma,
  studioPlatformPrisma,
  assertStudioRlsEnforced,
  inspectStudioDatabaseRole,
  disconnectStudioClients,
  type DatabaseRoleInfo,
} from './client';

export {
  withStudioTenant,
  withStudioPlatform,
  studioDb,
  currentStudioTenantId,
  tryCurrentStudioTenantId,
  hasStudioTenantContext,
  isStudioUuid,
  StudioTenantContextMissingError,
  type StudioTenantClient,
  type WithStudioTenantOptions,
} from './tenant';

export {
  studioStorageUsage,
  evaluateStudioQuota,
  formatBytes,
  type QuotaDecision,
  type StudioStorageUsage,
} from './quota';

export type { Prisma, PrismaClient } from '../generated/client';
