import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
      directory = join(learningStorageRoot(env.STAGING_DIR), p.tenantId, 'models'),
      path = join(directory, id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
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
            title: file.filename.replace(/\.glb$/i, '').slice(0, 200),
            mime: 'model/gltf-binary',
            status: 'ready',
            storagePath: path,
            passages: [],
            metadata: {
              ...metadata,
              size: bytes.length,
              revision: 0,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      });
      return reply.code(201).send({
        model: {
          id: source.id,
          title: source.title,
          metadata: source.metadata,
          status: source.status,
        },
      });
    } catch (e) {
      await rm(path, { force: true });
      throw e;
    }
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
    return reply
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .type('model/gltf-binary')
      .send(await readFile(source.storagePath));
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
