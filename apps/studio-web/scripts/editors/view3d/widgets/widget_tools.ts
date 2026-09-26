import {Vector3, Vector4, Matrix4} from '../../../util/vectormath.js'
import {SelMask} from '../../../core/select_types.js'

import {WidgetBase, WidgetSphere, WidgetFlags, WidgetManager} from './widgets.js'
import {TranslateOp, ScaleOp, RotateOp} from '../transform/transform_ops.js'
import {type TransCenterResult} from '../transform/transform_query.js'
import {Icons} from '../../icon_enum.js'
import type {ViewContext} from '../../../core/context.js'
import type {Container} from '../../../path.ux/scripts/core/ui.js'

/**
 * The Move / Rotate / Scale / Disable buttons a tool-mode header offers, next to
 * its own controls — the Gizmo dropdown of a viewport header, in one place so
 * every mode shows the same four buttons in the same order.
 *
 * `scene.tool.transformWidget` resolves against the *active* tool mode, whose enum
 * is built from its own `transWidgets` list, so a mode that declares no transform
 * widgets gets a row of dead buttons: see `ToolMode.getTransformProp`.
 */
export function buildTransformWidgetRow(strip: Container<ViewContext>): void {
  strip.useIcons()
  strip.prop('scene.tool.transformWidget[NONE]')
  strip.prop('scene.tool.transformWidget[translate]')
  strip.prop('scene.tool.transformWidget[scale]')
  strip.prop('scene.tool.transformWidget[rotate]')
}

export class WidgetSceneCursor extends WidgetBase {
  constructor() {
    super()
  }

  get isDead() {
    return !this.manager.ctx.view3d._showCursor()
  }

  static widgetDefine() {
    return {
      description: 'Cursor Widget',
      uiname     : 'cursor',
      name       : 'cursor',
      selMask    : undefined,
      flag       : WidgetFlags.IGNORE_EVENTS,
      icon       : -1,
    }
  }

  update(): this {
    super.update()
    const view3d = this.manager.ctx.view3d

    if (this.shape === undefined) {
      this.shape = new WidgetSphere()
      this.shape.shapeid = 'CURSOR'
    }

    this.matrix.load(view3d.cursor3D)
    this.matrix.scale(0.15, 0.15, 0.15)
    return this
  }
}

export class NoneWidget extends WidgetBase {
  static widgetDefine() {
    return {
      description: 'Disable Widget',
      uiname     : 'Disable widgets',
      name       : 'none',
      icon       : -1,
      flag       : 0,
    }
  }

  static validate(ctx: ViewContext) {
    return true
  }
}

export class TransformWidget extends WidgetBase {
  /**
   * The transform widgets only ever move *objects*, so they are offered whenever an
   * object is selected — deliberately not gated on the select mask. The mask is a
   * mesh-editing idea (the sculpt and box-model toolmodes set `SelMask.VERTEX`), and
   * gating on it meant the object gizmo vanished the moment the app started in a
   * mesh toolmode, which is where it starts by default.
   */
  static validate(ctx: ViewContext) {
    return Array.from(ctx.selectedObjects).length > 0
  }

  create(ctx: ViewContext, manager: WidgetManager) {}

  /** space: see ConstraintSpaces */
  getTransMatrix(space: number): Matrix4 {
    if (!this.ctx?.view3d) {
      return new Matrix4()
    }

    const view3d = this.ctx.view3d
    return new Matrix4(view3d.getTransMatrix(space))
  }

  /**
   * The union of the selected objects' bounds.
   *
   * `view3d.getTransBounds()` answers a different question — "what would a transform
   * op act on, given the current select mask" — so in a mesh select mode it reports
   * the selected *geometry*, which for an object gizmo is either empty or the wrong
   * box. That is treated as "no bounds" here rather than as a box of no size, which
   * would leave the gizmo with no scale and nowhere to sit.
   */
  getSelectedBounds(): [Vector3, Vector3] | undefined {
    let ret: [Vector3, Vector3] | undefined

    for (const ob of this.ctx?.selectedObjects ?? []) {
      const bbox = ob.getBoundingBox()

      if (bbox === undefined) {
        continue
      }

      if (ret === undefined) {
        ret = [new Vector3(bbox[0]), new Vector3(bbox[1])]
      } else {
        for (let i = 0 as 0 | 1 | 2; i < 3; i = (i + 1) as 0 | 1 | 2) {
          ret[0][i] = Math.min(ret[0][i], bbox[0][i])
          ret[1][i] = Math.max(ret[1][i], bbox[1][i])
        }
      }
    }

    return ret
  }

