import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { S3ObjectStore, s3Configuration, objectKey, checksum } from '@void-space/storage';
import { REPO_ROOT } from './env';
export const learningStorageRoot = (stagingDir: string) =>
  resolve(REPO_ROOT, stagingDir, 'learning-private');
function configuration() {
  return s3Configuration(process.env);
}
function s3Key(path: string) {
  if (!path.startsWith('s3://')) return null;
  const config = configuration();
  if (!config) throw new Error('This file requires the configured S3 storage service');
  const url = new URL(path);
  const key = objectKey(decodeURIComponent(url.pathname.slice(1)));
  if (
    url.hostname !== config.bucket ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^learning\/[a-f0-9-]{36}\//i.test(key)
  )
    throw new Error('Invalid private object reference');
  return { config, key };
}
function legacyRoot(path: string, stagingDir: string) {
  return [
    learningStorageRoot(stagingDir),
    resolve(REPO_ROOT, 'apps/api', stagingDir, 'learning-private'),
  ].find((root) => resolve(path).startsWith(root + '/'));
}
export function isLearningStoragePath(path: string, stagingDir: string) {
  try {
    return path.startsWith('s3://') ? !!s3Key(path) : !!legacyRoot(path, stagingDir);
  } catch {
    return false;
  }
}
/** Authorization stays with the caller's DB lookup; storage never accepts arbitrary buckets or URLs. */
export async function readLearningFile(
  path: string,
  stagingDir = process.env.STAGING_DIR ?? '.staging',
  maxBytes = 60 * 1024 * 1024,
) {
  const reference = s3Key(path);
  if (!reference) {
    if (!legacyRoot(path, stagingDir))
      throw new Error('Private file path is outside the learning store');
    const bytes = await readFile(path);
    if (bytes.length > maxBytes) throw new Error('Private file exceeds read limit');
    return bytes;
  }
  const object = await new S3ObjectStore(reference.config).get(reference.key);
  if (object.sizeBytes > maxBytes) {
    object.body.destroy();
    throw new Error('Private object exceeds read limit');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of object.body) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) {
      object.body.destroy();
      throw new Error('Private object exceeds read limit');
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
export async function writeLearningFile(
  path: string,
  data: Uint8Array | string,
  stagingDir = process.env.STAGING_DIR ?? '.staging',
  mime = 'application/octet-stream',
) {
  const root = legacyRoot(path, stagingDir);
  if (!root) throw new Error('Private file path is outside the learning store');
  const config = configuration();
  if (!config) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      await writeFile(path, data, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const bytes = await readFile(path);
      if (checksum(bytes) !== checksum(typeof data === 'string' ? Buffer.from(data) : data))
        throw new Error('Immutable private file already exists with different content');
    }
    return path;
  }
  const key = objectKey(`learning/${relative(root, path).split('\\').join('/')}`);
  if (isAbsolute(relative(root, path)) || !/^learning\/[a-f0-9-]{36}\//i.test(key))
    throw new Error('Private object must belong to a workspace');
  await new S3ObjectStore(config).put(
    key,
    typeof data === 'string' ? Buffer.from(data) : data,
    mime,
  );
  return `s3://${config.bucket}/${key}`;
}
export async function deleteLearningFile(
  path: string,
  stagingDir = process.env.STAGING_DIR ?? '.staging',
) {
  const reference = s3Key(path);
  if (reference) return new S3ObjectStore(reference.config).delete(reference.key);
  if (!legacyRoot(path, stagingDir))
    throw new Error('Private file path is outside the learning store');
  await rm(path, { force: true });
}

/** Range-aware streaming keeps a classroom's model downloads out of API heap memory. */
export async function streamLearningFile(
  path: string,
  stagingDir = process.env.STAGING_DIR ?? '.staging',
  range?: string,
) {
  if (range && !/^bytes=\d+-\d*$/.test(range)) throw new RangeError('Unsupported byte range');
  const reference = s3Key(path);
  if (reference) return new S3ObjectStore(reference.config).get(reference.key, range);
  if (!legacyRoot(path, stagingDir))
    throw new Error('Private file path is outside the learning store');
  const { stat } = await import('node:fs/promises');
  const { createReadStream } = await import('node:fs');
  const { size } = await stat(path);
  let start = 0,
    end = size - 1;
  if (range) {
    const parts = /^bytes=(\d+)-(\d*)$/.exec(range)!;
    start = Number(parts[1]);
    end = parts[2] ? Math.min(Number(parts[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
      throw new RangeError('Byte range is outside this file');
  }
  return {
    body: createReadStream(path, range ? { start, end } : undefined),
    mime: 'application/octet-stream',
    sizeBytes: range ? end - start + 1 : size,
    contentRange: range ? `bytes ${start}-${end}/${size}` : undefined,
  };
}
