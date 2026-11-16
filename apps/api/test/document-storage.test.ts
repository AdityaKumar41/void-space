import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_DOCUMENT_SIZE_BYTES } from '@void-space/types';

import { DocumentStorage } from '../src/lib/document-storage';

describe('private document storage', () => {
  let root: string;
  let storage: DocumentStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'void-space-documents-'));
    storage = new DocumentStorage({ rootDir: root });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores the upload beneath its tenant and document and computes its digest', async () => {
    const bytes = Buffer.from('%PDF-1.7\nlearning material');
    const stored = await storage.store({
      tenantId: 'tenant-id',
      documentId: 'document-id',
      originalName: 'lesson.pdf',
      declaredMime: 'application/pdf',
      source: Readable.from([bytes]),
    });

    expect(stored.storageKey).toBe('tenant-id/document-id/content.pdf');
    expect(stored.sizeBytes).toBe(bytes.length);
    expect(stored.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(await readFile(storage.pathFor(stored.storageKey))).toEqual(bytes);

    if (process.platform !== 'win32') {
      expect((await stat(stored.path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(root, 'tenant-id', 'document-id'))).mode & 0o777).toBe(0o700);
    }
  });

  it('rejects a mismatched declared type and removes a file with invalid PDF bytes', async () => {
    await expect(
      storage.store({
        tenantId: 'tenant-id',
        documentId: 'bad-mime',
        originalName: 'lesson.pdf',
        declaredMime: 'text/plain',
        source: Readable.from(['not a PDF']),
      }),
    ).rejects.toThrow('is not accepted');

    await expect(
      storage.store({
        tenantId: 'tenant-id',
        documentId: 'bad-bytes',
        originalName: 'lesson.pdf',
        declaredMime: 'application/pdf',
        source: Readable.from(['not a PDF']),
      }),
    ).rejects.toThrow('do not match');

    await expect(stat(join(root, 'tenant-id', 'bad-bytes', 'content.pdf'))).rejects.toThrow();
  });

  it('rejects oversized documents and refuses paths outside the storage root', async () => {
    await expect(
      storage.store({
        tenantId: 'tenant-id',
        documentId: 'too-large',
        originalName: 'notes.txt',
        declaredMime: 'text/plain',
        source: Readable.from([Buffer.alloc(MAX_DOCUMENT_SIZE_BYTES + 1)]),
      }),
    ).rejects.toThrow('exceeds');

    expect(storage.owns('../outside.txt')).toBe(false);
    expect(() => storage.pathFor('../outside.txt')).toThrow('path is invalid');
  });
});
