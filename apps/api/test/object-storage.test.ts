import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { S3ObjectStore, s3Configuration, checksum } from '../../../packages/storage/src/index';
const config = s3Configuration(process.env);
describe.skipIf(!config?.endpoint)('local private S3 storage', () => {
  it('preserves immutable bytes and supports authorized ranges', async () => {
    const store = new S3ObjectStore(config!), key = `health/${randomUUID()}`, bytes = Buffer.from('private-model-data');
    try {
      await store.put(key, bytes, 'application/octet-stream');
      expect(await store.head(key)).toEqual({ sizeBytes: bytes.length, sha256: checksum(bytes) });
      await store.put(key, bytes, 'application/octet-stream');
      await expect(store.put(key, Buffer.from('different-content'), 'application/octet-stream')).rejects.toThrow('different content');
      const object = await store.get(key, 'bytes=0-6'), chunks: Buffer[] = [];
      for await (const chunk of object.body) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks).toString()).toBe('private');
      expect(object.contentRange).toBe(`bytes 0-6/${bytes.length}`);
    } finally { await store.delete(key); }
    await expect(store.head(key)).rejects.toThrow();
  });
});
