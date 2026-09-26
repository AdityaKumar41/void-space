/**
 * The storage-usage accounting FR-2.4's quota is enforced against.
 *
 * §3.6 makes every stored blob content-addressed, which is what makes this a *sum*
 * over distinct CIDs rather than a reference count: a texture reused across ten
 * projects is one row and one charge. Counting rows referenced by scenes instead
 * would let a Creator stay under quota by duplicating an object, and would misreport
 * the storage the tenant actually consumes.
 *
 * Deliberately a query against the asset tables rather than a stored counter. A
 * counter would need to be updated on every insert, delete, dedupe hit and cascade,
 * and any one missed update makes the quota wrong in the direction that lets an
 * upload through — the failure mode with a real cost. Summing three indexed columns
 * is cheap at the scale a tenant's library reaches, and cannot drift.
 */
import type { StudioTenantClient } from './tenant';

export interface StudioStorageUsage {
  readonly meshBytes: bigint;
  readonly textureBytes: bigint;
  /** Bytes charged against the tenant quota (mesh + texture). */
  readonly usedBytes: bigint;
}

export async function studioStorageUsage(db: StudioTenantClient): Promise<StudioStorageUsage> {
  const [mesh, texture] = await Promise.all([
    db.meshAsset.aggregate({ _sum: { sizeBytes: true } }),
    db.textureAsset.aggregate({ _sum: { sizeBytes: true } }),
  ]);

  const meshBytes = mesh._sum.sizeBytes ?? 0n;
  const textureBytes = texture._sum.sizeBytes ?? 0n;
  return { meshBytes, textureBytes, usedBytes: meshBytes + textureBytes };
}

export interface QuotaDecision {
  readonly allowed: boolean;
  readonly usedBytes: bigint;
  readonly quotaBytes: bigint;
  readonly remainingBytes: bigint;
  /** Plain language for the UI; empty when the upload may proceed. */
  readonly message: string;
}

/**
 * FR-2.4 — "block new asset uploads once exceeded, surfacing a clear message".
 *
 * Takes the size being added so the decision is about the *result* of the upload
 * rather than the current state: a check that only looks at what is already stored
 * always lets the one upload that crosses the line through.
 */
export function evaluateStudioQuota(
  usage: StudioStorageUsage,
  quotaBytes: bigint,
  incomingBytes: bigint,
): QuotaDecision {
  const usedBytes = usage.usedBytes;
  const projected = usedBytes + (incomingBytes > 0n ? incomingBytes : 0n);
  const allowed = projected <= quotaBytes;

  return {
    allowed,
    usedBytes,
    quotaBytes,
    remainingBytes: quotaBytes > usedBytes ? quotaBytes - usedBytes : 0n,
    message: allowed
      ? ''
      : `This upload would take the tenant to ${formatBytes(projected)} against a ` +
        `${formatBytes(quotaBytes)} quota, with ${formatBytes(
          quotaBytes > usedBytes ? quotaBytes - usedBytes : 0n,
        )} free. Delete unused assets or ask a TenantAdmin to raise the quota (FR-2.4).`,
  };
}

/** Human-readable bytes, for the quota message above. */
export function formatBytes(bytes: bigint): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