  /** The select-mask-independent bounds: the mask's answer only when it has size. */
  getTransBounds(): [Vector3, Vector3] | undefined {
    const aabb = this.ctx?.view3d?.getTransBounds()

    if (aabb !== undefined && aabb[0].vectorDistance(aabb[1]) > 0) {
      return [new Vector3(aabb[0]), new Vector3(aabb[1])]
    }

    return this.getSelectedBounds() ?? (aabb as [Vector3, Vector3] | undefined)
  }

  getTransAABB(): [Vector3, Vector3] {
    const aabb = this.getTransBounds()

    if (!aabb) {
      window.redraw_viewport()

      const d = 0.00001
      return [new Vector3([-d, -d, -d]), new Vector3([d, d, d])]
    }

    //console.log(new Vector3(aabb[1]).sub(aabb[0]));

    return aabb
  }

  getTransCenter(): TransCenterResult | {center: Vector3} {
    if (!this.ctx?.view3d) {
      window.redraw_viewport()
      return {center: new Vector3()}
    }

    const ret = this.ctx.view3d.getTransCenter()
    const aabb = this.getTransBounds()

    if (!aabb) {
      if (ret) {
        ret.center = new Vector3()
        return ret
      } else {
        return {
          center: new Vector3(),
        }
      }
    }

    //use aabb midpoint instead of median center
    ret.center = new Vector3(aabb[0]).interp(aabb[1], 0.5)

    return ret
  }

  update(): this {
    return super.update()
  }
}

export class ThreeAxisWidget extends TransformWidget {
  axes?: WidgetBase[]
  center_widget?: WidgetBase
  plane_axes?: WidgetBase[]

  update(): this {
    super.update()

    const x = this.axes![0]
    const y = this.axes![1]
    const z = this.axes![2]

    const ret = this.getTransCenter()

    this.center_widget!.matrix.makeIdentity()
    const sz = 0.4
    this.center_widget!.matrix.scale(sz, sz, sz)

    const p = new Vector3(ret.center)
    this.ctx!.view3d.project(p)

    const mat = new Matrix4() //XXX get proper matrix space transform
    if ('spaceMatrix' in ret) {
      mat.multiply(ret.spaceMatrix)
    }
    const mat2 = new Matrix4()
    mat2.translate(ret.center[0], ret.center[1], ret.center[2])

    mat.multiply(mat2)
    this.setMatrix(mat)

    const xmat = new Matrix4()
    const ymat = new Matrix4()

    let scale = 1.0
    const toff = 1.0
    const scale2 = 1.0 //scale*1.5;

    xmat.euler_rotate(0.0, Math.PI * 0.5, 0.0)
    xmat.translate(0.0, 0.0, toff)
    xmat.scale(scale, scale, scale2)

    ymat.euler_rotate(Math.PI * 0.5, 0.0, 0.0)
    ymat.translate(0.0, 0.0, toff)
    ymat.scale(scale, scale, scale2)

    const zmat = new Matrix4()
    zmat.translate(0.0, 0.0, toff)
    zmat.scale(scale, scale, scale2)

    x.setMatrix(xmat)
    y.setMatrix(ymat)
    z.setMatrix(zmat)

    if (!this.plane_axes) {
      return this
    }

    const px = this.plane_axes[0]
    const py = this.plane_axes[1]
    const pz = this.plane_axes[2]

    xmat.makeIdentity()
    ymat.makeIdentity()
    zmat.makeIdentity()

    scale *= 0.6
    const fac = 0.6

    xmat.euler_rotate(0.0, Math.PI * 0.5, 0.0)
    xmat.translate(-toff * fac, -toff * fac, 0.0)
    xmat.scale(scale, scale, scale)

    ymat.euler_rotate(Math.PI * 0.5, 0.0, 0.0)
    ymat.translate(toff * fac, toff * fac, 0.0)
    ymat.scale(scale, scale, scale)

    zmat.euler_rotate(0.0, 0.0, 0.0)
    zmat.translate(toff * fac, -toff * fac, 0.0)
    zmat.scale(scale, scale, scale)

    px.setMatrix(xmat)
    py.setMatrix(ymat)
    pz.setMatrix(zmat)

    return this
  }
}

