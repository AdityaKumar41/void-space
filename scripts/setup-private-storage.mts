import { loadRootEnv } from '../packages/db/src/env';
import { S3ObjectStore, s3Configuration, checksum } from '../packages/storage/src/index';
import { randomUUID } from 'node:crypto';
loadRootEnv();
const config = s3Configuration(process.env);
if (
  !config ||
  !config.endpoint ||
  !['localhost', '127.0.0.1'].includes(new URL(config.endpoint).hostname)
)
  throw new Error(
    'This setup command only creates a bucket on explicitly configured local storage.',
  );
const store = new S3ObjectStore(config);
await store.ensureDevelopmentBucket();
const key = `health/${randomUUID()}`,
  bytes = Buffer.from('Void Space private object storage check');
try {
  await store.put(key, bytes, 'text/plain');
  const object = await store.get(key);
  const chunks: Buffer[] = [];
  for await (const chunk of object.body) chunks.push(Buffer.from(chunk));
  if (checksum(Buffer.concat(chunks)) !== checksum(bytes))
    throw new Error('Stored bytes failed verification');
  process.stdout.write('Private object upload, read and checksum verification passed.\n');
} finally {
  await store.delete(key);
}
