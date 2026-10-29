/**
 * Applies Copilot and generative commands inside the editor, as one undo step.
 *
 * The Studio API still only proposes calls. This module is the command system
 * on the editor side: primitives, transforms, materials, deletes, groups, an
 * imported GLB, and a PBR map assignment.
 */
import {
  applySceneCommands,
  type CommandEditor,
  type MeshBuffers,
  type PbrAssignment,
  type SceneCommand,
  type SceneObjectRef,
} from '../../../../packages/studio-engine/src/generative/index.ts'
import {ToolOp, Vector3, Vector4} from '../path.ux/pathux.js'
import {DiffuseNode} from '../shadernodes/shader_nodes.js'

export interface SceneCommandIo {
  importBuffers(
    ctx: any,
    name: string,
    buffers: MeshBuffers,
    location: readonly [number, number, number],
    scale: readonly [number, number, number],
  ): string
  importGlb(
    ctx: any,
    name: string,
    bytes: Uint8Array,
    location: readonly [number, number, number],
    scale: readonly [number, number, number],
  ): string
  applyMaps(ctx: any, objectId: string, maps: PbrAssignment): void
}

interface PreparedCall {
  readonly buffers?: MeshBuffers
  readonly glb?: Uint8Array
  readonly maps?: PbrAssignment
  readonly note: string
}

export function commandsForToolCalls(
  calls: readonly {name: string; input: Record<string, unknown>}[],
  prepared: readonly (PreparedCall | null)[],
): SceneCommand[] {
  return calls.map((call, index) => {
    const prep = prepared[index] ?? null
    if (call.name === 'generateMesh') {
      if (!prep || (!prep.buffers && !prep.glb)) {
        return {kind: 'skip', summary: prep?.note ?? 'Image-to-3D did not produce a mesh.'}
      }
      const name = typeof call.input.name === 'string' ? call.input.name : 'AI draft'
      return {
        kind: 'mesh',
        name,
        ...(prep.buffers ? {buffers: prep.buffers} : {}),
        ...(prep.glb ? {glb: prep.glb} : {}),
        location: [0, 0, 0],
        scale: [1, 1, 1],
        note: prep.note,
      }
    }
    if (call.name === 'generateTexture') {
      if (!prep?.maps) return {kind: 'skip', summary: prep?.note ?? 'The texture prompt did not produce maps.'}
      const objectId = typeof call.input.objectId === 'string' ? call.input.objectId : '$active'
      return {kind: 'maps', objectId, maps: prep.maps, note: prep.note}
    }
    if (call.name === 'applyModifier') {
      return {kind: 'skip', summary: 'This editor has no modifier stack, so the modifier was not applied.'}
    }
    return {kind: 'call', name: call.name, input: call.input}
  })
}

function liveContext(ctx: any): any {
  return (window as any)._appstate?.ctx ?? ctx
}

class CopilotCommandOp extends ToolOp {
  runner: ((ctx: any) => void) | null = null

  static tooldef() {
    return {
      uiname  : 'Copilot command',
      toolpath: 'voidspace.copilot_command',
      inputs  : {},
      outputs : {},
    }
  }

  exec(ctx: any): void {
    this.runner?.(liveContext(ctx))
  }

  /**
   * The stack's default redo runs undoPre first, which replaces the saved file
   * with the undone one, then re-executes against the context captured at the
   * first run. That context is no longer the live scene, so the mesh never
   * comes back. Re-apply on the live scene and leave the original snapshot alone.
   */
  override redo(ctx: any): void {
    this._was_redo = true
    this.runner?.(liveContext(ctx))
  }
}

let registered = false

function ensureRegistered(): void {
  if (registered) return
  ToolOp.register(CopilotCommandOp)
  registered = true
}

function objectId(ob: any): string {
  return String(ob?.lib_id ?? ob?.id ?? ob?.name ?? '')
}

function sceneObjects(ctx: any): any[] {
  return ctx?.scene?.objects ? [...ctx.scene.objects] : []
}

function findObject(ctx: any, id: string): any | undefined {
  return sceneObjects(ctx).find((ob) => objectId(ob) === id || String(ob?.name ?? '') === id)
}

function writeVector(target: any, values: readonly [number, number, number]): void {
  const vector = new Vector3()
  vector[0] = values[0]
  vector[1] = values[1]
  vector[2] = values[2]
  target.setValue(vector)
  target.graphUpdate?.()
}

function hexToRgba(hex: string): [number, number, number, number] {
  let body = hex.trim().replace('#', '')
  if (body.length === 3) body = body.split('').map((char) => char + char).join('')
  if (body.length < 6) return [0.8, 0.8, 0.8, 1]
  return [
    Number.parseInt(body.slice(0, 2), 16) / 255,
    Number.parseInt(body.slice(2, 4), 16) / 255,
    Number.parseInt(body.slice(4, 6), 16) / 255,
    1,
  ]
}

function diffuseNode(ob: any): any | null {
  const mat = ob?.material || ob?.data?.material || ob?.data?.materials?.[0]
  const nodes = mat?.graph?.nodes
  if (!nodes) return null
  for (const node of nodes) {
    if (node instanceof DiffuseNode || node?.constructor?.name === 'DiffuseNode') return node
  }
  return null
}