export class TranslateWidget extends ThreeAxisWidget {
  constructor() {
    super()
    this.axes = undefined
  }

  static widgetDefine() {
    return {
      description: 'Move Widget',
      uiname     : 'Move',
      name       : 'translate',
      icon       : Icons.TRANSLATE,
      flag       : 0,
    }
  }

  create(ctx: ViewContext, manager: WidgetManager) {
    super.create(ctx, manager)

    const center = (this.center_widget = this.getSphere(undefined, new Vector4([0.5, 0.5, 0.5, 1.0])))

    const px = this.getPlane(undefined, new Vector4([1, 0, 0, 0.5])) //"rgba(255, 0, 0, 0.8)");
    const py = this.getPlane(undefined, 'rgba(0, 255, 0, 0.2)')
    const pz = this.getPlane(undefined, 'rgba(0, 0, 255, 0.2)')
    this.plane_axes = [px, py, pz]

    const x = this.getArrow(undefined, 'red')
    const y = this.getArrow(undefined, 'green')
    const z = this.getArrow(undefined, 'blue')

    this.axes = [x, y, z]

    center.on_mousedown = (e: PointerEvent, localX: number, localY: number) => {
      this.startTool(-1, localX, localY, e)
      return true
    }

    x.on_mousedown = (e: PointerEvent, localX: number, localY: number) => {
      this.startTool(0, localX, localY, e)
      return true
    }
    y.on_mousedown = (e: PointerEvent, localX: number, localY: number) => {
      this.startTool(1, localX, localY, e)
      return true
    }
    z.on_mousedown = (e: PointerEvent, localX: number, localY: number) => {
      this.startTool(2, localX, localY, e)
      return true
    }

    px.on_mousedown = (e: PointerEvent, localX: number, localY: number) => {
      this.startTool(3, localX, localY, e)
      return true
    }
    py.on_mousedown = (e: PointerEvent, localX: number, localY: number) => {
      this.startTool(4, localX, localY, e)
      return true
    }
    pz.on_mousedown = (e: PointerEvent, localX: number, localY: number) => {
      this.startTool(5, localX, localY, e)
      return true
    }
  }

  startTool(axis: number, localX: number, localY: number, e?: PointerEvent) {
    const tool = TranslateOp.invoke(this.ctx!, {}) //new TranslateOp([localX, localY]);
    const con = new Vector3()

    // The gizmo is the *object* gizmo, so it transforms objects whatever the
    // current mesh select mode is (sculpt runs in VERTEX), exactly as Blender's
    // Move gizmo does. Using the view's mask here made a gizmo drag in sculpt mode
    // try to move vertices instead.
    tool.inputs.selmask.setValue(SelMask.OBJECT)

    if (axis >= 0) {
      if (axis > 2) {
        axis -= 3
        con[(axis + 1) % 3] = 1.0
        con[(axis + 2) % 3] = 1.0
      } else {
        con[axis] = 1.0
      }

      tool.inputs.constraint.setValue(con)
    }

    this.execTool(this.ctx!, tool, e)
  }

  update(): this {
    if (this.axes === undefined) {
      this.create(this.ctx!, this.manager)
    }

    return super.update()
  }
}

export class ScaleWidget extends ThreeAxisWidget {
  constructor() {
    super()

    this.axes = undefined
  }

