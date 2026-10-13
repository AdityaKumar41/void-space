/**
 * glTF 2.0 (GLB / glTF) import for LeafMesh.
 *
 * Parses binary glTF containers (.glb) and text glTF (.gltf) into LeafMesh geometry,
 * extracting vertex buffers (positions, UVs, colors), triangle indices, embedded
 * textures, and materials.
 */
import type {IFileFormat, ToolContext} from '@framework/api'
import {
  InvalidationKind,
  SceneObject,
  makeDefaultMaterial,
  triangleSourceOf,
  Material,
  ImageBlock,
  ImageTypes,
  ImageNode,
  AttributeNode,
  AttributeCategory,
  DiffuseNode,
  GeometryNode,
  OutputNode,
  Vector3,
} from '@framework/api'

import {AttrType, Domain} from './attrs.js'
import {ELEM_NONE} from './elem_array.js'
import {LeafMeshData} from './leafmesh.js'

function blockName(filename: string | undefined): string {
  if (filename === undefined || filename.length === 0) {
    return 'GLB'
  }
  const base = filename.slice(Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base) || 'GLB'
}

export interface ExtractedTexture {
  name: string
  mimeType: string
  dataUrl: string
}

export interface GlbImportResult {
  data: LeafMeshData
  stats: {verts: number; faces: number}
  textures: ExtractedTexture[]
  baseColorFactor?: [number, number, number, number]
}

function uint8ArrayToBase64(u8: Uint8Array): string {
  let binary = ''
  const chunkSize = 16384
  const len = u8.byteLength
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = u8.subarray(i, Math.min(i + chunkSize, len))
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
}

function readAccessorFloats(
  gltf: any,
  binBuffer: ArrayBuffer,
  accessorIdx: number | undefined,
  numComponents: number
): Float32Array | null {
  if (accessorIdx === undefined || !gltf.accessors || !gltf.accessors[accessorIdx]) return null
  const acc = gltf.accessors[accessorIdx]
  const bv = gltf.bufferViews[acc.bufferView]
  if (!bv) return null

  const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0)
  const count = acc.count
  const out = new Float32Array(count * numComponents)
  const stride = bv.byteStride || 0
  const compType = acc.componentType

  if (compType === 5126) {
    // FLOAT
    if (stride === 0 || stride === numComponents * 4) {
      return new Float32Array(binBuffer, byteOffset, count * numComponents)
    }
    const view = new DataView(binBuffer, byteOffset)
    for (let i = 0; i < count; i++) {
      const off = i * stride
      for (let c = 0; c < numComponents; c++) {
        out[i * numComponents + c] = view.getFloat32(off + c * 4, true)
      }
    }
  } else if (compType === 5123) {
    // UNSIGNED_SHORT normalized
    const view = new DataView(binBuffer, byteOffset)
    const effStride = stride || numComponents * 2
    for (let i = 0; i < count; i++) {
      const off = i * effStride
      for (let c = 0; c < numComponents; c++) {
        out[i * numComponents + c] = view.getUint16(off + c * 2, true) / 65535.0
      }
    }
  } else if (compType === 5121) {
    // UNSIGNED_BYTE normalized
    const view = new DataView(binBuffer, byteOffset)
    const effStride = stride || numComponents
    for (let i = 0; i < count; i++) {
      const off = i * effStride
      for (let c = 0; c < numComponents; c++) {
        out[i * numComponents + c] = view.getUint8(off + c) / 255.0
      }
    }
  }
  return out
}

function parseGltfImage(
  img: any,
  idx: number,
  gltf: any,
  binBuffer: ArrayBuffer | null
): ExtractedTexture | null {
  if (!img) return null
  const mimeType = img.mimeType || 'image/png'
  const name = img.name || `Texture_${idx}`

  if (img.bufferView !== undefined && binBuffer) {
    const bv = gltf.bufferViews[img.bufferView]
    if (bv) {
      const offset = bv.byteOffset || 0
      const len = bv.byteLength
      const slice = new Uint8Array(binBuffer, offset, len)
      const dataUrl = `data:${mimeType};base64,${uint8ArrayToBase64(slice)}`
      return {name, mimeType, dataUrl}
    }
  } else if (typeof img.uri === 'string') {
    return {name, mimeType, dataUrl: img.uri}
  }
  return null
}

