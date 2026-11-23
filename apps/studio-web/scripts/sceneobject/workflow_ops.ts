import {
  ToolOp,
  EnumProperty,
  FloatProperty,
  IntProperty,
} from '../path.ux/scripts/pathux'
import {
  readWorkflow,
  writeWorkflow,
  putKey,
  autoWeights,
  skinPositions,
  type V3,
} from '../core/object_workflows'
import {
  captureBase,
  storeWorkflow,
  transformKey,
  bakeScenePhysics,
  evaluateWorkflow,
} from './workflow_runtime'
import {Icons} from '../editors/icon_enum'
import type {ToolContext} from '../core/context'

export class ObjectWorkflowOp extends ToolOp<{
  action: EnumProperty
  index: IntProperty
  axis: IntProperty
  value: FloatProperty
}> {
  static tooldef() {
    return {
      toolpath: 'object.workflow',
      uiname  : 'Edit Object Workflow',
      icon    : Icons.EDITOR_SETTINGS,
      inputs: {
        action: new EnumProperty('KEY_INSERT', {
          KEY_INSERT   : 'KEY_INSERT',
          KEY_DELETE   : 'KEY_DELETE',
          LINEAR       : 'LINEAR',
          CONSTANT     : 'CONSTANT',
          MOD_TWIST    : 'MOD_TWIST',
          MOD_TAPER    : 'MOD_TAPER',
          MOD_BEND     : 'MOD_BEND',
          MOD_SET      : 'MOD_SET',
          MOD_TOGGLE   : 'MOD_TOGGLE',
          MOD_REMOVE   : 'MOD_REMOVE',
          MOD_UP       : 'MOD_UP',
          MOD_DOWN     : 'MOD_DOWN',
          MOD_APPLY    : 'MOD_APPLY',
          RIG_CREATE   : 'RIG_CREATE',
          RIG_ROTATE   : 'RIG_ROTATE',
          RIG_RESET    : 'RIG_RESET',
          RIG_UNBIND   : 'RIG_UNBIND',
          BODY_ACTIVE  : 'BODY_ACTIVE',
          BODY_PASSIVE : 'BODY_PASSIVE',
          BODY_REMOVE  : 'BODY_REMOVE',
          BODY_MASS    : 'BODY_MASS',
          BODY_BOUNCE  : 'BODY_BOUNCE',
          BODY_FRICTION: 'BODY_FRICTION',
        }),
        index : new IntProperty(0),
        axis  : new IntProperty(2),
        value : new FloatProperty(0).noUnits(),
      },
    }
  }
  exec(ctx: ToolContext) {
    const ob = ctx.object
    if (!ob) {
      ctx.warning('Select an object first')
      return
    }
    try {
      const state = readWorkflow(ob.workflow),
        action = this.inputs.action.getValue() as string
      const index = this.inputs.index.getValue(),
        axis = this.inputs.axis.getValue(),
        value = this.inputs.value.getValue()
      if (!Number.isFinite(value) || ![0, 1, 2].includes(axis))
        throw new Error('Invalid workflow input')
      const frame = Math.round(ctx.scene.time)
      if (action === 'KEY_INSERT') {
        if (
          state.keys.length >= 2000 &&
          !state.keys.some((key) => key.frame === frame)
        )
          throw new Error('An object supports up to 2000 keyframes')
        state.keys = putKey(state.keys, transformKey(ob, frame, state))
      } else if (action === 'KEY_DELETE')
        state.keys = state.keys.filter((key) => key.frame !== frame)
      else if (action === 'LINEAR' || action === 'CONSTANT')
        state.interpolation = action
      else if (['MOD_TWIST', 'MOD_TAPER', 'MOD_BEND'].includes(action)) {
        if (state.modifiers.length >= 32)
          throw new Error('A stack supports up to 32 modifiers')
        captureBase(ctx, ob, state)
        state.modifiers.push({
          type   : action.slice(4) as 'TWIST' | 'TAPER' | 'BEND',
          amount : action === 'MOD_TAPER' ? 0.25 : Math.PI / 4,
          axis   : 2,
          enabled: true,
        })
      } else if (action === 'MOD_APPLY') {
        if (state.rig)
          throw new Error('Unbind the rig before applying the modifier stack')
        state.modifiers = []
        delete state.base
      } else if (action.startsWith('MOD_')) {
        const modifier = state.modifiers[index]
        if (!modifier) throw new Error('Modifier no longer exists')
        if (action === 'MOD_SET') {
          modifier.amount = Math.max(-10, Math.min(10, value))
          modifier.axis = axis as 0 | 1 | 2
        }
        if (action === 'MOD_TOGGLE') modifier.enabled = !modifier.enabled
        if (action === 'MOD_REMOVE') state.modifiers.splice(index, 1)
        if (action === 'MOD_UP' && index > 0)
          [state.modifiers[index - 1], state.modifiers[index]] = [
            modifier,
            state.modifiers[index - 1],
          ]
        if (action === 'MOD_DOWN' && index + 1 < state.modifiers.length)
          [state.modifiers[index + 1], state.modifiers[index]] = [
            modifier,
            state.modifiers[index + 1],
          ]
      } else if (action === 'RIG_CREATE') {
        if (state.rig) throw new Error('This object already has a rig')
        captureBase(ctx, ob, state)
        const positions = state.base!.positions,
          min = [Infinity, Infinity, Infinity],
          max = [-Infinity, -Infinity, -Infinity]
        for (let i = 0; i < positions.length; i++) {
          const axis = i % 3
          min[axis] = Math.min(min[axis], positions[i])
          max[axis] = Math.max(max[axis], positions[i])
        }
        const x = (min[0] + max[0]) / 2,
          y = (min[1] + max[1]) / 2,
          height = Math.max(0.1, max[2] - min[2])
        const count = Math.max(1, Math.min(16, Math.round(value || 2)))
        const bones = Array.from({length: count}, (_, i) => ({
          name    : `Bone ${i + 1}`,
          parent  : i - 1,
          head    : [x, y, min[2] + (height * i) / count] as V3,
          tail    : [x, y, min[2] + (height * (i + 1)) / count] as V3,
          rotation: [0, 0, 0] as V3,
        }))
        state.rig = {bones, weights: autoWeights(positions, bones)}
      } else if (action === 'RIG_ROTATE') {
        const bone = state.rig?.bones[index]
        if (!bone) throw new Error('Bone no longer exists')
        bone.rotation[axis] =
          (Math.max(-3600, Math.min(3600, value)) * Math.PI) / 180
      } else if (action === 'RIG_RESET')
        state.rig?.bones.forEach((bone) => {
          bone.rotation = [0, 0, 0]
        })
      else if (action === 'RIG_UNBIND' && state.rig && state.base) {
        state.base.positions = skinPositions(state.base.positions, state.rig)
        delete state.rig
        if (!state.modifiers.length) delete state.base
      } else if (action === 'BODY_ACTIVE' || action === 'BODY_PASSIVE') {
        state.body = {
          type       : action === 'BODY_ACTIVE' ? 'ACTIVE' : 'PASSIVE',
          mass       : 1,
          restitution: 0.2,
          friction   : 0.5,
        }
      } else if (action === 'BODY_REMOVE') delete state.body
      else if (action.startsWith('BODY_') && state.body) {
        if (action === 'BODY_MASS')
          state.body.mass = Math.max(0.001, Math.min(10000, value))
        if (action === 'BODY_BOUNCE')
          state.body.restitution = Math.max(0, Math.min(1, value))
        if (action === 'BODY_FRICTION')
          state.body.friction = Math.max(0, Math.min(1, value))
      }
      storeWorkflow(ob, state, frame)
      if (
        action === 'LINEAR' ||
        action === 'CONSTANT' ||
        action === 'KEY_DELETE'
      ) {
        evaluateWorkflow(ob, frame, true)
        window.updateDataGraph?.(true)
      }
      if (state.base && (state.rig || state.modifiers.length))
        ctx.scene.switchToolMode('object')
      if (!state.modifiers.length && !state.rig && state.base) {
        delete state.base
        ob.workflow = writeWorkflow(state)
      }
    } catch (error) {
      ctx.error((error as Error).message)
    }
  }
}
ToolOp.register(ObjectWorkflowOp)

export class BakeObjectPhysicsOp extends ToolOp<{gravity: FloatProperty}> {
  static tooldef() {
    return {
      toolpath: 'scene.bake_box_physics',
      uiname  : 'Bake Box Rigid Bodies',
      icon    : Icons.PAN,
      inputs  : {gravity: new FloatProperty(-9.81).setRange(-100, 100)},
    }
  }
  exec(ctx: ToolContext) {
    try {
      bakeScenePhysics(ctx.scene, this.inputs.gravity.getValue())
      window.redraw_viewport(true)
    } catch (error) {
      ctx.error((error as Error).message)
    }
  }
}
ToolOp.register(BakeObjectPhysicsOp)
