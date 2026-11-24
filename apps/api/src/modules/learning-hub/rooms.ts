import { randomUUID } from 'node:crypto';
import { withTenant, type Prisma } from '@void-space/db';
import { learningActivitySchema } from '@void-space/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { parseBody } from '../../lib/http';
import { notifySpatialRoom } from '../spatial/ws';
const key = z.string().min(1).max(80),
  text = z.string().trim().min(2).max(1500);
const stateSchema = z.object({
  revision: z.number().int().default(0),
  events: z.array(z.string()).max(100).default([]),
  focus: z
    .object({ activityId: z.string().uuid(), targetId: key.nullable() })
    .nullable()
    .default(null),
  annotations: z
    .array(z.object({ id: key, text, targetId: key.nullable(), author: z.string() }))
    .max(50)
    .default([]),
  questions: z
    .array(
      z.object({
        id: key,
        text,
        authorId: z.string().uuid(),
        author: z.string(),
        resolved: z.boolean(),
      }),
    )
    .max(100)
    .default([]),
  poll: z
    .object({
      id: key,
      question: text,
      options: z.array(z.string().min(1).max(200)).min(2).max(6),
      votes: z.record(z.string().uuid(), z.number().int()),
      closed: z.boolean(),
    })
    .nullable()
    .default(null),
  recap: z
    .object({
      text: z.string().max(6000),
      reviewed: z.boolean(),
      activityId: z.string().uuid().nullable(),
    })
    .nullable()
    .default(null),
});
const actionSchema = z
  .object({
    eventKey: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    kind: z.enum([
      'focus',
      'annotate',
      'question',
      'resolve',
      'poll',
      'vote',
      'close_poll',
      'recap',
    ]),
    activityId: z.string().uuid().optional(),
    targetId: key.nullable().optional(),
    text: text.optional(),
    questionId: key.optional(),
    options: z.array(z.string().min(1).max(200)).min(2).max(6).optional(),
    option: z.number().int().min(0).max(5).optional(),
    reviewed: z.boolean().optional(),
  })
  .strict();
function projection(raw: unknown, userId: string, teacher: boolean) {
  const s = stateSchema.parse(raw ?? {});
  const { events, ...publicState } = s;
  return {
    ...publicState,
    questions: s.questions.map(({ authorId, ...q }) => ({ ...q, own: authorId === userId })),
    recap: s.recap && (teacher || s.recap.reviewed) ? s.recap : null,
    poll: s.poll
      ? {
          id: s.poll.id,
          question: s.poll.question,
          options: s.poll.options,
          closed: s.poll.closed,
          ownVote: s.poll.votes[userId] ?? null,
          total: Object.keys(s.poll.votes).length,
          counts:
            s.poll.closed || teacher
              ? s.poll.options.map(
                  (_, i) => Object.values(s.poll!.votes).filter((v) => v === i).length,
                )
              : null,
        }
      : null,
  };
}
export async function learningRoomRoutes(app: FastifyInstance) {
  app.get('/learning/rooms/:id', { preHandler: app.authenticate }, async (request) => {
    const p = request.principal!,
      id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const room = await withTenant(p.tenantId, (db) =>
      db.spatialRoom.findFirst({ where: { id, status: 'live' } }),
    );
    if (!room) throw new NotFoundError('Live room');
    return {
      session: projection(room.learningState, p.userId, p.permissions.includes('spatial:manage')),
    };
  });
  app.post(
    '/learning/rooms/:id/events',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const p = request.principal!,
        id = z.object({ id: z.string().uuid() }).parse(request.params).id,
        a = parseBody(actionSchema, request.body),
        teacher = p.permissions.includes('spatial:manage');
      const result = await withTenant(p.tenantId, async (db) => {
        await db.$queryRaw`SELECT id FROM spatial_rooms WHERE id=${id}::uuid FOR UPDATE`;
        const room = await db.spatialRoom.findFirst({ where: { id, status: 'live' } });
        if (!room) throw new NotFoundError('Live room');
        if (
          !teacher &&
          !(await db.spatialParticipant.findFirst({
            where: {
              roomId: id,
              userId: p.userId,
              lastSeenAt: { gte: new Date(Date.now() - 90000) },
            },
          }))
        )
          throw new ForbiddenError('Join the live room before participating');
        const s = stateSchema.parse(room.learningState ?? {});
        if (s.events.includes(a.eventKey))
          return { session: projection(s, p.userId, teacher), duplicate: true };
        if (s.revision !== a.revision)
          throw new ConflictError('The room changed. Load the latest session and retry.');
        if (!['question', 'vote'].includes(a.kind) && !teacher)
          throw new ForbiddenError('Only the facilitator may change shared learning material');
        if (a.kind === 'focus') {
          if (!a.activityId) throw new ValidationError('Choose a published activity');
          const row = await db.simulationScenario.findFirst({
            where: { id: a.activityId, status: 'published', learningScope: 'workspace' },
          });
          const parsed = learningActivitySchema.safeParse(row?.experience);
          if (
            !parsed.success ||
            (a.targetId && !parsed.data.targets.some((t) => t.id === a.targetId))
          )
            throw new ValidationError('Choose a reviewed activity and known target');
          s.focus = { activityId: a.activityId, targetId: a.targetId ?? null };
        } else if (a.kind === 'annotate') {
          if (!a.text) throw new ValidationError('Write an annotation');
          if (s.annotations.length >= 50)
            throw new ValidationError('This session has reached 50 annotations');
          s.annotations.push({
            id: randomUUID(),
            text: a.text,
            targetId: a.targetId ?? null,
            author: p.fullName,
          });
        } else if (a.kind === 'question') {
          if (!a.text) throw new ValidationError('Write your question');
          if (s.questions.length >= 100) throw new ValidationError('Question queue is full');
          s.questions.push({
            id: randomUUID(),
            text: a.text,
            authorId: p.userId,
            author: p.fullName,
            resolved: false,
          });
        } else if (a.kind === 'resolve') {
          const q = s.questions.find((q) => q.id === a.questionId);
          if (!q) throw new NotFoundError('Question');
          q.resolved = true;
        } else if (a.kind === 'poll') {
          if (!a.text || !a.options)
            throw new ValidationError('Write a question and at least two options');
          s.poll = {
            id: randomUUID(),
            question: a.text,
            options: a.options,
            votes: {},
            closed: false,
          };
        } else if (a.kind === 'vote') {
          if (
            !s.poll ||
            s.poll.closed ||
            a.option === undefined ||
            a.option >= s.poll.options.length
          )
            throw new ConflictError('Choose an option in the active poll');
          s.poll.votes[p.userId] = a.option;
        } else if (a.kind === 'close_poll') {
          if (!s.poll) throw new NotFoundError('Poll');
          s.poll.closed = true;
        } else if (a.kind === 'recap') {
          if (!a.text) throw new ValidationError('Write and review the session recap');
          s.recap = {
            text: a.text,
            reviewed: a.reviewed === true,
            activityId: s.focus?.activityId ?? null,
          };
        }
        s.revision++;
        s.events = [...s.events.slice(-99), a.eventKey];
        const checked = stateSchema.parse(s);
        await db.spatialRoom.update({
          where: { id },
          data: { learningState: checked as Prisma.InputJsonValue },
        });
        return { session: projection(checked, p.userId, teacher), duplicate: false };
      });
      notifySpatialRoom(p.tenantId, id, { kind: 'world' });
      return reply.code(result.duplicate ? 200 : 201).send(result);
    },
  );
}
