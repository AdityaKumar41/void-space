import {deformationSource} from '../core/deformation_sources'
import {
  readWorkflow,
  writeWorkflow,
  deformPositions,
  skinPositions,
  sampleKeys,
  putKey,
  bakeBoxBodies,
  type ObjectWorkflow,
  type V3,
  type TransformKey,
  type BoxBody,
} from '../core/object_workflows'
import type {SceneObject} from './sceneobject'
import type {ToolContext} from '../core/context'
import type {Scene} from '../scene/scene'
import {Vector3} from '../path.ux/scripts/pathux'

const geometryCache = new WeakMap<object, string>()
export function transformKey(
  object: SceneObject,
  frame: number,
  state = readWorkflow(object.workflow)
): TransformKey {
  return {
    frame,
    location: Array.from(object.location) as V3,
    rotation: Array.from(object.rotationEuler) as V3,
    scale   : Array.from(object.scale) as V3,
    pose    : state.rig?.bones.map((b) => [...b.rotation] as V3),
  }
}
export function captureBase(
  ctx: ToolContext,
  ob: SceneObject,
  state: ObjectWorkflow
): void {
  if (state.base) return
  const source = deformationSource(ob.data)
  if (!source) throw new Error('This object does not support mesh deformation')
  let base = source.capture()
  if (!base.handles.length) throw new Error('The mesh has no vertices')
  if (ob.data.lib_users > 1) {
    const previous = ob.data,
      copy = previous.copy() as typeof previous
    ctx.datalib.add(copy)
    for (const edge of [...ob.outputs.depend.edges]) {
      if (edge.node === previous) ob.outputs.depend.disconnect(edge)
    }
    previous.lib_remUser(ob)
    copy.lib_addUser(ob)
    ob.data = copy
    ob.ensureGraphConnection()
    base = deformationSource(copy)!.capture()
  }
  state.base = base
}
export function evaluateWorkflow(
  ob: SceneObject,
  frame: number,
  force = false,
  applyKeys = true
): void {
  if (!ob.workflow) return
  const state = readWorkflow(ob.workflow),
    key = sampleKeys(state.keys, frame, state.interpolation)
  if (key && applyKeys) {
    ob.inputs.loc.setValue(new Vector3(key.location))
    ob.inputs.rot.setValue(new Vector3(key.rotation))
    ob.inputs.scale.setValue(new Vector3(key.scale))
    if (state.rig && key.pose?.length === state.rig.bones.length) {
      state.rig.bones.forEach((bone, i) => {
        bone.rotation = key.pose![i]
      })
      ob.workflow = writeWorkflow(state)
    }
    ob.graphUpdate()
  }
  if (!state.base) return
  const cacheKey = ob.workflow
  if (!force && geometryCache.get(ob.data) === cacheKey) return
  let positions = state.base.positions
  if (state.rig) positions = skinPositions(positions, state.rig)
  positions = deformPositions(positions, state.modifiers)
  const source = deformationSource(ob.data)
  if (!source) throw new Error('The mesh deformation provider is unavailable')
  source.write(state.base, positions)
  geometryCache.set(ob.data, cacheKey)
}
export function storeWorkflow(
  ob: SceneObject,
  state: ObjectWorkflow,
  frame: number
): void {
  ob.workflow = writeWorkflow(state)
  evaluateWorkflow(ob, frame, true, false)
  ob.graphUpdate()
  window.updateDataGraph?.(true)
  window.redraw_viewport?.(true)
}
export function bakeScenePhysics(scene: Scene, gravity: number): void {
  const start = Math.round(scene.timeStart),
    end = Math.round(scene.timeEnd)
  scene.changeTime(start)
  const bodies: BoxBody[] = [],
    offsets = new Map<number, V3>(),
    states = new Map<number, ObjectWorkflow>()
  for (const ob of scene.objects) {
    const state = readWorkflow(ob.workflow)
    if (!state.body) continue
    if (ob.inputs.matrix.edges.length)
      throw new Error('Unparent rigid bodies before baking')
    const bounds = ob.data.getBoundingBox()
    if (!bounds) throw new Error(`No collision bounds for ${ob.name}`)
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity]
    for (let corner = 0; corner < 8; corner++) {
      const point = new Vector3([
        bounds[corner & 1 ? 1 : 0][0],
        bounds[corner & 2 ? 1 : 0][1],
        bounds[corner & 4 ? 1 : 0][2],
      ])
      point.multVecMatrix(ob.outputs.matrix.getValue())
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], point[k]!)
        max[k] = Math.max(max[k], point[k]!)
      }
    }
    const position = min.map((value, k) => (value + max[k]) / 2) as V3
    offsets.set(
      ob.lib_id,
      position.map((value, k) => value - ob.location[k]) as V3
    )
    bodies.push({
      id: ob.lib_id,
      position,
      half: min.map((value, k) => Math.max(0.01, (max[k] - value) / 2)) as V3,
      mass       : state.body.mass,
      dynamic    : state.body.type === 'ACTIVE',
      restitution: state.body.restitution,
      friction   : state.body.friction,
    })
    states.set(ob.lib_id, state)
  }
  if (!bodies.some((body) => body.dynamic))
    throw new Error('Add an active rigid body before baking')
  const samples = bakeBoxBodies(bodies, end - start + 1, scene.fps, gravity)
  for (const ob of scene.objects) {
    const state = states.get(ob.lib_id)
    if (!state || state.body!.type !== 'ACTIVE') continue
    const template = transformKey(ob, start, state)
    state.keys = state.keys.filter(
      (key) => key.frame < start || key.frame > end
    )
    for (const [index, position] of samples.get(ob.lib_id)!.entries()) {
      state.keys = putKey(state.keys, {
        ...template,
        frame   : start + index,
        location: position.map(
          (value, k) => value - offsets.get(ob.lib_id)![k]
        ) as V3,
      })
    }
    ob.workflow = writeWorkflow(state)
  }
  scene.changeTime(start)
}
