/**
 * Blender Add menu extras — Camera and Empty (Shift-A / menubar Add).
 *
 * Lights already live in `light.new`. Mesh primitives come from leafmesh/litemesh
 * addon menu entries. These two close the next gap against Blender's Add menu.
 */
import {Vector3} from '../util/vectormath.js'
import {ToolOp, Vec3Property} from '../path.ux/scripts/pathux.js'
import {Icons} from '../editors/icon_enum.js'
import {SceneObject} from './sceneobject.js'
import {CameraData} from '../camera/camera.js'
import {NullObject} from '../nullobject/nullobject.js'

function placeAtCursor(ctx, inputs) {
  let co = inputs.position.getValue()
  if (!inputs.position.wasSet && ctx.scene) {
    co = new Vector3()
    co.multVecMatrix(ctx.scene.cursor3D)
  }
  return co
}

export class AddCameraOp extends ToolOp {
  static invoke(ctx, args) {
    const tool = new this()
    if (args?.position === 'cursor') {
      const co = new Vector3()
      co.multVecMatrix(ctx.view3d.cursor3D)
      tool.inputs.position.setValue(co)
    }
    return tool
  }

  static tooldef() {
    return {
      uiname     : 'Add Camera',
      description: 'Add a camera object',
      toolpath   : 'object.add_camera',
      icon       : Icons.RENDER,
      inputs     : {
        position: new Vec3Property(),
      },
    }
  }

  exec(ctx) {
    const data = new CameraData()
    ctx.datalib.add(data)

    const ob = new SceneObject(data)
    ob.name = 'Camera'
    ob.inputs.loc.setValue(placeAtCursor(ctx, this.inputs))

    ctx.datalib.add(ob)
    ctx.scene.add(ob)
    ctx.scene.objects.clearSelection()
    ctx.scene.objects.setSelect(ob, true)
    ctx.scene.objects.setActive(ob)
    window.redraw_viewport?.(true)
  }
}

export class AddEmptyOp extends ToolOp {
  static invoke(ctx, args) {
    const tool = new this()
    if (args?.position === 'cursor') {
      const co = new Vector3()
      co.multVecMatrix(ctx.view3d.cursor3D)
      tool.inputs.position.setValue(co)
    }
    return tool
  }

  static tooldef() {
    return {
      uiname     : 'Add Empty',
      description: 'Add an empty (transform-only) object',
      toolpath   : 'object.add_empty',
      icon       : Icons.CURSOR_ARROW,
      inputs     : {
        position: new Vec3Property(),
      },
    }
  }

  exec(ctx) {
    // Blender Empty: NullObject datablock (axes locator), not a mesh.
    const data = new NullObject()
    ctx.datalib.add(data)

    const ob = new SceneObject(data)
    ob.name = 'Empty'
    ob.inputs.loc.setValue(placeAtCursor(ctx, this.inputs))

    ctx.datalib.add(ob)
    ctx.scene.add(ob)
    ctx.scene.objects.clearSelection()
    ctx.scene.objects.setSelect(ob, true)
    ctx.scene.objects.setActive(ob)
    window.redraw_viewport?.(true)
  }
}

ToolOp.register(AddCameraOp)
ToolOp.register(AddEmptyOp)
