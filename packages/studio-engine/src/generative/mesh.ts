/**
 * Unit meshes the editor can import when a generative provider is not configured.
 *
 * Coordinates are glTF Y-up, matching the panel's GLB packer. Every mesh is centred
 * on the origin at unit size; object translation and scale are applied by the command
 * that inserts it, so one builder serves both a Copilot primitive and a relief draft.
 */

export const LOCAL_PRIMITIVE_KINDS = ['cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'] as const;
export type LocalPrimitiveKind = (typeof LOCAL_PRIMITIVE_KINDS)[number];

export interface MeshBuffers {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}

interface MutableMesh {
  positions: number[];
  uvs: number[];
  indices: number[];
}

function emptyMesh(): MutableMesh {
  return { positions: [], uvs: [], indices: [] };
}

function addVertex(mesh: MutableMesh, x: number, y: number, z: number, u: number, v: number): number {
  const index = mesh.positions.length / 3;
  mesh.positions.push(x, y, z);
  mesh.uvs.push(u, v);
  return index;
}

function addTriangle(mesh: MutableMesh, a: number, b: number, c: number): void {
  mesh.indices.push(a, b, c);
}

/** Indexed reads under `noUncheckedIndexedAccess` — mesh builders only index filled slots. */
function num(arr: ArrayLike<number>, i: number): number {
  const value = arr[i];
  return value === undefined ? 0 : value;
}

function finalize(mesh: MutableMesh): MeshBuffers {
  const count = mesh.positions.length / 3;
  const normals = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ia = num(mesh.indices, i) * 3;
    const ib = num(mesh.indices, i + 1) * 3;
    const ic = num(mesh.indices, i + 2) * 3;
    const ax = num(mesh.positions, ia);
    const ay = num(mesh.positions, ia + 1);
    const az = num(mesh.positions, ia + 2);
    const abx = num(mesh.positions, ib) - ax;
    const aby = num(mesh.positions, ib + 1) - ay;
    const abz = num(mesh.positions, ib + 2) - az;
    const acx = num(mesh.positions, ic) - ax;
    const acy = num(mesh.positions, ic + 1) - ay;
    const acz = num(mesh.positions, ic + 2) - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[ia] = num(normals, ia) + nx;
    normals[ia + 1] = num(normals, ia + 1) + ny;
    normals[ia + 2] = num(normals, ia + 2) + nz;
    normals[ib] = num(normals, ib) + nx;
    normals[ib + 1] = num(normals, ib + 1) + ny;
    normals[ib + 2] = num(normals, ib + 2) + nz;
    normals[ic] = num(normals, ic) + nx;
    normals[ic + 1] = num(normals, ic + 1) + ny;
    normals[ic + 2] = num(normals, ic + 2) + nz;
  }
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const len = Math.hypot(num(normals, o), num(normals, o + 1), num(normals, o + 2)) || 1;
    normals[o] = num(normals, o) / len;
    normals[o + 1] = num(normals, o + 1) / len;
    normals[o + 2] = num(normals, o + 2) / len;
  }
  return {
    positions: Float32Array.from(mesh.positions),
    normals,
    uvs: Float32Array.from(mesh.uvs),
    indices: Uint32Array.from(mesh.indices),
  };
}

function buildCube(): MeshBuffers {
  const mesh = emptyMesh();
  const h = 0.5;
  const corners: ReadonlyArray<readonly [number, number, number, number, number]> = [
    [-h, -h, -h, 0, 0],
    [h, -h, -h, 1, 0],
    [h, h, -h, 1, 1],
    [-h, h, -h, 0, 1],
    [-h, -h, h, 0, 0],
    [h, -h, h, 1, 0],
    [h, h, h, 1, 1],
    [-h, h, h, 0, 1],
  ];
  const ids = corners.map(([x, y, z, u, v]) => addVertex(mesh, x, y, z, u, v));
  const quads: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [3, 2, 6, 7],
    [1, 5, 6, 2],
    [0, 3, 7, 4],
  ];
  for (const [a, b, c, d] of quads) {
    addTriangle(mesh, num(ids, a), num(ids, c), num(ids, b));
    addTriangle(mesh, num(ids, a), num(ids, d), num(ids, c));
  }
  return finalize(mesh);
}

function buildSphere(segments = 16, rings = 10): MeshBuffers {
  const mesh = emptyMesh();
  const north = addVertex(mesh, 0, 0.5, 0, 0.5, 1);
  const south = addVertex(mesh, 0, -0.5, 0, 0.5, 0);
  const rows: number[][] = [];
  for (let y = 1; y < rings; y++) {
    const v = y / rings;
    const phi = v * Math.PI;
    const row: number[] = [];
    for (let x = 0; x <= segments; x++) {
      const u = x / segments;
      const theta = u * Math.PI * 2;
      row.push(
        addVertex(
          mesh,
          Math.sin(phi) * Math.cos(theta) * 0.5,
          Math.cos(phi) * 0.5,
          Math.sin(phi) * Math.sin(theta) * 0.5,
          u,
          1 - v,
        ),
      );
    }
    rows.push(row);
  }
  const first = rows[0] ?? [];
  const last = rows[rows.length - 1] ?? [];
  for (let x = 0; x < segments; x++) {
    addTriangle(mesh, north, first[x + 1]!, first[x]!);
    addTriangle(mesh, south, last[x]!, last[x + 1]!);
  }
  for (let y = 0; y < rows.length - 1; y++) {
    for (let x = 0; x < segments; x++) {
      const a = rows[y]![x]!;
      const b = rows[y]![x + 1]!;
      const c = rows[y + 1]![x + 1]!;
      const d = rows[y + 1]![x]!;
      addTriangle(mesh, a, b, d);
      addTriangle(mesh, b, c, d);
    }
  }
  return finalize(mesh);
}

