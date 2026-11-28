/** Reviewed asset choices for the retained digital-twin model picker. */

import { withTenant } from '@void-space/db';
import type { FastifyInstance } from 'fastify';

export async function learningAssetPickerRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/lessons/assets',
    { preHandler: app.requirePermission('learning:manage') },
    async (request) => {
      const assets = await withTenant(request.principal!.tenantId, (db) =>
        db.asset.findMany({
          where: {
            tenantId: request.principal!.tenantId,
            status: { in: ['approved', 'published'] },
            currentVersionId: { not: null },
          },
          select: {
            id: true,
            name: true,
            category: true,
            currentVersion: { select: { id: true, ipfsCid: true, format: true, polycount: true } },
          },
          orderBy: { name: 'asc' },
          take: 200,
        }),
      );
      return {
        assets: assets.map((asset) => ({
          id: asset.id,
          name: asset.name,
          category: asset.category,
          media: asset.currentVersion
            ? {
                versionId: asset.currentVersion.id,
                cid: asset.currentVersion.ipfsCid,
                format: asset.currentVersion.format,
                polycount: asset.currentVersion.polycount,
              }
            : null,
        })),
      };
    },
  );
}
