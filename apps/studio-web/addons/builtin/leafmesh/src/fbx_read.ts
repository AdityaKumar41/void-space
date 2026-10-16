/**
 * Pure FBX Reader (Binary FBX 6.x/7.x & ASCII FBX) and FBX ASCII Writer for LeafMesh.
 *
 * Imports nothing from `@framework/api` or `scripts/`, only LeafMesh topology and local inflate.
 */

import {AttrType, Domain} from './attrs.js'
import {ELEM_NONE} from './elem_array.js'
import {unzlibSync} from './inflate.js'
import type {LeafMesh} from './topo.js'
import type {Tri} from './triangulate.js'
import {TriangulationCache} from './triangulate.js'

export const FBX_UV_LAYER = 'uv'

export interface FbxReadStats {
  verts: number
  faces: number
  hasUVs: boolean
  isBinary: boolean
  version: number
  warnings: string[]
}

export interface FbxNode {
  name: string
  props: any[]
  children: FbxNode[]
}

const BINARY_MAGIC = 'Kaydara FBX Binary  \x00\x1a\x00'

function isBinaryFBX(bytes: Uint8Array): boolean {
  if (bytes.length < BINARY_MAGIC.length) return false
  for (let i = 0; i < BINARY_MAGIC.length; i++) {
    if (bytes[i] !== BINARY_MAGIC.charCodeAt(i)) return false
  }
  return true
}

/** Binary FBX Parser */
class BinaryFbxParser {
  private view: DataView
  private bytes: Uint8Array
  private is64Bit: boolean
  private version: number

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.version = this.view.getUint32(23, true)
    this.is64Bit = this.version >= 7500
  }

  getVersion(): number {
    return this.version
  }

  parseProperty(offset: number): {val: any; next: number} {
    const typeCode = String.fromCharCode(this.view.getUint8(offset))
    offset += 1

    switch (typeCode) {
      case 'Y':
        return {val: this.view.getInt16(offset, true), next: offset + 2}
      case 'C':
        return {val: this.view.getUint8(offset) !== 0, next: offset + 1}
      case 'I':
        return {val: this.view.getInt32(offset, true), next: offset + 4}
      case 'F':
        return {val: this.view.getFloat32(offset, true), next: offset + 4}
      case 'D':
        return {val: this.view.getFloat64(offset, true), next: offset + 8}
      case 'L':
        return {val: Number(this.view.getBigInt64(offset, true)), next: offset + 8}
      case 'R': {
        const len = this.view.getUint32(offset, true)
        return {val: this.bytes.subarray(offset + 4, offset + 4 + len), next: offset + 4 + len}
      }
      case 'S': {
        const len = this.view.getUint32(offset, true)
        const str = new TextDecoder().decode(this.bytes.subarray(offset + 4, offset + 4 + len))
        return {val: str, next: offset + 4 + len}
      }
      case 'f':
      case 'd':
      case 'l':
      case 'i':
      case 'b': {
        const arrayLength = this.view.getUint32(offset, true)
        const encoding = this.view.getUint32(offset + 4, true)
        const compressedLength = this.view.getUint32(offset + 8, true)
        offset += 12

        let raw = this.bytes.subarray(offset, offset + compressedLength)
        if (encoding === 1) {
          raw = unzlibSync(raw)
        }

        let arrayData: any
        const rawBuf = raw.buffer
        const rawOffset = raw.byteOffset

        if (typeCode === 'd') {
          arrayData = new Float64Array(rawBuf, rawOffset, arrayLength)
        } else if (typeCode === 'f') {
          arrayData = new Float32Array(rawBuf, rawOffset, arrayLength)
        } else if (typeCode === 'i') {
          arrayData = new Int32Array(rawBuf, rawOffset, arrayLength)
        } else if (typeCode === 'l') {
          const bArr = new BigInt64Array(rawBuf, rawOffset, arrayLength)
          arrayData = new Float64Array(arrayLength)
          for (let k = 0; k < arrayLength; k++) arrayData[k] = Number(bArr[k])
        } else {
          arrayData = new Uint8Array(rawBuf, rawOffset, arrayLength)
        }

        return {val: arrayData, next: offset + compressedLength}
      }
      default:
        throw new Error(`Unsupported FBX property type: ${typeCode}`)
    }
  }

  parseNodes(start: number, end: number): FbxNode[] {
    const nodes: FbxNode[] = []
    let off = start

    while (off < end) {
      const headerSize = this.is64Bit ? 25 : 13
      if (off + headerSize > end) break

      let endOffset: number
      let numProperties: number
      let nameLen: number

      if (this.is64Bit) {
        endOffset = Number(this.view.getBigUint64(off, true))
        numProperties = Number(this.view.getBigUint64(off + 8, true))
        nameLen = this.view.getUint8(off + 24)
        off += 25
      } else {
        endOffset = this.view.getUint32(off, true)
        numProperties = this.view.getUint32(off + 4, true)
        nameLen = this.view.getUint8(off + 12)
        off += 13
      }

      if (endOffset === 0 && nameLen === 0) {
        // Null sentinel marking end of child list
        break
      }

      const name = new TextDecoder().decode(this.bytes.subarray(off, off + nameLen))
      off += nameLen

      const props: any[] = []
      for (let p = 0; p < numProperties; p++) {
        const res = this.parseProperty(off)
        props.push(res.val)
        off = res.next
      }

      let children: FbxNode[] = []
      if (off < endOffset) {
        children = this.parseNodes(off, endOffset)
      }

      nodes.push({name, props, children})
      off = endOffset
    }

    return nodes
  }

  getRootNodes(): FbxNode[] {
    return this.parseNodes(27, this.bytes.length)
  }
}

