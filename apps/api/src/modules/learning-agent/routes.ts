import { withTenant, type Prisma } from '@void-space/db';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../../env';
import type { JobProducer } from '../../lib/jobs';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { requirePrivateAuthor } from '../learning-hub/access';
import { enqueueLearningTask } from '../learning-hub/tasks';
import { lessonAsset } from '../lesson-plans/service';
const uuid = z.string().uuid(),
  params = z.object({ id: uuid });
export async function learningAgentRoutes(
  app: FastifyInstance,
  { env, producer }: { env: ApiEnv; producer: JobProducer },
) {
  const auth = { preHandler: app.authenticate };
  app.get('/learning/progress', auth, async (request) => {
    const p = request.principal!,
      grants = await withTenant(p.tenantId, (db) =>
        db.lessonGrant.findMany({
          where: { ownerId: p.userId },
          select: { releaseTenantId: true },
        }),
      );
    const tenants = [...new Set([p.tenantId, ...grants.map((g) => g.releaseTenantId)])].slice(
        0,
        30,
      ),
      rows = [];
    for (const tenant of tenants) {
      const studies = await withTenant(tenant, (db) =>
        db.lessonStudy.findMany({
          where: { ownerId: p.userId },
          include: { release: { select: { id: true, definition: true } } },
          orderBy: { updatedAt: 'desc' },
          take: 50,
        }),
      );
      for (const s of studies) {
        const definition = s.release.definition as { title: string; sections: unknown[] };
        const state = s.state as {
          completed: string[];
          activities: Record<string, { mistakes: number }>;
        };
        rows.push({
          id: s.releaseId,
          tenantId: tenant,
          title: definition.title,
          completed: state.completed.length,
          total: definition.sections.length,
          mistakes: Object.values(state.activities).reduce((n, a) => n + a.mistakes, 0),
          updatedAt: s.updatedAt,
        });
      }
    }
    return { lessons: rows };
  });
  app.get('/learning/agent/threads', auth, async (request) => {
    const p = request.principal!;
    return withTenant(p.tenantId, async (db) => ({
      threads: await db.learningThread.findMany({
        where: { ownerId: p.userId },
        select: { id: true, title: true, folderId: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
      folders: await db.learningFolder.findMany({
        where: { ownerId: p.userId },
        orderBy: { createdAt: 'desc' },
      }),
    }));
  });
  app.post('/learning/agent/folders', auth, async (request, reply) => {
    const p = request.principal!;
    requirePrivateAuthor(p);
    const { title } = z
      .object({ title: z.string().trim().min(1).max(120) })
      .strict()
      .parse(request.body);
    const folder = await withTenant(p.tenantId, (db) =>
      db.learningFolder.create({ data: { tenantId: p.tenantId, ownerId: p.userId, title } }),
    );
    return reply.code(201).send({ folder });
  });
  app.post('/learning/agent/threads', auth, async (request, reply) => {
    const p = request.principal!;
    requirePrivateAuthor(p);
    const input = z
      .object({
        title: z.string().trim().min(1).max(200).default('New conversation'),
        folderId: uuid.optional(),
      })
      .strict()
      .parse(request.body ?? {});
    const thread = await withTenant(p.tenantId, async (db) => {
      if (
        input.folderId &&
        !(await db.learningFolder.findFirst({ where: { id: input.folderId, ownerId: p.userId } }))
      )
        throw new NotFoundError('Folder');
      return db.learningThread.create({
        data: { tenantId: p.tenantId, ownerId: p.userId, ...input, messages: [] },
      });
    });
    return reply.code(201).send({ thread });
  });
  app.get('/learning/agent/threads/:id', auth, async (request) => {
    const p = request.principal!,
      { id } = params.parse(request.params);
    const thread = await withTenant(p.tenantId, (db) =>
      db.learningThread.findFirst({ where: { id, ownerId: p.userId } }),
    );
    if (!thread) throw new NotFoundError('Conversation');
    return { thread };
  });
  app.patch('/learning/agent/threads/:id', auth, async (request) => {
    requirePrivateAuthor(request.principal!);
    const p = request.principal!,
      { id } = params.parse(request.params),
      input = z
        .object({
          title: z.string().trim().min(1).max(200).optional(),
          folderId: uuid.nullable().optional(),
        })
        .strict()
        .parse(request.body);
    return withTenant(p.tenantId, async (db) => {
      if (!(await db.learningThread.findFirst({ where: { id, ownerId: p.userId } })))
        throw new NotFoundError('Conversation');
      if (
        input.folderId &&
        !(await db.learningFolder.findFirst({ where: { id: input.folderId, ownerId: p.userId } }))
      )
        throw new NotFoundError('Folder');
      return { thread: await db.learningThread.update({ where: { id }, data: input }) };
    });
  });
  app.delete('/learning/agent/threads/:id', auth, async (request) => {
    requirePrivateAuthor(request.principal!);
    const p = request.principal!,
      { id } = params.parse(request.params);
    const deleted = await withTenant(p.tenantId, (db) =>
      db.learningThread.deleteMany({ where: { id, ownerId: p.userId } }),
    );
    if (!deleted.count) throw new NotFoundError('Conversation');
    return { deleted: true };
  });
  app.post('/learning/agent/threads/:id/messages', auth, async (request, reply) => {
    const p = request.principal!,
      { id } = params.parse(request.params);
    requirePrivateAuthor(p);
    const input = z
      .object({
        eventKey: uuid,
        revision: z.number().int().min(0),
        message: z.string().trim().min(1).max(4000),
        sourceIds: z.array(uuid).max(5).default([]),
        assetId: uuid.optional(),
        privateModelId: uuid.optional(),
        durationMinutes: z.number().int().min(5).max(180).default(30),
        audience: z.string().min(3).max(200).default('Learners aged 13+'),
        planId: uuid.optional(),
      })
      .strict()
      .parse(request.body);
    const thread = await withTenant(p.tenantId, (db) =>
      db.learningThread.findFirst({ where: { id, ownerId: p.userId } }),
    );
    if (!thread) throw new NotFoundError('Conversation');
    const messages = thread.messages as {
      role: string;
      content: string;
      eventKey?: string;
      taskId?: string;
      result?: { planId?: string };
    }[];
    const duplicate = messages.find((m) => m.eventKey === input.eventKey);
    if (duplicate) {
      if (duplicate.content !== input.message)
        throw new ConflictError('A message key cannot be reused.');
      return { taskId: duplicate.taskId, threadId: id, duplicate: true };
    }
    if (thread.revision !== input.revision)
      throw new ConflictError('This conversation changed. Reload before sending.');
    if (messages.length >= 100) throw new ConflictError('Start a new conversation to continue.');
    const sources = await withTenant(p.tenantId, (db) =>
      db.learningSource.count({
        where: { id: { in: input.sourceIds }, ownerId: p.userId, status: 'ready' },
      }),
    );
    if (sources !== new Set(input.sourceIds).size)
      throw new ValidationError('Choose your own ready sources.');
    let asset = input.assetId ? await lessonAsset(p, input.assetId) : null;
    let model = input.privateModelId
      ? await withTenant(p.tenantId, (db) =>
          db.learningSource.findFirst({
            where: {
              id: input.privateModelId,
              ownerId: p.userId,
              mime: 'model/gltf-binary',
              status: 'ready',
            },
          }),
        )
      : null;
    if (input.privateModelId && !model) throw new NotFoundError('Private model');
    const contextPlanId =
      input.planId ??
      [...messages].reverse().find((m) => m.role === 'assistant' && m.result?.planId)?.result
        ?.planId;
    const plan = contextPlanId
      ? await withTenant(p.tenantId, (db) =>
          db.lessonPlan.findFirst({ where: { id: contextPlanId, ownerId: p.userId } }),
        )
      : null;
    if (contextPlanId && !plan) throw new NotFoundError('Lesson draft');
    const selected = plan?.definition as
      { sourceIds?: string[]; privateModelId?: string; assetId?: string } | undefined;
    if (!input.privateModelId && !input.assetId) {
      if (selected?.privateModelId)
        model = await withTenant(p.tenantId, (db) =>
          db.learningSource.findFirst({
            where: {
              id: selected.privateModelId,
              ownerId: p.userId,
              mime: 'model/gltf-binary',
              status: 'ready',
            },
          }),
        );
      else if (selected?.assetId) asset = await lessonAsset(p, selected.assetId);
    }
    const selectedSources = [
      ...new Set([...input.sourceIds, ...(selected?.sourceIds ?? [])]),
    ].slice(0, 5);

    const task = await enqueueLearningTask(
      env,
      producer,
      p,
      'agent_turn',
      {
        threadId: id,
        context: {
          ...input,
          sourceIds: selectedSources,
          ...(model ? { privateModelId: model.id } : {}),
          asset: asset
            ? {
                id: asset.id,
                name: asset.name,
                versionId: asset.currentVersion!.id,
                cid: asset.currentVersion!.ipfsCid,
                format: asset.currentVersion!.format,
                polycount: asset.currentVersion!.polycount,
                attribution: asset.currentVersion!.sourceAttribution ?? asset.name,
              }
            : null,
          model: model ? { id: model.id, title: model.title, metadata: model.metadata } : null,
          plan: plan ? { id: plan.id, revision: plan.revision, definition: plan.definition } : null,
        },
        messages: messages
          .slice(-12)
          .map((m) => ({ role: m.role, content: m.content }))
          .concat({ role: 'user', content: input.message }),
      },
      async (db, taskId) => {
        await db.$queryRaw`SELECT id FROM learning_threads WHERE id=${id}::uuid FOR UPDATE`;
        const current = await db.learningThread.findFirst({ where: { id, ownerId: p.userId } });
        if (!current) throw new NotFoundError('Conversation');
        if (current.revision !== input.revision)
          throw new ConflictError('This conversation changed. Reload before sending.');
        if (
          await db.learningTask.count({
            where: {
              ownerId: p.userId,
              kind: 'agent_turn',
              status: { in: ['queued', 'active'] },
              input: { path: ['threadId'], equals: id },
            },
          })
        )
          throw new ConflictError('Wait for the agent to finish this turn.');
        await db.learningThread.update({
          where: { id },
          data: {
            revision: { increment: 1 },
            title: messages.length ? thread.title : input.message.slice(0, 90),
            messages: [
              ...messages,
              { role: 'user', content: input.message, eventKey: input.eventKey, taskId },
            ] as Prisma.InputJsonValue,
          },
        });
      },
    );
    return reply.code(202).send({ taskId: task.id, threadId: id, status: task.status });
  });
}
