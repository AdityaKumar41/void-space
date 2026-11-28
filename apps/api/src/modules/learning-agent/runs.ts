import { safeLearningEvent } from '../learning-hub/telemetry';
import { setTimeout as pause } from 'node:timers/promises';
import { withTenant, type Prisma } from '@void-space/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { requirePrivateAuthor } from '../learning-hub/access';
export async function learningRunRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };
  app.post('/learning/agent/runs/:id/cancel', auth, async (request) => {
    const p = request.principal!;
    requirePrivateAuthor(p);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return withTenant(p.tenantId, async (db) => {
      await db.$queryRaw`SELECT id FROM learning_tasks WHERE id=${id}::uuid FOR UPDATE`;
      const task = await db.learningTask.findFirst({
        where: { id, ownerId: p.userId, kind: 'agent_turn' },
      });
      if (!task) throw new NotFoundError('Agent run');
      if (['completed', 'failed', 'cancelled'].includes(task.status))
        return { status: task.status };
      await db.learningTask.update({ where: { id }, data: { status: 'cancelled', error: null } });
      await db.job.updateMany({
        where: { id },
        data: { status: 'completed', result: { cancelled: true }, finishedAt: new Date() },
      });
      await db.learningAgentRun.updateMany({
        where: { id, ownerId: p.userId },
        data: { cancelledAt: new Date() },
      });
      await db.learningAgentEvent.create({
        data: { tenantId: p.tenantId, runId: id, payload: { type: 'cancelled' } },
      });
      return { status: 'cancelled' };
    });
  });
  app.get('/learning/agent/runs/:id/events', auth, async (request, reply) => {
    const p = request.principal!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { after = 0 } = z
      .object({ after: z.coerce.number().int().nonnegative().default(0) })
      .parse(request.query);
    const task = await withTenant(p.tenantId, (db) =>
      db.learningTask.findFirst({ where: { id, ownerId: p.userId }, select: { status: true } }),
    );
    if (!task) throw new NotFoundError('Agent run');
    reply.header('Cache-Control', 'private, no-store');
    const read = (cursor: number) =>
      withTenant(p.tenantId, (db) =>
        db.learningAgentEvent.findMany({
          where: { runId: id, sequence: { gt: cursor } },
          orderBy: { sequence: 'asc' },
          take: 200,
        }),
      );
    if (!request.headers.accept?.includes('text/event-stream')) {
      const events = await read(after);
      return {
        status: task.status,
        events: events.map((event) => ({ ...event, payload: safeLearningEvent(event.payload) })),
        nextCursor: events.at(-1)?.sequence ?? after,
      };
    }
    const last = Number(request.headers['last-event-id']);
    let cursor = Number.isSafeInteger(last) && last >= 0 ? Math.max(after, last) : after;
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'private, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const stopped = new AbortController();
    reply.raw.on('close', () => stopped.abort());
    const until = Date.now() + 20000;
    try {
      while (!stopped.signal.aborted && Date.now() < until) {
        const events = await read(cursor);
        for (const event of events) {
          reply.raw.write(
            `id: ${event.sequence}\ndata: ${JSON.stringify(safeLearningEvent(event.payload))}\n\n`,
          );
          cursor = event.sequence;
        }
        const current = await withTenant(p.tenantId, (db) =>
          db.learningTask.findFirst({ where: { id, ownerId: p.userId }, select: { status: true } }),
        );
        if (!current || ['completed', 'failed', 'cancelled'].includes(current.status)) {
          reply.raw.write(
            `event: terminal\ndata: ${JSON.stringify({ status: current?.status ?? 'unavailable' })}\n\n`,
          );
          break;
        }
        reply.raw.write(': keepalive\n\n');
        await pause(1000, undefined, { signal: stopped.signal }).catch(() => undefined);
      }
    } finally {
      reply.raw.end();
    }
  });
  app.get('/learning/source-collections', auth, async (request) => ({
    collections: await withTenant(request.principal!.tenantId, (db) =>
      db.learningSourceCollection.findMany({
        where: { ownerId: request.principal!.userId },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
    ),
  }));
  const collection = z
    .object({
      title: z.string().trim().min(3).max(200),
      sourceIds: z.array(z.string().uuid()).max(20),
    })
    .strict();
  app.post('/learning/source-collections', auth, async (request, reply) => {
    const p = request.principal!;
    requirePrivateAuthor(p);
    const input = collection.parse(request.body);
    return reply.code(201).send(
      await withTenant(p.tenantId, async (db) => {
        const count = await db.learningSource.count({
          where: {
            id: { in: input.sourceIds },
            ownerId: p.userId,
            NOT: { mime: 'model/gltf-binary' },
          },
        });
        if (count !== new Set(input.sourceIds).size) throw new NotFoundError('Private source');
        return {
          collection: await db.learningSourceCollection.create({
            data: {
              ...input,
              sourceIds: [...new Set(input.sourceIds)] as Prisma.InputJsonValue,
              tenantId: p.tenantId,
              ownerId: p.userId,
            },
          }),
        };
      }),
    );
  });
  app.patch('/learning/source-collections/:id', auth, async (request) => {
    const p = request.principal!;
    requirePrivateAuthor(p);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { revision, ...input } = collection
      .extend({ revision: z.number().int().nonnegative() })
      .parse(request.body);
    return withTenant(p.tenantId, async (db) => {
      const count = await db.learningSource.count({
        where: {
          id: { in: input.sourceIds },
          ownerId: p.userId,
          NOT: { mime: 'model/gltf-binary' },
        },
      });
      if (count !== new Set(input.sourceIds).size) throw new NotFoundError('Private source');
      const updated = await db.learningSourceCollection.updateMany({
        where: { id, ownerId: p.userId, revision },
        data: { ...input, revision: { increment: 1 } },
      });
      if (!updated.count)
        throw new ConflictError('Collection changed or is unavailable. Reload before editing.');
      return { saved: true };
    });
  });
}
