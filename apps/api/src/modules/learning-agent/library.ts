import type { AuthPrincipal } from '@void-space/types';
import { sendPrivateFile } from '../../lib/private-files';
import { readLearningFile, writeLearningFile, deleteLearningFile } from '@void-space/db';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  withTenant,
  learningStorageRoot,
  isLearningStoragePath,
  metadataFromGlbBuffer,
  type Prisma,
} from '@void-space/db';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../../env';
import { ValidationError, NotFoundError, ConflictError } from '../../lib/errors';
import { requirePrivateAuthor } from '../learning-hub/access';
const maxBytes = 50 * 1024 * 1024;
interface Node {
  name?: string;
  mesh?: number;
  children?: number[];
}
interface Glb {
  nodes?: Node[];
  meshes?: { name?: string; primitives?: unknown[] }[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
  buffers?: { uri?: string }[];
  images?: { uri?: string }[];
}
export function inspectPrivateModel(bytes: Buffer) {
  if (
    bytes.length < 20 ||
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    throw new ValidationError('Upload a complete GLB 2.0 model.');
  const length = bytes.readUInt32LE(12);
  if (
    length > 8 * 1024 * 1024 ||
    length + 20 > bytes.length ||
    bytes.readUInt32LE(16) !== 0x4e4f534a
  )
    throw new ValidationError('The model JSON chunk is invalid or too large.');
  let gltf: Glb;
  try {
    gltf = JSON.parse(bytes.subarray(20, 20 + length).toString());
  } catch {
    throw new ValidationError('The model JSON could not be read.');
  }
  if (
    [...(gltf.buffers ?? []), ...(gltf.images ?? [])].some(
      (x) => x.uri && !x.uri.startsWith('data:'),
    )
  )
    throw new ValidationError(
      'Use a self-contained GLB. External files and remote texture URLs are not allowed in private models.',
    );
  const stats = metadataFromGlbBuffer(bytes);
  if (!stats?.vertices || !stats.polycount || stats.polycount > 2000000)
    throw new ValidationError('Use a model with valid geometry and at most two million triangles.');
  const parts: { key: string; name: string }[] = [],
    visited = new Set<number>();
  const visit = (index: number, depth = 0) => {
    if (depth > 100 || visited.has(index)) return;
    visited.add(index);
    const n = gltf.nodes?.[index];
    if (!n) return;
    if (n.mesh !== undefined) {
      const mesh = gltf.meshes?.[n.mesh];
      for (const [i] of (mesh?.primitives ?? []).entries())
        parts.push({
          key: `mesh-${parts.length}`,
          name:
            (n.name ?? mesh?.name ?? `Unidentified part ${parts.length + 1}`).slice(0, 100) +
            (i ? ` (${i + 1})` : ''),
        });
    }
    for (const child of n.children ?? []) visit(child, depth + 1);
  };
  for (const root of gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? (gltf.nodes ?? []).map((_, i) => i))
    visit(root);
  if (parts.length > 500)
    throw new ValidationError('Use a model with at most 500 component meshes.');
  return { stats, parts, labels: [], labelsReviewed: false };
}
export async function savePrivateLibraryModel(
  p: AuthPrincipal,
  env: Pick<ApiEnv, 'STAGING_DIR'>,
  bytes: Buffer,
  filename: string,
  provenance?: {
    provider: string;
    uid: string;
    url: string;
    author: string;
    license: string;
    aiUseAllowed?: boolean;
  },
): Promise<{ id: string; title: string; metadata: Prisma.JsonValue | null; status: string }> {
  requirePrivateAuthor(p);
  if (!bytes.length || bytes.length > maxBytes)
    throw new ValidationError('Use a complete model no larger than 50 MB.');
  let inspected: ReturnType<typeof inspectPrivateModel>;
  try {
    inspected = inspectPrivateModel(bytes);
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError(
      'This GLB has invalid geometry metadata. Export a self-contained GLB and try again.',
    );
  }
  const metadata = inspected,
    id = randomUUID(),
    directory = join(learningStorageRoot(env.STAGING_DIR), p.tenantId, 'models');
  let path = join(directory, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  path = await writeLearningFile(path, bytes, env.STAGING_DIR, 'model/gltf-binary');
  try {
    const source = await withTenant(p.tenantId, async (db) => {
      await db.$queryRaw`SELECT id FROM users WHERE id=${p.userId}::uuid FOR UPDATE`;
      const existing = await db.learningSource.findMany({
        where: { ownerId: p.userId, mime: 'model/gltf-binary' },
        select: { metadata: true },
      });
      const total = existing.reduce(
        (n, s) => n + Number((s.metadata as { size?: number } | null)?.size ?? 0),
        0,
      );
      if (existing.length >= 20 || total + bytes.length > 200 * 1024 * 1024)
        throw new ConflictError('Your private library limit is 20 models and 200 MB.');
      return db.learningSource.create({
        data: {
          id,
          tenantId: p.tenantId,
          ownerId: p.userId,
          title: filename.replace(/\.glb$/i, '').slice(0, 200),
          mime: 'model/gltf-binary',
          status: 'ready',
          storagePath: path,
          passages: [],
          metadata: {
            ...metadata,
            size: bytes.length,
            revision: 0,
            ...(provenance ? { provenance } : {}),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return { id: source.id, title: source.title, metadata: source.metadata, status: source.status };
  } catch (e) {
    await deleteLearningFile(path, env.STAGING_DIR);
    throw e;
  }
}
export async function privateLibraryRoutes(app: FastifyInstance, { env }: { env: ApiEnv }) {
  const auth = { preHandler: app.authenticate };
  app.get('/learning/library', auth, async (request) => ({
    models: await withTenant(request.principal!.tenantId, (db) =>
      db.learningSource.findMany({
        where: { ownerId: request.principal!.userId, mime: 'model/gltf-binary' },
        select: { id: true, title: true, status: true, metadata: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ),
  }));
  app.post('/learning/library/upload', auth, async (request, reply) => {
    const p = request.principal!;
    requirePrivateAuthor(p);
    const file = await request.file({ limits: { fileSize: maxBytes, files: 1 } });
    if (!file || !file.filename.toLowerCase().endsWith('.glb'))
      throw new ValidationError('Choose a self-contained GLB model (maximum 50 MB).');
    const bytes = await file.toBuffer();
    if (file.file.truncated) throw new ValidationError('Model exceeds 50 MB.');
    const model = await savePrivateLibraryModel(p, env, bytes, file.filename);
    return reply.code(201).send({ model });
  });
  app.get('/learning/library/:id/file', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params),
      p = request.principal!;
    const source = await withTenant(p.tenantId, (db) =>
      db.learningSource.findFirst({
        where: { id, ownerId: p.userId, mime: 'model/gltf-binary', status: 'ready' },
      }),
    );
    if (!source?.storagePath || !isLearningStoragePath(source.storagePath, env.STAGING_DIR))
      throw new NotFoundError('Private model');
    return sendPrivateFile(
      request,
      reply,
      source.storagePath,
      'model/gltf-binary',
      env.STAGING_DIR,
    );
  });
  app.get('/learning/library/:id/thumbnail', auth, async (request, reply) => {
    const p = request.principal!,
      { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const model = await withTenant(p.tenantId, (db) =>
      db.learningSource.findFirst({ where: { id, ownerId: p.userId, mime: 'model/gltf-binary' } }),
    );
    const viewId = (model?.metadata as { viewsSourceId?: string } | null)?.viewsSourceId;
    const views = viewId
      ? await withTenant(p.tenantId, (db) =>
          db.learningSource.findFirst({
            where: { id: viewId, ownerId: p.userId, mime: 'application/x-void-model-views' },
          }),
        )
      : null;
    if (!views?.storagePath || !isLearningStoragePath(views.storagePath, env.STAGING_DIR))
      throw new NotFoundError('Model thumbnail');
    const data = await readLearningFile(views.storagePath, env.STAGING_DIR);
    if (data.length > 5 * 1024 * 1024) throw new NotFoundError('Model thumbnail');
    const image = (JSON.parse(data.toString()) as { views?: { image: string }[] }).views?.[0]
      ?.image;
    if (!image?.startsWith('data:image/jpeg;base64,/9j/'))
      throw new NotFoundError('Model thumbnail');
    return reply
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .type('image/jpeg')
      .send(Buffer.from(image.split(',')[1]!, 'base64'));
  });
  app.post(
    '/learning/library/:id/views',
    { ...auth, bodyLimit: 5 * 1024 * 1024 },
    async (request, reply) => {
      const p = request.principal!;
      requirePrivateAuthor(p);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const position = z.tuple([
        z.number().min(-1).max(1),
        z.number().min(-1).max(1),
        z.number().min(-1).max(1),
      ]);
      const input = z
        .object({
          views: z
            .array(
              z
                .object({
                  name: z.string().min(1).max(40),
                  image: z
                    .string()
                    .max(600000)
                    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/),
                  anchors: z
                    .array(
                      z
                        .object({
                          x: z.number().min(0).max(1),
                          y: z.number().min(0).max(1),
                          meshKey: z.string().regex(/^mesh-\d+$/),
                          position,
                        })
                        .strict(),
                    )
                    .max(64),
                })
                .strict(),
            )
            .min(1)
            .max(6),
        })
        .strict()
        .parse(request.body);
      const source = await withTenant(p.tenantId, (db) =>
        db.learningSource.findFirst({
          where: { id, ownerId: p.userId, mime: 'model/gltf-binary' },
        }),
      );
      if (!source) throw new NotFoundError('Private model');
      const metadata = source.metadata as { parts: { key: string }[] };
      if (
        input.views.some((v) =>
          v.anchors.some((a) => !metadata.parts.some((p) => p.key === a.meshKey)),
        )
      )
        throw new ValidationError('View anchors must reference actual model components.');
      const viewId = randomUUID(),
        directory = join(learningStorageRoot(env.STAGING_DIR), p.tenantId),
        path = join(directory, viewId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const storedPath = await writeLearningFile(
        path,
        JSON.stringify(input),
        env.STAGING_DIR,
        'application/json',
      );
      try {
        await withTenant(p.tenantId, async (db) => {
          await db.$queryRaw`SELECT id FROM learning_sources WHERE id=${id}::uuid FOR UPDATE`;
          const current = await db.learningSource.findFirstOrThrow({
            where: { id, ownerId: p.userId },
          });
          await db.learningSource.create({
            data: {
              id: viewId,
              tenantId: p.tenantId,
              ownerId: p.userId,
              title: 'Model views',
              mime: 'application/x-void-model-views',
              storagePath: storedPath,
              passages: [],
              metadata: { modelId: id },
            },
          });
          await db.learningSource.update({
            where: { id },
            data: { metadata: { ...(current.metadata as object), viewsSourceId: viewId } },
          });
        });
      } catch (error) {
        await deleteLearningFile(storedPath, env.STAGING_DIR);
        throw error;
      }
      return reply.code(201).send({ saved: true });
    },
  );
  app.get('/learning/library/:id/annotations/history', auth, async (request) => {
    const p = request.principal!,
      { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const source = await withTenant(p.tenantId, (db) =>
      db.learningSource.findFirst({ where: { id, ownerId: p.userId, mime: 'model/gltf-binary' } }),
    );
    if (!source) throw new NotFoundError('Private model');
    return {
      revisions: await withTenant(p.tenantId, (db) =>
        db.learningAnnotationRevision.findMany({
          where: { modelId: id, ownerId: p.userId },
          orderBy: { revision: 'desc' },
          take: 50,
        }),
      ),
    };
  });
  app.patch('/learning/library/:id/labels', auth, async (request) => {
    requirePrivateAuthor(request.principal!);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params),
      p = request.principal!;
    const input = z
      .object({
        revision: z.number().int().min(0),
        reviewed: z.boolean(),
        labels: z
          .array(
            z
              .object({
                id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
                label: z.string().min(2).max(100),
                meshKey: z.string().regex(/^mesh-\d+$/),
                explanation: z.string().max(2000),
                function: z.string().max(2000).optional(),
                relationships: z.string().max(2000).optional(),
                confidence: z.enum(['named', 'uncertain']).optional(),
                sourceRefs: z
                  .array(
                    z
                      .object({ sourceId: z.string().uuid(), passageId: z.string().max(100) })
                      .strict(),
                  )
                  .max(10)
                  .default([]),
                position: z.tuple([
                  z.number().min(-1).max(1),
                  z.number().min(-1).max(1),
                  z.number().min(-1).max(1),
                ]),
              })
              .strict(),
          )
          .max(40),
      })
      .strict()
      .parse(request.body);
    return withTenant(p.tenantId, async (db) => {
      await db.$queryRaw`SELECT id FROM learning_sources WHERE id=${id}::uuid FOR UPDATE`;
      const source = await db.learningSource.findFirst({
        where: { id, ownerId: p.userId, mime: 'model/gltf-binary' },
      });
      if (!source) throw new NotFoundError('Private model');
      const metadata = source.metadata as {
        parts: { key: string; name: string }[];
        revision: number;
      };
      if (metadata.revision !== input.revision)
        throw new ConflictError('Model labels changed in another tab.');
      if (
        input.labels.some((l) => !metadata.parts.some((p) => p.key === l.meshKey)) ||
        new Set(input.labels.map((l) => l.id)).size !== input.labels.length
      )
        throw new ValidationError('Each label must map to a known component mesh.');
      if (
        input.reviewed &&
        (!input.labels.length || input.labels.some((l) => l.explanation.trim().length < 10))
      )
        throw new ValidationError(
          'Add a useful explanation to every annotation before marking it reviewed.',
        );
      const refs = input.labels.flatMap((l) => l.sourceRefs);
      if (refs.length) {
        const sources = await db.learningSource.findMany({
          where: {
            id: { in: [...new Set(refs.map((r) => r.sourceId))] },
            ownerId: p.userId,
            status: 'ready',
          },
        });
        if (
          refs.some(
            (r) =>
              !sources.some(
                (s) =>
                  s.id === r.sourceId &&
                  Array.isArray(s.passages) &&
                  (s.passages as { id: string }[]).some((p) => p.id === r.passageId),
              ),
          )
        )
          throw new ValidationError(
            'Each citation must reference one of your readable source passages.',
          );
      }
      await db.learningAnnotationRevision.createMany({
        data: [
          {
            tenantId: p.tenantId,
            ownerId: p.userId,
            modelId: id,
            revision: metadata.revision,
            labels: (metadata as unknown as { labels?: Prisma.InputJsonValue }).labels ?? [],
            reviewed: !!(metadata as unknown as { labelsReviewed?: boolean }).labelsReviewed,
          },
          {
            tenantId: p.tenantId,
            ownerId: p.userId,
            modelId: id,
            revision: metadata.revision + 1,
            labels: input.labels as Prisma.InputJsonValue,
            reviewed: input.reviewed,
          },
        ],
        skipDuplicates: true,
      });
      const updated = await db.learningSource.update({
        where: { id },
        data: {
          metadata: {
            ...metadata,
            labels: input.labels,
            labelsReviewed: input.reviewed,
            revision: metadata.revision + 1,
          } as Prisma.InputJsonValue,
        },
      });
      return { model: { id, title: updated.title, metadata: updated.metadata } };
    });
  });
}
