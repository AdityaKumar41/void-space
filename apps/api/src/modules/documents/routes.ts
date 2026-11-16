/**
 * Documents & Notes — the reading material of the learning workspace.
 *
 *   GET    /documents                list, with search and organisation filters
 *   GET    /documents/:id            detail (notes include their full body)
 *   GET    /documents/:id/content    stream the stored file, inline or as a download
 *   POST   /documents                upload a PDF / Word / text file (multipart)
 *   POST   /documents/notes          author a note
 *   PATCH  /documents/:id            rename, re-file or edit a note
 *   DELETE /documents/:id            remove the row and its stored bytes
 *
 * Files are private. The bytes live on disk under `DOCUMENTS_DIR`, never in
 * Postgres, and are served only after a tenant-scoped lookup of the row. A
 * guessed path in the URL therefore reveals nothing: the route resolves the
 * document first and only then opens the stored file.
 */
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

import { recordAudit, withTenant, type Prisma, type TenantClient } from '@void-space/db';
import {
  DOCUMENT_CONTENT_TYPE,
  createNoteSchema,
  documentContentQuerySchema,
  documentListQuerySchema,
  documentMetadataSchema,
  updateDocumentSchema,
  type DocumentExtension,
  type DocumentView,
} from '@void-space/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiEnv } from '../../env';
import { DocumentStorage, type StoredDocument } from '../../lib/document-storage';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { parseBody, parseParams, parseQuery } from '../../lib/http';

const idParams = z.object({ id: z.string().uuid() });

/** Relations every view needs. Kept in one place so the four read paths agree. */
const documentInclude = {
  course: { select: { id: true, title: true } },
  lesson: { select: { id: true, title: true } },
  createdBy: { select: { id: true, fullName: true } },
} as const;

type DocumentRow = Prisma.DocumentGetPayload<{ include: typeof documentInclude }>;

/**
 * A list holds at most this many documents in one response. A workspace with a
 * larger collection narrows with the search and organisation filters, which is
 * what those controls are for.
 */
const LIST_LIMIT = 200;

export interface DocumentRoutesOptions {
  readonly env: ApiEnv;
}

function extensionOf(fileName: string | null): DocumentExtension | null {
  if (!fileName) return null;
  const extension = extname(fileName).toLowerCase();
  return extension in DOCUMENT_CONTENT_TYPE ? (extension as DocumentExtension) : null;
}

/** The card needs a first line; the detail endpoint needs the whole body. */
function excerptOf(content: string | null): string | null {
  if (!content) return null;
  const flattened = content.replace(/\s+/g, ' ').trim();
  return flattened.length > 240 ? `${flattened.slice(0, 237)}…` : flattened;
}

function documentView(row: DocumentRow, options: { includeContent?: boolean } = {}): DocumentView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    category: row.category,
    topic: row.topic,
    courseId: row.courseId,
    lessonId: row.lessonId,
    course: row.course,
    lesson: row.lesson,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    extension: extensionOf(row.fileName),
    excerpt: row.kind === 'note' ? excerptOf(row.content) : null,
    ...(row.kind === 'note' && options.includeContent
      ? { content: row.content ?? '' }
      : {}),
  };
}

/** Collects text parts into the shape the Zod metadata schema expects. */
function metadataFromFields(fields: Record<string, string>): unknown {
  const optional = (key: string): string | undefined => {
    const value = fields[key]?.trim();
    return value ? value : undefined;
  };

  return {
    title: fields['title'],
    description: optional('description'),
    category: optional('category'),
    topic: optional('topic'),
    courseId: optional('courseId'),
    lessonId: optional('lessonId'),
  };
}

/**
 * Programme and lesson links must point at rows in the caller's workspace. The
 * foreign keys alone cannot enforce tenancy: a uuid from another tenant would
 * satisfy Postgres while leaking that a row exists.
 */
async function assertOrganisation(
  db: TenantClient,
  tenantId: string,
  input: { readonly courseId?: string | null; readonly lessonId?: string | null },
): Promise<void> {
  if (input.courseId) {
    const course = await db.course.findFirst({
      where: { id: input.courseId, tenantId },
      select: { id: true },
    });
    if (!course) {
      throw new ValidationError('Select a program that belongs to this workspace', {
        courseId: input.courseId,
      });
    }
  }
  if (input.lessonId) {
    const lesson = await db.lesson.findFirst({
      where: { id: input.lessonId, tenantId },
      select: { id: true },
    });
    if (!lesson) {
      throw new ValidationError('Select a lesson that belongs to this workspace', {
        lessonId: input.lessonId,
      });
    }
  }
}

