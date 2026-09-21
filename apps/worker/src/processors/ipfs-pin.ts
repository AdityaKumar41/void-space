/**
 * `ipfs-pin` processor (SRS §3.8, FR-8.1–FR-8.4).
 *
 * Reads the staged upload, adds it to the local Kubo node with pinning enabled, records
 * the CID against the version and removes the staged copy. The CID is the
 * tamper-evident fingerprint the licence contract anchors on (§3.9), so it is written
 * inside the tenant transaction together with the audit row.
 */
import { recordAudit, withTenant } from '@void-space/db';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';

import { createIpfsClient, type IpfsClient } from '../lib/ipfs';
import { attemptOf, createJobContext, type JobPayload } from '../lib/job-tracking';
import { removeStagedFile } from '../lib/staging';

export interface IpfsPinDeps {
  readonly ipfsApiUrl: string;
  readonly logger: Logger;
  readonly ipfs?: IpfsClient;
}

export function createIpfsPinProcessor(deps: IpfsPinDeps) {
  const ipfs = deps.ipfs ?? createIpfsClient({ apiUrl: deps.ipfsApiUrl });

  return async function processIpfsPin(job: Job<JobPayload>): Promise<Record<string, unknown>> {
    const ctx = createJobContext({
      jobId: String(job.id),
      tenantId: String(job.data.tenantId ?? job.data['tenantId'] ?? ''),
      queue: 'ipfs-pin',
      payload: job.data,
      attempt: attemptOf(job),
      maxAttempts: job.opts.attempts ?? 1,
    });

    const { versionId, stagingPath } = job.data as {
      versionId?: string;
      stagingPath?: string;
    };
    if (!versionId) throw new Error('ipfs-pin job is missing versionId');

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
      if (!version) throw new Error(`AssetVersion ${versionId} not found in tenant ${ctx.tenantId}`);

      // Idempotent: a retry after a crash mid-write must not re-add the content.
      if (version.ipfsCid && version.pinStatus === 'pinned') {
        await ctx.succeed({ cid: version.ipfsCid, skipped: true });
        return { cid: version.ipfsCid, skipped: true };
      }

      const path = stagingPath ?? version.stagingPath;
      if (!path) {
        throw new Error(
          'No staged file is associated with this version — the upload may have been cleaned up',
        );
      }

      await withTenant(ctx.tenantId, (db) =>
        db.assetVersion.update({ where: { id: versionId }, data: { pinStatus: 'pinning' } }),
      );

      const started = Date.now();
      const { cid, sizeBytes } = await ipfs.add({
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
            action: 'ipfs.pinned',
            entityType: 'asset',
            entityId: version.assetId,
            actorLabel: 'worker:ipfs-pin',
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
      deps.logger.info(
        { versionId, cid, bytes: sizeBytes },
        'asset version pinned to IPFS',
      );

      return { cid };
    } catch (error) {
      const terminal = ctx.attempt >= ctx.maxAttempts;
      await ctx.fail(error, terminal);

      if (terminal) {
        // FR-8.5 — a version that cannot be pinned is visibly failed rather than silently
        // pending, so the Creator can re-upload it.
        await withTenant(ctx.tenantId, (db) =>
          db.assetVersion.update({ where: { id: versionId }, data: { pinStatus: 'failed' } }),
        ).catch(() => undefined);
        deps.logger.error({ err: error, versionId }, 'ipfs-pin failed permanently');
      } else {
        deps.logger.warn({ err: error, versionId }, 'ipfs-pin failed — will retry');
      }
      throw error;
    }
  };
}
