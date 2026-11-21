import {ColumnFrame} from '../../path.ux/scripts/core/ui_containers'
import {UIBase} from '../../path.ux/scripts/core/ui_base'
import {readWorkflow, type ObjectWorkflow} from '../../core/object_workflows'
import {deformationSource} from '../../core/deformation_sources'
import type {ViewContext} from '../../core/context'

export class WorkflowPanel extends ColumnFrame<ViewContext> {
  category: 'Modifiers' | 'Rigging' | 'Animation' | 'Physics' = 'Animation'
  private lastKey = ''
  private root?: HTMLDivElement
  static define() {
    return {tagname: 'object-workflow-panel-x'}
  }
  init() {
    super.init()
    this.build()
  }
  update() {
    super.update()
    const key = `${this.category}|${this.ctx?.object?.lib_id}|${this.ctx?.object?.workflow}|${this.ctx?.scene?.time}`
    if (key !== this.lastKey) {
      this.lastKey = key
      this.build()
    }
  }
  private run(action: string, index = 0, axis = 2, value = 0) {
    if (!Number.isFinite(value)) return
    this.ctx.api.execTool(this.ctx, 'object.workflow()', {
      action,
      index,
      axis,
      value,
    })
  }
  private text(text: string) {
    const el = document.createElement('p')
    el.textContent = text
    el.style.cssText = 'margin:6px 0;color:#bbb;line-height:1.5'
    this.root!.appendChild(el)
  }
  private actionButton(text: string, action: () => void) {
    const button = document.createElement('button')
    button.textContent = text
    button.type = 'button'
    button.addEventListener('click', () => {
      try {
        action()
      } catch (error) {
        this.ctx.error((error as Error).message)
      }
    })
    this.root!.appendChild(button)
    return button
  }
  private number(
    label: string,
    value: number,
    onChange: (value: number) => void,
    step = '0.1'
  ) {
    const row = document.createElement('label')
    row.textContent = label
    const input = document.createElement('input')
    input.type = 'number'
    input.value = String(Math.round(value * 10000) / 10000)
    input.step = step
    input.setAttribute('aria-label', label)
    input.addEventListener('change', () => {
      if (Number.isFinite(input.valueAsNumber)) onChange(input.valueAsNumber)
    })
    row.appendChild(input)
    this.root!.appendChild(row)
  }
  private build() {
    if (!this.ctx?.scene) return
    this.root?.remove()
    const root = (this.root = document.createElement('div'))
    root.className = 'object-workflow-panel'
    root.style.cssText =
      'padding:8px;min-width:0;font:11px system-ui;color:#ddd'
    const style = document.createElement('style')
    style.textContent = `.object-workflow-panel button {background:#414141;color:#eee;border:1px solid #555;border-radius:3px;padding:5px 8px;margin:3px 3px 3px 0;cursor:pointer;font:11px system-ui}
      .object-workflow-panel button:hover {background:#555}.object-workflow-panel button:focus-visible,.object-workflow-panel input:focus-visible {outline:2px solid #85b5ff}
      .object-workflow-panel label {display:flex;align-items:center;justify-content:space-between;gap:8px;margin:5px 0}
      .object-workflow-panel input {min-width:0;width:95px;border:1px solid #555;background:#3d3d3d;color:#eee;border-radius:2px;padding:4px;font:11px system-ui}
      .object-workflow-panel h3 {font:600 12px system-ui;margin:8px 0;border-bottom:1px solid #444;padding-bottom:6px}`
    root.appendChild(style)
    this.shadow.appendChild(root)
    const ob = this.ctx.object
    if (!ob) {
      this.text('Select an object to edit its workflow.')
      return
    }
    let state: ObjectWorkflow
    try {
      state = readWorkflow(ob.workflow)
    } catch (error) {
      this.text((error as Error).message)
      return
    }
    const title = document.createElement('h3')
    title.textContent = `${ob.name} · ${this.category}`
    root.appendChild(title)
    if (this.category === 'Animation') {
      this.number(
        'Current Frame',
        this.ctx.scene.time,
        (value) => this.ctx.scene.changeTime(Math.round(value)),
        '1'
      )
      this.number(
        'Start Frame',
        this.ctx.scene.timeStart,
        (value) => {
          this.ctx.scene.timeStart = Math.round(value)
        },
        '1'
      )
      this.number(
        'End Frame',
        this.ctx.scene.timeEnd,
        (value) => {
          this.ctx.scene.timeEnd = Math.round(value)
        },
        '1'
      )
      this.number(
        'Frame Rate',
        this.ctx.scene.fps,
        (value) => {
          this.ctx.scene.fps = Math.max(1, Math.min(120, Math.round(value)))
        },
        '1'
      )
      this.actionButton('Insert Keyframe', () => this.run('KEY_INSERT'))
      this.actionButton('Delete Keyframe', () => this.run('KEY_DELETE'))
      this.text(
        `Interpolation: ${state.interpolation.toLowerCase()} · ${state.keys.length} keys`
      )
      this.actionButton('Linear', () => this.run('LINEAR'))
      this.actionButton('Constant', () => this.run('CONSTANT'))
      this.text(
        'Keys store location, Euler rotation, scale and the current FK pose. Open the Animation workspace to scrub and play.'
      )
      for (const key of state.keys.slice(0, 20))
        this.actionButton(`Frame ${key.frame}`, () =>
          this.ctx.scene.changeTime(key.frame)
        )
      return
    }
    if (!deformationSource(ob.data)) {
      this.text('Select a mesh to use this workflow.')
      return
    }
    if (this.category === 'Modifiers') {
      this.text(
        'Non-destructive deformation stack. Amount is per object-space unit; bend and twist use radians. Apply before editing topology.'
      )
      for (const type of ['TWIST', 'TAPER', 'BEND'])
        this.actionButton(`Add ${type[0] + type.slice(1).toLowerCase()}`, () =>
          this.run(`MOD_${type}`)
        )
      state.modifiers.forEach((modifier, index) => {
        const heading = document.createElement('h3')
        heading.textContent = `${index + 1}. ${modifier.type.toLowerCase()} ${modifier.enabled ? '' : '(disabled)'}`
        root.appendChild(heading)
        this.number(`Modifier ${index + 1} Amount`, modifier.amount, (value) =>
          this.run('MOD_SET', index, modifier.axis, value)
        )
        for (const [axis, label] of ['X', 'Y', 'Z'].entries())
          this.actionButton(
            `${label}${axis === modifier.axis ? ' ✓' : ''}`,
            () => this.run('MOD_SET', index, axis, modifier.amount)
          )
        this.actionButton(modifier.enabled ? 'Disable' : 'Enable', () =>
          this.run('MOD_TOGGLE', index)
        )
        this.actionButton('Move Up', () => this.run('MOD_UP', index))
        this.actionButton('Move Down', () => this.run('MOD_DOWN', index))
        this.actionButton('Remove', () => this.run('MOD_REMOVE', index))
      })
      if (state.modifiers.length)
        this.actionButton('Apply Stack', () => this.run('MOD_APPLY'))
      if (state.rig) this.text('Unbind the rig before applying the stack.')
    } else if (this.category === 'Rigging') {
      this.text(
        'FK bone chain with automatic two-bone weights. Posing deforms the mesh; keyframes include bone rotations.'
      )
      if (!state.rig) {
        this.actionButton('Bind 2-Bone Rig', () =>
          this.run('RIG_CREATE', 0, 2, 2)
        )
        this.actionButton('Bind 3-Bone Rig', () =>
          this.run('RIG_CREATE', 0, 2, 3)
        )
      } else {
        state.rig.bones.forEach((bone, index) => {
          const title = document.createElement('h3')
          title.textContent = `${bone.name} · ${bone.parent < 0 ? 'root' : `child of ${bone.parent + 1}`}`
          root.appendChild(title)
          for (const [axis, name] of ['X', 'Y', 'Z'].entries())
            this.number(
              `${bone.name} Rotation ${name}`,
              (bone.rotation[axis] * 180) / Math.PI,
              (value) => this.run('RIG_ROTATE', index, axis, value),
              '1'
            )
        })
        this.actionButton('Reset Pose', () => this.run('RIG_RESET'))
        this.actionButton('Insert Pose Keyframe', () => this.run('KEY_INSERT'))
        this.actionButton('Unbind (Keep Pose)', () => this.run('RIG_UNBIND'))
      }
    } else {
      this.text(
        'Translational box rigid bodies: gravity, box contacts, bounce and friction. No angular motion, cloth or soft bodies. Bake writes transform keyframes over the scene range.'
      )
      this.actionButton('Active Body', () => this.run('BODY_ACTIVE'))
      this.actionButton('Passive Collider', () => this.run('BODY_PASSIVE'))
      if (state.body) {
        this.text(
          `${state.body.type.toLowerCase()} · axis-aligned box collision`
        )
        this.number('Mass', state.body.mass, (value) =>
          this.run('BODY_MASS', 0, 2, value)
        )
        this.number('Restitution', state.body.restitution, (value) =>
          this.run('BODY_BOUNCE', 0, 2, value)
        )
        this.number('Friction', state.body.friction, (value) =>
          this.run('BODY_FRICTION', 0, 2, value)
        )
        this.actionButton('Remove Body', () => this.run('BODY_REMOVE'))
      }
      this.actionButton('Bake Physics to Keyframes', () =>
        this.ctx.api.execTool(this.ctx, 'scene.bake_box_physics()')
      )
      this.text(
        'Use a passive floor mesh and an active object above it. Maximum: 64 bodies and 1000 frames. Previous keys in the bake range are replaced; Undo restores them.'
      )
    }
  }
}
UIBase.register(WorkflowPanel)
