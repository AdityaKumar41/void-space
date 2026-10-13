/**
 * Implements the host-facing half of LeafMesh drawing — P11 step 4.
 *
 * LeafMesh brings its own {@link Drawable} rather than filling a `SimpleMesh`,
 * because `SimpleIsland` binds a fixed buffer per layer type (uv at slot 2,
 * colour at 3), and a material's `AttributeNode` reads start at slot 2 as
 * well. That collision is the first entry under
 * documentation/geometry-contract.md §11; the fix binds requested attributes
 * by name at the slot the shader generator assigned.
 *
 * Geometry is unshared triangle corners (see `draw_buffers.ts`) uploaded once
 * per invalidation; a static mesh uploads on its first frame and never again.
 */

import type {Drawable, IUniformsBlock, MaterialAttrRequest, ShaderProgram, VertexAttrDesc} from '@framework/api'
import {
  BufferUsage,
  MATERIAL_BASE_VERTEX_ATTRS,
  LayerTypes,
  SimpleMesh,
  Vector2,
  Vector3,
  Vector4,
} from '@framework/api'

import {buildDrawGeometry, gatherDrawAttr} from './draw_buffers.js'
import type {DrawGeometry} from './draw_buffers.js'
import {LeafMesh} from './topo.js'
import type {Tri} from './triangulate.js'
import {TriangulationCache} from './triangulate.js'

/**
 * What LeafMesh always binds, whatever the material: the base vertex interface
 * and nothing else. Everything past slot 1 follows the material, so it cannot
 * be declared here — see documentation/geometry-contract.md §10.2.
 */
export const LEAFMESH_VERTEX_ATTRS: readonly VertexAttrDesc[] = MATERIAL_BASE_VERTEX_ATTRS

/** Every live face's triangles, through the per-face memo. */
function collectTris(mesh: LeafMesh, cache: TriangulationCache): Tri[] {
  const out: Tri[] = []
  for (const f of mesh.f) {
    for (const tri of cache.get(mesh, f)) {
      out.push(tri)
    }
  }
  return out
}

interface SlotBuffer {
  data: Float32Array
  gpu?: GPUBuffer
  /** Bytes actually uploaded, so a shrink re-writes rather than under-fills. */
  uploaded: number
}

export class LeafMeshDrawable implements Drawable {
  private readonly mesh: LeafMesh
  private readonly cache: TriangulationCache
  private readonly slots = new Map<number, SlotBuffer>()

  private geom?: DrawGeometry
  private tris: Tri[] = []
  private requested: readonly MaterialAttrRequest[] = []
  private dirty = true
  private device?: GPUDevice
  private warnedWebGL = false
  private simpleMesh?: SimpleMesh

  constructor(mesh: LeafMesh, cache: TriangulationCache) {
    this.mesh = mesh
    this.cache = cache
  }

  get triCount(): number {
    return this.geom?.triCount ?? 0
  }

  /** Drop the CPU arrays; the GPU buffers are reused if the size still fits. */
  invalidate(): void {
    this.dirty = true
    this.simpleMesh = undefined
  }

  /**
   * Install the attribute set the compiled material asks for. A no-op when the
   * set is unchanged, so the per-frame push from the render engine does not
   * re-gather every attribute of every mesh.
   */
  setRequestedAttrs(reqs: readonly MaterialAttrRequest[]): void {
    if (this.requested.length === reqs.length) {
      let same = true
      for (let i = 0; i < reqs.length; i++) {
        const a = this.requested[i]
        const b = reqs[i]
        if (a.name !== b.name || a.slot !== b.slot || a.elemSize !== b.elemSize) {
          same = false
          break
        }
      }
      if (same) {
        return
      }
    }

    this.requested = reqs.map((r) => ({name: r.name, slot: r.slot, elemSize: r.elemSize}))
    this.dirty = true
  }

