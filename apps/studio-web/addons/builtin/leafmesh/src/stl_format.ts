/**
 * Pure binary STL packing utilities.
 * Imports nothing from `@framework/api` or `scripts/`.
 */

export function exportTrianglesToSTL(tris: {positions: Float64Array; indices: Int32Array}): Uint8Array {
  const triCount = (tris.indices.length / 3) | 0
  if (triCount === 0) {
    return new Uint8Array()
  }

  const buf = new ArrayBuffer(84 + triCount * 50)
  const view = new DataView(buf)
  view.setUint32(80, triCount, true)

  const pos = tris.positions
  const ind = tris.indices

  for (let t = 0; t < triCount; t++) {
    const at = 84 + t * 50
    const i0 = ind[t * 3] * 3
    const i1 = ind[t * 3 + 1] * 3
    const i2 = ind[t * 3 + 2] * 3

    const ux = pos[i1] - pos[i0]
    const uy = pos[i1 + 1] - pos[i0 + 1]
    const uz = pos[i1 + 2] - pos[i0 + 2]
    const vx = pos[i2] - pos[i0]
    const vy = pos[i2 + 1] - pos[i0 + 1]
    const vz = pos[i2 + 2] - pos[i0 + 2]

    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len > 1e-6) {
      nx /= len
      ny /= len
      nz /= len
    }

    view.setFloat32(at, nx, true)
    view.setFloat32(at + 4, ny, true)
    view.setFloat32(at + 8, nz, true)

    view.setFloat32(at + 12, pos[i0], true)
    view.setFloat32(at + 16, pos[i0 + 1], true)
    view.setFloat32(at + 20, pos[i0 + 2], true)

    view.setFloat32(at + 24, pos[i1], true)
    view.setFloat32(at + 28, pos[i1 + 1], true)
    view.setFloat32(at + 32, pos[i1 + 2], true)

    view.setFloat32(at + 36, pos[i2], true)
    view.setFloat32(at + 40, pos[i2 + 1], true)
    view.setFloat32(at + 44, pos[i2 + 2], true)

    view.setUint16(at + 48, 0, true)
  }

  return new Uint8Array(buf)
}
