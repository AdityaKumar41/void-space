/** Stream staged assets into immutable S3 objects, then persist the content address.
 * Legacy database names preserve historical records; no IPFS service is contacted.
 */
import { recordAudit, withTenant } from '@void-space/db';
import { UnrecoverableError, type Job } from 'bullmq';
import type { Logger } from 'pino';

import { createAssetContentClient, type AssetContentClient } from '@void-space/storage';
import {
  attemptOf,
  createJobContext,
  isRecordNotFound,
  isTerminalFailure,
  type JobPayload,
} from '../lib/job-tracking';
import { isInsideStaging, removeStagedFile } from '../lib/staging';

export interface AssetStoreDeps {
  readonly logger: Logger;
  readonly content?: AssetContentClient;
}

export function createAssetStoreProcessor(deps: AssetStoreDeps) {
  const content = deps.content ?? createAssetContentClient();

  return async function processAssetStore(job: Job<JobPayload>): Promise<Record<string, unknown>> {
    const ctx = createJobContext({
      jobId: String(job.id),
      tenantId: String(job.data.tenantId ?? job.data['tenantId'] ?? ''),
      queue: 'asset-store',
      payload: job.data,
      attempt: attemptOf(job),
      maxAttempts: job.opts.attempts ?? 1,
    });

    const { versionId } = job.data as {
      versionId?: string;
    };
    if (!versionId) throw new Error('asset-store job is missing versionId');

    await ctx.markActive();

    try {
      const version = await withTenant(ctx.tenantId, (db) =>
        db.assetVersion.findUnique({
          where: { id: versionId },
          select: {
            id: true,
            assetId: true,
            stagingPath: true,
            format: true,
            sizeBytes: true,
            versionNumber: true,
            pinStatus: true,
            ipfsCid: true,
          },
        }),
      );
      if (!version) {
        // The version is gone, so this job can never succeed: an asset deleted while its ingest
        // was still queued takes its versions with it. Marking it unrecoverable stops BullMQ from
        // spending the retry policy on work that is already moot, and the operator sees one
        // attempt rather than three failures for something that needs no attention.
        throw new UnrecoverableError(
          `AssetVersion ${versionId} no longer exists (tenant ${ctx.tenantId}) — the asset was removed while its ingest was queued`,
        );
      }

      // Idempotent: a retry after a crash mid-write must not re-add the content.
      if (version.ipfsCid && version.pinStatus === 'pinned') {
        await ctx.succeed({ cid: version.ipfsCid, skipped: true });
        return { cid: version.ipfsCid, skipped: true };
      }

      const path = version.stagingPath;
      if (!path) {
        throw new Error(
          'No staged file is associated with this version — the upload may have been cleaned up',
        );
      }

      await withTenant(ctx.tenantId, (db) =>
        db.assetVersion.update({ where: { id: versionId }, data: { pinStatus: 'pinning' } }),
      );

      if (!isInsideStaging(path))
        throw new UnrecoverableError('Staged asset is outside the configured upload directory');
      const started = Date.now();
      const { cid, sizeBytes } = await content.add({
        filePath: path,
        fileName: `${version.assetId}-v${version.versionNumber}${version.format}`,
      });

      await withTenant(ctx.tenantId, async (db) => {
        await db.assetVersion.update({
          where: { id: versionId },
          data: {
            ipfsCid: cid,
            pinStatus: 'pinned',
            // The CID now identifies the content; the staged copy is redundant.
            stagingPath: null,
          },
        });

        await recordAudit(
          {
            action: 'asset.stored',
            entityType: 'asset',
            entityId: version.assetId,
            actorLabel: 'worker:asset-store',
            afterState: {
              versionId,
              versionNumber: version.versionNumber,
              cid,
              sizeBytes,
              durationMs: Date.now() - started,
            },
          },
          db,
        );
      });

      await removeStagedFile(path);
      await ctx.succeed({ cid, durationMs: Date.now() - started });
      deps.logger.info({ versionId, cid, bytes: sizeBytes }, 'asset version stored in S3');

      return { cid };
    } catch (error) {
      // A missing row from any write in this processor means the same thing as the lookup above:
      // the version was deleted while its ingest was in flight. The pin itself may well have
      // succeeded — the content is on IPFS, and an unreferenced pin is harmless because content
      // is addressed by its hash — but there is nowhere left to record the CID. So this is an
      // obsolete job, not a platform failure, and it is reported as one.
      const failure = isRecordNotFound(error)
        ? new UnrecoverableError(
            `AssetVersion ${versionId} was deleted while its ingest was in flight (tenant ${ctx.tenantId})`,
          )
        : error;

      // Terminal when the policy is spent *or* the error is unrecoverable — see
      // isTerminalFailure, which also keeps the row out of a permanent "will retry".
      const terminal = isTerminalFailure(failure, ctx);
      await ctx.fail(failure, terminal);

      if (terminal) {
        // FR-8.5 — a version that cannot be pinned is visibly failed rather than silently
        // pending, so the Creator can re-upload it. A version that no longer exists has nothing
        // to mark, which is why this update is allowed to miss.
        await withTenant(ctx.tenantId, (db) =>
          db.assetVersion.update({ where: { id: versionId }, data: { pinStatus: 'failed' } }),
        ).catch(() => undefined);
        deps.logger.error({ err: failure, versionId }, 'asset-store failed permanently');
      } else {
        deps.logger.warn({ err: failure, versionId }, 'asset-store failed — will retry');
      }
      throw failure;
    }
  };
}