/** RFC 6266: an ASCII fallback plus the UTF-8 name for clients that understand it. */
function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function documentRoutes(
  app: FastifyInstance,
  options: DocumentRoutesOptions,
): Promise<void> {
  const storage = new DocumentStorage({ rootDir: options.env.DOCUMENTS_DIR });

  // ------------------------------------------------------------------ list
  app.get('/documents', { preHandler: app.authenticate }, async (request) => {
    const principal = request.principal!;
    const query = parseQuery(documentListQuerySchema, request.query);

    const filters: Prisma.DocumentWhereInput[] = [];
    if (query.kind) filters.push({ kind: query.kind });
    if (query.category) filters.push({ category: query.category });
    if (query.courseId) filters.push({ courseId: query.courseId });
    if (query.lessonId) filters.push({ lessonId: query.lessonId });
    if (query.topic) filters.push({ topic: query.topic });
    if (query.q) {
      // Notes are searched in their body as well as their title: a note whose
      // title is "Week 3" is useless to a reader searching for "hydraulics".
      filters.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { description: { contains: query.q, mode: 'insensitive' } },
          { topic: { contains: query.q, mode: 'insensitive' } },
          { category: { contains: query.q, mode: 'insensitive' } },
          { fileName: { contains: query.q, mode: 'insensitive' } },
          { kind: 'note', content: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }

    const documents = await withTenant(principal.tenantId, (db) =>
      db.document.findMany({
        where: {
          tenantId: principal.tenantId,
          ...(filters.length > 0 ? { AND: filters } : {}),
        },
        include: documentInclude,
        orderBy: { updatedAt: 'desc' },
        take: LIST_LIMIT,
      }),
    );

    return { documents: documents.map((document) => documentView(document)) };
  });

  // ---------------------------------------------------------------- detail
  app.get('/documents/:id', { preHandler: app.authenticate }, async (request) => {
    const principal = request.principal!;
    const { id } = parseParams(idParams, request.params);

    const document = await withTenant(principal.tenantId, (db) =>
      db.document.findFirst({
        where: { id, tenantId: principal.tenantId },
        include: documentInclude,
      }),
    );
    if (!document) throw new NotFoundError('Document');

    return { document: documentView(document, { includeContent: true }) };
  });

  // --------------------------------------------------------------- content
  app.get('/documents/:id/content', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = request.principal!;
    const { id } = parseParams(idParams, request.params);
    const query = parseQuery(documentContentQuerySchema, request.query);

    const document = await withTenant(principal.tenantId, (db) =>
      db.document.findFirst({
        where: { id, tenantId: principal.tenantId },
        select: { id: true, kind: true, fileName: true, mimeType: true, storageKey: true },
      }),
    );
    if (!document) throw new NotFoundError('Document');
    if (document.kind !== 'file' || !document.storageKey) {
      throw new ValidationError('This document is a note, not a stored file', { id });
    }

    let size: number;
    try {
      size = (await stat(storage.pathFor(document.storageKey))).size;
    } catch {
      throw new NotFoundError('Stored document');
    }

    const fileName = document.fileName ?? `document${extname(document.storageKey)}`;
    const extension = extensionOf(document.fileName);
    const contentType =
      document.mimeType ??
      (extension ? DOCUMENT_CONTENT_TYPE[extension] : 'application/octet-stream');

    return reply
      .header('content-type', contentType)
      .header('content-length', String(size))
      .header(
        'content-disposition',
        contentDisposition(query.download ? 'attachment' : 'inline', fileName),
      )
      // Private material: no shared cache may hold a copy, and the browser must
      // not second-guess the type we negotiated from the stored row.
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .send(storage.open(document.storageKey));
  });

  // ---------------------------------------------------------------- upload
  app.post(
    '/documents',
    { preHandler: app.requirePermission('learning:manage') },
    async (request, reply) => {
      const principal = request.principal!;
      const documentId = randomUUID();
      const fields: Record<string, string> = {};
      let stored: StoredDocument | null = null;

      for await (const part of request.parts()) {
        if (part.type === 'field') {
          fields[part.fieldname] = String(part.value);
          continue;
        }

        if (stored) {
          // Drain any extra file part so the request stream completes cleanly.
          part.file.resume();
          continue;
        }

        stored = await storage.store({
          tenantId: principal.tenantId,
          documentId,
          originalName: part.filename,
          declaredMime: part.mimetype,
          source: part.file,
        });
      }

      if (!stored) {
        throw new ValidationError(
          'No file part was found. Send multipart/form-data with the metadata fields first and the file last.',
          { expectedField: 'file' },
        );
      }

      // A local const keeps the narrowing across the transaction callback: `stored`
      // is reassigned in the loop, so TypeScript widens it inside a closure.
      const file = stored;

      try {
        const metadata = parseBody(documentMetadataSchema, metadataFromFields(fields));
        const uploaded = await withTenant(principal.tenantId, async (db) => {
          await assertOrganisation(db, principal.tenantId, metadata);
          const created = await db.document.create({
            data: {
              id: documentId,
              tenantId: principal.tenantId,
              createdById: principal.userId,
              kind: 'file',
              title: metadata.title,
              description: metadata.description ?? null,
              category: metadata.category,
              topic: metadata.topic ?? null,
              courseId: metadata.courseId ?? null,
              lessonId: metadata.lessonId ?? null,
              fileName: file.originalName,
              mimeType: file.mimeType,
              sizeBytes: BigInt(file.sizeBytes),
              storageKey: file.storageKey,
              sha256: file.sha256,
            },
            include: documentInclude,
          });
          await recordAudit(
            {
              action: 'document.uploaded',
              entityType: 'document',
              entityId: created.id,
              actorId: principal.userId,
              actorLabel: principal.fullName,
              afterState: {
                kind: created.kind,
                title: created.title,
                category: created.category,
                courseId: created.courseId,
                lessonId: created.lessonId,
                sizeBytes: file.sizeBytes,
              },
            },
            db,
          );
          return created;
        });

        return reply.status(201).send({ document: documentView(uploaded) });
      } catch (error) {
        // The row never landed, so the bytes must not either.
        await storage.removeDocument(principal.tenantId, documentId).catch((cleanupError: unknown) => {
          request.log.warn(
            { err: cleanupError, documentId },
            'document metadata creation failed and uploaded file cleanup also failed',
          );
        });
        throw error;
      }
    },
  );

  // ------------------------------------------------------------------ note
  app.post(
    '/documents/notes',
    { preHandler: app.requirePermission('learning:manage') },
    async (request, reply) => {
      const principal = request.principal!;
      const input = parseBody(createNoteSchema, request.body);

      const note = await withTenant(principal.tenantId, async (db) => {
        await assertOrganisation(db, principal.tenantId, input);
        const created = await db.document.create({
          data: {
            tenantId: principal.tenantId,
            createdById: principal.userId,
            kind: 'note',
            title: input.title,
            description: input.description ?? null,
            category: input.category,
            topic: input.topic ?? null,
            courseId: input.courseId ?? null,
            lessonId: input.lessonId ?? null,
            content: input.content,
          },
          include: documentInclude,
        });
        await recordAudit(
          {
            action: 'document.note_created',
            entityType: 'document',
            entityId: created.id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
            afterState: {
              title: created.title,
              category: created.category,
              courseId: created.courseId,
              lessonId: created.lessonId,
              characters: input.content.length,
            },
          },
          db,
        );
        return created;
      });

      return reply.status(201).send({ document: documentView(note, { includeContent: true }) });
    },
  );

  // ---------------------------------------------------------------- update
  app.patch(
    '/documents/:id',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const principal = request.principal!;
      const { id } = parseParams(idParams, request.params);
      const input = parseBody(updateDocumentSchema, request.body);

      const updated = await withTenant(principal.tenantId, async (db) => {
        const current = await db.document.findFirst({
          where: { id, tenantId: principal.tenantId },
        });
        if (!current) throw new NotFoundError('Document');

        await assertOrganisation(db, principal.tenantId, input);

        if (input.content !== undefined) {
          if (current.kind !== 'note') {
            throw new ValidationError(
              'Only a note has an editable body. Upload a new file to replace a document.',
              { id },
            );
          }
          if (input.content.length === 0) {
            throw new ValidationError('A note needs some content before it can be saved', { id });
          }
        }

        const data: Prisma.DocumentUncheckedUpdateInput = {};
        if (input.title !== undefined) data.title = input.title;
        if (input.description !== undefined) data.description = input.description;
        if (input.category !== undefined) data.category = input.category;
        if (input.topic !== undefined) data.topic = input.topic;
        if (input.courseId !== undefined) data.courseId = input.courseId;
        if (input.lessonId !== undefined) data.lessonId = input.lessonId;
        if (input.content !== undefined) data.content = input.content;

        const row = await db.document.update({
          where: { id },
          data,
          include: documentInclude,
        });
        await recordAudit(
          {
            action: 'document.updated',
            entityType: 'document',
            entityId: id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
            beforeState: {
              title: current.title,
              category: current.category,
              topic: current.topic,
              courseId: current.courseId,
              lessonId: current.lessonId,
            },
            afterState: {
              title: row.title,
              category: row.category,
              topic: row.topic,
              courseId: row.courseId,
              lessonId: row.lessonId,
            },
          },
          db,
        );
        return row;
      });

      return { document: documentView(updated, { includeContent: true }) };
    },
  );

  // ---------------------------------------------------------------- delete
  app.delete(
    '/documents/:id',
    { preHandler: app.requirePermission('learning:manage') },
    async (request, reply) => {
      const principal = request.principal!;
      const { id } = parseParams(idParams, request.params);

      const removed = await withTenant(principal.tenantId, async (db) => {
        const current = await db.document.findFirst({
          where: { id, tenantId: principal.tenantId },
          select: { id: true, kind: true, title: true, fileName: true },
        });
        if (!current) throw new NotFoundError('Document');

        await db.document.delete({ where: { id } });
        await recordAudit(
          {
            action: 'document.deleted',
            entityType: 'document',
            entityId: id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
            beforeState: current,
          },
          db,
        );
        return current;
      });

      // The row is gone; a lingering file would be unreachable, so remove it.
      if (removed.kind === 'file') {
        await storage.removeDocument(principal.tenantId, id).catch((error: unknown) => {
          request.log.warn(
            { err: error, documentId: id },
            'document row deleted but stored file could not be removed',
          );
        });
      }

      return reply.status(204).send();
    },
  );
}
