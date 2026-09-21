/**
 * GLB fixture builder for tests.
 *
 * Produces a genuinely valid GLB — 12-byte header, JSON chunk, BIN chunk — so the ingest
 * parser is exercised against the real container format rather than a stub. The geometry
 * accessors are chosen so a test can assert exact triangle counts:
 *
 *   mesh 0: 6000 indices → 2000 triangles
 *   mesh 1: 1500 indices →  500 triangles
 *   total                 → 2500 triangles
 */
import { randomUUID } from 'node:crypto';

export const FIXTURE_TRIANGLES = 2500;

export function makeGlb(sizeMultiplier = 1): Buffer {
  const accessors = [
    { bufferView: 0, componentType: 5126, count: 1200 * sizeMultiplier, type: 'VEC3' },
    { bufferView: 0, componentType: 5125, count: 6000 * sizeMultiplier, type: 'SCALAR' },
    { bufferView: 0, componentType: 5126, count: 300 * sizeMultiplier, type: 'VEC3' },
    { bufferView: 0, componentType: 5125, count: 1500 * sizeMultiplier, type: 'SCALAR' },
  ];

  const gltf = {
    asset: { version: '2.0', generator: 'void-space-test-fixture' },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }, { mesh: 1 }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] },
      { primitives: [{ attributes: { POSITION: 2 }, indices: 3, material: 1 }] },
    ],
    accessors,
    materials: [{ name: 'painted-steel' }, { name: 'rubber' }],
    animations: [{ name: 'idle', channels: [], samplers: [] }],
    textures: [{ source: 0 }],
    images: [{ name: 'albedo', mimeType: 'image/png' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 16 }],
    buffers: [{ byteLength: 16 }],
  };

  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  // The JSON chunk must be padded to a 4-byte boundary with spaces.
  const padding = (4 - (json.length % 4)) % 4;
  if (padding > 0) json = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);

  const binary = Buffer.alloc(16);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  const body = Buffer.concat([jsonHeader, json, binHeader, binary]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);

  return Buffer.concat([header, body]);
}

/** A non-GLB payload that still claims the .glb extension. */
export function makeFakeGlb(): Buffer {
  return Buffer.from(`not really a glb ${randomUUID()}`, 'utf8');
}
