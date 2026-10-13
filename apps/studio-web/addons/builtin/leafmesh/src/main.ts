/**
 * LeafMesh addon entry point.
 *
 * Loaded as its own out-of-bundle esbuild build (`build/addons/leafmesh/`), not
 * compiled into the main bundle — LeafMesh is a leaf with no host imports, so
 * there is nothing forcing it in-bundle the way mesh/sculptcore are forced.
 * That also makes it the stronger proof of success criterion 12: its modules
 * physically cannot reach `scripts/` internals by relative path.
 *
 * `"dependencies": []` — the first builtin with none. See P11 §4.
 *
 * This module registers the kind descriptor, the data class, the OBJ importer,
 * the modeling toolmode with its selection ops (P12), and the UV source (P18).
 */

import type {AddonAPI, IAddon, IAddonDefine} from '@framework/api'
import {LEAFMESH_VERTEX_ATTRS} from './draw.js'
import {runLeafMeshHeadlessDemo} from './headless_demo.js'
import * as leafmesh from './index.js'
import {LEAFMESH_CAPABILITIES, LeafMeshData, LeafMeshSymmetry} from './leafmesh.js'
import {buildLeafMeshDefaultScene} from './leafmesh_default_scene.js'
// Side-effect: registers globalThis.__uvsourceLeafMesh for the IUVSource suite.
import './leafmesh_uvsource_support.js'
import {LEAFMESH_MODELING_OPS} from './modeling_ops.js'
import {LEAFMESH_OBJ_FORMAT} from './obj.js'
import {LEAFMESH_GLB_FORMAT} from './glb.js'
import {LEAFMESH_STL_FORMAT} from './stl.js'
import {LEAFMESH_PLY_FORMAT} from './ply.js'
import {LEAFMESH_PRIMITIVE_OPS} from './primitive_ops.js'
import {LEAFMESH_SELECT_OPS} from './select_ops.js'
import {LeafMeshToolMode} from './toolmode.js'
import {LeafMeshTransType} from './transtype.js'
import {LEAFMESH_UV_PROVIDER} from './uv_source.js'

export const addonDefine: IAddonDefine = {
  name       : 'Leaf Mesh',
  version    : [1, 0, 0],
  author     : 'joeedh',
  description: 'Corner-based polygon mesh geometry type.',
}

export function register(api: AddonAPI<IAddon>) {
  // Keep in sync with addons/builtin/leafmesh/src/api.ts.
  api.exportNamespace('leafmesh', {
    ...leafmesh,
    LEAFMESH_CAPABILITIES,
    LeafMeshData,
    LeafMeshSymmetry,
    runLeafMeshHeadlessDemo,
  })
  api.register(LeafMeshData)

  // Declaring a capability is what makes `asElementSource` and friends return
  // non-undefined, so this list and leafmesh.ts's AssertExtends block have to
  // agree; they share LEAFMESH_CAPABILITIES so that they cannot drift.
  api.registerDataKind({
    id              : 'leafmesh',
    uiName          : 'Leaf Mesh',
    factory         : LeafMeshData,
    capabilities    : LEAFMESH_CAPABILITIES,
    usesMaterial    : true,
    vertexAttrs     : LEAFMESH_VERTEX_ATTRS,
    importExtensions: [
      ...LEAFMESH_OBJ_FORMAT.extensions,
      ...LEAFMESH_GLB_FORMAT.extensions,
      ...LEAFMESH_STL_FORMAT.extensions,
      ...LEAFMESH_PLY_FORMAT.extensions,
    ],
  })

  // The format registry is what a file dialog reads; the kind's
  // `importExtensions` above is what a "which kind claims this file" query
  // reads. Both point at the same parser (P11 §6).
  api.registerFileFormat(LEAFMESH_OBJ_FORMAT)
  api.registerFileFormat(LEAFMESH_GLB_FORMAT)
  api.registerFileFormat(LEAFMESH_STL_FORMAT)
  api.registerFileFormat(LEAFMESH_PLY_FORMAT)

  // The modeling toolmode, its selection ops (P12 step 1) and its topology ops
  // (step 4). One `register` dispatch each — no module-scope side effect.
  api.registerAll(
    LeafMeshToolMode,
    ...LEAFMESH_SELECT_OPS,
    ...LEAFMESH_MODELING_OPS,
    ...LEAFMESH_PRIMITIVE_OPS
  )

  // Contribute primitives to the View3D "Add" menu & Shift-A popup
  api.menuEntries('add', [
    'leafmesh.add_cube()|Mesh: Cube',
    'leafmesh.add_uv_sphere()|Mesh: UV Sphere',
    'leafmesh.add_icosphere()|Mesh: Ico Sphere',
    'leafmesh.add_cylinder()|Mesh: Cylinder',
    'leafmesh.add_cone()|Mesh: Cone',
    'leafmesh.add_torus()|Mesh: Torus',
    'leafmesh.add_plane()|Mesh: Plane',
    'leafmesh.add_grid()|Mesh: Grid',
    'leafmesh.add_monkey()|Mesh: Monkey (Suzanne)',
    'leafmesh.add_tube()|Mesh: Tube',
  ])

  // Implementor #2 of `ITransDataType` (P12 §6) — grab/rotate/scale, snapping
  // and proportional edit, with `transform_ops.ts` naming no geometry type.
  api.registerTransType(LeafMeshTransType)

  // Implementor #1 of `IUVSource` (P18 §5 step 2). Registered, not narrowed:
  // the source is an adapter, so it cannot be found by a capability query.
  api.registerUVSource(LEAFMESH_UV_PROVIDER)

  // The startup file `void-studio-core` selects (P17 §3).
  api.registerDefaultSceneBuilder('leafmesh-cube', buildLeafMeshDefaultScene, 'leafmesh')
}

export function unregister() {}
export function handleArgv() {}
export function validArgv() {}

export {LEAFMESH_OBJ_FORMAT, LEAFMESH_GLB_FORMAT, LEAFMESH_STL_FORMAT, LEAFMESH_PLY_FORMAT}
