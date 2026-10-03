/**
 * STL (Binary & ASCII) import for LeafMesh.
 */
import type {IFileFormat, ToolContext} from '@framework/api'
import {InvalidationKind, SceneObject, makeDefaultMaterial} from '@framework/api'

import {LeafMeshData} from './leafmesh.js'

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

export const LEAFMESH_STL_FORMAT: IFileFormat<ToolContext> = {
  id: 'stl',
  uiName: 'Stereolithography STL',
  extensions: ['.stl'],

  importFromBytes(ctx, bytes, filename) {
    importSTLIntoScene(ctx, bytes, filename)
  },
}
