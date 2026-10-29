import { recordAudit, withTenant } from '@void-space/db';
import { venturePlanSchema } from '@void-space/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors';
import { parseBody } from '../../lib/http';
const params = z.object({ id: z.string().uuid() });
export async function ventureRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ventures', { preHandler: app.authenticate }, async (request) => {
    const p = request.principal!;
    return withTenant(p.tenantId, async (db) => ({
      plans: await db.venturePlan.findMany({
        where: { tenantId: p.tenantId },
        orderBy: { updatedAt: 'desc' },
      }),
    }));
  });
  app.post('/ventures', { preHandler: app.authenticate }, async (request, reply) => {
    const p = request.principal!;
    const input = parseBody(venturePlanSchema, request.body);
    const plan = await withTenant(p.tenantId, async (db) => {
      const created = await db.venturePlan.create({
        data: { ...input, tenantId: p.tenantId, createdById: p.userId },
      });
      await recordAudit(
        {
          action: 'venture.plan_created',
          entityType: 'venture_plan',
          entityId: created.id,
          actorId: p.userId,
          actorLabel: p.fullName,
        },
        db,
      );
      return created;
    });
    return reply.status(201).send({ plan });
  });
  app.put('/ventures/:id', { preHandler: app.authenticate }, async (request) => {
    const p = request.principal!;
    const { id } = params.parse(request.params);
    const input = parseBody(venturePlanSchema, request.body);
    return withTenant(p.tenantId, async (db) => {
      const found = await db.venturePlan.findFirst({
        where: { id, tenantId: p.tenantId, createdById: p.userId },
      });
      if (!found) throw new NotFoundError('Venture plan not found');
      const plan = await db.venturePlan.update({ where: { id }, data: input });
      await recordAudit(
        {
          action: 'venture.plan_updated',
          entityType: 'venture_plan',
          entityId: id,
          actorId: p.userId,
          actorLabel: p.fullName,
        },
        db,
      );
      return { plan };
    });
  });
}
