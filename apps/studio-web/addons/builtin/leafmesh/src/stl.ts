/**
 * STL (Binary & ASCII) import for LeafMesh.
 */
import type {IFileFormat, ToolContext} from '@framework/api'
import {InvalidationKind, SceneObject, makeDefaultMaterial, triangleSourceOf} from '@framework/api'

import {LeafMeshData} from './leafmesh.js'
import {exportTrianglesToSTL} from './stl_format.js'
export {exportTrianglesToSTL}

function blockName(filename: string | undefined): string {
  if (filename === undefined || filename.length === 0) {
    return 'STL'
  }
  const base = filename.slice(Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base) || 'STL'
}

export interface StlImportResult {
  data: LeafMeshData
  stats: {verts: number; faces: number}
}

export function leafMeshFromSTL(bytes: Uint8Array, filename?: string): StlImportResult {
  const data = new LeafMeshData()
  let verts = 0
  let faces = 0

  try {
    const isBinary =
      bytes.length >= 84 &&
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true) * 50 + 84 <=
        bytes.byteLength

    if (isBinary) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const count = view.getUint32(80, true)

      for (let i = 0; i < count; i++) {
        const at = 84 + i * 50
        const v0 = data.mesh.makeVert([
          view.getFloat32(at + 12, true),
          view.getFloat32(at + 16, true),
          view.getFloat32(at + 20, true),
        ])
        const v1 = data.mesh.makeVert([
          view.getFloat32(at + 24, true),
          view.getFloat32(at + 28, true),
          view.getFloat32(at + 32, true),
        ])
        const v2 = data.mesh.makeVert([
          view.getFloat32(at + 36, true),
          view.getFloat32(at + 40, true),
          view.getFloat32(at + 44, true),
        ])
        verts += 3

        if (v0 !== v1 && v1 !== v2 && v0 !== v2) {
          try {
            data.mesh.makeFace([[v0, v1, v2]])
            faces++
          } catch {
            // Non-manifold skip
          }
        }
      }
    } else {
      // ASCII STL
      const text = new TextDecoder().decode(bytes)
      const lines = text.split('\n')
      let triangle: number[] = []

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('vertex')) {
          const parts = trimmed.split(/\s+/)
          if (parts.length >= 4) {
            const v = data.mesh.makeVert([
              parseFloat(parts[1]),
              parseFloat(parts[2]),
              parseFloat(parts[3]),
            ])
            triangle.push(v)
            verts++
            if (triangle.length === 3) {
              try {
                data.mesh.makeFace([[triangle[0], triangle[1], triangle[2]]])
                faces++
              } catch {
                // Non-manifold skip
              }
              triangle = []
            }
          }
        }
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('STL parse error', err)
  }

  data.name = blockName(filename)
  data.invalidate(InvalidationKind.ALL)

  return {data, stats: {verts, faces}}
}

export function importSTLIntoScene(ctx: ToolContext, bytes: Uint8Array, filename?: string): LeafMeshData {
  const {data, stats} = leafMeshFromSTL(bytes, filename)
  const lib = ctx.datalib
  const scene = ctx.scene

  lib.add(data)

  const mat = makeDefaultMaterial()
  lib.add(mat)
  data.materials.push(mat)
  mat.lib_addUser(data)

  const ob = new SceneObject()
  lib.add(ob)
  ob.data = data
  ob.name = data.name
  data.lib_addUser(ob)

  scene.add(ob)
  scene.objects.setSelect(ob, true)
  scene.objects.setActive(ob)

  ob.graphUpdate()
  data.graphUpdate()

  ctx.message?.(`Imported STL: ${stats.verts} vertices, ${stats.faces} faces`)
  return data
}

import type {Tri} from './triangulate.js'
import {TriangulationCache} from './triangulate.js'

export function exportLeafMeshToSTL(data: LeafMeshData, name = 'Model'): Uint8Array {
  const mesh = data.mesh
  const cache = new TriangulationCache()
  const tris: Tri[] = []
  for (const f of mesh.f) {
    for (const tri of cache.get(mesh, f)) {
      tris.push(tri)
    }
  }

  const triCount = tris.length
  const totalBytes = 84 + triCount * 50
  const out = new Uint8Array(totalBytes)
  const view = new DataView(out.buffer)

  // 80 byte header
  const headerStr = `VOID·STUDIO STL 1.0 - ${name}`.slice(0, 80)
  for (let i = 0; i < headerStr.length; i++) {
    out[i] = headerStr.charCodeAt(i)
  }

  view.setUint32(80, triCount, true)

  const co = mesh.v.co
  for (let t = 0; t < triCount; t++) {
    const at = 84 + t * 50
    const tri = tris[t]
    const v0 = tri.v[0] * 3
    const v1 = tri.v[1] * 3
    const v2 = tri.v[2] * 3

    // Face normal via cross product
    const ux = co[v1] - co[v0]
    const uy = co[v1 + 1] - co[v0 + 1]
    const uz = co[v1 + 2] - co[v0 + 2]
    const vx = co[v2] - co[v0]
    const vy = co[v2 + 1] - co[v0 + 1]
    const vz = co[v2 + 2] - co[v0 + 2]

    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len > 0) {
      nx /= len
      ny /= len
      nz /= len
    }

    view.setFloat32(at, nx, true)
    view.setFloat32(at + 4, ny, true)
    view.setFloat32(at + 8, nz, true)

    // v0
    view.setFloat32(at + 12, co[v0], true)
    view.setFloat32(at + 16, co[v0 + 1], true)
    view.setFloat32(at + 20, co[v0 + 2], true)

    // v1
    view.setFloat32(at + 24, co[v1], true)
    view.setFloat32(at + 28, co[v1 + 1], true)
    view.setFloat32(at + 32, co[v1 + 2], true)

    // v2
    view.setFloat32(at + 36, co[v2], true)
    view.setFloat32(at + 40, co[v2 + 1], true)
    view.setFloat32(at + 44, co[v2 + 2], true)

    view.setUint16(at + 48, 0, true) // attribute byte count
  }

  return out
}

export const LEAFMESH_STL_FORMAT: IFileFormat<ToolContext> = {
  id: 'stl',
  uiName: 'Stereolithography STL',
  extensions: ['.stl'],

  importFromBytes(ctx, bytes, filename) {
    importSTLIntoScene(ctx, bytes, filename)
  },

  exportToBytes(ctx) {
    const ob = ctx.scene?.objects?.active || [...(ctx.scene?.objects || [])].find((o: any) => o.data instanceof LeafMeshData || triangleSourceOf(o?.data))
    if (ob && ob.data instanceof LeafMeshData) {
      return exportLeafMeshToSTL(ob.data, ob.name || 'Model')
    }
    const src = triangleSourceOf(ob?.data)
    if (src) {
      const tris = src.extractTriangles()
      return exportTrianglesToSTL(tris)
    }
    return new Uint8Array()
  },
}
