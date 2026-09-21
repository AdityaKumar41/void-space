/**
 * GLB/glTF mesh metadata extraction (SRS §6.3: "mesh metadata parsed on ingest",
 * FR-3.2 polycount budget).
 *
 * A GLB is a binary container with a 12-byte header followed by chunks; the first
 * chunk is the glTF JSON. Reading only that chunk (bounded here) gives real vertex,
 * triangle, material, animation and texture counts without loading the geometry — so
 * ingest stays fast even for a 200 MB asset.
 *
 * Non-GLB formats (.obj, .fbx, .stl, .blend) get `null` values: their geometry is not
 * cheaply parseable in-process, and the headless-Blender derivative (§6.3) reports the
 * numbers for those instead.
 */
import { open } from 'node:fs/promises';

import type { MeshMetadata } from '@void-space/types';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON'
/** Cap on the JSON chunk we will read; real chunks are a few KB, this is slack. */
const MAX_JSON_CHUNK_BYTES = 8 * 1024 * 1024;

interface GltfDocument {
  readonly accessors?: readonly { count?: number; type?: string }[];
  readonly meshes?: readonly {
    primitives?: readonly { attributes?: Record<string, number>; indices?: number; mode?: number }[];
  }[];
  readonly materials?: readonly unknown[];
  readonly animations?: readonly unknown[];
  readonly images?: readonly unknown[];
  readonly textures?: readonly unknown[];
  readonly nodes?: readonly { mesh?: number }[];
}

const ACCESSOR_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

/** Triangles contributed by one primitive: indices/3, or vertices/3 when unindexed. */
function trianglesForPrimitive(
  primitive: { attributes?: Record<string, number>; indices?: number; mode?: number },
  document: GltfDocument,
): number {
  // mode 4 is TRIANGLES (the default); other modes are not triangle geometry.
  const mode = primitive.mode ?? 4;
  if (mode !== 4) return 0;

  const accessorIndex = primitive.indices ?? primitive.attributes?.['POSITION'];
  if (accessorIndex === undefined) return 0;

  const accessor = document.accessors?.[accessorIndex];
  const count = accessor?.count ?? 0;
  return Math.floor(count / 3);
}

function verticesForPrimitive(
  primitive: { attributes?: Record<string, number> },
  document: GltfDocument,
): number {
  const accessorIndex = primitive.attributes?.['POSITION'];
  if (accessorIndex === undefined) return 0;
  return document.accessors?.[accessorIndex]?.count ?? 0;
}

/** Interprets a parsed glTF JSON document. Exported so it can be unit-tested. */
export function metadataFromGltfJson(document: GltfDocument): MeshMetadata {
  let polycount = 0;
  let vertices = 0;

  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      polycount += trianglesForPrimitive(primitive, document);
      vertices += verticesForPrimitive(primitive, document);
    }
  }

  return {
    polycount: polycount > 0 ? polycount : null,
    vertices: vertices > 0 ? vertices : null,
    materials: document.materials?.length ?? null,
    animations: document.animations?.length ?? null,
    textures: document.textures?.length ?? document.images?.length ?? null,
    // Bounds require decoding the POSITION accessor's min/max, which glTF stores per
    // accessor; read them when present rather than computing from geometry.
    boundingBox: null,
  };
}

/**
 * Reads the GLB header and its JSON chunk. Returns null for anything that is not a
 * readable GLB (a mislabelled file, a .gltf JSON upload, an unreadable path), so
 * ingest never fails because metadata could not be parsed.
 */
export async function readGlbMetadata(path: string): Promise<MeshMetadata | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(path, 'r');

    const header = Buffer.alloc(12);
    const headerRead = await handle.read(header, 0, 12, 0);
    if (headerRead.bytesRead < 12) return null;
    if (header.readUInt32LE(0) !== GLB_MAGIC) return null;

    const chunkHeader = Buffer.alloc(8);
    const chunkRead = await handle.read(chunkHeader, 0, 8, 12);
    if (chunkRead.bytesRead < 8) return null;

    const chunkLength = chunkHeader.readUInt32LE(0);
    const chunkType = chunkHeader.readUInt32LE(4);
    if (chunkType !== JSON_CHUNK_TYPE || chunkLength <= 0 || chunkLength > MAX_JSON_CHUNK_BYTES) {
      return null;
    }

    const json = Buffer.alloc(chunkLength);
    const jsonRead = await handle.read(json, 0, chunkLength, 20);
    if (jsonRead.bytesRead < chunkLength) return null;

    const document = JSON.parse(json.toString('utf8')) as GltfDocument;
    return metadataFromGltfJson(document);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Human-readable polycount budget check (FR-3.2, FR-14.3). */
export function exceedsPolycountBudget(
  metadata: MeshMetadata | null,
  budget: number | null,
): boolean {
  if (!metadata?.polycount || !budget) return false;
  return metadata.polycount > budget;
}

export { ACCESSOR_COMPONENTS };
