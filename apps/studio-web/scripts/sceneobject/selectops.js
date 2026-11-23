import {Vector2, Vector3} from '../util/vectormath.js'
import {IntProperty, BoolProperty, EnumProperty, ToolOp, ListProperty} from '../path.ux/scripts/pathux.js'
import {ObjectFlags} from './sceneobject.js'

import {SelMask, SelToolModes, SelOneToolModes} from '../core/select_types.js'

export class ObjectSelectOpBase extends ToolOp {
  constructor() {
    super()
  }

  static tooldef() {
    return {}
  }

  execPre() {
    window.redraw_viewport()
  }

  calcUndoMem(ctx) {
    return 256
  }

  undoPre(ctx) {
    let ud = (this._undo = {
      flags: {},
    })

    let scene = ctx.scene

    for (let ob of scene.objects) {
      ud.flags[ob.lib_id] = ob.flag
    }

    ud.active = scene.objects.active !== undefined ? scene.objects.active.lib_id : -1
    ud.highlight = scene.objects.highlight !== undefined ? scene.objects.highlight.lib_id : -1
  }

  undo(ctx) {
    let ud = this._undo
    let flags = ud.flags
    let datalib = ctx.datalib
    let scene = ctx.scene

    for (let k in flags) {
      let ob = datalib.get(Number(k))

      if (ob === undefined) {
        // eslint-disable-next-line no-console
        console.error('error in object select op base undo', k)
        continue
      }

      let flag = flags[k]

      scene.objects.setSelect(ob, flag & ObjectFlags.SELECT)
      ob.flag = flag
    }

    scene.objects.setActive(datalib.get(ud.active))
    scene.objects.setHighlight(datalib.get(ud.highlight))

    window.updateDataGraph()
    window.redraw_all()
  }
}

export class ObjectSelectOneOp extends ObjectSelectOpBase {
  constructor() {
    super()
  }

  static tooldef() {
    return {
      uiname  : 'Select One (Object)',
      name    : 'object_select',
      toolpath: 'object.selectone',
      icon    : -1,
      inputs: {
        mode     : new EnumProperty('UNIQUE', SelOneToolModes),
        objectId : new IntProperty(-1).private(),
        setActive: new BoolProperty(true),
      },
    }
  }

  static invoke(ctx, args) {
    let tool = new this()

    if ('mode' in args) {
      tool.inputs.mode.setValue(args.mode)
    }

    if ('objectId' in args) {
      tool.inputs.objectId.setValue(args.objectId)
    }

    if ('setActive' in args) {
      tool.inputs.setActive.setValue(args.setActive)
    }

    return tool
  }

  exec(ctx) {
    let mode = this.inputs.mode.getValue()
    let scene = ctx.scene
    let ob = this.inputs.objectId.getValue()

    ob = ctx.datalib.get(ob)

    if (ob === undefined) {
      // eslint-disable-next-line no-console
      console.error('error in SelectOneOp', ob, this.inputs.objectId.getValue())
      return
    }

    if (mode === SelOneToolModes.UNIQUE) {
      scene.objects.clearSelection()
      scene.objects.setSelect(ob, true)

      if (this.inputs.setActive.getValue()) {
        scene.objects.setActive(ob)
      }
    } else {
      if (this.inputs.setActive.getValue() && mode == SelOneToolModes.ADD) {
        scene.objects.setActive(ob)
      }

      scene.objects.setSelect(ob, mode === SelOneToolModes.ADD)
    }
  }
}

ToolOp.register(ObjectSelectOneOp)

export class ObjectToggleSelectOp extends ObjectSelectOpBase {
  constructor() {
    super()
  }

  static tooldef() {
    return {
      uiname  : 'Toggle Select All (Object)',
      name    : 'toggle_select_all',
      toolpath: 'object.toggle_select_all',
      icon    : -1,
      inputs: ToolOp.inherit({
        mode: new EnumProperty('AUTO', SelToolModes),
      }),
    }
  }

  static invoke(ctx, args) {
    let tool = new this()

    if ('mode' in args) {
      tool.inputs.mode.setValue(args.mode)
    }

    return tool
  }

  exec(ctx) {
    let mode = this.inputs.mode.getValue()
    let scene = ctx.scene

    if (mode == SelToolModes.AUTO) {
      mode = SelToolModes.ADD

      for (let ob of scene.objects.selected.editable) {
        mode = SelToolModes.SUB
        break
      }
    }

    for (let ob of scene.objects.editable) {
      scene.objects.setSelect(ob, mode == SelToolModes.ADD)
    }
  }
}

ToolOp.register(ObjectToggleSelectOp)

export class ObjectBoxSelectOp extends ObjectSelectOpBase {
  constructor() {
    super()

    this.mdown = false
    this._clearFirst = false
    this.start = new Vector2()
    this.end = new Vector2()
  }

