/**
 * OBJ import, host-facing half — P11 §6. The parse lives in `obj_read.ts`,
 * which imports nothing from `scripts/`; this file turns the result into a
 * scene object and hands the format to the registry.
 *
 * Registration goes through `AddonAPI.registerFileFormat`, so disabling the
 * addon removes the importer rather than leaving a menu entry that throws.
 * FBX is deliberately out of scope (§6).
 */

import type {IFileFormat, ToolContext} from '@framework/api'
import {InvalidationKind, SceneObject, makeDefaultMaterial, triangleSourceOf} from '@framework/api'

import {LeafMeshData} from './leafmesh.js'
import type {ObjReadStats} from './obj_read.js'
import {readOBJ, exportTrianglesToOBJ} from './obj_read.js'
export {exportTrianglesToOBJ}

/** Strip the directory and the extension: `models/head.obj` → `head`. */
function blockName(filename: string | undefined): string {
  if (filename === undefined || filename.length === 0) {
    return 'OBJ'
  }

  const base = filename.slice(Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base) || 'OBJ'
}

export interface ObjImportResult {
  data: LeafMeshData
  stats: ObjReadStats
}

/** Decode and parse, without touching the scene — the testable half of import. */
export function leafMeshFromOBJ(bytes: Uint8Array, filename?: string): ObjImportResult {
  const data = new LeafMeshData()
  const {stats} = readOBJ(new TextDecoder().decode(bytes), data.mesh)

  data.name = blockName(filename)
  data.invalidate(InvalidationKind.ALL)

  return {data, stats}
}

/**
 * Import into `ctx`'s scene as a new selected, active object, the way the
 * default-scene builder does it.
 */
export function importOBJIntoScene(ctx: ToolContext, bytes: Uint8Array, filename?: string): LeafMeshData {
  const {data, stats} = leafMeshFromOBJ(bytes, filename)
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
    console.warn(`OBJ import: ${stats.warnings.length} problem(s)`, stats.warnings)
  }
  ctx.message?.(`Imported ${stats.verts} vertices, ${stats.faces} faces`)

  return data
}

import type {Tri} from './triangulate.js'
import {TriangulationCache} from './triangulate.js'

export function exportLeafMeshToOBJ(data: LeafMeshData, name = 'Model'): string {
  const mesh = data.mesh
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

  let out = `# Exported by VOID·STUDIO 1.0\no ${name}\n`
  const co = mesh.v.co
  for (const v of vertHandles) {
    const i = v * 3
    out += `v ${co[i].toFixed(6)} ${co[i + 1].toFixed(6)} ${co[i + 2].toFixed(6)}\n`
  }

  for (const tri of tris) {
    const i0 = (handleToIdx.get(tri.v[0]) ?? tri.v[0]) + 1
    const i1 = (handleToIdx.get(tri.v[1]) ?? tri.v[1]) + 1
    const i2 = (handleToIdx.get(tri.v[2]) ?? tri.v[2]) + 1
    out += `f ${i0} ${i1} ${i2}\n`
  }
  return out
}

export const LEAFMESH_OBJ_FORMAT: IFileFormat<ToolContext> = {
  id        : 'obj',
  uiName    : 'Wavefront OBJ',
  extensions: ['.obj'],

  importFromBytes(ctx, bytes, filename) {
    importOBJIntoScene(ctx, bytes, filename)
  },

  exportToBytes(ctx) {
    const ob = ctx.scene?.objects?.active || [...(ctx.scene?.objects || [])].find((o: any) => o.data instanceof LeafMeshData || triangleSourceOf(o?.data))
    if (ob && ob.data instanceof LeafMeshData) {
      return exportLeafMeshToOBJ(ob.data, ob.name || 'Model')
    }
    const src = triangleSourceOf(ob?.data)
    if (src) {
      const tris = src.extractTriangles()
      return exportTrianglesToOBJ(tris, ob?.name || 'Model')
    }
    return ''
  },
}
