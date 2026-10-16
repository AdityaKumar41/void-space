/**
 * FBX import/export integration with LeafMesh & ToolContext.
 *
 * Implements IFileFormat for FBX 6.x/7.x (Binary & ASCII), registering with
 * VOID·STUDIO's core file format registry.
 */

import type {IFileFormat, ToolContext} from '@framework/api'
import {InvalidationKind, SceneObject, makeDefaultMaterial, triangleSourceOf} from '@framework/api'

import {LeafMeshData} from './leafmesh.js'
import type {FbxReadStats} from './fbx_read.js'
import {readFBX, exportLeafMeshToFBX} from './fbx_read.js'

export {readFBX, exportLeafMeshToFBX, type FbxReadStats}

function blockName(filename: string | undefined): string {
  if (filename === undefined || filename.length === 0) {
    return 'FBX'
  }
  const base = filename.slice(Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base) || 'FBX'
}

export interface FbxImportResult {
  data: LeafMeshData
  stats: FbxReadStats
}

/** Decode and parse FBX bytes without touching the scene. */
export function leafMeshFromFBX(bytes: Uint8Array, filename?: string): FbxImportResult {
  const data = new LeafMeshData()
  let stats: FbxReadStats = {
    verts: 0,
    faces: 0,
    hasUVs: false,
    isBinary: false,
    version: 7400,
    warnings: [],
  }

  try {
    stats = readFBX(bytes, data.mesh)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('FBX parse error:', err)
  }

  data.name = blockName(filename)
  data.invalidate(InvalidationKind.ALL)
  return {data, stats}
}

/** Import FBX into the active scene as a new selected object. */
export function importFBXIntoScene(ctx: ToolContext, bytes: Uint8Array, filename?: string): LeafMeshData {
  const {data, stats} = leafMeshFromFBX(bytes, filename)
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

  if (stats.warnings.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`FBX import: ${stats.warnings.length} problem(s)`, stats.warnings)
  }
  ctx.message?.(`Imported FBX: ${stats.verts} vertices, ${stats.faces} faces${stats.hasUVs ? ' (with UVs)' : ''}`)

  return data
}

export const LEAFMESH_FBX_FORMAT: IFileFormat<ToolContext> = {
  id: 'fbx',
  uiName: 'Autodesk FBX',
  extensions: ['.fbx'],

  importFromBytes(ctx, bytes, filename) {
    importFBXIntoScene(ctx, bytes, filename)
  },

  exportToBytes(ctx) {
    const ob =
      ctx.scene?.objects?.active ||
      [...(ctx.scene?.objects || [])].find((o: any) => o.data instanceof LeafMeshData || triangleSourceOf(o?.data))

    if (ob && ob.data instanceof LeafMeshData) {
      return exportLeafMeshToFBX(ob.data.mesh, ob.name || 'Model')
    }
    return ''
  },
}
