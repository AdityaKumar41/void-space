#!/usr/bin/env node
/**
 * Writes a small, genuinely valid GLB cube.
 *
 * Why this exists: the platform's contract is "upload a 3D model and see it in the browser",
 * and a hand-written fixture with declared accessors but an empty binary chunk is *not* a
 * model — three.js refuses it (`Invalid typed array length`). This script emits a cube with
 * real positions, per-face normals and indices, so the preview path can be demonstrated and
 * tested against something that actually renders.
 *
 * Usage: node scripts/make-demo-glb.mjs [outputPath]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve(process.argv[2] ?? '/tmp/demo-cube.glb');

/** Unit cube: 4 vertices per face so each face gets a correct flat normal. */
const faces = [
  { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { normal: [1, 0, 0], corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { normal: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { normal: [0, 1, 0], corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { normal: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
];

const positions = [];
const normals = [];
const indices = [];

faces.forEach((face, faceIndex) => {
  for (const corner of face.corners) {
    positions.push(...corner.map((value) => value * 0.5));
    normals.push(...face.normal);
  }
  // Two triangles per quad, wound counter-clockwise when viewed from outside.
  const base = faceIndex * 4;
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
});

const positionBuffer = Buffer.from(new Float32Array(positions).buffer);
const normalBuffer = Buffer.from(new Float32Array(normals).buffer);
const indexBuffer = Buffer.from(new Uint16Array(indices).buffer);

// glTF requires 4-byte alignment between buffer views.
const pad = (buffer) => (buffer.length % 4 === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(4 - (buffer.length % 4))]));
const positionPadded = pad(positionBuffer);
const normalPadded = pad(normalBuffer);
const indexPadded = pad(indexBuffer);

const binary = Buffer.concat([positionPadded, normalPadded, indexPadded]);

const gltf = {
  asset: { version: '2.0', generator: 'void-space/make-demo-glb' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'DemoCube' }],
  meshes: [
    {
      name: 'DemoCube',
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
    },
  ],
  materials: [
    {
      name: 'HazardYellow',
      pbrMetallicRoughness: {
        baseColorFactor: [0.9, 0.55, 0.12, 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.7,
      },
    },
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: positions.length / 3,
      type: 'VEC3',
      // min/max are mandatory for POSITION: their absence is a GLTFLoader warning.
      min: [-0.5, -0.5, -0.5],
      max: [0.5, 0.5, 0.5],
    },
    { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: positionBuffer.length, target: 34962 },
    { buffer: 0, byteOffset: positionPadded.length, byteLength: normalBuffer.length, target: 34962 },
    {
      buffer: 0,
      byteOffset: positionPadded.length + normalPadded.length,
      byteLength: indexBuffer.length,
      target: 34963,
    },
  ],
  buffers: [{ byteLength: binary.length }],
};

let json = Buffer.from(JSON.stringify(gltf), 'utf8');
if (json.length % 4 !== 0) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);

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

writeFileSync(output, Buffer.concat([header, body]));
console.log(`wrote ${output} (${12 + body.length} bytes, ${indices.length / 3} triangles)`);
