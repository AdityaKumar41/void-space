/**
 * glTF 2.0 (GLB / glTF) import for LeafMesh.
 *
 * Parses binary glTF containers (.glb) and text glTF (.gltf) into LeafMesh geometry,
 * extracting vertex buffers (positions) and triangle indices.
 */
import type {IFileFormat, ToolContext} from '@framework/api'
import {InvalidationKind, SceneObject, makeDefaultMaterial} from '@framework/api'

import {LeafMeshData} from './leafmesh.js'

function blockName(filename: string | undefined): string {
  if (filename === undefined || filename.length === 0) {
    return 'GLB'
  }
  const base = filename.slice(Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base) || 'GLB'
}

export interface GlbImportResult {
  data: LeafMeshData
  stats: {verts: number; faces: number}
}

export function leafMeshFromGLB(bytes: Uint8Array, filename?: string): GlbImportResult {
  const data = new LeafMeshData()
  let verts = 0
  let faces = 0

  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const isGlb = bytes.length >= 12 && view.getUint32(0, true) === 0x46546c67 // 'glTF'

    let gltf: any
    let binBuffer: ArrayBuffer | null = null

    if (isGlb) {
      // Chunk 0: JSON
      const jsonLength = view.getUint32(12, true)
      const jsonBytes = bytes.subarray(20, 20 + jsonLength)
      const jsonStr = new TextDecoder().decode(jsonBytes)
      gltf = JSON.parse(jsonStr)

      // Chunk 1: BIN
      const chunk1Offset = 20 + jsonLength
      if (chunk1Offset + 8 <= bytes.byteLength) {
        const binLength = view.getUint32(chunk1Offset, true)
        const binStart = bytes.byteOffset + chunk1Offset + 8
        binBuffer = bytes.buffer.slice(binStart, binStart + binLength)
      }
    } else {
      // Non-binary JSON glTF
      const jsonStr = new TextDecoder().decode(bytes)
      gltf = JSON.parse(jsonStr)
      if (gltf.buffers && gltf.buffers[0] && typeof gltf.buffers[0].uri === 'string') {
        const uri: string = gltf.buffers[0].uri
        if (uri.startsWith('data:')) {
          const comma = uri.indexOf(',')
          const b64 = uri.slice(comma + 1)
          const binStr = atob(b64)
          const u8 = new Uint8Array(binStr.length)
          for (let i = 0; i < binStr.length; i++) {
            u8[i] = binStr.charCodeAt(i)
          }
          binBuffer = u8.buffer
        }
      }
    }

    if (gltf && gltf.meshes && binBuffer) {
      for (const mesh of gltf.meshes) {
        for (const prim of mesh.primitives || []) {
          if (prim.attributes && prim.attributes.POSITION !== undefined) {
            const posAcc = gltf.accessors[prim.attributes.POSITION]
            const posView = gltf.bufferViews[posAcc.bufferView]
            const posOffset = (posView.byteOffset || 0) + (posAcc.byteOffset || 0)
            const positions = new Float32Array(binBuffer, posOffset, posAcc.count * 3)

            const vertHandles: number[] = []
            for (let i = 0; i < positions.length; i += 3) {
              const v = data.mesh.makeVert([positions[i], positions[i + 1], positions[i + 2]])
              vertHandles.push(v)
              verts++
            }

            if (prim.indices !== undefined) {
              const indAcc = gltf.accessors[prim.indices]
              const indView = gltf.bufferViews[indAcc.bufferView]
              const indOffset = (indView.byteOffset || 0) + (indAcc.byteOffset || 0)

              let indices: ArrayLike<number>
              if (indAcc.componentType === 5123) {
                // UNSIGNED_SHORT
                indices = new Uint16Array(binBuffer, indOffset, indAcc.count)
              } else if (indAcc.componentType === 5125) {
                // UNSIGNED_INT
                indices = new Uint32Array(binBuffer, indOffset, indAcc.count)
              } else {
                // UNSIGNED_BYTE
                indices = new Uint8Array(binBuffer, indOffset, indAcc.count)
              }

              for (let i = 0; i < indices.length; i += 3) {
                const v0 = vertHandles[indices[i]]
                const v1 = vertHandles[indices[i + 1]]
                const v2 = vertHandles[indices[i + 2]]
                if (
                  v0 !== undefined &&
                  v1 !== undefined &&
                  v2 !== undefined &&
                  v0 !== v1 &&
                  v1 !== v2 &&
                  v0 !== v2
                ) {
                  try {
                    data.mesh.makeFace([[v0, v1, v2]])
                    faces++
                  } catch {
                    // Ignore non-manifold edge rejection
                  }
                }
              }
            } else {
              // Unindexed sequential triangles
              for (let i = 0; i < vertHandles.length; i += 3) {
                const v0 = vertHandles[i]
                const v1 = vertHandles[i + 1]
                const v2 = vertHandles[i + 2]
                if (v0 !== undefined && v1 !== undefined && v2 !== undefined) {
                  try {
                    data.mesh.makeFace([[v0, v1, v2]])
                    faces++
                  } catch {
                    // Ignore
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GLB parse error', err)
  }

  data.name = blockName(filename)
  data.invalidate(InvalidationKind.ALL)

  return {data, stats: {verts, faces}}
}

export function importGLBIntoScene(ctx: ToolContext, bytes: Uint8Array, filename?: string): LeafMeshData {
  const {data, stats} = leafMeshFromGLB(bytes, filename)
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

  ctx.message?.(`Imported GLB: ${stats.verts} vertices, ${stats.faces} faces`)
  return data
}

export const LEAFMESH_GLB_FORMAT: IFileFormat<ToolContext> = {
  id: 'glb',
  uiName: 'glTF 2.0 Binary / Model',
  extensions: ['.glb', '.gltf'],

  importFromBytes(ctx, bytes, filename) {
    importGLBIntoScene(ctx, bytes, filename)
  },
}
