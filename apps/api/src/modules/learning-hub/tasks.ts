import { randomUUID } from 'node:crypto';
import { withTenant, type Prisma, type TenantClient } from '@void-space/db';
import type { AuthPrincipal } from '@void-space/types';
import type { ApiEnv } from '../../env';
import type { JobProducer } from '../../lib/jobs';
import { ConflictError } from '../../lib/errors';
import { isTeacher } from './access';
export async function enqueueLearningTask(
  env: ApiEnv,
  producer: JobProducer,
  p: AuthPrincipal,
  kind: string,
  input: unknown,
  prepare?: (db: TenantClient, taskId: string) => Promise<void>,
) {
  const task = await withTenant(p.tenantId, async (db) => {
    await db.$queryRaw`SELECT id FROM users WHERE id=${p.userId}::uuid FOR UPDATE`;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const used = await db.learningTask.count({
      where: { ownerId: p.userId, createdAt: { gte: today } },
    });
    if (used >= (isTeacher(p) ? env.LEARNING_TEACHER_DAILY_JOBS : env.LEARNING_LEARNER_DAILY_JOBS))
      throw new ConflictError(
        'Daily generation limit reached. Editing and study remain available.',
      );
    if (
      (await db.learningTask.count({
        where: { ownerId: p.userId, status: { in: ['queued', 'active'] } },
      })) >= (kind === 'extract' ? 20 : 3)
    )
      throw new ConflictError(
        'Your task limit is reached. Wait for running work to finish, then retry.',
      );
    const id = randomUUID();
    await prepare?.(db, id);
    const t = await db.learningTask.create({
      data: {
        id,
        tenantId: p.tenantId,
        ownerId: p.userId,
        kind,
        input: input as Prisma.InputJsonValue,
      },
    });
    if (kind === 'agent_turn')
      await db.learningAgentRun.create({
        data: {
          id,
          tenantId: p.tenantId,
          ownerId: p.userId,
          engine: process.env.LEARNING_AGENT_ENGINE === 'inngest' ? 'inngest' : 'bullmq',
        },
      });
    await db.job.create({
      data: {
        id,
        tenantId: p.tenantId,
        queue: 'learning',
        entityType: 'learning_task',
        entityId: id,
        payload: { tenantId: p.tenantId, taskId: id },
        maxAttempts: 2,
      },
    });
    return t;
  });
  const queued = await producer.enqueue({
    id: task.id,
    tenantId: p.tenantId,
    queue: 'learning',
    entityType: 'learning_task',
    entityId: task.id,
    payload: { tenantId: p.tenantId, taskId: task.id },
    maxAttempts: 2,
  });
  if (!queued.enqueued)
    return withTenant(p.tenantId, async (db) => {
      const error =
        'The background queue is unavailable. Your work is saved; retry when it returns.';
      await db.job.update({
        where: { id: task.id },
        data: { status: 'failed', error, finishedAt: new Date() },
      });
      return db.learningTask.update({ where: { id: task.id }, data: { status: 'failed', error } });
    });
  return task;
}
