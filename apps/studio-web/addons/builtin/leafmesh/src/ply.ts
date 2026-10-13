/**
 * Stanford PLY (ASCII & Binary) format integration with LeafMesh & ToolContext.
 */

import type {IFileFormat, ToolContext} from '@framework/api'
import {InvalidationKind, SceneObject, makeDefaultMaterial, triangleSourceOf} from '@framework/api'

import {LeafMeshData} from './leafmesh.js'
import type {PlyReadStats} from './ply_format.js'
import {readPLY, writePLY, exportTrianglesToPLY} from './ply_format.js'

export {readPLY, writePLY, exportTrianglesToPLY, type PlyReadStats}

function blockName(filename: string | undefined): string {
  if (filename === undefined || filename.length === 0) {
    return 'PLY'
  }
  const base = filename.slice(Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base) || 'PLY'
}

export interface PlyImportResult {
  data: LeafMeshData
  stats: PlyReadStats
}

export function leafMeshFromPLY(bytes: Uint8Array, filename?: string): PlyImportResult {
  const data = new LeafMeshData()
  let stats: PlyReadStats = {verts: 0, faces: 0}
  try {
    stats = readPLY(bytes, data.mesh)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('PLY parse error:', err)
  }
  data.name = blockName(filename)
  data.invalidate(InvalidationKind.ALL)
  return {data, stats}
}

export function importPLYIntoScene(ctx: ToolContext, bytes: Uint8Array, filename?: string): LeafMeshData {
  const {data, stats} = leafMeshFromPLY(bytes, filename)
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

  ctx.message?.(`Imported ${stats.verts} vertices, ${stats.faces} faces from PLY`)
  return data
}

export function exportLeafMeshToPLY(data: {mesh: any}, name = 'Model'): string {
  return writePLY(data.mesh, name)
}

export const LEAFMESH_PLY_FORMAT: IFileFormat<ToolContext> = {
  id        : 'ply',
  uiName    : 'Stanford PLY',
  extensions: ['.ply'],

  importFromBytes(ctx, bytes, filename) {
    importPLYIntoScene(ctx, bytes, filename)
  },

  exportToBytes(ctx) {
    const ob = ctx.scene?.objects?.active || [...(ctx.scene?.objects || [])].find((o: any) => o.data?.mesh || triangleSourceOf(o?.data))
    if (ob?.data?.mesh) {
      return exportLeafMeshToPLY(ob.data, ob.name || 'Model')
    }
    const src = triangleSourceOf(ob?.data)
    if (src) {
      const tris = src.extractTriangles()
      return exportTrianglesToPLY(tris, ob?.name || 'Model')
    }
    return ''
  },
}
