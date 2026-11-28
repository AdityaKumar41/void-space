import { describe, it, expect } from 'vitest';
import { objectKey, checksum, s3Configuration } from '../src';
describe('private object storage', () => {
  it('rejects traversal keys, credentials in URLs and remote plaintext endpoints', () => {
    for (const key of ['/a', 'a/../b', 'a//b', 'a\\b', 'a\0b'])
      expect(() => objectKey(key)).toThrow();
    expect(objectKey('tenant/version/original.glb')).toBe('tenant/version/original.glb');
    expect(() =>
      s3Configuration({ S3_BUCKET: 'private-models', S3_ENDPOINT: 'http://remote.example' }),
    ).toThrow();
    expect(() =>
      s3Configuration({ S3_BUCKET: 'private-models', S3_ENDPOINT: 'https://a:b@example.test' }),
    ).toThrow();
    expect(() =>
      s3Configuration({ S3_BUCKET: 'private-models', S3_ACCESS_KEY_ID: 'only-one' }),
    ).toThrow();
  });
  it('allows local MinIO and computes content hashes independent of filenames', () => {
    expect(
      s3Configuration({ S3_BUCKET: 'void-private', S3_ENDPOINT: 'http://localhost:9000' }),
    ).toMatchObject({ forcePathStyle: true });
    expect(s3Configuration({})).toBeNull();
    expect(checksum(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
