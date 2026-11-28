import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoId, withTenant } from '@void-space/db';
import { assetObjectKey, assetStore, checksum } from '@void-space/storage';
import pino from 'pino';
import type { Job } from 'bullmq';
import { createAssetStoreProcessor } from '../src/processors/asset-store';
import { stagingRoot } from '../src/lib/staging';
import type { JobPayload } from '../src/lib/job-tracking';

describe('real S3 asset ingestion', () => {
  it('persists verified bytes, removes staging and safely resumes after completion', async () => {
    const tenantId = demoId('tenant:aurora'),
      assetId = randomUUID(),
      versionId = randomUUID(),
      jobId = randomUUID();
    const bytes = Buffer.from('unique asset-store fixture ' + randomUUID()),
      address = checksum(bytes);
    const directory = join(stagingRoot(), tenantId, versionId),
      path = join(directory, 'model.glb');
    await mkdir(directory, { recursive: true });
    await writeFile(path, bytes, { mode: 0o600 });
    try {
      await withTenant(tenantId, async (db) => {
        const creator = await db.user.findFirstOrThrow({ where: { email: 'creator@aurora.dev' } });
        await db.asset.create({
          data: {
            id: assetId,
            tenantId,
            creatorId: creator.id,
            name: 'Asset-store QA',
            category: 'QA',
          },
        });
        await db.assetVersion.create({
          data: {
            id: versionId,
            tenantId,
            assetId,
            versionNumber: 1,
            format: '.glb',
            sizeBytes: BigInt(bytes.length),
            stagingPath: path,
          },
        });
        await db.job.create({
          data: {
            id: jobId,
            tenantId,
            queue: 'ipfs_pin',
            entityType: 'assetVersion',
            entityId: versionId,
          },
        });
      });
      const job = {
        id: jobId,
        data: { tenantId, assetId, versionId },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as unknown as Job<JobPayload>;
      const process = createAssetStoreProcessor({ logger: pino({ level: 'silent' }) });
      expect(await process(job)).toMatchObject({ cid: address });
      const version = await withTenant(tenantId, (db) =>
        db.assetVersion.findUniqueOrThrow({ where: { id: versionId } }),
      );
      expect(version).toMatchObject({ ipfsCid: address, pinStatus: 'pinned', stagingPath: null });
      expect(await assetStore().head(assetObjectKey(address))).toEqual({
        sizeBytes: bytes.length,
        sha256: address,
      });
      await expect(access(path)).rejects.toThrow();
      expect(await process(job)).toMatchObject({ cid: address, skipped: true });
      const record = await withTenant(tenantId, (db) =>
        db.job.findUniqueOrThrow({ where: { id: jobId } }),
      );
      expect(record.status).toBe('completed');
    } finally {
      await withTenant(tenantId, async (db) => {
        await db.job.deleteMany({ where: { id: jobId } });
        await db.asset.deleteMany({ where: { id: assetId } });
      });
      await assetStore().delete(assetObjectKey(address));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
