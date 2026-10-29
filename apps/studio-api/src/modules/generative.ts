/**
 * Image-to-3D, text-to-3D and text-to-texture (VS2-SRS-1.0 §7.4).
 *
 * The editor proposes nothing to Meshy itself. A configured `MESHY_API_KEY` makes
 * these routes submit and poll a task, then download the GLB from Meshy's own
 * host. With no key the routes answer 503 and the editor builds a local relief
 * mesh or procedural PBR maps instead of pretending a provider ran.
 */
import { FetchTransport, MeshyClient, type HttpTransport, type MeshyTaskKind } from '@void-space/studio-ai';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { UnavailableError, UpstreamError } from '../lib/errors';
import { parseBody, parseParams, parseQuery } from '../lib/http';
import { resolveSession } from '../lib/session';
import { meshyAssetUrlAllowed } from './meshy-assets';

const kindSchema = z.enum(['text-to-3d', 'image-to-3d', 'text-to-texture']);

const createSchema = z.object({
  kind: kindSchema,
  prompt: z.string().min(3).max(2_000).optional(),
  imageUrl: z.string().min(1).max(8_000_000).optional(),
  modelUrl: z.string().url().max(2_000).optional(),
  resolution: z.union([z.literal(512), z.literal(1_024), z.literal(2_048), z.literal(4_096)]).optional(),
  targetPolycount: z.number().int().min(100).max(500_000).optional(),
});

const taskParamsSchema = z.object({
  taskId: z.string().min(1).max(128),
});

const taskQuerySchema = z.object({
  kind: kindSchema,
});

export interface GenerativeRoutesOptions {
  readonly apiKey?: string;
  readonly transport?: HttpTransport;
}

async function providerError(error: unknown): Promise<never> {
  if (error instanceof Error) throw new UpstreamError(error.message);
  throw new UpstreamError('Meshy did not accept the request.');
}

export async function generativeRoutes(
  app: FastifyInstance,
  options: GenerativeRoutesOptions,
): Promise<void> {
  const session = (request: FastifyRequest) => resolveSession(app, request);
  const client = options.apiKey
    ? new MeshyClient({
        apiKey: options.apiKey,
        transport: options.transport ?? new FetchTransport(),
      })
    : null;

  app.get('/generative/status', async (request: FastifyRequest) => {
    await session(request);
    return {
      configured: client !== null,
      provider: client ? 'meshy' : null,
    };
  });

  app.post('/generative/tasks', async (request: FastifyRequest) => {
    const me = await session(request);
    if (!client) {
      throw new UnavailableError(
        'Meshy is not configured. Set MESHY_API_KEY to enable image-to-3D and text-to-texture. The editor can still build a local relief mesh and procedural PBR maps.',
        'MESHY_NOT_CONFIGURED',
      );
    }
    const body = parseBody(createSchema, request.body);
    try {
      const taskId =
        body.kind === 'text-to-texture'
          ? await client.createTextureTask({
              tenantId: me.tenantId,
              userId: me.userId,
              prompt: body.prompt ?? '',
              modelUrl: body.modelUrl ?? '',
              ...(body.resolution === undefined ? {} : { resolution: body.resolution }),
            })
          : await client.createMeshTask({
              tenantId: me.tenantId,
              userId: me.userId,
              kind: body.kind,
              ...(body.prompt === undefined ? {} : { prompt: body.prompt }),
              ...(body.imageUrl === undefined ? {} : { imageUrl: body.imageUrl }),
              ...(body.targetPolycount === undefined ? {} : { targetPolycount: body.targetPolycount }),
            });
      return { provider: 'meshy', taskId, kind: body.kind };
    } catch (error) {
      await providerError(error);
    }
  });

  app.get('/generative/tasks/:taskId', async (request: FastifyRequest) => {
    await session(request);
    if (!client) {
      throw new UnavailableError('Meshy is not configured.', 'MESHY_NOT_CONFIGURED');
    }
    const { taskId } = parseParams(taskParamsSchema, request.params);
    const { kind } = parseQuery(taskQuerySchema, request.query);
    try {
      const task = await client.getTask(kind as MeshyTaskKind, taskId);
      return {
        id: task.id,
        kind: task.kind,
        status: task.status,
        progress: task.progress,
        error: task.error,
        hasModel: typeof task.resultUrls.glb === 'string' || typeof task.resultUrls.obj === 'string',
      };
    } catch (error) {
      await providerError(error);
    }
  });

  app.get('/generative/tasks/:taskId/model', async (request: FastifyRequest, reply) => {
    await session(request);
    if (!client) {
      throw new UnavailableError('Meshy is not configured.', 'MESHY_NOT_CONFIGURED');
    }
    const { taskId } = parseParams(taskParamsSchema, request.params);
    const { kind } = parseQuery(taskQuerySchema, request.query);
    const task = await client.getTask(kind as MeshyTaskKind, taskId);
    const raw = task.resultUrls.glb ?? task.resultUrls.obj;
    const target = typeof raw === 'string' ? meshyAssetUrlAllowed(raw) : null;
    if (!target) {
      throw new UnavailableError('Meshy did not return a downloadable mesh on an allowed host.', 'MESHY_NO_MODEL');
    }
    const response = await fetch(target, { redirect: 'manual' });
    if (response.status < 200 || response.status >= 300) {
      throw new UpstreamError(`Meshy asset download returned HTTP ${response.status}.`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return reply.header('content-type', 'model/gltf-binary').send(bytes);
  });
}
