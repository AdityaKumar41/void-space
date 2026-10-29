import type { FastifyInstance } from 'fastify';
import { withTenant, type Prisma } from '@void-space/db';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { parseBody } from '../../lib/http';
const params = z.object({ id: z.string().uuid() });
const inputSchema = z
  .object({
    assetVersionId: z.string().uuid(),
    revision: z.number().int().min(0),
    step: z.number().int().min(0).max(100),
    assessment: z.boolean(),
    answers: z.record(z.number().int().min(0).max(20)),
  })
  .strict();
export async function lessonProgressRoutes(app: FastifyInstance) {
  app.get('/lessons/:id/progress', { preHandler: app.authenticate }, async (request) => {
    const { id } = params.parse(request.params);
    const p = request.principal!;
    return withTenant(p.tenantId, async (db) => {
      const lesson = await db.lesson.findFirst({
        where: { id, isPublished: true },
        select: { assetVersionId: true },
      });
      if (!lesson) throw new NotFoundError('Lesson');
      const progress = await db.lessonProgress.findUnique({
        where: {
          tenantId_lessonId_learnerId: { tenantId: p.tenantId, lessonId: id, learnerId: p.userId },
        },
      });
      return { progress: progress?.assetVersionId === lesson.assetVersionId ? progress : null };
    });
  });
  app.patch('/lessons/:id/progress', { preHandler: app.authenticate }, async (request) => {
    const { id } = params.parse(request.params);
    const input = parseBody(inputSchema, request.body);
    const p = request.principal!;
    return withTenant(p.tenantId, async (db) => {
      await db.$queryRaw`SELECT id FROM users WHERE id=${p.userId}::uuid FOR UPDATE`;
      const lesson = await db.lesson.findFirst({ where: { id, isPublished: true } });
      if (!lesson) throw new NotFoundError('Lesson');
      if (input.assetVersionId !== lesson.assetVersionId)
        throw new ConflictError(
          'This lesson uses a different reviewed version. Reopen the lesson.',
        );
      const outline = z.array(z.string()).parse(lesson.outline);
      const questions = z
        .array(z.object({ id: z.string(), options: z.array(z.string()) }))
        .parse(lesson.questions);
      if (
        input.step >= outline.length ||
        Object.entries(input.answers).some(([key, value]) => {
          const question = questions.find((q) => q.id === key);
          return !question || value >= question.options.length;
        })
      )
        throw new ValidationError('Progress does not match the released lesson');
      const where = {
        tenantId_lessonId_learnerId: { tenantId: p.tenantId, lessonId: id, learnerId: p.userId },
      };
      const current = await db.lessonProgress.findUnique({ where });
      if ((current?.revision ?? 0) !== input.revision)
        throw new ConflictError(
          'This lesson changed in another tab. Reopen it to resume the latest saved progress.',
        );
      const data = {
        assetVersionId: input.assetVersionId,
        step: input.step,
        assessment: input.assessment,
        answers: input.answers as Prisma.InputJsonValue,
        revision: input.revision + 1,
      };
      const progress = await db.lessonProgress.upsert({
        where,
        create: { ...data, tenantId: p.tenantId, lessonId: id, learnerId: p.userId },
        update: data,
      });
      return { progress };
    });
  });
}
