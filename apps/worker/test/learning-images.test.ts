import { it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { fluxImage } from '../src/learning/images';
const config = { url: 'https://images.example/api/image/generate', model: 'flux' };
it('accepts private base64 image data and validates pixels', async () => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffcc22' } })
    .png()
    .toBuffer();
  const f = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ images: [`data:image/png;base64,${bytes.toString('base64')}`] }),
    );
  const output = await fluxImage('A sphere beside a cube', config, f);
  expect((await sharp(output).metadata()).format).toBe('png');
  expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toMatchObject({
    model: 'flux',
    prompt: 'A sphere beside a cube',
  });
});
it('reports missing Flux and refuses arbitrary remote image URLs', async () => {
  await expect(
    fluxImage(
      'A blue sphere',
      config,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ error: 'secret-provider-details' }, { status: 500 })),
    ),
  ).rejects.toThrow('Check that Flux is installed');
  await expect(
    fluxImage(
      'A blue sphere',
      config,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ image: 'http://169.254.169.254/private' })),
    ),
  ).rejects.toThrow('not a remote URL');
});
it('rejects non-image response content', async () => {
  await expect(
    fluxImage(
      'A blue sphere',
      config,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ images: ['aGVsbG8='] })),
    ),
  ).rejects.toThrow('readable image');
});
it('rejects executable vector image formats instead of rasterizing provider SVG', async () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>',
  );
  await expect(
    fluxImage(
      'A blue sphere',
      config,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(svg, { headers: { 'content-type': 'image/svg+xml' } })),
    ),
  ).rejects.toThrow('readable image');
});
