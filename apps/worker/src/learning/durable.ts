import { createServer } from 'node:http';
import { Inngest } from 'inngest';
import { serve } from 'inngest/node';
import { withTenant, type Prisma } from '@void-space/db';
import type { TextAiConfig } from '@void-space/ai/text';
import type { Job } from 'bullmq';
import { z } from 'zod/v3';
import { createLearningProcessor } from '../processors/learning';
const runInput = z.object({
  tenantId: z.string().uuid(),
  taskId: z.string().uuid(),
  ownerId: z.string().uuid(),
});
export const learningInngest = new Inngest({ id: 'void-space-learning' });
/** Keep the recorded cause and make terminal progress match the terminal task state. */
export async function finalizeLearningFailure(data: z.infer<typeof runInput>) {
  await withTenant(data.tenantId, async (db) => {
    await db.$queryRaw`SELECT id FROM learning_tasks WHERE id=${data.taskId}::uuid FOR UPDATE`;
    const task = await db.learningTask.findFirst({
      where: { id: data.taskId, ownerId: data.ownerId },
    });
    if (!task || ['cancelled', 'completed'].includes(task.status)) return;
    const message =
      task.error &&
      task.error !== 'No configured text provider returned a valid response' &&
      !task.error.startsWith('The agent could not finish after retries.')
        ? task.error
        : 'The AI request could not finish. No changes were applied. Your inputs are saved; retry or continue editing manually.';
    const progress = Array.isArray(task.progress) ? (task.progress as { status?: string }[]) : [];
    await db.learningTask.update({
      where: { id: task.id },
      data: {
        status: 'failed',
        error: message,
        progress: progress.map((step) =>
          step.status === 'working' ? { ...step, status: 'failed' } : step,
        ) as Prisma.InputJsonValue,
      },
    });
    await db.job.updateMany({
      where: { id: task.id },
      data: { status: 'failed', error: message, finishedAt: new Date() },
    });
  });
}
export function startLearningDurableRuntime(textAi: TextAiConfig, stagingDir: string) {
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.INNGEST_SIGNING_KEY || !process.env.INNGEST_EVENT_KEY)
  )
    throw new Error('Self-hosted learning requires Inngest signing and event keys in production.');
  const run = learningInngest.createFunction(
    {
      id: 'private-learning-run',
      triggers: [{ event: 'void/learning.requested' }],
      retries: 2,
      concurrency: [{ limit: 4 }, { limit: 1, key: 'event.data.ownerId' }],
      timeouts: { finish: '10m' },
      onFailure: async ({ event }) => {
        const data = runInput.parse(event.data.event.data);
        await finalizeLearningFailure(data);
      },
    },
    async ({ event, step, attempt }) => {
      const data = runInput.parse(event.data);
      const processor = createLearningProcessor({
        textAi,
        stagingDir,
        checkpoint: async (id, execute) =>
          (await step.run(id, execute)) as Awaited<ReturnType<typeof execute>>,
      });
      const result = await processor({
        id: data.taskId,
        data,
        opts: { attempts: 3 },
        attemptsMade: attempt,
      } as unknown as Job<{ tenantId: string; taskId: string }>);
      return { taskId: data.taskId, completed: !!result };
    },
  );
  const handler = serve({ client: learningInngest, functions: [run] });
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ service: 'learning-harness', ready: true }));
      return;
    }
    if (request.url?.split('?')[0] !== '/api/inngest') {
      response.writeHead(404);
      response.end();
      return;
    }
    handler(request, response);
  });
  server.listen(
    Number(process.env.LEARNING_HARNESS_PORT ?? 4030),
    process.env.LEARNING_HARNESS_HOST ?? '127.0.0.1',
  );
  return server;
}
export async function dispatchLearningRun(data: {
  tenantId: string;
  taskId: string;
  ownerId: string;
}) {
  await learningInngest.send({ id: data.taskId, name: 'void/learning.requested', data });
  await withTenant(data.tenantId, (db) =>
    db.learningAgentRun.updateMany({
      where: { id: data.taskId, ownerId: data.ownerId, dispatchedAt: null },
      data: { dispatchedAt: new Date() },
    }),
  );
  return { dispatched: true, taskId: data.taskId };
}