/** Helper to find child nodes */
function findNode(nodes: FbxNode[], name: string): FbxNode | undefined {
  return nodes.find((n) => n.name === name)
}

function findNodes(nodes: FbxNode[], name: string): FbxNode[] {
  return nodes.filter((n) => n.name === name)
}

/** Parse ASCII FBX format */
function parseAsciiFBX(text: string): FbxNode[] {
  const root: FbxNode = {name: 'Root', props: [], children: []}
  const stack: FbxNode[] = [root]

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim()
    if (!rawLine || rawLine.startsWith(';')) continue

    if (rawLine === '}') {
      if (stack.length > 1) stack.pop()
      continue
    }

    const colonIdx = rawLine.indexOf(':')
    if (colonIdx > 0) {
      const nodeName = rawLine.slice(0, colonIdx).trim()
      let rest = rawLine.slice(colonIdx + 1).trim()
      const isBlockOpen = rest.endsWith('{')
      if (isBlockOpen) {
        rest = rest.slice(0, -1).trim()
      }

      // Read array contents if block starts with 'a:'
      let props: any[] = []
      if (rest) {
        const parts = rest.split(',').map((p) => p.trim().replace(/^"|"$/g, ''))
        props = parts.map((p) => {
          const num = Number(p)
          return isNaN(num) ? p : num
        })
      }

      // Check if multi-line array
      if (isBlockOpen && (nodeName === 'Vertices' || nodeName === 'PolygonVertexIndex' || nodeName === 'UV' || nodeName === 'UVIndex' || nodeName === 'Normals')) {
        let arrayStr = ''
        let j = i + 1
        while (j < lines.length) {
          const aLine = lines[j].trim()
          if (aLine.startsWith('a:')) {
            arrayStr += aLine.slice(2).trim()
          } else if (aLine === '}') {
            i = j
            break
          } else if (arrayStr) {
            arrayStr += ' ' + aLine
          }
          j++
        }
        if (arrayStr) {
          const nums = arrayStr.split(/[\s,]+/).filter(Boolean).map(Number)
          if (nodeName === 'PolygonVertexIndex' || nodeName === 'UVIndex') {
            props = [new Int32Array(nums)]
          } else {
            props = [new Float64Array(nums)]
          }
          stack[stack.length - 1].children.push({name: nodeName, props, children: []})
          continue
        }
      }

      const node: FbxNode = {name: nodeName, props, children: []}
      stack[stack.length - 1].children.push(node)
      if (isBlockOpen) {
        stack.push(node)
      }
    }
  }

  return root.children
}