  static tooldef() {
    return {
      uiname  : 'Box Select (Object)',
      name    : 'object_box_select',
      toolpath: 'object.select_box',
      icon    : -1,
      is_modal: true,
      inputs: ToolOp.inherit({
        mode     : new EnumProperty('ADD', SelToolModes),
        objectIds: new ListProperty(IntProperty).private(),
      }),
    }
  }

  static invoke(ctx, args) {
    const tool = new this()
    if (args?.mode !== undefined) {
      tool.inputs.mode.setValue(args.mode)
    }
    return tool
  }

  on_mousedown(e) {
    let view3d = this.modal_ctx.view3d
    let mpos = view3d.getLocalMouse(e.x, e.y)

    // Blender: plain box replaces selection; Shift extends; Ctrl subtracts.
    if (e.ctrlKey || e.metaKey) {
      this.inputs.mode.setValue(SelToolModes.SUB)
    } else if (e.shiftKey) {
      this.inputs.mode.setValue(SelToolModes.ADD)
    } else {
      // UNIQUE-style: clear first, then add hits.
      this.inputs.mode.setValue(SelToolModes.ADD)
      this._clearFirst = true
    }

    this.start.load(mpos)
    this.end.load(mpos)
    this.mdown = true
  }

  on_mousemove(e) {
    if (!this.mdown) {
      return
    }

    let view3d = this.modal_ctx.view3d
    this.end.load(view3d.getLocalMouse(e.x, e.y))
    this._drawRect(view3d)
  }

  on_mouseup(e) {
    let view3d = this.modal_ctx.view3d

    if (this.mdown) {
      this.end.load(view3d.getLocalMouse(e.x, e.y))
      this.sample(this.modal_ctx)
    }

    this.mdown = false

    if (view3d.overdraw) {
      view3d.overdraw.clear()
    }

    this.modalEnd(false)
  }

  _drawRect(view3d) {
    if (!view3d.overdraw) {
      return
    }

    view3d.overdraw.clear()

    let a = this.start
    let b = this.end
    let color = 'white'

    let p1 = [a[0], a[1]]
    let p2 = [b[0], a[1]]
    let p3 = [b[0], b[1]]
    let p4 = [a[0], b[1]]

    view3d.overdraw.line(p1, p2, color)
    view3d.overdraw.line(p2, p3, color)
    view3d.overdraw.line(p3, p4, color)
    view3d.overdraw.line(p4, p1, color)
  }

  sample(ctx) {
    let view3d = ctx.view3d

    let min = new Vector2([Math.min(this.start[0], this.end[0]), Math.min(this.start[1], this.end[1])])
    let max = new Vector2([Math.max(this.start[0], this.end[0]), Math.max(this.start[1], this.end[1])])

    // Ignore tiny accidental clicks (no selection change).
    if (max[0] - min[0] < 3 && max[1] - min[1] < 3) {
      return
    }

    let selmask = ctx.selectMask || SelMask.OBJECT
    let prop = this.inputs.objectIds
    prop.clear()

    for (let ob of view3d.sortedObjects) {
      if (ob.flag & ObjectFlags.HIDE) continue
      if (ob.flag & ObjectFlags.LOCKED) continue

      let hit = false
      if (ob.data && typeof ob.data.castScreenRect === 'function') {
        let ret = ob.data.castScreenRect(ctx, view3d, ob, selmask, min, max)
        hit = !!(ret && ret.elements && ret.elements.length > 0)
      } else {
        // Origin fallback for empties / data-less objects.
        let mat = ob.outputs?.matrix?.getValue?.()
        if (mat) {
          let origin = new Vector3()
          origin.multVecMatrix(mat)
          view3d.project(origin)
          hit =
            origin[0] >= min[0] &&
            origin[0] <= max[0] &&
            origin[1] >= min[1] &&
            origin[1] <= max[1]
        }
      }

      if (hit) {
        prop.push(ob.lib_id)
      }
    }

    this.exec(ctx)
  }

  exec(ctx) {
    let scene = ctx.scene
    let mode = this.inputs.mode.getValue()

    if (this._clearFirst && mode === SelToolModes.ADD) {
      for (let ob of scene.objects) {
        scene.objects.setSelect(ob, false)
      }
      this._clearFirst = false
    }

    for (let id of this.inputs.objectIds) {
      let ob = ctx.datalib.get(id)
      if (ob === undefined) {
        continue
      }
      if (ob.flag & ObjectFlags.LOCKED) continue

      scene.objects.setSelect(ob, mode !== SelToolModes.SUB)
      if (mode !== SelToolModes.SUB) {
        scene.objects.setActive(ob)
      }
    }

    window.redraw_viewport(true)
  }
}

ToolOp.register(ObjectBoxSelectOp)