  static widgetDefine() {
    return {
      description: 'Scale Widget',
      uiname     : 'Scale',
      name       : 'scale',
      icon       : Icons.SCALE_WIDGET,
      flag       : 0,
    }
  }

  create(ctx: ViewContext, manager: WidgetManager) {
    super.create(ctx, manager)

    const center = (this.center_widget = this.getSphere(undefined, new Vector4([0.5, 0.5, 0.5, 1.0])))

    const x = this.getBlockArrow(undefined, 'red')
    const y = this.getBlockArrow(undefined, 'green')
    const z = this.getBlockArrow(undefined, 'blue')

    //manager.remove(x);
    //manager.remove(y);
    //manager.remove(z);
    //manager.remove(px);
    //manager.remove(py);
    //manager.remove(center);

    this.axes = [x, y, z]

    center.on_mousedown = (e: PointerEvent, localX: number, localY: number) => {
      this.startTool(-1, localX, localY, e)
      return true
    }

    x.on_mousedown = (e: PointerEvent, localX: number, localY: number) => {
      this.startTool(0, localX, localY, e)
      return true
    }
    y.on_mousedown = (e: PointerEvent, localX: number, localY: number) => {
      this.startTool(1, localX, localY, e)
      return true
    }
    z.on_mousedown = (e: PointerEvent, localX: number, localY: number) => {
      this.startTool(2, localX, localY, e)
      return true
    }

    return this.update()
  }

  startTool(axis: number, localX: number, localY: number, e?: PointerEvent) {
    const tool = ScaleOp.invoke(this.ctx!, {}) //new ScaleOp([localX, localY]);
    const con = new Vector3()

    // Object gizmo, whatever the mesh select mode — see TranslateWidget.startTool.
    tool.inputs.selmask.setValue(SelMask.OBJECT)

    if (axis >= 0) {
      con[axis] = 1.0

      tool.inputs.constraint.setValue(con)
    }

    this.execTool(this.ctx!, tool, e)
  }

  update(): this {
    if (this.axes === undefined) {
      this.create(this.ctx!, this.manager)
    }

    super.update()
    return this
  }
}

export class RotateWidget extends TransformWidget {
  _first: boolean
  axes?: WidgetBase[]

  constructor() {
    super()

    this._first = true
  }

  static widgetDefine() {
    return {
      description: 'Rotate Widget',
      uiname     : 'Rotate',
      name       : 'rotate',
      icon       : Icons.ROTATE,
      flag       : 0,
    }
  }

  static nodedef() {
    return {
      ...super.nodedef(),
      name: 'rotate_widget',
    }
  }

  create(ctx: ViewContext, manager: WidgetManager) {
    super.create(ctx, manager)

    this._first = false

    this.axes = [
      this.getTorus(new Matrix4(), new Vector4([1, 0, 0, 1])),
      this.getTorus(new Matrix4(), new Vector4([0, 1, 0, 1])),
      this.getTorus(new Matrix4(), new Vector4([0, 0, 1, 1])),
      //this.getTorus(new Matrix4(), new Vector4([1, 1, 1, 1])) //view axis
    ]

    const makeonclick = (axis: number) => {
      return (e: PointerEvent) => {
        this._handleClick(e, axis)
      }
    }

    for (let i = 0; i < this.axes.length; i++) {
      this.axes[i].onclick = makeonclick(i)
    }
  }

  _handleClick(e: PointerEvent, axis: number) {
    const op = new RotateOp()
    const con = new Vector3()
    con[axis] = 1.0

    op.inputs.constraint.setValue(con)
    // Object gizmo, whatever the mesh select mode — see TranslateWidget.startTool.
    op.inputs.selmask.setValue(SelMask.OBJECT)

    this.execTool(this.ctx!, op, e)
  }

  draw(gl: WebGL2RenderingContext, manager: WidgetManager, matrix?: Matrix4) {
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)

    super.draw(gl, manager, matrix)

    gl.disable(gl.DEPTH_TEST)
  }

  update(): this {
    if (!this.ctx?.view3d) {
      return this
    }

    if (this._first) {
      this.create(this.ctx!, this.manager)
    }
    super.update()
    return this
  }
}
