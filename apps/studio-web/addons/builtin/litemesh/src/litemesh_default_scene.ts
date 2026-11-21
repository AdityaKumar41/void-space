/**
 * LiteMesh default startup scene — Blender Layout parity.
 *
 * Blender's default file opens in Object Mode with a 2 m cube on the grid.
 * Earlier VOID·STUDIO opened a size-16 spherified mesh in Sculpt Mode, which
 * made every AI/import draft look tiny and forced sculpt chrome on first boot.
 */

import type {ToolContext} from '../../../../scripts/core/context'
import type {Library} from '../../../../scripts/core/lib_api'
import type {Scene} from '../../../../scripts/scene/scene'
import {SceneObject} from '../../../../scripts/sceneobject/sceneobject'
import {Light} from '../../../../scripts/light/light.js'
import {makeDefaultMaterial} from '../../../../scripts/core/material'
import {getWasmImmediate} from '@sculptcore/api/api'
import {LiteMesh} from './litemesh'

export function buildLiteMeshDefaultScene(ctx: ToolContext, lib: Library, scene: Scene): void {
  const wasm = getWasmImmediate()!
  // dimen / size / sphere — Blender default cube edge ≈ 2 units; low subdiv for Object Mode.
  const lm = new LiteMesh(wasm.Mesh_createCube(2, 2.0, 0.0))
  lm.name = 'Cube'
  lib.add(lm)

  const mat = makeDefaultMaterial()
  lib.add(mat)
  lm.materials.push(mat)
  mat.lib_addUser(lm)

  const sob = new SceneObject()
  sob.name = 'Cube'
  lib.add(sob)
  sob.data = lm
  lm.lib_addUser(sob)

  scene.add(sob)
  scene.objects.setSelect(sob, true)
  scene.objects.setActive(sob)

  const light = new Light()
  lib.add(light)
  const lightOb = new SceneObject(light)
  lightOb.name = 'Light'
  lib.add(lightOb)
  lightOb.location[2] = 7.0
  scene.add(lightOb)

  sob.graphUpdate()
  lm.graphUpdate()
}