/** Pure parser that populates a LeafMesh from FBX bytes (Binary or ASCII). */
export function readFBX(bytes: Uint8Array, mesh: LeafMesh): FbxReadStats {
  const stats: FbxReadStats = {
    verts: 0,
    faces: 0,
    hasUVs: false,
    isBinary: false,
    version: 7400,
    warnings: [],
  }

  let rootNodes: FbxNode[]
  if (isBinaryFBX(bytes)) {
    stats.isBinary = true
    const parser = new BinaryFbxParser(bytes)
    stats.version = parser.getVersion()
    rootNodes = parser.getRootNodes()
  } else {
    stats.isBinary = false
    const text = new TextDecoder().decode(bytes)
    rootNodes = parseAsciiFBX(text)
  }

  const objectsNode = findNode(rootNodes, 'Objects')
  if (!objectsNode) {
    stats.warnings.push('No Objects node found in FBX file')
    return stats
  }

  const geomNodes = findNodes(objectsNode.children, 'Geometry')
  if (geomNodes.length === 0) {
    stats.warnings.push('No Geometry node found in FBX Objects')
    return stats
  }

  // Determine global settings (UpAxis: 0=X, 1=Y, 2=Z)
  let upAxis = 1 // default FBX is Y-up
  const globalSettings = findNode(rootNodes, 'GlobalSettings')
  if (globalSettings) {
    const props70 = findNode(globalSettings.children, 'Properties70')
    if (props70) {
      for (const p of props70.children) {
        if (p.name === 'P' && p.props[0] === 'UpAxis') {
          upAxis = Number(p.props[4])
        }
      }
    }
  }

  // Iterate over all Geometry meshes and add to LeafMesh
  for (const geom of geomNodes) {
    const verticesNode = findNode(geom.children, 'Vertices')
    const polyIndexNode = findNode(geom.children, 'PolygonVertexIndex')
    if (!verticesNode || !polyIndexNode) continue

    const vCoords: Float64Array | Float32Array = verticesNode.props[0]
    const pIndices: Int32Array = polyIndexNode.props[0]
    if (!vCoords || !pIndices || vCoords.length === 0 || pIndices.length === 0) continue

    // Extract UVs
    let uvData: Float64Array | Float32Array | undefined
    let uvIndexData: Int32Array | undefined
    let uvMapping = 'ByPolygonVertex'

    const uvNode = findNode(geom.children, 'LayerElementUV')
    if (uvNode) {
      const uvsChild = findNode(uvNode.children, 'UV')
      const uvIdxChild = findNode(uvNode.children, 'UVIndex')
      const mappingChild = findNode(uvNode.children, 'MappingInformationType')
      if (mappingChild && mappingChild.props[0]) {
        uvMapping = String(mappingChild.props[0])
      }
      if (uvsChild && uvsChild.props[0]) {
        uvData = uvsChild.props[0]
      }
      if (uvIdxChild && uvIdxChild.props[0]) {
        uvIndexData = uvIdxChild.props[0]
      }
    }

    // Add Vertices
    const numVerts = Math.floor(vCoords.length / 3)
    const vertHandles: number[] = new Array(numVerts)
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity

    for (let i = 0; i < numVerts; i++) {
      let x = vCoords[i * 3]
      let y = vCoords[i * 3 + 1]
      let z = vCoords[i * 3 + 2]

      // If source FBX is Y-up, convert to VOID·STUDIO Z-up:
      // x' = x, y' = -z, z' = y
      if (upAxis === 1) {
        const tempY = y
        y = -z
        z = tempY
      }

      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)

      const handle = mesh.makeVert([x, y, z])
      vertHandles[i] = handle
      stats.verts++
    }

    // Add Faces and UVs
    const cornerHandles: number[] = []
    const cornerUVs: [number, number][] = []

    let currentRing: number[] = []
    let ringCornerIndices: number[] = []

    for (let i = 0; i < pIndices.length; i++) {
      let rawIdx = pIndices[i]
      let isEnd = rawIdx < 0
      let vertIdx = isEnd ? ~rawIdx : rawIdx

      if (vertIdx >= 0 && vertIdx < vertHandles.length) {
        currentRing.push(vertHandles[vertIdx])
        ringCornerIndices.push(i)
      }

      if (isEnd) {
        if (currentRing.length >= 3) {
          try {
            const f = mesh.makeFace([currentRing])
            if (f !== ELEM_NONE) {
              stats.faces++

              // Collect loop corners for this face
              let loopIdx = 0
              for (const l of mesh.faceLoops(f)) {
                for (const c of mesh.loopCorners(l)) {
                  if (loopIdx < ringCornerIndices.length) {
                    const polyVertIdx = ringCornerIndices[loopIdx]
                    cornerHandles.push(c)

                    let u = 0, v = 0
                    if (uvData && uvData.length > 0) {
                      let uvIndex = -1
                      if (uvIndexData && polyVertIdx < uvIndexData.length) {
                        uvIndex = uvIndexData[polyVertIdx]
                      } else if (uvMapping === 'ByPolygonVertex' || uvMapping === 'ByPolygon') {
                        uvIndex = polyVertIdx
                      } else if (uvMapping === 'ByVertex' || uvMapping === 'ByControlPoint') {
                        uvIndex = vertIdx
                      }

                      if (uvIndex >= 0 && (uvIndex * 2 + 1) < uvData.length) {
                        u = uvData[uvIndex * 2]
                        v = uvData[uvIndex * 2 + 1]
                      }
                    }
                    cornerUVs.push([u, v])
                  }
                  loopIdx++
                }
              }
            }
          } catch {
            // Skip degenerate / non-manifold face
          }
        }
        currentRing = []
        ringCornerIndices = []
      }
    }

    // Apply or generate UV layer
    if (cornerHandles.length > 0) {
      stats.hasUVs = true
      const uvLayer = mesh.attrs.add(Domain.CORNER, FBX_UV_LAYER, AttrType.Float2)
      const data = uvLayer.column.data

      const hasAuthoredUVs = uvData && uvData.length > 0
      const spanX = Math.max(maxX - minX, 1e-4)
      const spanY = Math.max(maxY - minY, 1e-4)
      const spanZ = Math.max(maxZ - minZ, 1e-4)

      for (let i = 0; i < cornerHandles.length; i++) {
        const c = cornerHandles[i]
        if (hasAuthoredUVs) {
          data[c * 2] = cornerUVs[i][0]
          data[c * 2 + 1] = cornerUVs[i][1]
        } else {
          // Automatic box projection UV unwrap fallback
          const vIdx = mesh.c.v[c]
          const co = mesh.v.co
          const px = co[vIdx * 3]
          const py = co[vIdx * 3 + 1]
          const pz = co[vIdx * 3 + 2]
          data[c * 2] = (px - minX) / spanX
          data[c * 2 + 1] = (pz - minZ) / spanZ
        }
      }
    }
  }

  return stats
}

