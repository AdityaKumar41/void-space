/**
 * Autosave Processor (VS2-SRS-1.0 §3.1, FR-13.2, FR-13.3).
 *
 * Persists cloud project snapshots and enforces the retention invariant:
 * - All explicit versions are kept permanently.
 * - Only the most recent 50 autosave versions are kept; older autosaves are pruned.
 */
import { withStudioTenant } from '@void-space/studio-db';
import type { Job as BullJob } from 'bullmq';
import type { Logger } from 'pino';

export interface AutosaveJobPayload {
  tenantId: string;
  projectId: string;
  userId?: string;
  sceneDataCid: string;
  documentHash: string;
}

export function createAutosaveProcessor(logger: Logger) {
  return async function processAutosave(job: BullJob<AutosaveJobPayload>): Promise<{
    versionId: string;
    prunedCount: number;
  }> {
    const { tenantId, projectId, userId, sceneDataCid, documentHash } = job.data;
    logger.info({ jobId: job.id, tenantId, projectId }, 'processing autosave snapshot');

    const result = await withStudioTenant(tenantId, async (db) => {
      // 1. Fetch current version count for numbering
      const count = await db.projectVersion.count({ where: { projectId } });

      // 2. Create the new autosave version
      const version = await db.projectVersion.create({
        data: {
          tenantId,
          projectId,
          createdById: userId ?? '00000000-0000-0000-0000-000000000000',
          versionNumber: count + 1,
          kind: 'autosave',
          documentRef: sceneDataCid,
          documentFormat: 'struct',
        },
      });

      // 3. Enforce FR-13.3: retain max 50 autosave versions
      const autosaves = await db.projectVersion.findMany({
        where: { projectId, kind: 'autosave' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      let pruned = 0;
      if (autosaves.length > 50) {
        const toPrune = autosaves.slice(50).map((v: { id: string }) => v.id);
        const deleteRes = await db.projectVersion.deleteMany({
          where: { id: { in: toPrune } },
        });
        pruned = deleteRes.count;
      }

      return { versionId: version.id, prunedCount: pruned };
    });

    logger.info(
      { jobId: job.id, versionId: result.versionId, pruned: result.prunedCount },
      'autosave snapshot recorded and pruned successfully',
    );

    return result;
  };
}
