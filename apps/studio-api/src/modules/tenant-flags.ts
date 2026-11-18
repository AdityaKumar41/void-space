/**
 * FR-18.1 — Studio AI feature flags (TenantAdmin).
 * Mirrors VOID·SPACE admin toggles into studio-db so copilot/generative gates stay in sync.
 */
import { withStudioTenant } from '@void-space/studio-db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ForbiddenError } from '../lib/errors';
import { parseBody } from '../lib/http';
import { resolveSession } from '../lib/session';

const flagsSchema = z.object({
  copilot: z.boolean().optional(),
  readinessAudit: z.boolean().optional(),
  generativeMesh: z.boolean().optional(),
  generativeTexture: z.boolean().optional(),
  enforcePublishAudit: z.boolean().optional(),
});

export async function tenantFlagRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tenant/ai-flags', async (request, reply) => {
    const me = await resolveSession(app, request);
    const row = await withStudioTenant(me.tenantId, (db) =>
      db.tenant.findUnique({
        where: { id: me.tenantId },
        select: { aiFeatureFlags: true },
      }),
    );
    return reply.status(200).send({ flags: row?.aiFeatureFlags ?? {} });
  });

  app.patch('/tenant/ai-flags', async (request, reply) => {
    const me = await resolveSession(app, request);
    if (!me.roles.includes('TenantAdmin') && !me.roles.includes('SuperAdmin')) {
      throw new ForbiddenError(
        'Only TenantAdmin can change AI feature flags',
        'INSUFFICIENT_PERMISSION',
      );
    }

    const input = parseBody(flagsSchema, request.body);
    const flags = await withStudioTenant(me.tenantId, async (db) => {
      const before = await db.tenant.findUnique({
        where: { id: me.tenantId },
        select: { aiFeatureFlags: true },
      });
      const prev =
        before?.aiFeatureFlags && typeof before.aiFeatureFlags === 'object'
          ? (before.aiFeatureFlags as Record<string, unknown>)
          : {};
      const merged = { ...prev, ...input };
      await db.tenant.upsert({
        where: { id: me.tenantId },
        create: {
          id: me.tenantId,
          name: 'Workspace',
          storageQuotaBytes: BigInt(5 * 1024 * 1024 * 1024),
          aiFeatureFlags: merged,
        },
        update: { aiFeatureFlags: merged },
      });
      return merged;
    });

    return reply.status(200).send({ flags });
  });
}
