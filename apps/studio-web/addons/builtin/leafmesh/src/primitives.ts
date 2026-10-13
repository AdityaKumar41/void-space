/**
 * Primitive builders. These exist as much to exercise the topology layer as to
 * be useful — between them they cover quads, fans, poles, and (in the tube) a
 * face with a hole, which is the case a mesh library usually gets wrong.
 *
 * Everything is built Z-up and wound so face normals point out of the solid.
 */

import {LeafMesh, type Vec3} from './topo.js'

export interface PrimitiveResult {
  verts: number[]
  faces: number[]
}

/** A single quad in the XY plane, normal +Z. */
export function makePlane(mesh: LeafMesh, size = 1): PrimitiveResult {
  return makeGrid(mesh, 1, 1, size)
}

/** An `nx` by `ny` quad grid in the XY plane, normal +Z. */
export function makeGrid(mesh: LeafMesh, nx: number, ny: number, size = 1): PrimitiveResult {
  const verts: number[] = []
  const faces: number[] = []
  const half = size * 0.5

  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      verts.push(mesh.makeVert([-half + (size * i) / nx, -half + (size * j) / ny, 0]))
    }
  }

  const at = (i: number, j: number): number => verts[j * (nx + 1) + i]
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      faces.push(mesh.makeFace([[at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]]))
    }
  }

  return {verts, faces}
}

/** An axis-aligned cube of six quads, centred on the origin. */
export function makeCube(mesh: LeafMesh, size = 1): PrimitiveResult {
  const h = size * 0.5
  const corners: Vec3[] = [
    [-h, -h, -h],
    [h, -h, -h],
    [h, h, -h],
    [-h, h, -h],
    [-h, -h, h],
    [h, -h, h],
    [h, h, h],
    [-h, h, h],
  ]

  const verts = corners.map((co) => mesh.makeVert(co))
  const rings = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [3, 7, 6, 2],
    [0, 4, 7, 3],
    [1, 2, 6, 5],
  ]

  const faces = rings.map((ring) => mesh.makeFace([ring.map((i) => verts[i])]))
  return {verts, faces}
}

/** A UV sphere: quad bands between two triangle-fan poles, on the Z axis. */
export function makeUVSphere(mesh: LeafMesh, segments = 16, rings = 8, radius = 1): PrimitiveResult {
  const verts: number[] = []
  const faces: number[] = []

  const north = mesh.makeVert([0, 0, radius])
  verts.push(north)

  const band: number[][] = []
  for (let j = 1; j < rings; j++) {
    const theta = (Math.PI * j) / rings
    const z = radius * Math.cos(theta)
    const s = radius * Math.sin(theta)
    const row: number[] = []
    for (let i = 0; i < segments; i++) {
      const phi = (2 * Math.PI * i) / segments
      const v = mesh.makeVert([s * Math.cos(phi), s * Math.sin(phi), z])
      row.push(v)
      verts.push(v)
    }
    band.push(row)
  }

  const south = mesh.makeVert([0, 0, -radius])
  verts.push(south)

  const top = band[0]
  const bottom = band[band.length - 1]
  for (let i = 0; i < segments; i++) {
    const k = (i + 1) % segments
    faces.push(mesh.makeFace([[north, top[i], top[k]]]))
    faces.push(mesh.makeFace([[south, bottom[k], bottom[i]]]))
  }

  for (let j = 0; j + 1 < band.length; j++) {
    const a = band[j]
    const b = band[j + 1]
    for (let i = 0; i < segments; i++) {
      const k = (i + 1) % segments
      faces.push(mesh.makeFace([[a[i], b[i], b[k], a[k]]]))
    }
  }

  return {verts, faces}
}

/**
 * A tube: an outer and an inner cylinder wall closed by two annular caps. The
 * caps are the point — each is a single face with a hole, so this is the
 * primitive that exercises the multi-loop path end to end.
 */
export function makeTube(mesh: LeafMesh, segments = 16, radius = 1, innerRadius = 0.5, height = 1): PrimitiveResult {
  const verts: number[] = []
  const faces: number[] = []
  const h = height * 0.5

  const ring = (r: number, z: number): number[] => {
    const out: number[] = []
    for (let i = 0; i < segments; i++) {
      const phi = (2 * Math.PI * i) / segments
      const v = mesh.makeVert([r * Math.cos(phi), r * Math.sin(phi), z])
      out.push(v)
      verts.push(v)
    }
    return out
  }

  const outerBot = ring(radius, -h)
  const outerTop = ring(radius, h)
  const innerBot = ring(innerRadius, -h)
  const innerTop = ring(innerRadius, h)

  for (let i = 0; i < segments; i++) {
    const k = (i + 1) % segments
    faces.push(mesh.makeFace([[outerBot[i], outerBot[k], outerTop[k], outerTop[i]]]))
    faces.push(mesh.makeFace([[innerBot[i], innerTop[i], innerTop[k], innerBot[k]]]))
  }

  faces.push(mesh.makeFace([outerTop, innerTop]))
  faces.push(mesh.makeFace([outerBot.slice().reverse(), innerBot]))

  return {verts, faces}
}

