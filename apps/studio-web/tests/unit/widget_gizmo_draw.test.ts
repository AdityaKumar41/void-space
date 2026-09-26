/**
 * Widget (gizmo) draw path — the two defects that made the viewport transform
 * gizmo invisible while everything around it reported success.
 *
 * 1. `SimpleMesh.copy()` kept the constructor's placeholder island ahead of the
 *    copied ones, so every widget shape mesh began with a zero-vertex island.
 *    `WidgetManager.loadShapes()` copies all of `Shapes`, so this hit every
 *    gizmo at startup.
 * 2. `buildPipelineDescriptor` substitutes `DEFAULT_DEPTH_STATE` whenever a
 *    WGSL entry omits `depthStencil`. The legacy GL path drew widgets into a
 *    depth buffer it had just cleared (`clear(DEPTH); widgets.draw`), so a
 *    gizmo was never occluded. In WebGPU the overlay pass shares one depth
 *    attachment with the grid, which still holds the scene's depth — so the
 *    substituted `less-equal` test hid every widget behind the mesh it was
 *    attached to. `WidgetMeshShader` therefore has to declare the test away.
 *
 * Neither is visible from the outside: the draws were submitted, no GPU error
 * was raised, and the meshes reported islands. Only the pixels showed nothing.
 */

import {LayerTypes, SimpleMesh} from '../../scripts/webgl/simplemesh'
import {Vector3} from '../../scripts/util/vectormath'
import {buildPipelineDescriptor, lookupWgslShader} from '../../scripts/shaders/wgsl_shaders'

describe('SimpleMesh.copy', () => {
  /** A one-triangle mesh, layered like the widget shapes are. */
  function triangleMesh(): SimpleMesh {
    const mesh = new SimpleMesh(LayerTypes.LOC | LayerTypes.NORMAL | LayerTypes.UV | LayerTypes.COLOR)
    const v = (x: number, y: number): Vector3 => new Vector3([x, y, 0])

    mesh.tri(v(0, 0), v(1, 0), v(0, 1))
    return mesh
  }

  test('does not inherit the constructor’s placeholder island', () => {
    const copy = triangleMesh().copy()

    expect(copy.islands.length).toBe(1)
    expect(copy.islands.every((island) => island.tottri > 0)).toBe(true)
  })

  test('keeps the geometry and points `island` at it', () => {
    const source = triangleMesh()
    const copy = source.copy()

    expect(copy.island).toBe(copy.islands[0])
    expect(copy.island.tottri).toBe(source.island.tottri)
    // Same layer data, new layers: `WidgetManager.loadShapes` copies once and
    // then shares the result across every shape of that kind.
    expect(copy.island).not.toBe(source.island)
    expect(copy.layerflag).toBe(source.layerflag)
  })

  test('copies every island, not just the first', () => {
    const source = triangleMesh()
    source.add_island()

    const copy = source.copy()

    expect(copy.islands.length).toBe(2)
    expect(copy.islands.includes(copy.island)).toBe(true)
  })
})

describe('WidgetMeshShader pipeline', () => {
  const entry = lookupWgslShader('WidgetMeshShader')

  test('is registered', () => {
    expect(entry).toBeDefined()
  })

  test('never depth-tests, so a gizmo draws over the mesh it is attached to', () => {
    const desc = buildPipelineDescriptor(entry!)

    expect(desc.depthStencil?.depthCompare).toBe('always')
    expect(desc.depthStencil?.depthWriteEnabled).toBe(false)
  })

  test('still declares a depth format, because the overlay pass has a depth attachment', () => {
    const desc = buildPipelineDescriptor(entry!)

    expect(desc.depthStencil?.format).toBe('depth24plus')
  })
})