  /** Attribute names the material asked for that this mesh has no layer for. */
  missingAttrs(): string[] {
    if (this.dirty) {
      this.rebuild()
    }
    return this.requested.filter((r) => !this.slots.has(r.slot)).map((r) => r.name)
  }

  private rebuild(): void {
    this.dirty = false
    this.tris = collectTris(this.mesh, this.cache)
    this.geom = buildDrawGeometry(this.mesh, this.tris)
    this.slots.clear()

    this.setSlot(0, this.geom.position)
    this.setSlot(1, this.geom.normal)

    for (const req of this.requested) {
      if (req.slot < MATERIAL_BASE_VERTEX_ATTRS.length) {
        continue
      }
      const data = gatherDrawAttr(this.mesh, this.tris, req.name, req.elemSize)
      if (data !== undefined) {
        this.setSlot(req.slot, data)
      }
    }

    const vertCount = this.geom.triCount * 3
    if (!this.slots.has(2)) {
      const uvs = gatherDrawAttr(this.mesh, this.tris, 'uv', 2) ?? new Float32Array(vertCount * 2)
      this.setSlot(2, uvs)
    }

    if (!this.slots.has(3)) {
      const colors = gatherDrawAttr(this.mesh, this.tris, 'color', 4)
      if (colors !== undefined) {
        this.setSlot(3, colors)
      } else {
        const defaultColors = new Float32Array(vertCount * 4)
        for (let i = 0; i < vertCount; i++) {
          const idx = i * 4
          defaultColors[idx] = 0.82
          defaultColors[idx + 1] = 0.82
          defaultColors[idx + 2] = 0.85
          defaultColors[idx + 3] = 1.0
        }
        this.setSlot(3, defaultColors)
      }
    }
  }

  private setSlot(slot: number, data: Float32Array): void {
    this.slots.set(slot, {data, uploaded: -1})
  }

  /**
   * Called by the WebGPU draw adapter before `drawGPU`, and the only place a
   * provider is handed the device — hence the underscore, which is the
   * adapter's name for the hook, not ours.
   */
  _uploadGpuBuffers(device: GPUDevice): void {
    if (this.device !== device) {
      // A device change invalidates every buffer handle we hold.
      for (const slot of this.slots.values()) {
        slot.gpu = undefined
        slot.uploaded = -1
      }
      this.device = device
    }
    if (this.dirty) {
      this.rebuild()
    }

    for (const [slot, buf] of this.slots) {
      const bytes = buf.data.byteLength
      if (bytes === 0) {
        continue
      }
      if (buf.gpu === undefined || buf.gpu.size < bytes) {
        buf.gpu?.destroy()
        buf.gpu = device.createBuffer({
          label: `LeafMeshDrawable.slot${slot}`,
          size : (bytes + 3) & ~3,
          usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
        })
        buf.uploaded = -1
      }
      if (buf.uploaded !== bytes) {
        device.queue.writeBuffer(buf.gpu, 0, buf.data.buffer, buf.data.byteOffset, bytes)
        buf.uploaded = bytes
      }
    }
  }

  drawGPU(pass: GPURenderPassEncoder, _pipeline: GPURenderPipeline, _uniforms: IUniformsBlock): void {
    if (this.dirty || this.geom === undefined) {
      // Reached only if the adapter skipped `_uploadGpuBuffers`; without a
      // device there is nothing to bind, so drawing nothing is the honest
      // outcome rather than a validation error.
      return
    }

    for (const [slot, buf] of this.slots) {
      if (buf.gpu !== undefined) {
        pass.setVertexBuffer(slot, buf.gpu)
      }
    }

    if (this.geom.triCount > 0) {
      pass.draw(this.geom.triCount * 3, 1, 0, 0)
    }
  }