function buildLathe(kind: 'cylinder' | 'cone', segments = 20): MeshBuffers {
  const mesh = emptyMesh();
  const top: number[] = [];
  const bottom: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const theta = u * Math.PI * 2;
    const cx = Math.cos(theta);
    const cz = Math.sin(theta);
    const topR = kind === 'cone' ? 0 : 0.5;
    top.push(addVertex(mesh, cx * topR, 0.5, cz * topR, u, 1));
    bottom.push(addVertex(mesh, cx * 0.5, -0.5, cz * 0.5, u, 0));
  }
  const topCenter = addVertex(mesh, 0, 0.5, 0, 0.5, 0.5);
  const bottomCenter = addVertex(mesh, 0, -0.5, 0, 0.5, 0.5);
  for (let i = 0; i < segments; i++) {
    addTriangle(mesh, num(top, i), num(bottom, i), num(bottom, i + 1));
    addTriangle(mesh, num(top, i), num(bottom, i + 1), num(top, i + 1));
    addTriangle(mesh, topCenter, num(top, i + 1), num(top, i));
    addTriangle(mesh, bottomCenter, num(bottom, i), num(bottom, i + 1));
  }
  return finalize(mesh);
}

function buildPlane(): MeshBuffers {
  const mesh = emptyMesh();
  const h = 0.5;
  const a = addVertex(mesh, -h, 0, -h, 0, 0);
  const b = addVertex(mesh, h, 0, -h, 1, 0);
  const c = addVertex(mesh, h, 0, h, 1, 1);
  const d = addVertex(mesh, -h, 0, h, 0, 1);
  addTriangle(mesh, a, b, c);
  addTriangle(mesh, a, c, d);
  return finalize(mesh);
}

function buildTorus(major = 0.35, minor = 0.15, majorSeg = 20, minorSeg = 10): MeshBuffers {
  const mesh = emptyMesh();
  const rings: number[][] = [];
  for (let i = 0; i <= majorSeg; i++) {
    const u = i / majorSeg;
    const theta = u * Math.PI * 2;
    const ring: number[] = [];
    for (let j = 0; j <= minorSeg; j++) {
      const v = j / minorSeg;
      const phi = v * Math.PI * 2;
      const cx = Math.cos(theta) * (major + minor * Math.cos(phi));
      const cy = Math.sin(phi) * minor;
      const cz = Math.sin(theta) * (major + minor * Math.cos(phi));
      ring.push(addVertex(mesh, cx, cy, cz, u, v));
    }
    rings.push(ring);
  }
  for (let i = 0; i < majorSeg; i++) {
    for (let j = 0; j < minorSeg; j++) {
      const ringA = rings[i] ?? [];
      const ringB = rings[i + 1] ?? [];
      const a = num(ringA, j);
      const b = num(ringB, j);
      const c = num(ringB, j + 1);
      const d = num(ringA, j + 1);
      addTriangle(mesh, a, b, c);
      addTriangle(mesh, a, c, d);
    }
  }
  return finalize(mesh);
}

export function buildPrimitive(kind: LocalPrimitiveKind): MeshBuffers {
  switch (kind) {
    case 'cube':
      return buildCube();
    case 'sphere':
      return buildSphere();
    case 'cylinder':
      return buildLathe('cylinder');
    case 'cone':
      return buildLathe('cone');
    case 'plane':
      return buildPlane();
    case 'torus':
      return buildTorus();
    default:
      throw new Error(`Unknown primitive ${String(kind)}`);
  }
}

/**
 * A relief mesh from a row-major luminance grid in 0..1.
 *
 * This is the offline image-to-3D path: bright pixels rise on Y. It is a height
 * field of the picture, not a reconstructed object.
 */
export function heightfieldFromLuminance(
  luminance: ArrayLike<number>,
  width: number,
  height: number,
  size = 2,
  depth = 0.65,
): MeshBuffers {
  if (width < 2 || height < 2 || luminance.length < width * height) {
    throw new Error('A relief mesh needs a luminance grid of at least 2×2.');
  }
  const mesh = emptyMesh();
  const ids: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const lum = Math.min(1, Math.max(0, luminance[y * width + x] ?? 0));
      const px = (x / (width - 1) - 0.5) * size;
      const pz = (y / (height - 1) - 0.5) * size;
      const py = lum * depth;
      ids.push(addVertex(mesh, px, py, pz, x / (width - 1), 1 - y / (height - 1)));
    }
  }
  const at = (x: number, y: number) => num(ids, y * width + x);
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      addTriangle(mesh, at(x, y), at(x + 1, y), at(x + 1, y + 1));
      addTriangle(mesh, at(x, y), at(x + 1, y + 1), at(x, y + 1));
    }
  }
  return finalize(mesh);
}

/** Which stand-in primitive a text prompt is closest to, when no mesh provider answers. */
export function primitiveForPrompt(prompt: string): LocalPrimitiveKind {
  const text = prompt.toLowerCase();
  if (/\b(sphere|ball|orb|planet)\b/.test(text)) return 'sphere';
  if (/\b(cylinder|pipe|tube|can|column)\b/.test(text)) return 'cylinder';
  if (/\b(cone|funnel)\b/.test(text)) return 'cone';
  if (/\b(plane|floor|ground|wall)\b/.test(text)) return 'plane';
  if (/\b(torus|ring|donut|doughnut)\b/.test(text)) return 'torus';
  return 'cube';
}
