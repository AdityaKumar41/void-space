/**
 * VOID·STUDIO Asynchronous Jobs API (VS2-SRS-1.0 §3.1, §5.1, FR-6.5).
 *
 * Provides status polling for background BullMQ jobs (publish, generative, csg, export, autosave).
 */
import { withStudioTenant } from '@void-space/studio-db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { NotFoundError } from '../lib/errors';
import { parseParams, parseQuery } from '../lib/http';
import { resolveSession } from '../lib/session';

const jobParamsSchema = z.object({
  jobId: z.string().uuid(),
});

const listJobsQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  queue: z.enum(['copilot', 'generative', 'csg', 'export', 'autosave', 'publish']).optional(),
  status: z.enum(['queued', 'active', 'completed', 'failed', 'delayed']).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export async function registerJobRoutes(app: FastifyInstance): Promise<void> {
  const session = (request: FastifyRequest) => resolveSession(app, request);

  /**
   * GET /studio/api/v1/jobs/:jobId
   * Polling endpoint to check status and result of a background job.
   */
  app.get('/jobs/:jobId', async (request: FastifyRequest) => {
    const me = await session(request);
    const { jobId } = parseParams(jobParamsSchema, request.params);

    const job = await withStudioTenant(me.tenantId, (db) =>
      db.job.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          tenantId: true,
          projectId: true,
          userId: true,
          queue: true,
          status: true,
          result: true,
          error: true,
          attempts: true,
          startedAt: true,
          endedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    );

    if (!job) throw new NotFoundError('Job');

    return { job };
  });

  /**
   * GET /studio/api/v1/jobs
   * List recent background jobs for the active tenant or project.
   */
  app.get('/jobs', async (request: FastifyRequest) => {
    const me = await session(request);
    const query = parseQuery(listJobsQuerySchema, request.query);

    const where: Record<string, unknown> = {
      tenantId: me.tenantId,
    };
    if (query.projectId) where.projectId = query.projectId;
    if (query.queue) where.queue = query.queue;
    if (query.status) where.status = query.status;

    const jobs = await withStudioTenant(me.tenantId, (db) =>
      db.job.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        select: {
          id: true,
          projectId: true,
          queue: true,
          status: true,
          result: true,
          error: true,
          attempts: true,
          createdAt: true,
          endedAt: true,
        },
      }),
    );

    return { jobs, total: jobs.length };
  });
}
