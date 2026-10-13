/**
 * LeafMesh primitive spawning operations (Blender-compatible Add menu & Shift-A).
 *
 * Spawns primitives directly into the scene as editable LeafMesh objects with
 * clean topology, default material assignment, and cursor/origin placement.
 */

import type {ToolContext} from '@framework/api'
import {Icons, InvalidationKind, SceneObject, makeDefaultMaterial} from '@framework/api'
import {FloatProperty, IntProperty, ToolOp} from '@framework/pathux'

import {LeafMeshData} from './leafmesh.js'
import {
  makeCone,
  makeCube,
  makeCylinder,
  makeGrid,
  makeIcoSphere,
  makeMonkey,
  makePlane,
  makeTorus,
  makeTube,
  makeUVSphere,
} from './primitives.js'

function spawnLeafMeshPrimitive(
  ctx: ToolContext,
  name: string,
  buildMesh: (mesh: any) => void
): SceneObject {
  const data = new LeafMeshData()
  data.name = name
  buildMesh(data.mesh)
  data.invalidate(InvalidationKind.ALL)

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
  ob.name = name
  data.lib_addUser(ob)

  // Place at 3D cursor position if available, else at origin
  const cursor = (scene as any)?.cursor
  if (cursor && Array.isArray(cursor) && cursor.length >= 3) {
    ob.location[0] = cursor[0]
    ob.location[1] = cursor[1]
    ob.location[2] = cursor[2]
  }

  scene.add(ob)
  scene.objects.clearSelection?.()
  scene.objects.setSelect(ob, true)
  scene.objects.setActive(ob)

  ob.graphUpdate()
  data.graphUpdate()

  if (typeof (window as any).redraw_viewport === 'function') {
    (window as any).redraw_viewport(true)
  }

  ctx.message?.(`Added ${name}`)
  return ob
}

export class LeafMeshAddCubeOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Add Cube',
      toolpath: 'leafmesh.add_cube',
      icon    : Icons.CUBE ?? Icons.MESHTOOL,
      inputs  : {
        size: new FloatProperty(2.0),
      },
    }
  }

  exec(ctx: ToolContext): void {
    const size = (this.inputs as any).size?.getValue() ?? 2.0
    spawnLeafMeshPrimitive(ctx, 'Cube', (mesh) => makeCube(mesh, size))
  }
}

export class LeafMeshAddUVSphereOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Add UV Sphere',
      toolpath: 'leafmesh.add_uv_sphere',
      icon    : Icons.SPHERE ?? Icons.MESHTOOL,
      inputs  : {
        segments: new IntProperty(16),
        rings   : new IntProperty(8),
        radius  : new FloatProperty(1.0),
      },
    }
  }

  exec(ctx: ToolContext): void {
    const segments = (this.inputs as any).segments?.getValue() ?? 16
    const rings = (this.inputs as any).rings?.getValue() ?? 8
    const radius = (this.inputs as any).radius?.getValue() ?? 1.0
    spawnLeafMeshPrimitive(ctx, 'UV Sphere', (mesh) => makeUVSphere(mesh, segments, rings, radius))
  }
}

export class LeafMeshAddIcoSphereOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Add Ico Sphere',
      toolpath: 'leafmesh.add_icosphere',
      icon    : Icons.SPHERE ?? Icons.MESHTOOL,
      inputs  : {
        subdivisions: new IntProperty(1),
        radius      : new FloatProperty(1.0),
      },
    }
  }

  exec(ctx: ToolContext): void {
    const subs = (this.inputs as any).subdivisions?.getValue() ?? 1
    const radius = (this.inputs as any).radius?.getValue() ?? 1.0
    spawnLeafMeshPrimitive(ctx, 'Ico Sphere', (mesh) => makeIcoSphere(mesh, subs, radius))
  }
}

export class LeafMeshAddCylinderOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Add Cylinder',
      toolpath: 'leafmesh.add_cylinder',
      icon    : Icons.MESHTOOL,
      inputs  : {
        segments: new IntProperty(16),
        radius  : new FloatProperty(1.0),
        height  : new FloatProperty(2.0),
      },
    }
  }

  exec(ctx: ToolContext): void {
    const segments = (this.inputs as any).segments?.getValue() ?? 16
    const radius = (this.inputs as any).radius?.getValue() ?? 1.0
    const height = (this.inputs as any).height?.getValue() ?? 2.0
    spawnLeafMeshPrimitive(ctx, 'Cylinder', (mesh) => makeCylinder(mesh, segments, radius, height))
  }
}

