import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
export interface ObjectReference {
  provider: 's3';
  bucket: string;
  key: string;
  sha256: string;
  sizeBytes: number;
  mime: string;
}
export function objectKey(key: string) {
  if (
    !key ||
    key.length > 1024 ||
    key.startsWith('/') ||
    key.includes('\\') ||
    key.split('/').some((part) => !part || part === '.' || part === '..') ||
    /[\x00-\x1f]/.test(key)
  )
    throw new Error('Invalid object key');
  return key;
}
export function checksum(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}
export interface ObjectStore {
  put(key: string, bytes: Uint8Array, mime: string): Promise<ObjectReference>;
  get(
    key: string,
    range?: string,
  ): Promise<{ body: Readable; mime: string; sizeBytes: number; contentRange?: string }>;
  head(key: string): Promise<{ sizeBytes: number; sha256: string | null }>;
  delete(key: string): Promise<void>;
}
export function s3Configuration(env: Record<string, string | undefined>) {
  const bucket = env.S3_BUCKET?.trim();
  if (!bucket) {
    if (env.S3_ENDPOINT || env.S3_ACCESS_KEY_ID || env.S3_SECRET_ACCESS_KEY)
      throw new Error('S3_BUCKET is required when S3 settings are present');
    return null;
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Invalid S3 bucket name');
  if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY))
    throw new Error('Both S3 credential fields must be configured together');
  if (env.S3_ENDPOINT) {
    const endpoint = new URL(env.S3_ENDPOINT);
    if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
      throw new Error('Invalid S3 endpoint');
    if (
      endpoint.protocol === 'http:' &&
      !['localhost', '127.0.0.1', 'minio', 'host.docker.internal', '::1', '[::1]'].includes(
        endpoint.hostname,
      )
    )
      throw new Error('Remote S3 endpoints require HTTPS');
  }
  return {
    bucket,
    region: env.S3_REGION || 'us-east-1',
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true' || !!env.S3_ENDPOINT,
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
        : undefined,
  };
}
export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  readonly bucket: string;
  constructor(config: NonNullable<ReturnType<typeof s3Configuration>>, client?: S3Client) {
    const { bucket, ...options } = config;
    this.bucket = bucket;
    this.client =
      client ??
      new S3Client({
        ...options,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
  }
  async put(key: string, bytes: Uint8Array, mime: string): Promise<ObjectReference> {
    objectKey(key);
    const sha256 = checksum(bytes);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
          ContentLength: bytes.byteLength,
          ContentType: mime,
          Metadata: { sha256 },
          IfNoneMatch: '*',
        }),
      );
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412)
        throw error;
      const existing = await this.head(key);
      if (existing.sha256 !== sha256 || existing.sizeBytes !== bytes.byteLength)
        throw new Error('Immutable object already exists with different content');
    }
    return { provider: 's3', bucket: this.bucket, key, sha256, sizeBytes: bytes.byteLength, mime };
  }
  /** Two-pass callers hash first, then stream uploads without buffering a large model. */
  async putFile(
    key: string,
    path: string,
    sizeBytes: number,
    sha256: string,
    mime = 'application/octet-stream',
  ) {
    objectKey(key);
    try {
      const body = createReadStream(path);
      try {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentLength: sizeBytes,
            ContentType: mime,
            Metadata: { sha256 },
            IfNoneMatch: '*',
          }),
        );
      } finally {
        body.destroy();
      }
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412)
        throw error;
      const existing = await this.head(key);
      if (existing.sha256 !== sha256 || existing.sizeBytes !== sizeBytes)
        throw new Error('Immutable object already exists with different content');
    }
  }
  async get(key: string, range?: string) {
    objectKey(key);
    if (range && !/^bytes=\d+-\d*$/.test(range)) throw new Error('Invalid object byte range');
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ...(range ? { Range: range } : {}) }),
    );
    if (!result.Body) throw new Error('Object body is unavailable');
    return {
      body: result.Body as Readable,
      mime: result.ContentType ?? 'application/octet-stream',
      sizeBytes: result.ContentLength ?? 0,
      contentRange: result.ContentRange,
    };
  }
  async ready() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
  async head(key: string) {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey(key) }),
    );
    return { sizeBytes: result.ContentLength ?? 0, sha256: result.Metadata?.sha256 ?? null };
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey(key) }));
  }
  /** Explicit development setup; ordinary API requests never create buckets. */
  async ensureDevelopmentBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404)
        throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }
}

export {
  assetObjectKey,
  assetStore,
  createAssetContentClient,
  storeAssetBytes,
  type AssetContentClient,
} from './asset-content';