function editorFor(ctx: any, io: SceneCommandIo): CommandEditor {
  const refs = (): SceneObjectRef[] =>
    sceneObjects(ctx)
      .filter((ob) => objectId(ob).length > 0)
      .map((ob) => ({
        id        : objectId(ob),
        name      : String(ob?.name ?? 'Object'),
        childCount: Array.isArray(ob?.children) ? ob.children.length : 0,
      }))

  return {
    list: refs,
    activeId: () => {
      const active = ctx?.scene?.objects?.active
      return active ? objectId(active) : null
    },
    addMesh: (name, buffers, location, scale) => io.importBuffers(ctx, name, buffers, location, scale),
    importGlb: (name, bytes, location, scale) => io.importGlb(ctx, name, bytes, location, scale),
    setTransform: (id, change) => {
      const ob = findObject(ctx, id)
      if (!ob?.inputs) throw new Error(`Could not transform ${id}.`)
      if (change.translate) writeVector(ob.inputs.loc, change.translate)
      if (change.rotateDegrees) {
        const radians = change.rotateDegrees.map((degree) => (degree * Math.PI) / 180) as [
          number,
          number,
          number,
        ]
        writeVector(ob.inputs.rot, radians)
      }
      if (change.scale) writeVector(ob.inputs.scale, change.scale)
      ob.graphUpdate?.()
    },
    setMaterial: (id, property, value) => {
      const ob = findObject(ctx, id)
      if (!ob) throw new Error(`Could not find ${id} to change its material.`)
      const mat = ob.material || ob.data?.material || ob.data?.materials?.[0]
      const diffuse = diffuseNode(ob)
      if (property === 'roughness' && typeof value === 'number' && diffuse?.inputs?.roughness) {
        diffuse.inputs.roughness.setValue(value)
      } else if ((property === 'baseColor' || property === 'emissive') && typeof value === 'string' && diffuse?.inputs?.color) {
        const [r, g, b, a] = hexToRgba(value)
        const color = new Vector4()
        color[0] = r
        color[1] = g
        color[2] = b
        color[3] = a
        diffuse.inputs.color.setValue(color)
      } else if (mat) {
        mat[property] = value
      }
      if (mat) mat._regen = true
      ob.graphUpdate?.()
      ob.data?.graphUpdate?.()
    },
    deleteObject: (id) => {
      const ob = findObject(ctx, id)
      if (!ob) throw new Error(`Could not find ${id} to delete.`)
      ctx.scene.remove(ob)
      if (ob.lib_users <= 0) {
        const data = ob.data
        ctx.datalib.remove(ob)
        if (data && data.lib_users <= 0) ctx.datalib.remove(data)
      }
    },
    groupObjects: (ids, name) => {
      const collection = ctx.scene.getCollection?.(ctx, name)
      if (!collection) throw new Error('This scene cannot hold a group.')
      for (const id of ids) {
        const ob = findObject(ctx, id)
        if (ob) collection.add(ob)
      }
      ctx.scene.updateObjectList?.()
      return name
    },
    applyMaps: (id, maps) => io.applyMaps(ctx, id, maps),
  }
}

export async function applyEditorCommands(
  ctx: any,
  commands: readonly SceneCommand[],
  io: SceneCommandIo,
): Promise<{commandId: string; lines: string[]}> {
  if (!ctx?.scene) throw new Error('Open a scene before applying a Copilot command.')
  ensureRegistered()
  const commandId = `copilot-${Date.now().toString(36)}`
  let lines: string[] = []
  const run = (live: any) => {
    const batch = applySceneCommands(editorFor(live, io), commands, commandId)
    lines = batch.results.map((result) => result.summary)
  }

  if (typeof ctx.toolstack?.execTool === 'function') {
    const op = new CopilotCommandOp()
    op.runner = run
    await ctx.toolstack.execTool(ctx, op)
  } else {
    run(ctx)
  }

  const redraw = (window as any).redraw_viewport
  if (typeof redraw === 'function') redraw(true)
  return {commandId, lines}
}

export async function fetchMeshyGlb(
  base: string,
  token: string,
  body: {kind: 'text-to-3d' | 'image-to-3d' | 'text-to-texture'; prompt?: string; imageUrl?: string},
): Promise<{bytes: Uint8Array} | {unavailable: string} | {failed: string}> {
  const headers = {authorization: `Bearer ${token}`, 'content-type': 'application/json'}
  const status = await fetch(`${base}/studio/api/v1/generative/status`, {headers})
  if (!status.ok) return {unavailable: 'Meshy status could not be read.'}
  const info = (await status.json()) as {configured?: boolean}
  if (!info.configured) return {unavailable: 'Meshy is not configured.'}

  const created = await fetch(`${base}/studio/api/v1/generative/tasks`, {
    method : 'POST',
    headers,
    body   : JSON.stringify(body),
  })
  if (created.status === 503) return {unavailable: 'Meshy is not configured.'}
  if (!created.ok) {
    const err = (await created.json().catch(() => ({}))) as {message?: string}
    return {failed: err.message ?? `Meshy refused the task (HTTP ${created.status}).`}
  }
  const task = (await created.json()) as {taskId?: string; kind?: string}
  if (!task.taskId || !task.kind) return {failed: 'Meshy did not return a task id.'}

  for (let attempt = 0; attempt < 45; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const poll = await fetch(
      `${base}/studio/api/v1/generative/tasks/${encodeURIComponent(task.taskId)}?kind=${encodeURIComponent(task.kind)}`,
      {headers},
    )
    if (!poll.ok) continue
    const state = (await poll.json()) as {status?: string; error?: string | null}
    if (state.status === 'SUCCEEDED') {
      const model = await fetch(
        `${base}/studio/api/v1/generative/tasks/${encodeURIComponent(task.taskId)}/model?kind=${encodeURIComponent(task.kind)}`,
        {headers},
      )
      if (!model.ok) return {failed: 'Meshy finished but the mesh could not be downloaded.'}
      return {bytes: new Uint8Array(await model.arrayBuffer())}
    }
    if (state.status === 'FAILED' || state.status === 'CANCELED') {
      return {failed: state.error || `Meshy ${state.status}.`}
    }
  }
  return {failed: 'Meshy is still generating. Try the same image again in a minute.'}
}