/** Export LeafMesh to standard ASCII FBX 7.4 format */
export function exportLeafMeshToFBX(mesh: LeafMesh, name = 'Model'): string {
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

  const co = mesh.v.co
  const vertCoords: string[] = []
  for (const v of vertHandles) {
    const i = v * 3
    vertCoords.push(`${co[i].toFixed(6)},${co[i + 1].toFixed(6)},${co[i + 2].toFixed(6)}`)
  }

  const polyIndices: number[] = []
  for (const tri of tris) {
    const i0 = handleToIdx.get(tri.v[0]) ?? 0
    const i1 = handleToIdx.get(tri.v[1]) ?? 0
    const i2 = handleToIdx.get(tri.v[2]) ?? 0
    polyIndices.push(i0, i1, ~i2)
  }

  return `; FBX 7.4.0 project file
; Created by VOID·STUDIO

FBXHeaderExtension:  {
  FBXHeaderVersion: 1003
  FBXVersion: 7400
}

GlobalSettings:  {
  Version: 1000
  Properties70:  {
    P: "UpAxis", "int", "Integer", "", 2
    P: "CoordAxis", "int", "Integer", "", 0
  }
}

Objects:  {
  Geometry: 1000001, "Geometry::${name}", "Mesh" {
    Vertices: *${vertCoords.length * 3} {
      a: ${vertCoords.join(',')}
    }
    PolygonVertexIndex: *${polyIndices.length} {
      a: ${polyIndices.join(',')}
    }
  }
  Model: 2000001, "Model::${name}", "Mesh" {
    Version: 232
  }
}

Connections:  {
  C: "OO", 1000001, 2000001
}
`
}