/** A cylinder with quad side walls and n-gon end caps. */
export function makeCylinder(mesh: LeafMesh, segments = 16, radius = 1, height = 2): PrimitiveResult {
  const verts: number[] = []
  const faces: number[] = []
  const h = height * 0.5

  const bot: number[] = []
  const top: number[] = []
  for (let i = 0; i < segments; i++) {
    const phi = (2 * Math.PI * i) / segments
    const x = radius * Math.cos(phi)
    const y = radius * Math.sin(phi)
    const vb = mesh.makeVert([x, y, -h])
    const vt = mesh.makeVert([x, y, h])
    bot.push(vb)
    top.push(vt)
    verts.push(vb, vt)
  }

  for (let i = 0; i < segments; i++) {
    const k = (i + 1) % segments
    faces.push(mesh.makeFace([[bot[i], bot[k], top[k], top[i]]]))
  }

  faces.push(mesh.makeFace([top]))
  faces.push(mesh.makeFace([bot.slice().reverse()]))

  return {verts, faces}
}

/** A cone with triangle side walls converging at the apex and an n-gon base. */
export function makeCone(mesh: LeafMesh, segments = 16, radius = 1, height = 2): PrimitiveResult {
  const verts: number[] = []
  const faces: number[] = []
  const h = height * 0.5

  const tip = mesh.makeVert([0, 0, h])
  verts.push(tip)

  const bot: number[] = []
  for (let i = 0; i < segments; i++) {
    const phi = (2 * Math.PI * i) / segments
    const x = radius * Math.cos(phi)
    const y = radius * Math.sin(phi)
    const vb = mesh.makeVert([x, y, -h])
    bot.push(vb)
    verts.push(vb)
  }

  for (let i = 0; i < segments; i++) {
    const k = (i + 1) % segments
    faces.push(mesh.makeFace([[bot[i], bot[k], tip]]))
  }

  faces.push(mesh.makeFace([bot.slice().reverse()]))

  return {verts, faces}
}

/** A torus with quad subdivisions along major and minor circles. */
export function makeTorus(
  mesh: LeafMesh,
  majorRadius = 1,
  minorRadius = 0.25,
  majorSegments = 24,
  minorSegments = 12
): PrimitiveResult {
  const verts: number[] = []
  const faces: number[] = []

  const grid: number[][] = []
  for (let i = 0; i < majorSegments; i++) {
    const u = (2 * Math.PI * i) / majorSegments
    const cosU = Math.cos(u)
    const sinU = Math.sin(u)
    const ring: number[] = []
    for (let j = 0; j < minorSegments; j++) {
      const v = (2 * Math.PI * j) / minorSegments
      const x = (majorRadius + minorRadius * Math.cos(v)) * cosU
      const y = (majorRadius + minorRadius * Math.cos(v)) * sinU
      const z = minorRadius * Math.sin(v)
      const vert = mesh.makeVert([x, y, z])
      ring.push(vert)
      verts.push(vert)
    }
    grid.push(ring)
  }

  for (let i = 0; i < majorSegments; i++) {
    const iNext = (i + 1) % majorSegments
    for (let j = 0; j < minorSegments; j++) {
      const jNext = (j + 1) % minorSegments
      const v0 = grid[i][j]
      const v1 = grid[iNext][j]
      const v2 = grid[iNext][jNext]
      const v3 = grid[i][jNext]
      faces.push(mesh.makeFace([[v0, v1, v2, v3]]))
    }
  }

  return {verts, faces}
}

