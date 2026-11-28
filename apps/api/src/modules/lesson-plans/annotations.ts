import { writeLearningFile, deleteLearningFile } from '@void-space/db';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { withTenant, learningStorageRoot } from '@void-space/db';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../../env';
import type { JobProducer } from '../../lib/jobs';
import { requirePrivateAuthor } from '../learning-hub/access';
import { enqueueLearningTask } from '../learning-hub/tasks';
import { ConflictError, ValidationError } from '../../lib/errors';
import { ownedPlan, parsePlan } from './service';
const point = z.tuple([
  z.number().min(-1).max(1),
  z.number().min(-1).max(1),
  z.number().min(-1).max(1),
]);
const views = z
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
                position: point,
              })
              .strict(),
          )
          .max(64),
      })
      .strict(),
  )
  .min(1)
  .max(6);
export function lessonAnnotationRoutes(
  app: FastifyInstance,
  { env, producer }: { env: ApiEnv; producer: JobProducer },
) {
  app.post(
    '/learning/lesson-plans/:id/annotations',
    { preHandler: app.authenticate, bodyLimit: 5 * 1024 * 1024 },
    async (request, reply) => {
      const p = request.principal!;
      requirePrivateAuthor(p);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const input = z
        .object({
          revision: z.number().int().min(0),
          sectionId: z.string().min(1).max(80),
          instruction: z.string().trim().min(5).max(3000),
          views: views.optional(),
        })
        .strict()
        .parse(request.body);
      const plan = await withTenant(p.tenantId, (db) => ownedPlan(db, p, id));
      if (plan.revision !== input.revision)
        throw new ConflictError('Save or reload the current lesson before annotating.');
      const definition = parsePlan(plan.definition),
        section = definition.sections.find((s) => s.id === input.sectionId);
      if (section?.activity?.scene.kind !== 'model')
        throw new ValidationError('Choose a model exploration section.');
      let viewsSourceId: string | undefined, path: string | undefined;
      if (input.views) {
        viewsSourceId = randomUUID();
        const directory = join(learningStorageRoot(env.STAGING_DIR), p.tenantId);
        path = join(directory, viewsSourceId);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        path = await writeLearningFile(path, JSON.stringify({ views: input.views }), env.STAGING_DIR, 'application/json');
        try {
          await withTenant(p.tenantId, (db) =>
            db.learningSource.create({
              data: {
                id: viewsSourceId!,
                tenantId: p.tenantId,
                ownerId: p.userId,
                title: 'Lesson model views',
                mime: 'application/x-void-model-views',
                storagePath: path,
                passages: [],
                metadata: { planId: id, revision: plan.revision },
              },
            }),
          );
        } catch (error) {
          await deleteLearningFile(path, env.STAGING_DIR);
          throw error;
        }
      }
      try {
        const task = await enqueueLearningTask(env, producer, p, 'plan_annotate', {
          planId: id,
          baseRevision: plan.revision,
          definition,
          sectionId: input.sectionId,
          instruction: input.instruction,
          ...(viewsSourceId ? { viewsSourceId } : {}),
        });
        return reply.code(202).send({ task });
      } catch (error) {
        if (viewsSourceId)
          await withTenant(p.tenantId, (db) =>
            db.learningSource.deleteMany({ where: { id: viewsSourceId, ownerId: p.userId } }),
          );
        if (path) await deleteLearningFile(path, env.STAGING_DIR);
        throw error;
      }
    },
  );
}
