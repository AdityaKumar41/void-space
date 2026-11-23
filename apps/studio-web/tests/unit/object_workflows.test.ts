import {
  autoWeights,
  newWorkflow,
  readWorkflow,
  writeWorkflow,
  bakeBoxBodies,
  deformPositions,
  poseBones,
  putKey,
  sampleKeys,
  skinPositions,
  type Bone,
  type BoxBody,
  type DeformModifier,
  type TransformKey,
} from '../../scripts/core/object_workflows'
const key = (frame: number, x: number): TransformKey => ({
  frame,
  location: [x, 0, 0],
  rotation: [0, 0, x],
  scale   : [1 + x, 1, 1],
  pose    : [[0, x, 0]],
})
const bones: Bone[] = [
  {
    name    : 'Root',
    parent  : -1,
    head    : [0, 0, 0],
    tail    : [0, 0, 1],
    rotation: [0, 0, 0],
  },
  {
    name    : 'Child',
    parent  : 0,
    head    : [0, 0, 1],
    tail    : [0, 0, 2],
    rotation: [0, 0, 0],
  },
]
test('keys replace, sort and interpolate transforms and poses', () => {
  const keys = putKey(putKey([key(11, 10)], key(1, 0)), key(11, 20))
  expect(keys.map((k) => k.frame)).toEqual([1, 11])
  expect(sampleKeys(keys, 6)).toEqual(key(6, 10))
  expect(sampleKeys(keys, 6, 'CONSTANT')).toEqual(key(1, 0))
  expect(sampleKeys(keys, -5)).toEqual(key(1, 0))
  expect(sampleKeys(keys, 100)).toEqual(key(11, 20))
  expect(sampleKeys([], 1)).toBeUndefined()
})
test('modifiers preserve base, respect order and disable cleanly', () => {
  const base = [1, 0, 1, 0, 1, -1],
    twist: DeformModifier = {
      type   : 'TWIST',
      axis   : 2,
      amount : Math.PI / 2,
      enabled: true,
    },
    bend: DeformModifier = {type: 'BEND', axis: 2, amount: 0.7, enabled: true}
  const out = deformPositions(base, [twist])
  expect(out[0]).toBeCloseTo(0)
  expect(out[1]).toBeCloseTo(1)
  expect(base).toEqual([1, 0, 1, 0, 1, -1])
  expect(deformPositions(base, [{...twist, enabled: false}])).toEqual(base)
  expect(deformPositions(base, [twist, bend])).not.toEqual(
    deformPositions(base, [bend, twist])
  )
  expect(
    deformPositions(base, [{...twist, type: 'TAPER', amount: 0.5}])
  ).toEqual([1.5, 0, 1, 0, 0.5, -1])
  expect(deformPositions(base, [{...bend, amount: 0}])).toEqual(base)
})
test('weights normalize and bind pose preserves the mesh', () => {
  const base = [1, 0, 0, 1, 0, 1, 1, 0, 2],
    weights = autoWeights(base, bones)
  weights.forEach((w) =>
    expect(w.reduce((s, v) => s + v.weight, 0)).toBeCloseTo(1)
  )
  skinPositions(base, {bones, weights}).forEach((v, i) =>
    expect(v).toBeCloseTo(base[i])
  )
  expect(() => skinPositions(base, {bones, weights: []})).toThrow('Rebind')
})
test('FK propagates root rotation to child and weighted vertices', () => {
  const posed = bones.map((b) => ({
    ...b,
    rotation: [...b.rotation] as [number, number, number],
  }))
  posed[0].rotation = [0, Math.PI / 2, 0]
  const pose = poseBones(posed)
  expect(pose[1].head[0]).toBeCloseTo(1)
  expect(pose[1].tail[0]).toBeCloseTo(2)
  const co = skinPositions([0, 0, 2], {
    bones  : posed,
    weights: [[{bone: 1, weight: 1}]],
  })
  expect(co[0]).toBeCloseTo(2)
  expect(co[2]).toBeCloseTo(0)
  expect(() => poseBones([{...bones[0], parent: 0}])).toThrow('acyclic')
})
const body = (id: number, z: number, dynamic = true): BoxBody => ({
  id,
  position: [0, 0, z],
  half    : [1, 1, 1],
  dynamic,
  mass       : 1,
  restitution: 0,
  friction   : 0.5,
})
test('box bake is deterministic and settles on a passive floor', () => {
  const bodies = [
      body(1, 5),
      {...body(2, -1, false), half: [10, 10, 1] as [number, number, number]},
    ],
    a = bakeBoxBodies(bodies, 120, 24, -9.81)
  expect(a).toEqual(bakeBoxBodies(bodies, 120, 24, -9.81))
  expect(a.get(1)!.at(-1)![2]).toBeCloseTo(1, 3)
  expect(a.get(2)!.at(-1)).toEqual([0, 0, -1])
  expect(bodies[0].position[2]).toBe(5)
  expect(a.get(1)!.flat().every(Number.isFinite)).toBe(true)
})
test('dynamic boxes stack and unsupported bake sizes fail', () => {
  const a = bakeBoxBodies(
    [body(1, 5), body(2, 8), {...body(3, -1, false), half: [10, 10, 1]}],
    180,
    30,
    -9.81
  )
  expect(a.get(1)!.at(-1)![2]).toBeCloseTo(1, 2)
  expect(a.get(2)!.at(-1)![2]).toBeCloseTo(3, 2)
  expect(() => bakeBoxBodies([], 1001, 24, -9.81)).toThrow('1000')
})

test('physics refuses non-finite inputs and duplicate bodies', () => {
  expect(() => bakeBoxBodies([body(1, NaN)], 10, 24, -9.81)).toThrow('Invalid')
  expect(() => bakeBoxBodies([body(1, 5)], NaN, 24, -9.81)).toThrow('finite')
  expect(() => bakeBoxBodies([body(1, 5), body(1, 8)], 10, 24, -9.81)).toThrow(
    'unique'
  )
})

test('workflow attribution is serialized as ASCII JSON and retains Unicode and spacing', () => {
  const credit = 'Modèle by 作者 · CC BY · https://sketchfab.com/3d-models/example'
  const workflow = {...newWorkflow(), sourceAttribution: credit}
  const serialized = writeWorkflow(workflow)
  expect(serialized).toMatch(/^[\x20-\x7e]+$/)
  expect(readWorkflow(serialized).sourceAttribution).toBe(credit)
  const edited = readWorkflow(serialized)
  edited.modifiers.push({type: 'TWIST', amount: 1, axis: 2, enabled: true})
  expect(readWorkflow(writeWorkflow(edited)).sourceAttribution).toBe(credit)
})
