import {
  deleteLearningFile,
  isLearningStoragePath,
  learningStorageRoot,
  withTenant,
  writeLearningFile,
} from '@void-space/db';
import { type AuthPrincipal } from '@void-space/types';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ApiEnv } from '../../env';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { parseBody } from '../../lib/http';
import type { JobProducer } from '../../lib/jobs';
import { sendPrivateFile } from '../../lib/private-files';
import { requirePrivateAuthor } from './access';
import { enqueueLearningTask } from './tasks';
import { safeLearningProgress } from './telemetry';
const uuid = z.string().uuid();
const params = z.object({ id: uuid });
const title = z.string().trim().min(3).max(200);
export async function learningHubRoutes(
  app: FastifyInstance,
  { env, producer }: { env: ApiEnv; producer: JobProducer },
) {
  const auth = { preHandler: app.authenticate };
  const root = learningStorageRoot(env.STAGING_DIR);
  const enqueue = (p: AuthPrincipal, kind: string, input: unknown) =>
    enqueueLearningTask(env, producer, p, kind, input);
  app.get('/learning/sources', auth, async (request) => ({
    sources: await withTenant(request.principal!.tenantId, (db) =>
      db.learningSource.findMany({
        where: {
          ownerId: request.principal!.userId,
          NOT: { mime: { in: ['model/gltf-binary', 'application/x-void-model-views'] } },
        },
        select: {
          id: true,
          title: true,
          mime: true,
          metadata: true,
          status: true,
          passages: true,
          error: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ),
  }));
  app.post('/learning/sources', auth, async (request, reply) => {
    requirePrivateAuthor(request.principal!);
    const input = parseBody(
      z.object({ title, text: z.string().trim().min(20).max(100000) }).strict(),
      request.body,
    );
    const p = request.principal!;
    const paragraphs = input.text
      .split(/\n\s*\n|\n/)
      .filter(Boolean)
      .flatMap((line) => line.match(/[\s\S]{1,2500}/g) ?? [])
      .slice(0, 100)
      .map((text, i) => ({ id: `p${i + 1}`, page: 1, text }));
    const source = await withTenant(p.tenantId, (db) =>
      db.learningSource.create({
        data: {
          tenantId: p.tenantId,
          ownerId: p.userId,
          title: input.title,
          mime: 'text/plain',
          passages: paragraphs,
        },
      }),
    );
    return reply.code(201).send({ source });
  });
  app.post('/learning/sources/links', auth, async (request, reply) => {
    const p = request.principal!;
    requirePrivateAuthor(p);
    const { urls } = parseBody(
      z.object({ urls: z.array(z.string().url().max(2000)).min(1).max(20) }).strict(),
      request.body,
    );
    const results = [];
    for (const raw of [...new Set(urls)]) {
      try {
        const url = new URL(raw);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new ValidationError('Use public HTTP(S) links without credentials.');
        const source = await withTenant(p.tenantId, (db) =>
          db.learningSource.create({
            data: {
              tenantId: p.tenantId,
              ownerId: p.userId,
              title: url.hostname + url.pathname.slice(0, 120),
              mime: 'text/html',
              status: 'extracting',
              passages: [],
              metadata: { url: url.href },
            },
          }),
        );
        let task;
        try {
          task = await enqueue(p, 'extract', { sourceId: source.id });
        } catch (error) {
          await withTenant(p.tenantId, (db) =>
            db.learningSource.update({
              where: { id: source.id },
              data: {
                status: 'failed',
                error: 'Import could not start. Retry after running work finishes.',
              },
            }),
          );
          throw error;
        }
        if (task.status === 'failed')
          await withTenant(p.tenantId, (db) =>
            db.learningSource.update({
              where: { id: source.id },
              data: { status: 'failed', error: task.error },
            }),
          );
        results.push({ url: raw, sourceId: source.id, status: task.status });
      } catch (error) {
        results.push({ url: raw, error: (error as Error).message });
      }
    }
    return reply.code(202).send({ results });
  });
  app.post('/learning/sources/:id/retry', auth, async (request, reply) => {
    const p = request.principal!;
    requirePrivateAuthor(p);
    const { id } = params.parse(request.params);
    const source = await withTenant(p.tenantId, (db) =>
      db.learningSource.findFirst({ where: { id, ownerId: p.userId, status: 'failed' } }),
    );
    if (!source) throw new NotFoundError('Failed private PDF');
    const changed = await withTenant(p.tenantId, (db) =>
      db.learningSource.updateMany({
        where: { id, ownerId: p.userId, status: 'failed' },
        data: { status: 'extracting', error: null },
      }),
    );
    if (!changed.count) throw new ConflictError('This source is already being processed.');
    try {
      const task = await enqueue(p, 'extract', { sourceId: id });
      if (task.status === 'failed')
        await withTenant(p.tenantId, (db) =>
          db.learningSource.update({
            where: { id },
            data: { status: 'failed', error: task.error },
          }),
        );
      return reply.code(202).send({ task });
    } catch (error) {
      await withTenant(p.tenantId, (db) =>
        db.learningSource.update({
          where: { id },
          data: {
            status: 'failed',
            error: 'Extraction could not start. Try again after pending jobs finish.',
          },
        }),
      );
      throw error;
    }
  });
  app.post('/learning/sources/upload', auth, async (request, reply) => {
    requirePrivateAuthor(request.principal!);
    const p = request.principal!;
    const part = await request.file({ limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
    if (!part) throw new ValidationError('Choose a PDF, DOCX, PPTX, text or image file');
    const allowed = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];
    if (!allowed.includes(part.mimetype))
      throw new ValidationError('Use a PDF, DOCX, PPTX, text or image file');
    const bytes = await part.toBuffer();
    if (part.file.truncated) throw new ValidationError('Source exceeds 10 MB');
    const signatures: Record<string, boolean> = {
      'application/pdf': bytes.subarray(0, 5).toString() === '%PDF-',
      'image/png': bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      'image/jpeg': bytes[0] === 255 && bytes[1] === 216,
      'image/webp':
        bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP',
    };
    if (!(
      signatures[part.mimetype] ??
      (part.mimetype === 'text/plain' ? !bytes.includes(0) : bytes[0] === 80 && bytes[1] === 75)
    ))
      throw new ValidationError('File contents do not match the selected source format');
    const id = randomUUID(),
      directory = join(root, p.tenantId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let path = join(directory, id);
    path = await writeLearningFile(path, bytes, env.STAGING_DIR, part.mimetype);
    try {
      const source = await withTenant(p.tenantId, (db) =>
        db.learningSource.create({
          data: {
            id,
            tenantId: p.tenantId,
            ownerId: p.userId,
            title: part.filename.slice(0, 200),
            mime: part.mimetype,
            status: part.mimetype.startsWith('image/') ? 'ready' : 'extracting',
            storagePath: path,
            passages: [],
          },
        }),
      );
      const task = !part.mimetype.startsWith('image/')
        ? await enqueue(p, 'extract', { sourceId: id })
        : null;
      if (task?.status === 'failed')
        await withTenant(p.tenantId, (db) =>
          db.learningSource.update({
            where: { id },
            data: { status: 'failed', error: task.error },
          }),
        );
      return reply.code(201).send({
        source: {
          ...source,
          ...(task?.status === 'failed' ? { status: 'failed', error: task.error } : {}),
          storagePath: undefined,
        },
        task,
      });
    } catch (e) {
      const saved = await withTenant(p.tenantId, (db) =>
        db.learningSource.updateMany({
          where: { id, ownerId: p.userId },
          data: {
            status: 'failed',
            error: 'Source saved, but processing could not start. Retry extraction.',
          },
        }),
      );
      if (!saved.count) await deleteLearningFile(path, env.STAGING_DIR);
      throw e;
    }
  });
  app.get('/learning/sources/:id/file', auth, async (request, reply) => {
    const { id } = params.parse(request.params),
      p = request.principal!;
    const source = await withTenant(p.tenantId, (db) =>
      db.learningSource.findFirst({ where: { id, ownerId: p.userId } }),
    );
    if (!source?.storagePath || !isLearningStoragePath(source.storagePath, env.STAGING_DIR))
      throw new NotFoundError('Private source');
    if (!source.mime.startsWith('image/'))
      reply
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(source.title)}`,
        )
        .header('Content-Security-Policy', "sandbox; default-src 'none'");
    return sendPrivateFile(request, reply, source.storagePath, source.mime, env.STAGING_DIR);
  });
  app.get('/learning/tasks/:id', auth, async (request) => {
    const { id } = params.parse(request.params),
      p = request.principal!;
    const task = await withTenant(p.tenantId, (db) =>
      db.learningTask.findFirst({ where: { id, ownerId: p.userId } }),
    );
    if (!task) throw new NotFoundError('Own learning task');
    return { task: { ...task, progress: safeLearningProgress(task.progress) } };
  });
}
