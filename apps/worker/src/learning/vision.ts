import { modelAllowsAi } from '@void-space/types';
import { readLearningFile } from '@void-space/db';
import sharp from 'sharp';

import { withTenant, isLearningStoragePath } from '@void-space/db';
import type { TextAiConfig } from '@void-space/ai/text';
import { z } from 'zod/v3';
const view = z.object({
  name: z.string(),
  image: z.string(),
  anchors: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      meshKey: z.string(),
      position: z.tuple([z.number(), z.number(), z.number()]),
    }),
  ),
});
export async function annotationVision(
  tenantId: string,
  ownerId: string,
  modelId: string,
  sourceIds: string[] = [],
  prepared?: { id: string; planId: string; revision: number },
) {
  if (!prepared && !modelId) return null;
  if (modelId) {
    const model = await withTenant(tenantId, (db) =>
      db.learningSource.findFirst({
        where: { id: modelId, ownerId, mime: 'model/gltf-binary' },
        select: { metadata: true },
      }),
    );
    if (model && !modelAllowsAi(model.metadata))
      throw new Error(
        'This Sketchfab model does not permit AI processing. Manual annotation remains available.',
      );
  }
  if (!process.env.AI_VISION_BASE_URL || !process.env.AI_VISION_MODEL) return null;
  const config: TextAiConfig = {
    AI_TEXT_BASE_URL: process.env.AI_VISION_BASE_URL,
    AI_TEXT_MODEL: process.env.AI_VISION_MODEL,
    AI_TEXT_PROTOCOL: 'openai',
    AI_TEXT_API_KEY: process.env.AI_VISION_API_KEY,
    AI_TEXT_TIMEOUT_MS: 120000,
    OPENROUTER_DISABLE_REASONING: true,
    OPENROUTER_FREE_ONLY: process.env.OPENROUTER_FREE_ONLY !== 'false',
  };
  if (
    new URL(config.AI_TEXT_BASE_URL!).hostname === 'openrouter.ai' &&
    process.env.OPENROUTER_FREE_ONLY !== 'false' &&
    !config.AI_TEXT_MODEL!.endsWith(':free') &&
    config.AI_TEXT_MODEL !== 'openrouter/free'
  )
    throw new Error('Vision must use a free OpenRouter model.');
  const source = await withTenant(tenantId, async (db) => {
    if (prepared) {
      const source = await db.learningSource.findFirst({
        where: { id: prepared.id, ownerId, mime: 'application/x-void-model-views' },
      });
      const meta = source?.metadata as { planId?: string; revision?: number } | null;
      if (meta?.planId !== prepared.planId || meta.revision !== prepared.revision)
        throw new Error('Model views do not belong to this lesson revision.');
      return source;
    }
    const model = await db.learningSource.findFirst({
      where: { id: modelId, ownerId, mime: 'model/gltf-binary' },
    });
    const id = (model?.metadata as { viewsSourceId?: string } | null)?.viewsSourceId;
    return id
      ? db.learningSource.findFirst({
          where: { id, ownerId, mime: 'application/x-void-model-views' },
        })
      : null;
  });
  if (
    !source?.storagePath ||
    !isLearningStoragePath(source.storagePath, process.env.STAGING_DIR ?? '.staging')
  )
    return null;
  const bytes = await readLearningFile(source.storagePath);
  if (bytes.length > 5 * 1024 * 1024) throw new Error('Model views exceed safe input limits.');
  const views = z.object({ views: z.array(view).max(6) }).parse(JSON.parse(bytes.toString())).views;
  const references: { title: string; sourceId: string; image: string }[] = [];
  const images = await withTenant(tenantId, (db) =>
    db.learningSource.findMany({
      where: {
        id: { in: sourceIds },
        ownerId,
        status: 'ready',
        mime: { in: ['image/png', 'image/jpeg', 'image/webp'] },
      },
      take: 2,
    }),
  );
  for (const source of images) {
    const metadata = source.metadata as { generated?: boolean; reviewed?: boolean } | null;
    if (metadata?.generated && !metadata.reviewed) continue;
    if (
      !source.storagePath ||
      !isLearningStoragePath(source.storagePath, process.env.STAGING_DIR ?? '.staging')
    )
      continue;
    const bytes = await readLearningFile(source.storagePath);
    if (bytes.length > 10 * 1024 * 1024) continue;
    const image = await sharp(bytes, { limitInputPixels: 25000000 })
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();
    references.push({
      title: source.title,
      sourceId: source.id,
      image: `data:image/jpeg;base64,${image.toString('base64')}`,
    });
  }
  return { config, views, references };
}
export function anchoredVisionPin(
  views: z.infer<typeof view>[],
  viewIndex: number,
  pixel: [number, number],
) {
  const anchors = views[viewIndex]?.anchors ?? [];
  const nearest = [...anchors].sort(
    (a, b) =>
      (a.x - pixel[0]) ** 2 +
      (a.y - pixel[1]) ** 2 -
      ((b.x - pixel[0]) ** 2 + (b.y - pixel[1]) ** 2),
  )[0];
  if (!nearest || Math.hypot(nearest.x - pixel[0], nearest.y - pixel[1]) > 0.1) return null;
  return { meshKey: nearest.meshKey, position: nearest.position };
}
