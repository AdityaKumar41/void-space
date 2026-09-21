/**
 * GLB mesh-metadata extraction (SRS §6.3, FR-3.2).
 *
 * The parser reads only the container header and the JSON chunk, so these tests cover the
 * cases that matter for ingest robustness: a valid GLB, a mislabelled file, a truncated
 * file, and a file that is not a GLB at all.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { exceedsPolycountBudget, metadataFromGltfJson, readGlbMetadata } from '../src/lib/gltf';
import { FIXTURE_TRIANGLES, makeFakeGlb, makeGlb } from './fixtures/glb';

async function writeTemp(name: string, content: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'void-space-glb-'));
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

describe('readGlbMetadata', () => {
  it('extracts triangle, material, animation and texture counts', async () => {
    const path = await writeTemp('fixture.glb', makeGlb());
    const metadata = await readGlbMetadata(path);

    expect(metadata).not.toBeNull();
    expect(metadata?.polycount).toBe(FIXTURE_TRIANGLES);
    expect(metadata?.vertices).toBe(1500); // 1200 + 300 POSITION entries
    expect(metadata?.materials).toBe(2);
    expect(metadata?.animations).toBe(1);
    expect(metadata?.textures).toBe(1);
  });

  it('scales with the fixture size multiplier', async () => {
    const path = await writeTemp('double.glb', makeGlb(2));
    const metadata = await readGlbMetadata(path);
    expect(metadata?.polycount).toBe(FIXTURE_TRIANGLES * 2);
  });

  it('returns null for a file that is not a GLB', async () => {
    const path = await writeTemp('fake.glb', makeFakeGlb());
    expect(await readGlbMetadata(path)).toBeNull();
  });

  it('returns null for a truncated GLB header', async () => {
    const path = await writeTemp('short.glb', makeGlb().subarray(0, 8));
    expect(await readGlbMetadata(path)).toBeNull();
  });

  it('returns null for a missing file instead of throwing', async () => {
    expect(await readGlbMetadata('/tmp/void-space-does-not-exist.glb')).toBeNull();
  });
});

describe('metadataFromGltfJson', () => {
  it('ignores non-triangle primitive modes', () => {
    const metadata = metadataFromGltfJson({
      accessors: [
        { count: 12, type: 'VEC3' },
        { count: 99, type: 'SCALAR' },
      ],
      // mode 1 is LINES: no polygon count should be attributed to it.
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 1 }] }],
    });

    expect(metadata.polycount).toBeNull();
    expect(metadata.vertices).toBe(12);
  });

  it('handles an asset with no geometry at all', () => {
    const metadata = metadataFromGltfJson({ asset: {} } as never);
    expect(metadata.polycount).toBeNull();
    expect(metadata.materials).toBeNull();
  });
});

describe('polycount budget (FR-3.2)', () => {
  it('flags only assets that genuinely exceed the budget', () => {
    const over = { polycount: 80_000 } as never;
    const under = { polycount: 10_000 } as never;

    expect(exceedsPolycountBudget(over, 50_000)).toBe(true);
    expect(exceedsPolycountBudget(under, 50_000)).toBe(false);
    // No budget configured, or unknown geometry: nothing to flag.
    expect(exceedsPolycountBudget(over, null)).toBe(false);
    expect(exceedsPolycountBudget(null, 50_000)).toBe(false);
  });
});