/** An icosahedron subdivided onto a sphere surface (Ico Sphere). */
export function makeIcoSphere(mesh: LeafMesh, subdivisions = 1, radius = 1): PrimitiveResult {
  const phi = (1 + Math.sqrt(5)) * 0.5
  const rawVerts: Vec3[] = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ]

  const norm = (v: Vec3): Vec3 => {
    const len = Math.hypot(v[0], v[1], v[2])
    return [(v[0] / len) * radius, (v[1] / len) * radius, (v[2] / len) * radius]
  }

  let currentVerts: Vec3[] = rawVerts.map(norm)
  let currentFaces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ]

  const subs = Math.min(3, Math.max(0, subdivisions))
  for (let s = 0; s < subs; s++) {
    const midCache = new Map<string, number>()
    const getMid = (i1: number, i2: number): number => {
      const key = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`
      const existing = midCache.get(key)
      if (existing !== undefined) return existing
      const p1 = currentVerts[i1]
      const p2 = currentVerts[i2]
      const mid = norm([(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5, (p1[2] + p2[2]) * 0.5])
      const idx = currentVerts.length
      currentVerts.push(mid)
      midCache.set(key, idx)
      return idx
    }

    const nextFaces: [number, number, number][] = []
    for (const [a, b, c] of currentFaces) {
      const ab = getMid(a, b)
      const bc = getMid(b, c)
      const ca = getMid(c, a)
      nextFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    }
    currentFaces = nextFaces
  }

  const vHandles = currentVerts.map((co) => mesh.makeVert(co))
  const fHandles = currentFaces.map(([a, b, c]) => mesh.makeFace([[vHandles[a], vHandles[b], vHandles[c]]]))
  return {verts: vHandles, faces: fHandles}
}

/** Blender's iconic low-poly monkey mascot Suzanne. */
export function makeMonkey(mesh: LeafMesh, size = 1): PrimitiveResult {
  const s = size * 0.5
  // Stylized low-poly monkey head coordinates:
  const rawCoords: Vec3[] = [
    // 0..7: Centerline profile (from crown to throat, Z-up)
    [0, 0.4 * s, 0.9 * s],    // 0: top crown
    [0, 0.8 * s, 0.4 * s],    // 1: brow center
    [0, 0.85 * s, 0.0 * s],   // 2: nose bridge
    [0, 0.95 * s, -0.35 * s], // 3: snout tip
    [0, 0.65 * s, -0.65 * s], // 4: lower chin
    [0, -0.15 * s, -0.6 * s], // 5: throat
    [0, -0.75 * s, 0.0 * s],  // 6: back base of skull
    [0, -0.55 * s, 0.75 * s], // 7: top back of skull

    // 8..15: Left side head/face (-X)
    [-0.4 * s, 0.4 * s, 0.8 * s],   // 8: upper forehead L
    [-0.6 * s, 0.6 * s, 0.35 * s],  // 9: temple / brow outer L
    [-0.3 * s, 0.7 * s, 0.25 * s],  // 10: inner brow L
    [-0.4 * s, 0.75 * s, -0.05 * s],// 11: eye L
    [-0.3 * s, 0.75 * s, -0.35 * s],// 12: snout L
    [-0.55 * s, 0.3 * s, -0.45 * s],// 13: cheek L
    [-0.7 * s, -0.15 * s, 0.1 * s], // 14: ear root L
    [-0.5 * s, -0.6 * s, 0.45 * s], // 15: back skull L

    // 16..17: Left ear flap
    [-1.25 * s, -0.2 * s, 0.45 * s], // 16: ear tip top L
    [-1.15 * s, -0.2 * s, -0.15 * s],// 17: ear tip bot L

    // 18..25: Right side head/face (+X, mirrored)
    [0.4 * s, 0.4 * s, 0.8 * s],   // 18
    [0.6 * s, 0.6 * s, 0.35 * s],  // 19
    [0.3 * s, 0.7 * s, 0.25 * s],  // 20
    [0.4 * s, 0.75 * s, -0.05 * s],// 21
    [0.3 * s, 0.75 * s, -0.35 * s],// 22
    [0.55 * s, 0.3 * s, -0.45 * s],// 23
    [0.7 * s, -0.15 * s, 0.1 * s], // 24
    [0.5 * s, -0.6 * s, 0.45 * s], // 25

    // 26..27: Right ear flap
    [1.25 * s, -0.2 * s, 0.45 * s], // 26
    [1.15 * s, -0.2 * s, -0.15 * s],// 27
  ]

  const verts = rawCoords.map((co) => mesh.makeVert(co))
  const faces: number[] = []

  const quad = (a: number, b: number, c: number, d: number) => {
    faces.push(mesh.makeFace([[verts[a], verts[b], verts[c], verts[d]]]))
  }
  const tri = (a: number, b: number, c: number) => {
    faces.push(mesh.makeFace([[verts[a], verts[b], verts[c]]]))
  }

  // Forehead & Brow
  quad(0, 8, 10, 1)
  quad(0, 1, 20, 18)
  quad(8, 9, 10, 10) // Left brow
  quad(18, 20, 19, 19)

  // Eyes & Snout
  quad(1, 10, 11, 2)
  quad(1, 2, 21, 20)
  quad(2, 11, 12, 3)
  quad(2, 3, 22, 21)

  // Cheeks & Jaw
  quad(3, 12, 13, 4)
  quad(3, 4, 23, 22)
  quad(4, 13, 5, 5)
  quad(4, 5, 23, 23)

  // Skull & Temple
  quad(0, 7, 15, 8)
  quad(0, 18, 25, 7)
  quad(8, 15, 14, 9)
  quad(18, 19, 24, 25)

  // Under skull to throat
  quad(7, 6, 15, 15)
  quad(7, 25, 6, 6)
  quad(6, 5, 14, 15)
  quad(6, 25, 24, 5)
  quad(14, 5, 13, 11)
  quad(24, 21, 23, 5)

  // Ears
  tri(9, 16, 14)
  tri(14, 17, 13)
  quad(14, 16, 17, 14)
  tri(19, 24, 26)
  tri(24, 23, 27)
  quad(24, 27, 26, 24)

  return {verts, faces}
}

