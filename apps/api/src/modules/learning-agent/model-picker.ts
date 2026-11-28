import type { FastifyInstance } from 'fastify';
import { withTenant } from '@void-space/db';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors';
const uuid = z.string().uuid();
export async function modelPickerRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };
  app.get('/learning/model-picker/selected', auth, async (request, reply) => {
    const { reference } = z
      .object({ reference: z.string().regex(/^(private|asset):[a-f0-9-]{36}$/i) })
      .parse(request.query);
    const [kind, id] = reference.split(':');
    uuid.parse(id);
    const p = request.principal!;
    const item = await withTenant(p.tenantId, async (db) => {
      if (kind === 'private') {
        const source = await db.learningSource.findFirst({
          where: { id, ownerId: p.userId, mime: 'model/gltf-binary', status: 'ready' },
          select: { title: true },
        });
        return source ? { reference, title: source.title, origin: 'private' } : null;
      }
      const asset = await db.asset.findFirst({
        where: { id, status: { in: ['approved', 'published'] } },
        select: { name: true },
      });
      return asset ? { reference, title: asset.name, origin: 'workspace' } : null;
    });
    if (!item) throw new NotFoundError('Accessible model');
    reply.header('Cache-Control', 'private, no-store');
    return { item };
  });
  app.get('/learning/model-picker', auth, async (request, reply) => {
    const { source, q, cursor } = z
      .object({
        source: z.enum(['private', 'workspace']).default('private'),
        q: z.string().trim().max(120).default(''),
        cursor: uuid.optional(),
      })
      .parse(request.query);
    const p = request.principal!;
    reply.header('Cache-Control', 'private, no-store');
    return withTenant(p.tenantId, async (db) => {
      const paging = {
        take: 25,
        orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      };
      if (source === 'private') {
        const rows = await db.learningSource.findMany({
          ...paging,
          where: {
            ownerId: p.userId,
            mime: 'model/gltf-binary',
            status: 'ready',
            ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
          },
          select: { id: true, title: true },
        });
        return {
          items: rows
            .slice(0, 24)
            .map((r) => ({
              reference: `private:${r.id}`,
              title: r.title,
              origin: 'private',
              ownerLabel: 'Only you',
              license: null,
            })),
          nextCursor: rows.length > 24 ? rows[23]!.id : null,
        };
      }
      const rows = await db.asset.findMany({
        ...paging,
        where: {
          status: { in: ['approved', 'published'] },
          ...(q
            ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { tags: { has: q } }] }
            : {}),
        },
        select: {
          id: true,
          name: true,
          currentVersion: { select: { sourceLicense: true, sourceAttribution: true } },
        },
      });
      return {
        items: rows
          .slice(0, 24)
          .map((r) => ({
            reference: `asset:${r.id}`,
            title: r.name,
            origin: 'workspace',
            ownerLabel: p.tenantName,
            license: r.currentVersion?.sourceLicense ?? null,
          })),
        nextCursor: rows.length > 24 ? rows[23]!.id : null,
      };
    });
  });
}
