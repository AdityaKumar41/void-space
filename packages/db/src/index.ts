/**
 * @void-space/db — Prisma client, tenant-isolated data access, and the
 * append-only audit helper (SRS §5).
 *
 * Tenant-scoped data is reachable **only** through `withTenant(...)`; see
 * ./tenant.ts for the mechanics and the rationale.
 */
export {
  prisma,
  platformPrisma,
  inspectDatabaseRole,
  assertRlsEnforced,
  disconnectAll,
  type DatabaseRoleInfo,
} from './client';

export {
  withTenant,
  withPlatform,
  tenantDb,
  currentTenantId,
  tryCurrentTenantId,
  hasTenantContext,
  isUuid,
  TenantContextMissingError,
  type TenantClient,
  type WithTenantOptions,
} from './tenant';

export {
  recordAudit,
  recordStatusChange,
  type AuditEventInput,
  type AuditLogRow,
} from './audit';

export { loadRootEnv, migrateDatabaseUrl, REPO_ROOT } from './env';

// Prisma enums/types so consumers never import from the generated path directly.
export {
  AssetStatus,
  JobQueue,
  JobStatus,
  LicenseStatus,
  PinStatus,
  ReviewDecisionKind,
  RoleName,
  TenantStatus,
  UserStatus,
  WalletType,
  Prisma,
} from '../generated/client';

export type { PrismaClient } from '../generated/client';