export function leafMeshFromGLB(bytes: Uint8Array, filename?: string): GlbImportResult {
  const data = new LeafMeshData()
  let verts = 0
  let faces = 0
  const textures: ExtractedTexture[] = []
  let baseColorFactor: [number, number, number, number] | undefined

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

    if (gltf && binBuffer) {
      // 1. Extract texture & material info
      if (gltf.materials && gltf.materials.length > 0) {
        const m = gltf.materials[0]
        if (m.pbrMetallicRoughness?.baseColorFactor) {
          baseColorFactor = m.pbrMetallicRoughness.baseColorFactor
        }
        const texRef = m.pbrMetallicRoughness?.baseColorTexture
        if (texRef !== undefined && gltf.textures) {
          const tex = gltf.textures[texRef.index]
          const imgIdx = tex?.source !== undefined ? tex.source : texRef.index
          const img = gltf.images?.[imgIdx]
          const extracted = parseGltfImage(img, imgIdx, gltf, binBuffer)
          if (extracted) textures.push(extracted)
        }
      }

      if (textures.length === 0 && gltf.images && gltf.images.length > 0) {
        for (let idx = 0; idx < gltf.images.length; idx++) {
          const img = gltf.images[idx]
          const extracted = parseGltfImage(img, idx, gltf, binBuffer)
          if (extracted) {
            textures.push(extracted)
            break
          }
        }
      }

      // 2. Parse geometry
      let uvLayerVert: any
      let uvLayerCorner: any
      let colLayerVert: any

      if (gltf.meshes) {
        for (const mesh of gltf.meshes) {
          for (const prim of mesh.primitives || []) {
            if (prim.attributes && prim.attributes.POSITION !== undefined) {
              const positions = readAccessorFloats(gltf, binBuffer, prim.attributes.POSITION, 3)
              if (!positions) continue

              const vertCount = positions.length / 3
              const uvs = readAccessorFloats(gltf, binBuffer, prim.attributes.TEXCOORD_0, 2)
              const colors = readAccessorFloats(gltf, binBuffer, prim.attributes.COLOR_0, 4)

              if (uvs && !uvLayerVert) {
                uvLayerVert = data.mesh.attrs.add(Domain.VERT, 'uv', AttrType.Float2)
                uvLayerCorner = data.mesh.attrs.add(Domain.CORNER, 'uv', AttrType.Float2)
              }
              if (colors && !colLayerVert) {
                colLayerVert = data.mesh.attrs.add(Domain.VERT, 'color', AttrType.Float4)
              }

              const localVertHandles: number[] = []
              for (let i = 0; i < vertCount; i++) {
                const v = data.mesh.makeVert([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]])
                localVertHandles.push(v)
                verts++

                if (uvs && uvLayerVert) {
                  uvLayerVert.column.data[v * 2] = uvs[i * 2]
                  uvLayerVert.column.data[v * 2 + 1] = uvs[i * 2 + 1]
                }
                if (colors && colLayerVert) {
                  colLayerVert.column.data[v * 4] = colors[i * 4]
                  colLayerVert.column.data[v * 4 + 1] = colors[i * 4 + 1]
                  colLayerVert.column.data[v * 4 + 2] = colors[i * 4 + 2]
                  colLayerVert.column.data[v * 4 + 3] = colors[i * 4 + 3]
                }
              }

              const createdFaces: number[] = []

              if (prim.indices !== undefined) {
                const indAcc = gltf.accessors[prim.indices]
                const indView = gltf.bufferViews[indAcc.bufferView]
                const indOffset = (indView.byteOffset || 0) + (indAcc.byteOffset || 0)

                let indices: ArrayLike<number>
                if (indAcc.componentType === 5123) {
                  indices = new Uint16Array(binBuffer, indOffset, indAcc.count)
                } else if (indAcc.componentType === 5125) {
                  indices = new Uint32Array(binBuffer, indOffset, indAcc.count)
                } else {
                  indices = new Uint8Array(binBuffer, indOffset, indAcc.count)
                }

                for (let i = 0; i < indices.length; i += 3) {
                  const v0 = localVertHandles[indices[i]]
                  const v1 = localVertHandles[indices[i + 1]]
                  const v2 = localVertHandles[indices[i + 2]]
                  if (
                    v0 !== undefined &&
                    v1 !== undefined &&
                    v2 !== undefined &&
                    v0 !== v1 &&
                    v1 !== v2 &&
                    v0 !== v2
                  ) {
                    try {
                      const f = data.mesh.makeFace([[v0, v1, v2]])
                      if (f !== ELEM_NONE) {
                        faces++
                        createdFaces.push(f)
                      }
                    } catch {
                      // Non-manifold or degenerate face skipped
                    }
                  }
                }
              } else {
                for (let i = 0; i < localVertHandles.length; i += 3) {
                  const v0 = localVertHandles[i]
                  const v1 = localVertHandles[i + 1]
                  const v2 = localVertHandles[i + 2]
                  if (v0 !== undefined && v1 !== undefined && v2 !== undefined) {
                    try {
                      const f = data.mesh.makeFace([[v0, v1, v2]])
                      if (f !== ELEM_NONE) {
                        faces++
                        createdFaces.push(f)
                      }
                    } catch {
                      // Non-manifold or degenerate face skipped
                    }
                  }
                }
              }

              // Copy UVs onto face loop corners
              if (uvs && uvLayerCorner && uvLayerVert) {
                for (const f of createdFaces) {
                  for (const l of data.mesh.faceLoops(f)) {
                    for (const c of data.mesh.loopCorners(l)) {
                      const vert = data.mesh.c.v[c]
                      uvCornerLayer.column.data[c * 2] = uvLayerVert.column.data[vert * 2]
                      uvCornerLayer.column.data[c * 2 + 1] = uvLayerVert.column.data[vert * 2 + 1]
                    }
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

  return {data, stats: {verts, faces}, textures, baseColorFactor}
}

export function importGLBIntoScene(ctx: ToolContext, bytes: Uint8Array, filename?: string): LeafMeshData {
  const {data, stats, textures, baseColorFactor} = leafMeshFromGLB(bytes, filename)
  const lib = ctx.datalib
  const scene = ctx.scene

  lib.add(data)

  let mat: Material
  if (textures && textures.length > 0) {
    const texInfo = textures[0]
    const imgBlock = new ImageBlock()
    imgBlock.name = texInfo.name || 'BaseColor'
    imgBlock.type = ImageTypes.URL
    imgBlock.url = texInfo.dataUrl
    imgBlock.update()
    lib.add(imgBlock)

    mat = new Material()
    mat.name = blockName(filename) + '_Mat'

    const geom = new GeometryNode()
    const attr = new AttributeNode()
    attr.attrName = 'uv'
    attr.category = AttributeCategory.UV

    const imgNode = new ImageNode()
    imgNode.imageUser.image = imgBlock

    const diff = new DiffuseNode()
    const output = new OutputNode()

    mat.graph.add(geom)
    mat.graph.add(attr)
    mat.graph.add(imgNode)
    mat.graph.add(diff)
    mat.graph.add(output)

    attr.graph_ui_pos[0] = -500
    attr.graph_ui_pos[1] = 0
    imgNode.graph_ui_pos[0] = -250
    imgNode.graph_ui_pos[1] = 0
    geom.graph_ui_pos[0] = -250
    geom.graph_ui_pos[1] = 200
    diff.graph_ui_pos[0] = 50
    diff.graph_ui_pos[1] = 0
    output.graph_ui_pos[0] = 300
    output.graph_ui_pos[1] = 0

    attr.outputs.vector.connect(imgNode.inputs.uv)
    imgNode.outputs.color.connect(diff.inputs.color)
    geom.outputs.normal.connect(diff.inputs.normal)
    diff.outputs.surface.connect(output.inputs.surface)
  } else if (data.mesh.attrs.has(Domain.VERT, 'color')) {
    mat = new Material()
    mat.name = blockName(filename) + '_Mat'

    const geom = new GeometryNode()
    const attr = new AttributeNode()
    attr.attrName = 'color'
    attr.category = AttributeCategory.COLOR

    const diff = new DiffuseNode()
    const output = new OutputNode()

    mat.graph.add(geom)
    mat.graph.add(attr)
    mat.graph.add(diff)
    mat.graph.add(output)

    attr.graph_ui_pos[0] = -250
    attr.graph_ui_pos[1] = 0
    geom.graph_ui_pos[0] = -250
    geom.graph_ui_pos[1] = 200
    diff.graph_ui_pos[0] = 50
    diff.graph_ui_pos[1] = 0
    output.graph_ui_pos[0] = 300
    output.graph_ui_pos[1] = 0

    attr.outputs.color.connect(diff.inputs.color)
    geom.outputs.normal.connect(diff.inputs.normal)
    diff.outputs.surface.connect(output.inputs.surface)
  } else {
    mat = makeDefaultMaterial()
    if (baseColorFactor) {
      for (const n of mat.graph.nodes) {
        if (n instanceof DiffuseNode) {
          n.inputs.color.setValue(baseColorFactor)
        }
      }
    }
  }

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

import type {Tri} from './triangulate.js'
import {TriangulationCache} from './triangulate.js'
import {buildDrawGeometry, gatherDrawAttr} from './draw_buffers.js'
import {buildGlbBinary, exportTrianglesToGLB, type GlbBinaryOptions} from './glb_binary.js'
export {buildGlbBinary, exportTrianglesToGLB} from './glb_binary.js'

export function exportLeafMeshToGLB(
  data: LeafMeshData,
  name = 'Model',
  material?: Material
): Uint8Array {
  const mesh = data.mesh
  const cache = new TriangulationCache()
  const tris: Tri[] = []
  for (const f of mesh.f) {
    for (const tri of cache.get(mesh, f)) {
      tris.push(tri)
    }
  }

  if (tris.length === 0) {
    const minPos = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0])
    const minNorm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])
    const minIdx = new Uint16Array([0, 1, 2])
    return buildGlbBinary(name, minPos, minNorm, minIdx)
  }

  const {position, normal} = buildDrawGeometry(mesh, tris)
  const vertCount = tris.length * 3
  const isLarge = vertCount >= 65535
  const indices = isLarge ? new Uint32Array(vertCount) : new Uint16Array(vertCount)
  for (let i = 0; i < vertCount; i++) {
    indices[i] = i
  }

  const uv = gatherDrawAttr(mesh, tris, 'uv', 2)

  let textureBytes: Uint8Array | undefined
  let textureMimeType: string | undefined
  let baseColorFactor: [number, number, number, number] | undefined

  const mat = material || (data as any).material
  if (mat && mat.graph) {
    for (const node of mat.graph.nodes) {
      if ((node instanceof ImageNode || (node as any).constructor?.name === 'ImageNode') && (node as any).image) {
        const imgBlock = (node as any).image
        const url: string = imgBlock.url || imgBlock.data || ''
        if (url && url.startsWith('data:')) {
          try {
            const [header, b64] = url.split(',')
            textureMimeType = header.split(':')[1]?.split(';')[0] || 'image/png'
            const raw = atob(b64)
            textureBytes = new Uint8Array(raw.length)
            for (let i = 0; i < raw.length; i++) {
              textureBytes[i] = raw.charCodeAt(i)
            }
          } catch {}
          break
        }
      }
    }
  }

  return buildGlbBinary(name, position, normal, indices, {
    uv,
    textureBytes,
    textureMimeType,
    baseColorFactor,
  })
}

export function exportSceneToGLB(ctx: ToolContext, name = 'SceneModel'): Uint8Array {
  const sceneObs = ctx.scene?.objects ? [...ctx.scene.objects] : []
  const meshObs = sceneObs.filter(
    (o: any) => o.data instanceof LeafMeshData || triangleSourceOf(o?.data)
  )

  if (meshObs.length === 0) {
    return new Uint8Array()
  }

  if (meshObs.length === 1) {
    const ob = meshObs[0]
    if (ob.data instanceof LeafMeshData) {
      return exportLeafMeshToGLB(ob.data, ob.name || name, (ob as any).material || ob.data.material)
    }
    const src = triangleSourceOf(ob?.data)
    if (src) {
      return exportTrianglesToGLB(src.extractTriangles(), ob.name || name)
    }
  }

  // Multi-object scene: merge all meshes in world space
  const allPositions: number[] = []
  const allNormals: number[] = []
  const allUVs: number[] = []
  let hasAnyUV = false
  let sharedTexBytes: Uint8Array | undefined
  let sharedMimeType: string | undefined

  for (const ob of meshObs) {
    const worldMatrix = (ob as any).outputs?.matrix?.getValue?.() || (ob as any).matrix
    if (ob.data instanceof LeafMeshData) {
      const mesh = ob.data.mesh
      const cache = new TriangulationCache()
      const tris: Tri[] = []
      for (const f of mesh.f) {
        for (const tri of cache.get(mesh, f)) {
          tris.push(tri)
        }
      }
      if (tris.length === 0) continue

      const {position, normal} = buildDrawGeometry(mesh, tris)
      const uv = gatherDrawAttr(mesh, tris, 'uv', 2)
      if (uv) hasAnyUV = true

      const v = new Vector3()
      const n = new Vector3()
      for (let i = 0; i < position.length; i += 3) {
        v.loadXYZ(position[i], position[i + 1], position[i + 2])
        if (worldMatrix) v.multVecMatrix(worldMatrix)
        allPositions.push(v[0], v[1], v[2])

        n.loadXYZ(normal[i], normal[i + 1], normal[i + 2])
        if (worldMatrix) {
          n.multVecMatrix(worldMatrix)
          n.normalize()
        }
        allNormals.push(n[0], n[1], n[2])

        const uvIdx = Math.floor(i / 3) * 2
        if (uv && uvIdx + 1 < uv.length) {
          allUVs.push(uv[uvIdx], uv[uvIdx + 1])
        } else {
          allUVs.push(0, 0)
        }
      }

      if (!sharedTexBytes) {
        const mat = (ob as any).material || ob.data.material
        if (mat?.graph) {
          for (const node of mat.graph.nodes) {
            if ((node instanceof ImageNode || (node as any).constructor?.name === 'ImageNode') && (node as any).image) {
              const url = (node as any).image.url || ''
              if (url.startsWith('data:')) {
                try {
                  const [header, b64] = url.split(',')
                  sharedMimeType = header.split(':')[1]?.split(';')[0] || 'image/png'
                  const raw = atob(b64)
                  sharedTexBytes = new Uint8Array(raw.length)
                  for (let k = 0; k < raw.length; k++) sharedTexBytes[k] = raw.charCodeAt(k)
                } catch {}
                break
              }
            }
          }
        }
      }
    }
  }

  if (allPositions.length === 0) {
    return new Uint8Array()
  }

  const vertCount = (allPositions.length / 3) | 0
  const isLarge = vertCount >= 65535
  const indices = isLarge ? new Uint32Array(vertCount) : new Uint16Array(vertCount)
  for (let i = 0; i < vertCount; i++) indices[i] = i

  return buildGlbBinary(
    name,
    new Float32Array(allPositions),
    new Float32Array(allNormals),
    indices,
    {
      uv: hasAnyUV ? new Float32Array(allUVs) : undefined,
      textureBytes: sharedTexBytes,
      textureMimeType: sharedMimeType,
    }
  )
}

export const LEAFMESH_GLB_FORMAT: IFileFormat<ToolContext> = {
  id: 'glb',
  uiName: 'glTF 2.0 Binary / Model',
  extensions: ['.glb', '.gltf'],

  importFromBytes(ctx, bytes, filename) {
    importGLBIntoScene(ctx, bytes, filename)
  },

  exportToBytes(ctx) {
    return exportSceneToGLB(ctx, 'SceneModel')
  },
}
