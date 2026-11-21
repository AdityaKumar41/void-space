/**
 * Bottom status bar — Blender's info strip.
 *
 * Mode + active object + Verts/Edges/Faces + the hotkeys Blender users reach for.
 */
import {Editor} from '../editor_base'
import {Icons} from '../icon_enum.js'
import {AreaFlags, BorderMask, nstructjs, UIBase} from '../../path.ux/scripts/pathux.js'
import {VOID_STUDIO_PALETTE as p} from '../../voidspace/theme.js'

const STATUS_H = 24

type ModeDef = {uiname?: string; name?: string}

function meshStats(ob: {data?: unknown} | undefined | null): string {
  const data = ob?.data as {mesh?: {v?: {count?: number}; e?: {count?: number}; f?: {count?: number}}; faceCount?: string} | undefined
  if (!data) return ''

  const mesh = data.mesh
  if (mesh?.v?.count !== undefined || mesh?.f?.count !== undefined) {
    const v = mesh.v?.count
    const e = mesh.e?.count
    const f = mesh.f?.count
    // LiteMesh WASM exposes v/f reliably; edges are often absent — omit rather
    // than printing Edges:— which looks broken next to Blender's status strip.
    if (e !== undefined) {
      return `Verts:${v ?? '—'}  Edges:${e}  Faces:${f ?? '—'}`
    }
    return `Verts:${v ?? '—'}  Faces:${f ?? '—'}`
  }

  // LeafMesh / datapath faceCount string fallback
  if (data.faceCount) return `Faces:${data.faceCount}`
  return ''
}

export class StatusBarEditor extends Editor {
  static STRUCT = nstructjs.inlineRegister(
    this,
    `
StatusBarEditor {
}
  `
  )

  _lastKey = ''
  _modeLabel: {text: string; style: CSSStyleDeclaration} | undefined
  _objectLabel: {text: string; style: CSSStyleDeclaration} | undefined
  _statsLabel: {text: string; style: CSSStyleDeclaration} | undefined

  constructor() {
    super()
    this.areaDragToolEnabled = false
    this.borderLock = BorderMask.TOP | BorderMask.BOTTOM
    this.minSize[1] = STATUS_H
    this.maxSize[1] = STATUS_H
  }

  static define() {
    return {
      tagname : 'status-bar-editor-x',
      areaname: 'StatusBarEditor',
      uiname  : 'Status Bar',
      icon    : Icons.EDITOR_MENU,
      flag    : AreaFlags.HIDDEN | AreaFlags.NO_SWITCHER,
    }
  }

  init() {
    super.init()
    this.background = p.surface2

    const row = this.container.row()
    row.style.alignItems = 'center'
    row.style['gap'] = '12px'
    row.style['padding'] = '0 10px'
    row.style['height'] = `${STATUS_H}px`
    row.style.fontSize = '11px'
    row.style['color'] = p.fgDim

    this._modeLabel = row.label('Object Mode')
    this._modeLabel.style['color'] = p.fg
    this._modeLabel.style.fontWeight = '600'

    const sep1 = row.label('|')
    sep1.style['color'] = p.lineStrong

    this._objectLabel = row.label('—')
    this._objectLabel.style['color'] = p.gold

    const sep2 = row.label('|')
    sep2.style['color'] = p.lineStrong

    this._statsLabel = row.label('')
    this._statsLabel.style['color'] = p.fgDim
    this._statsLabel.style.fontVariantNumeric = 'tabular-nums'

    const sep3 = row.label('|')
    sep3.style['color'] = p.lineStrong

    const hint = row.label('Shift/Ctrl select  ·  B Box  ·  A All  ·  G/R/S  ·  Tab Mode  ·  Shift+A Add  ·  X Delete  ·  Z Shading')
    hint.style.color = p.fgFaint
    hint.style.flex = '1'

    this.flushUpdate()
  }

  update() {
    super.update()

    if (this.minSize[1] !== STATUS_H) {
      this.minSize[1] = STATUS_H
      this.maxSize[1] = STATUS_H
      try {
        this.ctx?.screen?.solveAreaConstraints()
      } catch {
        // early boot
      }
    }

    const scene = this.ctx?.scene as
      | {
          toolmode?: {constructor?: {toolModeDefine?: () => ModeDef}}
          objects?: {active?: {name?: string; data?: unknown}}
        }
      | undefined

    const modeDef = scene?.toolmode?.constructor?.toolModeDefine?.()
    const modeName = modeDef?.uiname || modeDef?.name || 'Object Mode'
    const ob = scene?.objects?.active ?? this.ctx?.object
    const objName = ob?.name || '(nothing selected)'
    const stats = meshStats(ob)

    const key = `${modeName}|${objName}|${stats}`
    if (key === this._lastKey) return
    this._lastKey = key

    if (this._modeLabel) this._modeLabel.text = modeName
    if (this._objectLabel) this._objectLabel.text = objName
    if (this._statsLabel) this._statsLabel.text = stats
  }

  copy() {
    const ret = UIBase.createElement('status-bar-editor-x') as this
    ret.ctx = this.ctx
    return ret
  }
}

Editor.register(StatusBarEditor)
