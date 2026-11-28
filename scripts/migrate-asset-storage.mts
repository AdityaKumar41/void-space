/** Copy legacy content without changing identifiers or deleting source data. --apply writes S3. */
import { loadRootEnv } from '../packages/db/src/env';
import { PrismaClient } from '../packages/db/generated/client/index.js';
import { assetObjectKey, assetStore } from '../packages/storage/src/index';
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
loadRootEnv();
const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
const apply = process.argv.includes('--apply');
const gateway =
  process.env.LEGACY_ASSET_GATEWAY_URL ?? process.env.IPFS_GATEWAY_URL ?? 'http://localhost:8080';
const max = 210 * 1024 * 1024;
let failed = 0,
  copied = 0,
  verified = 0;
const store = assetStore();
async function verify(address: string, expected?: string) {
  const head = await store.head(assetObjectKey(address));
  const object = await store.get(assetObjectKey(address));
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of object.body) {
    hash.update(chunk);
    size += chunk.length;
  }
  const digest = hash.digest('hex');
  if (size !== head.sizeBytes || digest !== head.sha256 || (expected && digest !== expected))
    throw new Error('Destination checksum verification failed');
}
try {
  const versions = await db.assetVersion.findMany({
    where: { ipfsCid: { not: null } },
    select: { ipfsCid: true },
  });
  const licenses = await db.license.findMany({
    where: { ipfsMetadataCid: { not: null } },
    select: { ipfsMetadataCid: true },
  });
  const addresses = [
    ...new Set([...versions.map((v) => v.ipfsCid!), ...licenses.map((l) => l.ipfsMetadataCid!)]),
  ];
  console.log(
    JSON.stringify({
      mode: apply ? 'copy-and-verify' : 'verify-only',
      references: versions.length + licenses.length,
      uniqueObjects: addresses.length,
    }),
  );
  for (const address of addresses) {
    let directory: string | undefined;
    try {
      try {
        await verify(address);
        verified++;
        continue;
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404
        )
          throw error;
      }
      if (!apply) throw new Error('Object has not been migrated');
      directory = await mkdtemp(join(tmpdir(), 'void-asset-migration-'));
      const path = join(directory, 'content');
      const response = await fetch(`${gateway.replace(/\/$/, '')}/ipfs/${address}`, {
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok || !response.body)
        throw new Error(`Legacy content unavailable (${response.status})`);
      const file = await open(path, 'wx', 0o600);
      const hash = createHash('sha256');
      let size = 0;
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.byteLength;
          if (size > max) throw new Error('Legacy content exceeds migration limit');
          hash.update(chunk);
          await file.write(chunk);
        }
      } finally {
        await file.close();
      }
      const digest = hash.digest('hex');
      await store.putFile(assetObjectKey(address), path, size, digest);
      await verify(address, digest);
      copied++;
    } catch (error) {
      failed++;
      console.error(JSON.stringify({ address, error: (error as Error).message }));
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
  console.log(JSON.stringify({ copied, verified, failed, sourceDataDeleted: false }));
  if (failed) process.exitCode = 1;
} finally {
  await db.$disconnect();
}
