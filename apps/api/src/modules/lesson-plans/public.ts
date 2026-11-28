import { sendAssetContent } from '../content/routes';
import { sendPrivateFile } from '../../lib/private-files';

import {
  withTenant,
  prisma,
  isLearningStoragePath,
  type TenantClient,
  type Prisma,
} from '@void-space/db';
import { learnerLessonPlan, lessonPlanSchema } from '@void-space/types';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../../env';
import { NotFoundError, ForbiddenError } from '../../lib/errors';
import { requirePrivateAuthor } from '../learning-hub/access';
import { accessibleRelease } from './service';
export async function syncLessonListing(
  db: TenantClient,
  release: Prisma.LessonPlanReleaseGetPayload<Record<string, never>>,
) {
  if (release.reviewed && release.visibility === 'public') {
    const d = lessonPlanSchema.parse(release.definition);
    const data = {
      tenantId: release.tenantId,
      title: d.title,
      summary: d.summary,
      audience: d.audience,
      durationMinutes: d.durationMinutes,
      authorLabel: 'Reviewed by its author',
    };
    await db.publicLessonEntry.upsert({
      where: { id: release.id },
      create: { id: release.id, ...data },
      update: data,
    });
  } else await db.publicLessonEntry.deleteMany({ where: { id: release.id } });
}
export async function publicLessonRoutes(app: FastifyInstance, { env }: { env: ApiEnv }) {
  app.get('/learning/public-lessons', async (request) => {
    const { q } = z.object({ q: z.string().max(100).optional() }).parse(request.query);
    return {
      lessons: await prisma.publicLessonEntry.findMany({
        where: q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { summary: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {},
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    };
  });
  app.get('/learning/public-lessons/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params),
      entry = await prisma.publicLessonEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundError('Public lesson');
    const release = await withTenant(entry.tenantId, (db) =>
      db.lessonPlanRelease.findFirst({ where: { id, visibility: 'public', reviewed: true } }),
    );
    if (!release) throw new NotFoundError('Public lesson');
    return {
      lesson: entry,
      definition: learnerLessonPlan(lessonPlanSchema.parse(release.definition)),
      sourceExcerpts: release.sourceExcerpts,
    };
  });
  app.post(
    '/learning/public-lessons/:id/open',
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params),
        entry = await prisma.publicLessonEntry.findUnique({ where: { id } }),
        p = request.principal!;
      if (!entry) throw new NotFoundError('Public lesson');
      await withTenant(p.tenantId, (db) =>
        db.lessonGrant.upsert({
          where: { ownerId_shareId: { ownerId: p.userId, shareId: id } },
          create: {
            tenantId: p.tenantId,
            ownerId: p.userId,
            releaseId: id,
            releaseTenantId: entry.tenantId,
            shareId: id,
          },
          update: {},
        }),
      );
      return { releaseId: id, tenantId: entry.tenantId };
    },
  );
  app.patch(
    '/learning/lesson-plans/releases/:id/visibility',
    { preHandler: app.authenticate },
    async (request) => {
      requirePrivateAuthor(request.principal!);
      const p = request.principal!,
        { id } = z.object({ id: z.string().uuid() }).parse(request.params),
        { visibility } = z
          .object({ visibility: z.enum(['private', 'institution', 'public']) })
          .strict()
          .parse(request.body);
      if (visibility === 'institution' && !p.permissions.includes('learning:manage'))
        throw new ForbiddenError('Institution sharing requires an authorized educator.');
      const existing = await accessibleRelease(p, p.tenantId, id);
      if (existing.ownerId !== p.userId || !existing.reviewed)
        throw new ForbiddenError('Review and publish your lesson before changing its audience.');
      const release = await withTenant(p.tenantId, async (db) => {
        const r = await db.lessonPlanRelease.update({ where: { id }, data: { visibility } });
        await syncLessonListing(db, r);
        return r;
      });
      return { release: { id: release.id, visibility: release.visibility } };
    },
  );
  app.get('/learning/public-lessons/:id/visual', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params),
      { section } = z.object({ section: z.string() }).parse(request.query),
      entry = await prisma.publicLessonEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundError('Public lesson');
    let assetAddress: string | undefined;
    const source = await withTenant(entry.tenantId, async (db) => {
      const r = await db.lessonPlanRelease.findFirst({
        where: { id, reviewed: true, visibility: 'public' },
      });
      if (!r) throw new NotFoundError('Public lesson');
      const a = lessonPlanSchema
        .parse(r.definition)
        .sections.find((s) => s.id === section)?.activity;
      const sourceId =
        a?.scene.kind === 'diagram'
          ? a.scene.imageSourceId
          : a?.scene.kind === 'model'
            ? a.scene.privateModelId
            : undefined;
      if (
        a?.scene.kind === 'model' &&
        !a.scene.privateModelId &&
        !a.scene.builtin &&
        a.scene.assetId &&
        a.scene.media?.cid
      ) {
        assetAddress = a.scene.media.cid;
        return null;
      }
      if (!sourceId) throw new NotFoundError('Lesson visual');
      return db.learningSource.findFirst({
        where: { id: sourceId, ownerId: r.ownerId, status: 'ready' },
      });
    });
    if (assetAddress) return sendAssetContent(request, reply, assetAddress);
    if (
      !source?.storagePath ||
      !isLearningStoragePath(source.storagePath, env.STAGING_DIR) ||
      !['image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary'].includes(source.mime)
    )
      throw new NotFoundError('Public lesson visual');
    return sendPrivateFile(request, reply, source.storagePath, source.mime, env.STAGING_DIR);
  });
}
