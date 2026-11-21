/** Serializable browser authoring data and deterministic, engine-independent evaluators. */
export type V3 = [number, number, number]
export interface TransformKey {
  frame: number
  location: V3
  rotation: V3
  scale: V3
  pose?: V3[]
}
export interface DeformModifier {
  type: 'TWIST' | 'TAPER' | 'BEND'
  amount: number
  axis: 0 | 1 | 2
  enabled: boolean
}
export interface Bone {
  name: string
  parent: number
  head: V3
  tail: V3
  rotation: V3
}
export interface Rig {
  bones: Bone[]
  weights: {bone: number; weight: number}[][]
}
export interface GeometryBase {
  handles: number[]
  positions: number[]
}
export interface BodySettings {
  type: 'ACTIVE' | 'PASSIVE'
  mass: number
  restitution: number
  friction: number
}
export interface ObjectWorkflow {
  version: 1
  modifiers: DeformModifier[]
  keys: TransformKey[]
  interpolation: 'LINEAR' | 'CONSTANT'
  base?: GeometryBase
  rig?: Rig
  body?: BodySettings
}
export const newWorkflow = (): ObjectWorkflow => ({
  version      : 1,
  modifiers    : [],
  keys         : [],
  interpolation: 'LINEAR',
})
export function readWorkflow(json: string | undefined): ObjectWorkflow {
  if (!json) return newWorkflow()
  const data = JSON.parse(json) as ObjectWorkflow
  if (
    data.version !== 1 ||
    !Array.isArray(data.modifiers) ||
    !Array.isArray(data.keys)
  )
    throw new Error('Unsupported object authoring data')
  return data
}
export function putKey(
  keys: TransformKey[],
  key: TransformKey
): TransformKey[] {
  return [...keys.filter((k) => k.frame !== key.frame), key].sort(
    (a, b) => a.frame - b.frame
  )
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const mix3 = (a: V3, b: V3, t: number): V3 =>
  a.map((v, i) => lerp(v, b[i], t)) as V3
export function sampleKeys(
  keys: TransformKey[],
  frame: number,
  interpolation = 'LINEAR'
): TransformKey | undefined {
  if (!keys.length) return undefined
  if (frame <= keys[0].frame) return keys[0]
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i],
      a = keys[i - 1]
    if (frame > b.frame) continue
    if (frame === b.frame) return b
    if (interpolation === 'CONSTANT') return a
    const t = (frame - a.frame) / (b.frame - a.frame)
    return {
      frame,
      location: mix3(a.location, b.location, t),
      rotation: mix3(a.rotation, b.rotation, t),
      scale   : mix3(a.scale, b.scale, t),
      pose:
        a.pose && b.pose && a.pose.length === b.pose.length
          ? a.pose.map((p, j) => mix3(p, b.pose![j], t))
          : a.pose,
    }
  }
  return keys[keys.length - 1]
}

export function deformPositions(
  base: ArrayLike<number>,
  modifiers: readonly DeformModifier[]
): number[] {
  const out = Array.from(base)
  for (const modifier of modifiers) {
    if (!modifier.enabled || modifier.amount === 0) continue
    const axis = modifier.axis,
      a = (axis + 1) % 3,
      b = (axis + 2) % 3
    for (let i = 0; i < out.length; i += 3) {
      const h = out[i + axis],
        x = out[i + a],
        y = out[i + b],
        amount = modifier.amount
      if (modifier.type === 'TAPER') {
        const scale = Math.max(0.001, 1 + h * amount)
        out[i + a] = x * scale
        out[i + b] = y * scale
      } else if (modifier.type === 'TWIST') {
        const c = Math.cos(h * amount),
          s = Math.sin(h * amount)
        out[i + a] = x * c - y * s
        out[i + b] = x * s + y * c
      } else {
        const angle = h * amount,
          radius = 1 / amount
        out[i + a] = (radius + x) * Math.cos(angle) - radius
        out[i + axis] = (radius + x) * Math.sin(angle)
      }
    }
  }
  if (out.some((n) => !Number.isFinite(n)))
    throw new Error('Modifier produced a non-finite vertex')
  return out
}