  private buildSimpleMesh(): void {
    if (!this.geom || this.geom.triCount === 0) {
      this.simpleMesh = undefined
      return
    }

    const sm = new SimpleMesh(
      LayerTypes.LOC | LayerTypes.NORMAL | LayerTypes.UV | LayerTypes.COLOR | LayerTypes.ID
    )

    const uvs = gatherDrawAttr(this.mesh, this.tris, 'uv', 2)
    const colors = gatherDrawAttr(this.mesh, this.tris, 'color', 4)

    const co = this.geom.position
    const no = this.geom.normal
    const triCount = this.geom.triCount

    const p0 = new Vector3()
    const p1 = new Vector3()
    const p2 = new Vector3()
    const n0 = new Vector3()
    const n1 = new Vector3()
    const n2 = new Vector3()
    const c0 = new Vector4([1, 1, 1, 1])
    const c1 = new Vector4([1, 1, 1, 1])
    const c2 = new Vector4([1, 1, 1, 1])
    const uv0 = new Vector2([0, 0])
    const uv1 = new Vector2([0, 0])
    const uv2 = new Vector2([0, 0])

    for (let i = 0; i < triCount; i++) {
      const o = i * 9
      p0.loadXYZ(co[o], co[o + 1], co[o + 2])
      p1.loadXYZ(co[o + 3], co[o + 4], co[o + 5])
      p2.loadXYZ(co[o + 6], co[o + 7], co[o + 8])

      n0.loadXYZ(no[o], no[o + 1], no[o + 2])
      n1.loadXYZ(no[o + 3], no[o + 4], no[o + 5])
      n2.loadXYZ(no[o + 6], no[o + 7], no[o + 8])

      const ed = sm.tri(p0, p1, p2).normals(n0, n1, n2)

      if (colors !== undefined) {
        const co4 = i * 12
        c0.loadXYZW(colors[co4], colors[co4 + 1], colors[co4 + 2], colors[co4 + 3])
        c1.loadXYZW(colors[co4 + 4], colors[co4 + 5], colors[co4 + 6], colors[co4 + 7])
        c2.loadXYZW(colors[co4 + 8], colors[co4 + 9], colors[co4 + 10], colors[co4 + 11])
        ed.colors(c0, c1, c2)
      } else {
        c0.loadXYZW(1, 1, 1, 1)
        ed.colors(c0, c0, c0)
      }

      if (uvs !== undefined) {
        const uvo = i * 6
        uv0.loadXY(uvs[uvo], uvs[uvo + 1])
        uv1.loadXY(uvs[uvo + 2], uvs[uvo + 3])
        uv2.loadXY(uvs[uvo + 4], uvs[uvo + 5])
        ed.uvs(uv0, uv1, uv2)
      }
    }

    // Also populate lines for mesh edges so wireframe overlays render properly
    try {
      const meshCo = this.mesh.v.co
      for (const eid of this.mesh.e) {
        const v1 = this.mesh.e.v1[eid]
        const v2 = this.mesh.e.v2[eid]
        if (v1 >= 0 && v2 >= 0) {
          p0.loadXYZ(meshCo[v1 * 3], meshCo[v1 * 3 + 1], meshCo[v1 * 3 + 2])
          p1.loadXYZ(meshCo[v2 * 3], meshCo[v2 * 3 + 1], meshCo[v2 * 3 + 2])
          sm.line(p0, p1).colors(c0, c0)
        }
      }
    } catch {}

    this.simpleMesh = sm
  }

  draw(gl: WebGL2RenderingContext, uniforms: IUniformsBlock, program: ShaderProgram): void {
    if (this.dirty || this.simpleMesh === undefined) {
      this.rebuild()
      this.buildSimpleMesh()
    }
    if (this.simpleMesh) {
      this.simpleMesh.draw(gl, uniforms, program)
    }
  }

  dispose(): void {
    for (const buf of this.slots.values()) {
      buf.gpu?.destroy()
    }
    this.slots.clear()
    this.geom = undefined
    this.tris = []
    this.dirty = true
    if (this.simpleMesh && (this.simpleMesh as any).gl) {
      try {
        this.simpleMesh.destroy((this.simpleMesh as any).gl)
      } catch {}
    }
    this.simpleMesh = undefined
  }
}
