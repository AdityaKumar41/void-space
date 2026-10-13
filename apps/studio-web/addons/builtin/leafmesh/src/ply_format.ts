/**
 * Stanford PLY (ASCII & Binary) pure format read and write.
 *
 * Imports nothing from `@framework/api` or `scripts/`, only LeafMesh topology.
 */

import type {LeafMesh} from './topo.js'
import type {Tri} from './triangulate.js'
import {TriangulationCache} from './triangulate.js'

export interface PlyReadStats {
  verts: number
  faces: number
}

/** Pure parser that populates a LeafMesh from PLY bytes. */
export function readPLY(bytes: Uint8Array, mesh: LeafMesh): PlyReadStats {
  let verts = 0
  let faces = 0

  const textPreview = new TextDecoder().decode(bytes.subarray(0, Math.min(2048, bytes.length)))
  if (!textPreview.startsWith('ply')) {
    throw new Error('Not a valid PLY file (missing ply magic header)')
  }

  const headerEndIdx = textPreview.indexOf('end_header')
  if (headerEndIdx === -1) {
    throw new Error('Malformed PLY file: no end_header found')
  }

  const fullText = new TextDecoder().decode(bytes)
  const headerLines = fullText.slice(0, fullText.indexOf('end_header')).split('\n').map((l) => l.trim())

  let isBinary = false
  let vertexCount = 0
  let faceCount = 0

  for (const line of headerLines) {
    if (line.startsWith('format binary_little_endian')) {
      isBinary = true
    }
    if (line.startsWith('element vertex')) {
      vertexCount = parseInt(line.split(/\s+/)[2], 10) || 0
    }
    if (line.startsWith('element face')) {
      faceCount = parseInt(line.split(/\s+/)[2], 10) || 0
    }
  }

  if (!isBinary) {
    // Parse ASCII PLY
    const afterHeader = fullText.slice(fullText.indexOf('end_header') + 'end_header'.length)
    const lines = afterHeader.split('\n')
    let lineIdx = 0

    while (lineIdx < lines.length && lines[lineIdx].trim() === '') {
      lineIdx++
    }

    const vertHandles: number[] = []
    for (let i = 0; i < vertexCount && lineIdx < lines.length; i++) {
      const line = lines[lineIdx++].trim()
      if (!line) continue
      const parts = line.split(/\s+/)
      if (parts.length >= 3) {
        const x = parseFloat(parts[0])
        const y = parseFloat(parts[1])
        const z = parseFloat(parts[2])
        const v = mesh.makeVert([x, y, z])
        vertHandles.push(v)
        verts++
      }
    }

    for (let i = 0; i < faceCount && lineIdx < lines.length; i++) {
      const line = lines[lineIdx++].trim()
      if (!line) continue
      const parts = line.split(/\s+/)
      const count = parseInt(parts[0], 10)
      if (count >= 3 && parts.length >= count + 1) {
        const fIndices: number[] = []
        for (let k = 1; k <= count; k++) {
          const idx = parseInt(parts[k], 10)
          if (idx >= 0 && idx < vertHandles.length) {
            fIndices.push(vertHandles[idx])
          }
        }
        if (fIndices.length >= 3) {
          try {
            mesh.makeFace([fIndices])
            faces++
          } catch {
            // Skip non-manifold face
          }
        }
      }
    }
  } else {
    // Parse Binary Little-Endian PLY
    const headerBytes = new TextEncoder().encode(
      fullText.slice(0, fullText.indexOf('end_header') + 'end_header'.length)
    )
    let offset = headerBytes.length
    while (offset < bytes.length && (bytes[offset] === 0x0a || bytes[offset] === 0x0d || bytes[offset] === 0x20)) {
      offset++
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const vertHandles: number[] = []

    for (let i = 0; i < vertexCount && offset + 12 <= bytes.length; i++) {
      const x = view.getFloat32(offset, true)
      const y = view.getFloat32(offset + 4, true)
      const z = view.getFloat32(offset + 8, true)
      offset += 12
      const v = mesh.makeVert([x, y, z])
      vertHandles.push(v)
      verts++
    }

    for (let i = 0; i < faceCount && offset < bytes.length; i++) {
      const nVerts = view.getUint8(offset)
      offset += 1
      if (nVerts >= 3 && offset + nVerts * 4 <= bytes.length) {
        const fIndices: number[] = []
        for (let k = 0; k < nVerts; k++) {
          const idx = view.getInt32(offset, true)
          offset += 4
          if (idx >= 0 && idx < vertHandles.length) {
            fIndices.push(vertHandles[idx])
          }
        }
        if (fIndices.length >= 3) {
          try {
            mesh.makeFace([fIndices])
            faces++
          } catch {
            // Skip non-manifold face
          }
        }
      } else {
        break
      }
    }
  }

  return {verts, faces}
}

/** Pure serializer that formats a LeafMesh into an ASCII PLY string. */
export function writePLY(mesh: LeafMesh, name = 'Model'): string {
  const cache = new TriangulationCache()
  const tris: Tri[] = []
  for (const f of mesh.f) {
    for (const tri of cache.get(mesh, f)) {
      tris.push(tri)
    }
  }

  const vertHandles = Array.from(mesh.v)
  const handleToIdx = new Map<number, number>()
  for (let i = 0; i < vertHandles.length; i++) {
    handleToIdx.set(vertHandles[i], i)
  }

  const vertCount = vertHandles.length
  const faceCount = tris.length

  let out = 'ply\nformat ascii 1.0\n'
  out += `comment Exported by VOID·STUDIO ${name} (Blender-compatible PLY)\n`
  out += `element vertex ${vertCount}\n`
  out += 'property float x\nproperty float y\nproperty float z\n'
  out += `element face ${faceCount}\n`
  out += 'property list uchar int vertex_indices\n'
  out += 'end_header\n'

  const co = mesh.v.co
  for (const v of vertHandles) {
    const i = v * 3
    out += `${co[i].toFixed(6)} ${co[i + 1].toFixed(6)} ${co[i + 2].toFixed(6)}\n`
  }

  for (const tri of tris) {
    const i0 = handleToIdx.get(tri.v[0]) ?? tri.v[0]
    const i1 = handleToIdx.get(tri.v[1]) ?? tri.v[1]
    const i2 = handleToIdx.get(tri.v[2]) ?? tri.v[2]
    out += `3 ${i0} ${i1} ${i2}\n`
  }

  return out
}

export function exportTrianglesToPLY(
  tris: {positions: Float64Array; indices: Int32Array},
  name = 'Model'
): string {
  const numVerts = (tris.positions.length / 3) | 0
  const numFaces = (tris.indices.length / 3) | 0
  if (numVerts === 0 || numFaces === 0) {
    return ''
  }

  let out = `ply\nformat ascii 1.0\ncomment Exported by VOID·STUDIO 1.0 (${name})\n`
  out += `element vertex ${numVerts}\n`
  out += `property float x\nproperty float y\nproperty float z\n`
  out += `element face ${numFaces}\n`
  out += `property list uchar int vertex_indices\n`
  out += `end_header\n`

  for (let i = 0; i < numVerts; i++) {
    const x = tris.positions[i * 3]
    const y = tris.positions[i * 3 + 1]
    const z = tris.positions[i * 3 + 2]
    out += `${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}\n`
  }

  for (let i = 0; i < tris.indices.length; i += 3) {
    out += `3 ${tris.indices[i]} ${tris.indices[i + 1]} ${tris.indices[i + 2]}\n`
  }

  return out
}