type M3 = number[]
const identity = (): M3 => [1, 0, 0, 0, 1, 0, 0, 0, 1]
const mul = (a: M3, b: M3): M3 =>
  Array.from({length: 9}, (_, n) => {
    const r = Math.floor(n / 3),
      c = n % 3
    return a[r * 3] * b[c] + a[r * 3 + 1] * b[c + 3] + a[r * 3 + 2] * b[c + 6]
  })
const rotate = (m: M3, v: V3): V3 =>
  [0, 1, 2].map(
    (r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]
  ) as V3
const add = (a: V3, b: V3): V3 => a.map((v, i) => v + b[i]) as V3
const sub = (a: V3, b: V3): V3 => a.map((v, i) => v - b[i]) as V3
function euler([x, y, z]: V3): M3 {
  const cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cz = Math.cos(z),
    sz = Math.sin(z)
  return mul(
    mul([cz, -sz, 0, sz, cz, 0, 0, 0, 1], [cy, 0, sy, 0, 1, 0, -sy, 0, cy]),
    [1, 0, 0, 0, cx, -sx, 0, sx, cx]
  )
}
export function poseBones(bones: Bone[]): {head: V3; tail: V3; matrix: M3}[] {
  const poses: {head: V3; tail: V3; matrix: M3}[] = []
  bones.forEach((bone, index) => {
    if (bone.parent >= index || bone.parent < -1)
      throw new Error('Bone hierarchy must be acyclic and parent-first')
    const parent = bone.parent >= 0 ? poses[bone.parent] : undefined
    const head = parent
      ? add(
          parent.head,
          rotate(parent.matrix, sub(bone.head, bones[bone.parent].head))
        )
      : ([...bone.head] as V3)
    const matrix = mul(parent?.matrix ?? identity(), euler(bone.rotation))
    poses.push({
      head,
      matrix,
      tail: add(head, rotate(matrix, sub(bone.tail, bone.head))),
    })
  })
  return poses
}
function segmentDistance(p: V3, a: V3, b: V3): number {
  const d = sub(b, a),
    v = sub(p, a),
    len = d.reduce((s, x) => s + x * x, 0)
  const t = len
    ? Math.max(0, Math.min(1, v.reduce((s, x, i) => s + x * d[i], 0) / len))
    : 0
  return Math.hypot(...sub(p, add(a, d.map((x) => x * t) as V3)))
}
export function autoWeights(
  positions: number[],
  bones: Bone[]
): Rig['weights'] {
  if (!bones.length) throw new Error('Add bones before binding')
  const result: Rig['weights'] = []
  for (let i = 0; i < positions.length; i += 3) {
    const point = positions.slice(i, i + 3) as V3
    const nearest = bones
      .map((bone, index) => ({
        bone    : index,
        distance: segmentDistance(point, bone.head, bone.tail),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2)
    const values = nearest.map((row) => 1 / Math.max(1e-4, row.distance) ** 2)
    const total = values.reduce((a, b) => a + b, 0)
    result.push(
      nearest.map((row, j) => ({bone: row.bone, weight: values[j] / total}))
    )
  }
  return result
}
export function skinPositions(base: number[], rig: Rig): number[] {
  const poses = poseBones(rig.bones),
    out = base.slice()
  if (rig.weights.length !== base.length / 3)
    throw new Error('Rebind the rig after changing topology')
  for (let i = 0; i < rig.weights.length; i++) {
    const p = base.slice(i * 3, i * 3 + 3) as V3,
      co: V3 = [0, 0, 0]
    for (const weight of rig.weights[i]) {
      const bone = rig.bones[weight.bone],
        pose = poses[weight.bone]
      if (!bone || !pose) throw new Error('Invalid bone weight')
      const q = add(pose.head, rotate(pose.matrix, sub(p, bone.head)))
      for (let axis = 0; axis < 3; axis++) co[axis] += q[axis] * weight.weight
    }
    out.splice(i * 3, 3, ...co)
  }
  return out
}

export interface BoxBody {
  id: number
  position: V3
  half: V3
  mass: number
  restitution: number
  friction: number
  dynamic: boolean
}
/** Fixed-step, translational axis-aligned box solver. Returns frame-indexed centers. */
export function bakeBoxBodies(
  bodies: BoxBody[],
  frames: number,
  fps: number,
  gravity: number
): Map<number, V3[]> {
  if (frames < 1 || frames > 1000 || bodies.length > 64 || fps < 1 || fps > 120)
    throw new Error(
      'Bake supports 1–1000 frames, 1–120 fps and up to 64 bodies'
    )
  if (
    !Number.isInteger(frames) ||
    !Number.isFinite(fps) ||
    !Number.isFinite(gravity)
  )
    throw new Error('Bake frames, frame rate and gravity must be finite')
  const ids = new Set<number>()
  for (const body of bodies) {
    if (ids.has(body.id))
      throw new Error('Rigid body identifiers must be unique')
    ids.add(body.id)
    if (
      ![
        ...body.position,
        ...body.half,
        body.mass,
        body.restitution,
        body.friction,
      ].every(Number.isFinite) ||
      body.half.some((value) => value <= 0) ||
      body.mass <= 0 ||
      body.restitution < 0 ||
      body.restitution > 1 ||
      body.friction < 0 ||
      body.friction > 1
    )
      throw new Error('Invalid rigid body bounds or material settings')
  }
  const state = bodies.map((body) => ({
    ...body,
    position: [...body.position] as V3,
    velocity: [0, 0, 0] as V3,
  }))
  const result = new Map(
    state.map((body) => [body.id, [[...body.position] as V3]])
  )
  const substeps = Math.max(4, Math.ceil(120 / fps))
  const dt = 1 / fps / substeps
  for (let frame = 1; frame < frames; frame++) {
    for (let step = 0; step < substeps; step++) {
      for (const body of state)
        if (body.dynamic) {
          body.velocity[2] += gravity * dt
          for (let axis = 0; axis < 3; axis++)
            body.position[axis] += body.velocity[axis] * dt
        }
      for (let iteration = 0; iteration < 4; iteration++)
        for (let i = 0; i < state.length; i++)
          for (let j = i + 1; j < state.length; j++) {
            const a = state[i],
              b = state[j]
            if (!a.dynamic && !b.dynamic) continue
            const overlap = a.half.map(
              (h, k) => h + b.half[k] - Math.abs(b.position[k] - a.position[k])
            )
            if (overlap.some((n) => n <= 0)) continue
            const axis = overlap.indexOf(Math.min(...overlap)),
              sign = b.position[axis] >= a.position[axis] ? 1 : -1
            const ia = a.dynamic ? 1 / Math.max(a.mass, 0.001) : 0,
              ib = b.dynamic ? 1 / Math.max(b.mass, 0.001) : 0,
              sum = ia + ib
            const separation = Math.max(0, overlap[axis] - 1e-5) / sum
            a.position[axis] -= sign * separation * ia
            b.position[axis] += sign * separation * ib
            const relative = (b.velocity[axis] - a.velocity[axis]) * sign
            if (relative >= 0) continue
            const impulse =
              (-(1 + Math.min(a.restitution, b.restitution)) * relative) / sum
            a.velocity[axis] -= sign * impulse * ia
            b.velocity[axis] += sign * impulse * ib
            for (let k = 0; k < 3; k++)
              if (k !== axis) {
                const tangent = (b.velocity[k] - a.velocity[k]) / sum
                const limit = impulse * Math.sqrt(a.friction * b.friction)
                const friction = Math.max(-limit, Math.min(limit, tangent))
                a.velocity[k] += friction * ia
                b.velocity[k] -= friction * ib
              }
          }
    }
    for (const body of state)
      result.get(body.id)!.push([...body.position] as V3)
  }
  return result
}
