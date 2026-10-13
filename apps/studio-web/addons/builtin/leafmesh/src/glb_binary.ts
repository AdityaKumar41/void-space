/**
 * Binary glTF 2.0 (GLB) low-level packing utilities.
 * Pure TypeScript functions with no framework or DOM dependencies.
 */

export interface GlbBinaryOptions {
  uv?: Float32Array
  color?: Float32Array
  baseColorFactor?: [number, number, number, number]
  metallicFactor?: number
  roughnessFactor?: number
  textureBytes?: Uint8Array
  textureMimeType?: string
}

export function buildGlbBinary(
  name: string,
  position: Float32Array,
  normal: Float32Array,
  indices: Uint16Array | Uint32Array,
  options?: GlbBinaryOptions,
): Uint8Array {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  for (let i = 0; i < position.length; i += 3) {
    const x = position[i]
    const y = position[i + 1]
    const z = position[i + 2]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }

  if (minX === Infinity) {
    minX = minY = minZ = -1
    maxX = maxY = maxZ = 1
  }

  const vertCount = Math.floor(position.length / 3)
  const is32Bit = indices instanceof Uint32Array

  // Calculate buffer offsets (padded to 4-byte boundaries)
  const posByteLength = position.byteLength
  const posPadded = (posByteLength + 3) & ~3

  const normByteLength = normal.byteLength
  const normPadded = (normByteLength + 3) & ~3

  const hasUv = Boolean(options?.uv && options.uv.length >= vertCount * 2)
  const uvByteLength = hasUv ? vertCount * 2 * 4 : 0
  const uvPadded = (uvByteLength + 3) & ~3

  const idxByteLength = indices.byteLength
  const idxPadded = (idxByteLength + 3) & ~3

  const hasTex = Boolean(options?.textureBytes && options.textureBytes.byteLength > 0)
  const texByteLength = hasTex ? options!.textureBytes!.byteLength : 0
  const texPadded = (texByteLength + 3) & ~3

  const totalBinBytes = posPadded + normPadded + uvPadded + idxPadded + texPadded
  const binBuffer = new Uint8Array(totalBinBytes)

  // Copy positions
  binBuffer.set(new Uint8Array(position.buffer, position.byteOffset, posByteLength), 0)
  // Copy normals
  binBuffer.set(new Uint8Array(normal.buffer, normal.byteOffset, normByteLength), posPadded)

  let curOffset = posPadded + normPadded
  let uvOffset = 0
  let minU = 0, minV = 0, maxU = 1, maxV = 1

  if (hasUv) {
    uvOffset = curOffset
    const uvData = options!.uv!
    minU = Infinity
    minV = Infinity
    maxU = -Infinity
    maxV = -Infinity
    for (let i = 0; i < vertCount * 2; i += 2) {
      const u = uvData[i]
      const v = uvData[i + 1]
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    if (minU === Infinity) {
      minU = minV = 0
      maxU = maxV = 1
    }
    binBuffer.set(new Uint8Array(uvData.buffer, uvData.byteOffset, uvByteLength), curOffset)
    curOffset += uvPadded
  }

  // Copy indices
  const idxOffset = curOffset
  binBuffer.set(new Uint8Array(indices.buffer, indices.byteOffset, idxByteLength), idxOffset)
  curOffset += idxPadded

  // Copy embedded texture image
  let texOffset = 0
  if (hasTex) {
    texOffset = curOffset
    binBuffer.set(options!.textureBytes!, texOffset)
    curOffset += texPadded
  }

  const bufferViews: any[] = [
    {buffer: 0, byteOffset: 0, byteLength: posByteLength, target: 34962},
    {buffer: 0, byteOffset: posPadded, byteLength: normByteLength, target: 34962},
  ]

  let uvBvIdx = -1
  if (hasUv) {
    uvBvIdx = bufferViews.length
    bufferViews.push({buffer: 0, byteOffset: uvOffset, byteLength: uvByteLength, target: 34962})
  }

  const idxBvIdx = bufferViews.length
  bufferViews.push({buffer: 0, byteOffset: idxOffset, byteLength: idxByteLength, target: 34963})

  let texBvIdx = -1
  if (hasTex) {
    texBvIdx = bufferViews.length
    bufferViews.push({buffer: 0, byteOffset: texOffset, byteLength: texByteLength})
  }

  const accessors: any[] = [
    {
      bufferView: 0,
      byteOffset: 0,
      componentType: 5126, // FLOAT
      count: vertCount,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
    {
      bufferView: 1,
      byteOffset: 0,
      componentType: 5126, // FLOAT
      count: vertCount,
      type: 'VEC3',
    },
  ]

  let uvAccIdx = -1
  if (hasUv) {
    uvAccIdx = accessors.length
    accessors.push({
      bufferView: uvBvIdx,
      byteOffset: 0,
      componentType: 5126, // FLOAT
      count: vertCount,
      type: 'VEC2',
      min: [minU, minV],
      max: [maxU, maxV],
    })
  }

  const idxAccIdx = accessors.length
  accessors.push({
    bufferView: idxBvIdx,
    byteOffset: 0,
    componentType: is32Bit ? 5125 : 5123, // UNSIGNED_INT or UNSIGNED_SHORT
    count: indices.length,
    type: 'SCALAR',
    min: [0],
    max: [vertCount > 0 ? vertCount - 1 : 0],
  })

  const attributes: Record<string, number> = {
    POSITION: 0,
    NORMAL: 1,
  }
  if (hasUv) {
    attributes.TEXCOORD_0 = uvAccIdx
  }

  const pbr: any = {
    baseColorFactor: options?.baseColorFactor || [0.85, 0.85, 0.9, 1.0],
    metallicFactor: options?.metallicFactor ?? 0.2,
    roughnessFactor: options?.roughnessFactor ?? 0.5,
  }

  if (hasTex) {
    pbr.baseColorTexture = {index: 0}
  }

  const gltfJson: any = {
    asset: {version: '2.0', generator: 'VOID·STUDIO 1.0'},
    scenes: [{name: 'Scene', nodes: [0]}],
    nodes: [{name, mesh: 0}],
    meshes: [
      {
        name,
        primitives: [
          {
            attributes,
            indices: idxAccIdx,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        name: 'PBR_Material',
        pbrMetallicRoughness: pbr,
      },
    ],
    accessors,
    bufferViews,
    buffers: [{byteLength: totalBinBytes}],
  }

  if (hasTex) {
    gltfJson.images = [{bufferView: texBvIdx, mimeType: options?.textureMimeType || 'image/png'}]
    gltfJson.textures = [{source: 0, sampler: 0}]
    gltfJson.samplers = [{magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497}]
  }

  const jsonStr = JSON.stringify(gltfJson)
  const jsonBytes = new TextEncoder().encode(jsonStr)
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4
  const jsonChunkLen = jsonBytes.length + jsonPadding

  const totalLength = 12 + 8 + jsonChunkLen + 8 + totalBinBytes
  const out = new Uint8Array(totalLength)
  const view = new DataView(out.buffer)

  // GLB Header
  view.setUint32(0, 0x46546c67, true) // 'glTF'
  view.setUint32(4, 2, true) // version 2
  view.setUint32(8, totalLength, true)

  // Chunk 0: JSON
  view.setUint32(12, jsonChunkLen, true)
  view.setUint32(16, 0x4e4f534a, true) // 'JSON'
  out.set(jsonBytes, 20)
  for (let i = 0; i < jsonPadding; i++) {
    out[20 + jsonBytes.length + i] = 0x20 // space padding
  }

  // Chunk 1: BIN
  const binHeaderOffset = 20 + jsonChunkLen
  view.setUint32(binHeaderOffset, totalBinBytes, true)
  view.setUint32(binHeaderOffset + 4, 0x004e4942, true) // 'BIN\0'
  out.set(binBuffer, binHeaderOffset + 8)

  return out
}

export function exportTrianglesToGLB(
  tris: {positions: Float64Array; indices: Int32Array; normals?: Float64Array},
  name = 'Model'
): Uint8Array {
  const vertCount = (tris.positions.length / 3) | 0
  if (vertCount === 0 || tris.indices.length === 0) {
    return new Uint8Array()
  }

  const posF32 = new Float32Array(tris.positions.length)
  for (let i = 0; i < tris.positions.length; i++) {
    posF32[i] = tris.positions[i]
  }

  const normF32 = new Float32Array(tris.positions.length)
  if (tris.normals && tris.normals.length === tris.positions.length) {
    for (let i = 0; i < tris.normals.length; i++) {
      normF32[i] = tris.normals[i]
    }
  } else {
    for (let i = 0; i < vertCount; i++) {
      normF32[i * 3 + 2] = 1.0
    }
  }

  const isLarge = vertCount >= 65535
  const indices = isLarge ? new Uint32Array(tris.indices.length) : new Uint16Array(tris.indices.length)
  for (let i = 0; i < tris.indices.length; i++) {
    indices[i] = tris.indices[i]
  }

  return buildGlbBinary(name, posF32, normF32, indices)
}
