import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { S3ObjectStore, s3Configuration, checksum } from './index';

/** Stable content identifiers include historical CIDs and new SHA-256 digests. */
export function assetObjectKey(address: string): string {
  if (!/^[a-zA-Z0-9]{32,120}$/.test(address)) throw new Error('Invalid asset content address');
  return `assets/${address}`;
}
let cachedStore: S3ObjectStore | undefined;
let cachedConfiguration = '';
export function assetStore() {
  const config = s3Configuration(process.env);
  if (!config) throw new Error('Configure S3 storage before uploading assets');
  const signature = JSON.stringify(config);
  if (!cachedStore || cachedConfiguration !== signature) {
    cachedStore = new S3ObjectStore(config);
    cachedConfiguration = signature;
  }
  return cachedStore;
}
export interface AssetContentClient {
  add(params: { filePath: string; fileName: string }): Promise<{ cid: string; sizeBytes: number }>;
  has(address: string): Promise<boolean>;
  /** Content may be shared by versions and historical contracts; deletion is a separate GC operation. */
  unpin(address: string): Promise<void>;
}
export function createAssetContentClient(): AssetContentClient {
  return {
    async add({ filePath, fileName }) {
      const hash = createHash('sha256');
      let sizeBytes = 0;
      for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk);
        sizeBytes += chunk.length;
      }
      const cid = hash.digest('hex');
      await assetStore().putFile(
        assetObjectKey(cid),
        filePath,
        sizeBytes,
        cid,
        fileName.endsWith('.json')
          ? 'application/json'
          : fileName.endsWith('.glb')
            ? 'model/gltf-binary'
            : 'application/octet-stream',
      );
      return { cid, sizeBytes };
    },
    async has(address) {
      try {
        await assetStore().head(assetObjectKey(address));
        return true;
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
        )
          return false;
        throw error;
      }
    },
    async unpin(address) {
      assetObjectKey(address); /* retain immutable provenance */
    },
  };
}
export async function storeAssetBytes(bytes: Uint8Array) {
  const cid = checksum(bytes);
  await assetStore().put(assetObjectKey(cid), bytes, 'application/octet-stream');
  return { cid, bytes: bytes.byteLength };
}