export class LeafMeshAddConeOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Add Cone',
      toolpath: 'leafmesh.add_cone',
      icon    : Icons.MESHTOOL,
      inputs  : {
        segments: new IntProperty(16),
        radius  : new FloatProperty(1.0),
        height  : new FloatProperty(2.0),
      },
    }
  }

  exec(ctx: ToolContext): void {
    const segments = (this.inputs as any).segments?.getValue() ?? 16
    const radius = (this.inputs as any).radius?.getValue() ?? 1.0
    const height = (this.inputs as any).height?.getValue() ?? 2.0
    spawnLeafMeshPrimitive(ctx, 'Cone', (mesh) => makeCone(mesh, segments, radius, height))
  }
}

export class LeafMeshAddTorusOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Add Torus',
      toolpath: 'leafmesh.add_torus',
      icon    : Icons.MESHTOOL,
      inputs  : {
        majorRadius  : new FloatProperty(1.0),
        minorRadius  : new FloatProperty(0.25),
        majorSegments: new IntProperty(24),
        minorSegments: new IntProperty(12),
      },
    }
  }

  exec(ctx: ToolContext): void {
    const majorRadius = (this.inputs as any).majorRadius?.getValue() ?? 1.0
    const minorRadius = (this.inputs as any).minorRadius?.getValue() ?? 0.25
    const majorSegments = (this.inputs as any).majorSegments?.getValue() ?? 24
    const minorSegments = (this.inputs as any).minorSegments?.getValue() ?? 12
    spawnLeafMeshPrimitive(ctx, 'Torus', (mesh) =>
      makeTorus(mesh, majorRadius, minorRadius, majorSegments, minorSegments)
    )
  }
}

export class LeafMeshAddPlaneOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Add Plane',
      toolpath: 'leafmesh.add_plane',
      icon    : Icons.MAKE_POLYGON ?? Icons.MESHTOOL,
      inputs  : {
        size: new FloatProperty(2.0),
      },
    }
  }

  exec(ctx: ToolContext): void {
    const size = (this.inputs as any).size?.getValue() ?? 2.0
    spawnLeafMeshPrimitive(ctx, 'Plane', (mesh) => makePlane(mesh, size))
  }
}

export class LeafMeshAddGridOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Add Grid',
      toolpath: 'leafmesh.add_grid',
      icon    : Icons.SHOW_GRID_FLOOR ?? Icons.MESHTOOL,
      inputs  : {
        nx  : new IntProperty(4),
        ny  : new IntProperty(4),
        size: new FloatProperty(2.0),
      },
    }
  }

  exec(ctx: ToolContext): void {
    const nx = (this.inputs as any).nx?.getValue() ?? 4
    const ny = (this.inputs as any).ny?.getValue() ?? 4
    const size = (this.inputs as any).size?.getValue() ?? 2.0
    spawnLeafMeshPrimitive(ctx, 'Grid', (mesh) => makeGrid(mesh, nx, ny, size))
  }
}

export class LeafMeshAddTubeOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Add Tube',
      toolpath: 'leafmesh.add_tube',
      icon    : Icons.MESHTOOL,
      inputs  : {
        segments   : new IntProperty(16),
        radius     : new FloatProperty(1.0),
        innerRadius: new FloatProperty(0.5),
        height     : new FloatProperty(1.0),
      },
    }
  }

  exec(ctx: ToolContext): void {
    const segments = (this.inputs as any).segments?.getValue() ?? 16
    const radius = (this.inputs as any).radius?.getValue() ?? 1.0
    const innerRadius = (this.inputs as any).innerRadius?.getValue() ?? 0.5
    const height = (this.inputs as any).height?.getValue() ?? 1.0
    spawnLeafMeshPrimitive(ctx, 'Tube', (mesh) => makeTube(mesh, segments, radius, innerRadius, height))
  }
}

export class LeafMeshAddMonkeyOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Add Monkey (Suzanne)',
      toolpath: 'leafmesh.add_monkey',
      icon    : Icons.MESHTOOL,
      inputs  : {
        size: new FloatProperty(2.0),
      },
    }
  }

  exec(ctx: ToolContext): void {
    const size = (this.inputs as any).size?.getValue() ?? 2.0
    spawnLeafMeshPrimitive(ctx, 'Suzanne', (mesh) => makeMonkey(mesh, size))
  }
}

export const LEAFMESH_PRIMITIVE_OPS = [
  LeafMeshAddCubeOp,
  LeafMeshAddUVSphereOp,
  LeafMeshAddIcoSphereOp,
  LeafMeshAddCylinderOp,
  LeafMeshAddConeOp,
  LeafMeshAddTorusOp,
  LeafMeshAddPlaneOp,
  LeafMeshAddGridOp,
  LeafMeshAddTubeOp,
  LeafMeshAddMonkeyOp,
]
