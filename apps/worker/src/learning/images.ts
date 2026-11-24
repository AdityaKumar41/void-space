import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { withTenant, learningStorageRoot } from '@void-space/db';
import { learningToolProgress } from './progress';

export async function fluxImage(
  prompt: string,
  config: { url: string; model: string; key?: string },
  fetchImpl: typeof fetch = fetch,
) {
  const url = new URL(config.url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error('Invalid image provider configuration');
  const response = await fetchImpl(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(120000),
    headers: {
      'content-type': 'application/json',
      ...(config.key ? { authorization: `Bearer ${config.key}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      prompt,
      width: 768,
      height: 768,
      size: '768x768',
      n: 1,
    }),
  });
  if (!response.ok)
    throw Error(
      'The image service could not generate an illustration. Check that Flux is installed and accessible on the configured server, then try again.',
    );
  const reader = response.body?.getReader();
  if (!reader) throw Error('The image service returned no image.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 16 * 1024 * 1024) throw Error('Generated image exceeds the 16 MB limit.');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  let bytes = Buffer.concat(chunks);
  if (!response.headers.get('content-type')?.startsWith('image/')) {
    let body: any;
    try {
      body = JSON.parse(bytes.toString());
    } catch {
      throw Error('The image service returned an unsupported response.');
    }
    if (body.error)
      throw Error(
        'The image service could not load Flux. Ask the server administrator to check model access.',
      );
    const image = body.data?.[0]?.b64_json ?? body.images?.[0] ?? body.image ?? body.image_base64;
    if (typeof image !== 'string' || /^https?:/i.test(image))
      throw Error('The image service must return image bytes or base64 data, not a remote URL.');
    const encoded = image.replace(/^data:image\/(png|jpeg|webp);base64,/, '');
    if (!/^[a-zA-Z0-9+/=\s]+$/.test(encoded))
      throw Error('The image service returned invalid image data.');
    bytes = Buffer.from(encoded, 'base64');
  }
  const raster =
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (bytes[0] === 255 && bytes[1] === 216) ||
    (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP');
  if (!raster) throw Error('The image service did not return a readable image.');
  try {
    return await sharp(bytes, { limitInputPixels: 16_000_000 })
      .rotate()
      .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw Error('The image service did not return a readable image.');
  }
}
export async function generateLearningImage(
  tenantId: string,
  taskId: string,
  ownerId: string,
  input: { prompt: string; title?: string },
  stagingDir = process.env.STAGING_DIR ?? '.staging',
) {
  if (!process.env.AI_IMAGE_BASE_URL)
    throw Error('Image generation is not configured. Upload an approved image instead.');
  await learningToolProgress(tenantId, taskId, 'image', 'Creating an illustration', 'working');
  const bytes = await fluxImage(input.prompt, {
    url: process.env.AI_IMAGE_BASE_URL,
    model: process.env.AI_IMAGE_MODEL ?? 'flux',
    key: process.env.AI_IMAGE_API_KEY,
  });
  const id = randomUUID(),
    directory = join(learningStorageRoot(stagingDir), tenantId),
    path = join(directory, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
  try {
    await withTenant(tenantId, (db) =>
      db.learningSource.create({
        data: {
          id,
          tenantId,
          ownerId,
          title: (input.title ?? input.prompt).slice(0, 200),
          mime: 'image/png',
          status: 'ready',
          storagePath: path,
          passages: [],
          metadata: {
            generated: true,
            model: process.env.AI_IMAGE_MODEL ?? 'flux',
            reviewed: false,
          },
        },
      }),
    );
  } catch (e) {
    await rm(path, { force: true });
    throw e;
  }
  await learningToolProgress(
    tenantId,
    taskId,
    'image',
    'Creating an illustration',
    'complete',
    'Saved privately. Review before using it to teach.',
  );
  return { sourceId: id, image: true, reviewed: false };
}
