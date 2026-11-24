import { randomUUID } from 'node:crypto';
import { withTenant, recordAudit } from '@void-space/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConflictError } from '../../lib/errors';
export async function learningWorkspaceRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };
  app.get('/learning/workspace/profile', auth, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const p = request.principal!;
    const workspace = await withTenant(p.tenantId, (db) =>
      db.tenant.findUniqueOrThrow({
        where: { id: p.tenantId },
        select: { id: true, name: true, kind: true },
      }),
    );
    const persona =
      workspace.kind === 'personal'
        ? 'individual'
        : p.permissions.includes('learning:manage')
          ? 'teacher'
          : 'student';
    return { workspace, persona };
  });
  app.get('/learning/workspace', auth, async (request) => {
    const p = request.principal!;
    return withTenant(p.tenantId, async (db) => ({
      workspace: await db.tenant.findUniqueOrThrow({
        where: { id: p.tenantId },
        select: { id: true, name: true, kind: true },
      }),
      lessons: await db.lessonPlanRelease
        .findMany({
          where: { visibility: 'institution', reviewed: true },
          select: { id: true, tenantId: true, definition: true },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            tenantId: r.tenantId,
            title: (r.definition as { title: string }).title,
            summary: (r.definition as { summary: string }).summary,
          })),
        ),
    }));
  });
  app.post('/learning/workspace/institution', auth, async (request, reply) => {
    const p = request.principal!,
      { name } = z
        .object({ name: z.string().trim().min(2).max(120) })
        .strict()
        .parse(request.body),
      id = randomUUID();
    const source = await withTenant(p.tenantId, (db) =>
      db.user.findUniqueOrThrow({ where: { id: p.userId } }),
    );
    const slug = `${
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 35) || 'institution'
    }-${id.slice(0, 8)}`;
    await withTenant(id, async (db) => {
      await db.tenant.create({ data: { id, name, slug, kind: 'organization' } });
      await db.tenantSettings.create({
        data: {
          tenantId: id,
          defaultPolycountBudget: 50000,
          requiredMetadataFields: [],
          allowedCategories: [],
        },
      });
      const user = await db.user.create({
        data: {
          tenantId: id,
          email: source.email,
          fullName: source.fullName,
          passwordHash: source.passwordHash,
          googleId: source.googleId,
          status: 'active',
        },
      });
      const role = await db.role.findUniqueOrThrow({ where: { name: 'TenantAdmin' } });
      await db.userRole.create({ data: { tenantId: id, userId: user.id, roleId: role.id } });
      await recordAudit(
        {
          action: 'tenant.institution_created',
          entityType: 'tenant',
          entityId: id,
          actorId: user.id,
          actorLabel: source.fullName,
          afterState: { name, kind: 'organization' },
        },
        db,
      );
    });
    return reply.code(201).send({ workspace: { id, name } });
  });
}
