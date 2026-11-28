import { prisma, withTenant } from '@void-space/db';
import { assetObjectKey, assetStore } from '@void-space/storage';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { NotFoundError } from '../../lib/errors';

/** One authorized gateway for S3-backed assets. Private learning files use their own owner-scoped routes. */
export async function contentRoutes(app: FastifyInstance) {
  app.get('/content/:address', async (request, reply) => {
    const { address } = request.params as { address: string };
    await authorizeAssetContent(request, address, app.optionalAuth);
    return sendAssetContent(request, reply, address);
  });
  app.get('/content/:address/access', async (request, reply) => {
    await authorizeAssetContent(
      request,
      (request.params as { address: string }).address,
      app.optionalAuth,
    );
    return reply.header('Cache-Control', 'private, no-store').send({ available: true });
  });
}

/** Caller has already authorized this immutable reference through an asset or lesson release. */
export async function sendAssetContent(
  request: FastifyRequest,
  reply: FastifyReply,
  address: string,
) {
  const range = request.headers.range;
  if (range && !/^bytes=\d+-\d*$/.test(range)) return reply.code(416).send();
  try {
    const object = await assetStore().get(assetObjectKey(address), range);
    reply
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', object.sizeBytes)
      .type(object.mime);
    if (object.contentRange) reply.code(206).header('Content-Range', object.contentRange);
    return reply.send(object.body);
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) throw new NotFoundError('Content');
    if (status === 416) return reply.code(416).send();
    throw error;
  }
}

async function authorizeAssetContent(
  request: FastifyRequest,
  address: string,
  authenticate: (request: FastifyRequest) => Promise<void>,
) {
  if (!/^[a-zA-Z0-9]{32,120}$/.test(address)) throw new NotFoundError('Content');
  const publicEntry = await prisma.publicCatalogEntry.findFirst({
    where: { OR: [{ ipfsCid: address }, { licenseMetadataCid: address }] },
    select: { assetId: true },
  });
  if (publicEntry) return;
  await authenticate(request);
  let allowed = false;
  const p = request.principal;
  if (!allowed && p?.permissions.includes('catalog:view')) {
    allowed = await withTenant(p.tenantId, async (db) => {
      const allWorkspaceAssets =
        !p.readOnly &&
        (p.permissions.includes('review:decide') || p.permissions.includes('asset:upload-own'));
      const visibleAsset = p.readOnly
        ? { status: 'published' as const }
        : allWorkspaceAssets
          ? {}
          : { OR: [{ status: 'published' as const }, { creatorId: p.userId }] };
      const version = await db.assetVersion.findFirst({
        where: { ipfsCid: address, asset: visibleAsset },
        select: { id: true },
      });
      if (version) return true;
      return !!(await db.license.findFirst({
        where: { ipfsMetadataCid: address, asset: visibleAsset },
        select: { id: true },
      }));
    });
  }
  if (!allowed) throw new NotFoundError('Content');
}
