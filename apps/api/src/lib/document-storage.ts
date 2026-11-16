/**
 * Private document store for Documents & Notes.
 *
 * The bytes never enter Postgres. Each upload is written to
 * `<DOCUMENTS_DIR>/<tenantId>/<documentId>/content<extension>`, and the database
 * stores only the relative storage key. Serving is deliberately *not* static:
 * `GET /documents/:id/content` resolves the row inside `withTenant(...)` first,
 * then streams the file. A guessed path therefore reveals nothing.
 *
 * Security properties enforced here:
 *   - extension allow-list (PDF / Word / text / markdown / RTF);
 *   - declared MIME must agree with the extension when it is present;
 *   - the first bytes must match the format (a `.pdf` that is not a PDF is rejected);
 *   - the 25 MB ceiling is enforced *while* writing, not after;
 *   - the stored path is generated, never client-supplied;
 *   - every read resolves under the storage root (no traversal).
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, open, rm, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

import {
  DOCUMENT_CONTENT_TYPE,
  DOCUMENT_EXTENSIONS,
  DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_SIZE_BYTES,
  type DocumentExtension,
} from '@void-space/types';

import { ValidationError } from './errors';
import { sanitizeFileName } from './storage';

export interface StoredDocument {
  readonly path: string;
  readonly storageKey: string;
  readonly sizeBytes: number;
  readonly extension: DocumentExtension;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sha256: string;
}

export function isDocumentExtension(extension: string): extension is DocumentExtension {
  return (DOCUMENT_EXTENSIONS as readonly string[]).includes(extension);
}

export function documentExtensionOf(name: string): string {
  return extname(name).toLowerCase();
}

/** The declared type is checked when present; bytes are checked separately below. */
export function assertDocumentMime(
  extension: DocumentExtension,
  declaredMime: string | undefined,
): void {
  if (!declaredMime || declaredMime === 'application/octet-stream') return;

  const accepted = DOCUMENT_MIME_TYPES[extension];
  const normalised = declaredMime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!accepted.includes(normalised)) {
    throw new ValidationError(`A ${extension} file declared as ${normalised} is not accepted`, {
      extension,
      declaredMime: normalised,
      accepted,
    });
  }
}

const MAGIC_PREFIXES: Partial<Record<DocumentExtension, readonly Buffer[]>> = {
  '.pdf': [Buffer.from('%PDF-', 'ascii')],
  '.doc': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  '.docx': [Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from([0x50, 0x4b, 0x05, 0x06])],
  '.rtf': [Buffer.from('{\\rtf', 'ascii')],
};

async function assertMagicBytes(path: string, extension: DocumentExtension): Promise<void> {
  const prefixes = MAGIC_PREFIXES[extension];
  if (!prefixes) return;

  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(8);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const actual = head.subarray(0, bytesRead);
    if (!prefixes.some((prefix) => actual.subarray(0, prefix.length).equals(prefix))) {
      throw new ValidationError(
        `The file contents do not match a ${extension} document. ` +
          'Check the file extension and that the file is not corrupted.',
        { extension },
      );
    }
  } finally {
    await handle.close();
  }
}

export interface DocumentStorageOptions {
  readonly rootDir: string;
}

export class DocumentStorage {
  private readonly root: string;

  constructor(options: DocumentStorageOptions) {
    this.root = resolve(options.rootDir);
  }

  get rootPath(): string {
    return this.root;
  }

  /**
   * Streams one file to disk. The caller supplies the row id up front so the
   * path is attributable to exactly one tenant and one document.
   */
  async store(params: {
    readonly tenantId: string;
    readonly documentId: string;
    readonly originalName: string;
    readonly declaredMime: string | undefined;
    readonly source: NodeJS.ReadableStream & { truncated?: boolean };
  }): Promise<StoredDocument> {
    const extension = documentExtensionOf(params.originalName);
    if (!isDocumentExtension(extension)) {
      throw new ValidationError(
        `Unsupported file type "${extension || params.originalName}". ` +
          `Allowed: ${DOCUMENT_EXTENSIONS.join(', ')}`,
        { allowed: DOCUMENT_EXTENSIONS },
      );
    }
    assertDocumentMime(extension, params.declaredMime);

    const directory = join(this.root, params.tenantId, params.documentId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);

    const originalName = sanitizeFileName(params.originalName);
    const storageKey = relative(this.root, join(directory, `content${extension}`)).replace(
      /\\/g,
      '/',
    );
    const target = join(this.root, storageKey);

    const hash = createHash('sha256');
    let written = 0;
    const counting = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        written += chunk.length;
        if (written > MAX_DOCUMENT_SIZE_BYTES) {
          callback(
            new ValidationError(
              `Document exceeds the ${Math.round(
                MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024),
              )} MB limit`,
              { maxBytes: MAX_DOCUMENT_SIZE_BYTES },
            ),
          );
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        params.source as NodeJS.ReadableStream,
        counting,
        createWriteStream(target, { flags: 'wx', mode: 0o600 }),
      );
      if (params.source.truncated) {
        throw new ValidationError(
          `Document exceeds the ${Math.round(
            MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024),
          )} MB limit`,
          { maxBytes: MAX_DOCUMENT_SIZE_BYTES },
        );
      }
      const stats = await stat(target);
      if (stats.size === 0) throw new ValidationError('The uploaded document is empty', {});
      await assertMagicBytes(target, extension);
      return {
        path: target,
        storageKey,
        sizeBytes: stats.size,
        extension,
        originalName,
        mimeType: DOCUMENT_CONTENT_TYPE[extension],
        sha256: hash.digest('hex'),
      };
    } catch (error) {
      try {
        await this.remove(storageKey);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Document upload failed and partial-file cleanup also failed',
        );
      }
      throw error;
    }
  }

  /** True when a relative key resolves inside the store (defence against traversal). */
  owns(storageKey: string): boolean {
    const resolved = resolve(this.root, storageKey);
    const rel = relative(this.root, resolved);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  }

  /** Resolves a stored key to an absolute path after checking it stays inside the store. */
  pathFor(storageKey: string): string {
    if (!this.owns(storageKey)) {
      throw new ValidationError('The stored document path is invalid', {});
    }
    return resolve(this.root, storageKey);
  }

  /** Opens a stored file for streaming. The key is checked before it reaches the filesystem. */
  open(storageKey: string) {
    return createReadStream(this.pathFor(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    if (!this.owns(storageKey)) return;
    await rm(resolve(this.root, storageKey), { force: true });
  }

  /** Removes the whole per-document directory, used after a row is deleted. */
  async removeDocument(tenantId: string, documentId: string): Promise<void> {
    const directory = resolve(this.root, tenantId, documentId);
    const rel = relative(this.root, directory);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return;
    await rm(directory, { force: true, recursive: true });
  }
}
