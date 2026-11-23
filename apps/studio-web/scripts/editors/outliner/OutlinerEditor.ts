/**
 * Scene Outliner — Blender hierarchy editor (subset).
 *
 * Flat Scene Collection list with clear restrict controls (Hide / Lock / Delete),
 * multi-select, rename, and keyboard shortcuts. Built with a custom list DOM so
 * the narrow column never collapses into invisible middot buttons.
 * docs.blender.org → Editors → Outliner
 */
import {Editor} from '../editor_base'
import {Icons} from '../icon_enum.js'
import {HotKey, KeyMap, nstructjs, UIBase} from '../../path.ux/scripts/pathux.js'
import {ObjectFlags, type SceneObject} from '../../sceneobject/sceneobject'
import {VOID_STUDIO_PALETTE as p} from '../../voidspace/theme.js'

function kindLabel(ob: SceneObject): string {
  const kind = String(ob?.data?.constructor?.name ?? 'Empty')
  if (/light/i.test(kind)) return 'Light'
  if (/camera/i.test(kind)) return 'Camera'
  if (/null/i.test(kind) || !ob?.data) return 'Empty'
  if (/lite|leaf|mesh/i.test(kind)) return 'Mesh'
  return kind
}

function setStyle(el: HTMLElement, props: Record<string, string>) {
  for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v)
}

/** Compact restriction glyphs retain explicit accessible labels. */
function makeToggle(label: string, title: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  const glyphs: Record<string, string> = {
    Hide: '<path d="M2 8s5-8 12 0c-7 8-12 0-12 0Z"/><circle cx="8" cy="8" r="2"/>',
    Show: '<path d="m2 2 12 12M2 8s5-8 12 0M3 10q4 5 8 1"/>',
    Lock: '<path d="m4 2 9 7-5 1-2 4Z"/>',
    Unlock: '<rect x="4" y="7" width="8" height="7" rx="1"/><path d="M6 7V4a2 2 0 0 1 4 0v3"/>',
    Del: '<path d="M3 4h10M6 4V2h4v2M5 6v7h6V6M7 7v4M9 7v4"/>',
  }
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[label] ?? glyphs.Hide}</svg>`
  btn.setAttribute('aria-label', title)
  btn.title = title
  setStyle(btn, {
    appearance: 'none',
    '-webkit-appearance': 'none',
    margin: '0',
    padding: '3px',
    'min-width': '22px',
    height: '22px',
    'font-size': '11px',
    'font-weight': '600',
    'font-family': p.fontSans,
    'line-height': '1',
    'border-radius': '3px',
    border: '0',
    background: 'transparent',
    color: active ? '#ffffff' : p.fg,
    cursor: 'pointer',
    'flex-shrink': '0',
  })
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick()
  })
  return btn
}

export class OutlinerEditor extends Editor {
  static STRUCT = nstructjs.inlineRegister(
    this,
    `
OutlinerEditor {
}
  `
  )

  listHost!: HTMLDivElement
  _lastKey = ''
  _rowStructureKey = ''
  _rows = new Map<number, {object: SceneObject; row: HTMLDivElement; name: HTMLDivElement; glyph: HTMLSpanElement}>()
  keymap!: KeyMap
  /** Visible row order for Shift-range select (Blender Outliner). */
  _visibleOrder: SceneObject[] = []
  /** Anchor object for Shift-range multi-select. */
  _rangeAnchor: SceneObject | undefined

  static define() {
    return {
      tagname : 'outliner-editor-x',
      areaname: 'OutlinerEditor',
      uiname  : 'Outliner',
      icon    : Icons.GRAPH,
      flag    : 0,
    }
  }

  init() {
    super.init()
    this.background = p.surface
    setStyle(this, {
      overflow: 'hidden',
      display: 'flex',
      'flex-direction': 'column',
    })
    setStyle(this.container as unknown as HTMLElement, {
      flex: '0 0 auto',
      'flex-shrink': '0',
    })

    const tools = (this.header as any)?.row?.() ?? this.container.row()
    tools.useIcons?.(false)
    tools.menu('Select', [
      ['Select All', () => this.selectAll(true), 'A'],
      ['Deselect All', () => this.selectAll(false), 'Alt+A'],
    ])
    tools.menu('Object', [
      ['Delete', () => this.deleteSelected(), 'X'],
      ['Hide Selected', () => this.hideSelected(true), 'H'],
      ['Show Selected', () => this.hideSelected(false), 'Alt+H'],
    ])

    // Custom scroll host — path.ux themed buttons were collapsing to invisible middots.
    this.listHost = document.createElement('div')
    setStyle(this.listHost, {
      flex: '1 1 auto',
      overflow: 'auto',
      padding: '4px 0 8px',
      'min-height': '0',
      'font-family': p.fontSans,
      'font-size': '12px',
      color: p.fg,
      background: p.surface,
    })
    this.shadow.appendChild(this.listHost)

    this.rebuild()
  }

  defineKeyMap() {
    this.keymap = new KeyMap([
      new HotKey('X', [], () => this.deleteSelected()),
      new HotKey('Delete', [], () => this.deleteSelected()),
      new HotKey('A', [], () => this.selectAll(true)),
      new HotKey('A', ['alt'], () => this.selectAll(false)),
      new HotKey('H', [], () => this.hideSelected(true)),
      new HotKey('H', ['alt'], () => this.hideSelected(false)),
    ])
    return this.keymap
  }

  getKeyMaps() {
    return [this.keymap]
  }

  selectAll(state: boolean) {
    const scene = this.ctx?.scene
    if (!scene?.objects) return
    void this.ctx.api.execTool(this.ctx, `object.toggle_select_all(mode=${state ? 'ADD' : 'SUB'})`)
    window.redraw_viewport?.(true)
    this._lastKey = ''
    this.rebuild()
  }

  hideSelected(hide: boolean) {
    const scene = this.ctx?.scene
    if (!scene?.objects) return
    void this.ctx.api.execTool(this.ctx,
      `object.set_restriction(restriction=HIDE value=${hide})`)
    window.redraw_viewport?.(true)
    this._lastKey = ''
    this.rebuild()
  }

  deleteSelected() {
    const scene = this.ctx?.scene
    if (!scene?.objects) return

    const targets = [...scene.objects.selected].filter(
      (ob) => !(ob.flag & (ObjectFlags.LOCKED | ObjectFlags.INTERNAL)),
    )
    if (targets.length === 0) {
      this.ctx.warning?.('Nothing to delete — select an object first')
      return
    }

    try {
      void this.ctx.api.execTool(this.ctx, 'object.delete_selected()')
    } catch {
      this.deleteObjectsDirect(targets)
    }

    this._lastKey = ''
    this.rebuild()
    window.redraw_viewport?.(true)
  }

  deleteObjectsDirect(targets: SceneObject[]) {
    const scene = this.ctx.scene
    const datalib = this.ctx.datalib
    for (const ob of targets) {
      const data = ob.data
      try {
        scene.remove(ob)
      } catch {
        continue
      }
      while (ob.lib_users > 0) ob.lib_remUser()
      try {
        datalib.remove(ob)
      } catch {
        /* gone */
      }
      if (data && data.lib_users <= 0) {
        try {
          datalib.remove(data)
        } catch {
          /* gone */
        }
      }
    }
  }

  rebuild() {
    if (!this.ctx?.scene || !this.listHost) {
      if (!this.isDead()) this.doOnce(this.rebuild)
      return
    }

    const scene = this.ctx.scene
    const objects = [...(scene.objects ?? [])] as SceneObject[]
    const activeId = scene.objects?.active?.lib_id ?? -1
    const key =
      `${objects.length}|` +
      objects.map((ob) => `${ob.lib_id}:${ob.flag}:${ob.name}:${ob.data?.lib_id ?? 'ø'}`).join('|') +
      `|a${activeId}`

    if (key === this._lastKey) return
    this._lastKey = key
    const structureKey = objects.map((ob) =>
      `${ob.lib_id}:${ob.flag & (ObjectFlags.HIDE | ObjectFlags.LOCKED | ObjectFlags.INTERNAL)}:${ob.name}:${ob.data?.lib_id}`,
    ).join('|')
    if (structureKey === this._rowStructureKey && objects.every((ob) =>
      ob.flag & ObjectFlags.INTERNAL || this._rows.get(ob.lib_id)?.object === ob,
    )) {
      for (const {object, row, name, glyph} of this._rows.values()) {
        const active = object.lib_id === activeId
        const selected = !!(object.flag & ObjectFlags.SELECT)
        row.style.background = active ? p.accent : selected ? 'rgba(86, 128, 194, 0.35)' : 'transparent'
        name.style.color = active ? '#ffffff' : p.fg
        name.style.fontWeight = active || selected ? '600' : '400'
        glyph.style.color = active ? '#fff' : p.fgDim
      }
      return
    }
    this._rowStructureKey = structureKey
    this._rows.clear()
    this.listHost.replaceChildren()

    // Collection header
    const coll = document.createElement('div')
    setStyle(coll, {
      padding: '6px 10px 4px',
      'font-weight': '600',
      'font-size': '11px',
      color: p.fgDim,
      'letter-spacing': '0.02em',
      'text-transform': 'none',
    })
    coll.textContent = '▾  Scene Collection'
    this.listHost.appendChild(coll)

    const visible = objects.filter((ob) => !(ob.flag & ObjectFlags.INTERNAL))
    this._visibleOrder = visible

    if (visible.length === 0) {
      const empty = document.createElement('div')
      setStyle(empty, {padding: '12px 10px', color: p.fgFaint})
      empty.textContent = 'Empty — press Shift+A to add'
      this.listHost.appendChild(empty)
      return
    }

    for (const ob of visible) {
      this.listHost.appendChild(this.buildRow(scene, ob))
    }
  }

  buildRow(scene: any, ob: SceneObject): HTMLDivElement {
    const row = document.createElement('div')
    const selected = !!(ob.flag & ObjectFlags.SELECT)
    const active = scene.objects?.active === ob
    const hidden = !!(ob.flag & ObjectFlags.HIDE)
    const locked = !!(ob.flag & ObjectFlags.LOCKED)
    const name = ob.name || `Object${ob.lib_id}`

    setStyle(row, {
      display: 'flex',
      'align-items': 'center',
      gap: '4px',
      padding: '0 6px 0 18px',
      'min-height': '24px',
      'border-radius': '0',
      cursor: locked ? 'not-allowed' : 'pointer',
      background: active ? p.accent : selected ? 'rgba(86, 128, 194, 0.35)' : 'transparent',
      opacity: hidden ? '0.55' : '1',
      'user-select': 'none',
    })
    row.title = locked
      ? `${name} is locked`
      : 'Click to select · Shift+click multi-select · Double-click rename'

    // Type glyph via path.ux icon button (small, reliable).
    const iconWrap = document.createElement('div')
    setStyle(iconWrap, {width: '22px', 'flex-shrink': '0', display: 'flex', 'justify-content': 'center'})
    // Fallback text glyph when icons fail to paint in this host.
    const glyph = document.createElement('span')
    const kind = kindLabel(ob)
    const symbol = kind === 'Light'
      ? '<circle cx="8" cy="7" r="4"/><path d="M6 11v3h4v-3M8 0v2M1 7h2m10 0h2"/>'
      : kind === 'Camera'
      ? '<path d="M1 4h9v8H1zM10 6l5-3v10l-5-3"/>'
      : '<path d="m2 3 12 2-7 10Z"/><circle cx="2" cy="3" r="1"/><circle cx="14" cy="5" r="1"/><circle cx="7" cy="15" r="1"/>'
    glyph.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">${symbol}</svg>`
    setStyle(glyph, {
      width: '18px',
      height: '18px',
      'border-radius': '3px',
      background: 'transparent',
      color: active ? '#fff' : p.fgDim,
      display: 'inline-flex',
      'align-items': 'center',
      'justify-content': 'center',
      'font-size': '10px',
      'font-weight': '700',
    })
    glyph.title = kindLabel(ob)
    iconWrap.appendChild(glyph)
    row.appendChild(iconWrap)

    const nameCol = document.createElement('div')
    setStyle(nameCol, {flex: '1', 'min-width': '0', display: 'flex', 'flex-direction': 'column', gap: '0'})
    const nameEl = document.createElement('div')
    setStyle(nameEl, {
      color: active ? '#ffffff' : p.fg,
      'font-weight': active || selected ? '600' : '400',
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
      'white-space': 'nowrap',
    })
    nameEl.textContent = name
    const typeEl = document.createElement('div')
    setStyle(typeEl, {
      color: active ? 'rgba(255,255,255,0.75)' : p.fgFaint,
      'font-size': '10px',
    })
    typeEl.textContent = kindLabel(ob)
    nameCol.appendChild(nameEl)
    nameCol.title = kindLabel(ob)
    row.appendChild(nameCol)

    row.appendChild(
      makeToggle(hidden ? 'Show' : 'Hide', hidden ? 'Show object' : 'Hide object', hidden, () => {
        void this.ctx.api.execTool(this.ctx,
          `object.set_restriction(objectId=${ob.lib_id} restriction=HIDE value=${!hidden})`)
        window.redraw_viewport?.(true)
        this._lastKey = ''
        this.rebuild()
      }),
    )

    row.appendChild(
      makeToggle(locked ? 'Unlock' : 'Lock', locked ? 'Unlock object' : 'Lock (not selectable)', locked, () => {
        void this.ctx.api.execTool(this.ctx,
          `object.set_restriction(objectId=${ob.lib_id} restriction=LOCKED value=${!locked})`)
        this._lastKey = ''
        this.rebuild()
      }),
    )

    const del = makeToggle('Del', 'Delete object', false, () => {
      if (ob.flag & ObjectFlags.LOCKED) {
        this.ctx.warning?.(`"${name}" is locked — unlock it first`)
        return
      }
      const sc = this.ctx.scene
      sc.objects.clearSelection()
      sc.objects.setSelect(ob, true)
      sc.objects.setActive(ob)
      this.deleteSelected()
    })
    if (locked) {
      del.disabled = true
      setStyle(del, {opacity: '0.4', cursor: 'not-allowed'})
    }
    row.appendChild(del)

    row.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'BUTTON') return
      if (e.button !== 0) return
      e.preventDefault()
      this.selectObject(ob, e)
    })
    row.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'BUTTON') return
      e.preventDefault()
      this.renameObject(ob)
    })

    this._rows.set(ob.lib_id, {object: ob, row, name: nameEl, glyph})
    return row
  }

  renameObject(ob: SceneObject) {
    if (ob.flag & ObjectFlags.LOCKED) return
    const next = window.prompt('Rename object', ob.name || '')
    if (next == null) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === ob.name) return
    void this.ctx.api.execTool(this.ctx,
      `object.rename(objectId=${ob.lib_id} name=${JSON.stringify(trimmed)})`)
    this._lastKey = ''
    this.rebuild()
  }

  /**
   * Blender Outliner selection:
   * - click → exclusive select
   * - Shift+click → range from anchor (or extend if no anchor)
   * - Ctrl/⌘+click → toggle that object in the selection
   */
  selectObject(ob: SceneObject, e: {shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean}) {
    const scene = this.ctx?.scene
    if (!scene?.objects) return
    if (ob.flag & ObjectFlags.LOCKED) {
      this.ctx.warning?.(`"${ob.name}" is locked — unlock it first`)
      return
    }

    const toggle = !!(e.ctrlKey || e.metaKey)
    const range = !!e.shiftKey && !toggle

    if (toggle) {
      const on = !(ob.flag & ObjectFlags.SELECT)
      scene.objects.setSelect(ob, on)
      if (on) scene.objects.setActive(ob)
      else if (scene.objects.active === ob) {
        const next = [...scene.objects.selected][0]
        scene.objects.setActive(next)
      }
      this._rangeAnchor = ob
    } else if (range) {
      const order = this._visibleOrder
      const anchor = this._rangeAnchor ?? scene.objects.active ?? ob
      let a = order.indexOf(anchor)
      let b = order.indexOf(ob)
      if (a < 0) a = b
      if (b < 0) b = a
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      // Keep prior selection and add the range (Blender Outliner Shift).
      for (let i = lo; i <= hi; i++) {
        const row = order[i]
        if (!row || row.flag & ObjectFlags.LOCKED) continue
        scene.objects.setSelect(row, true)
      }
      scene.objects.setActive(ob)
    } else {
      scene.objects.clearSelection()
      scene.objects.setSelect(ob, true)
      scene.objects.setActive(ob)
      this._rangeAnchor = ob
    }

    window.redraw_viewport?.(true)
    this._lastKey = ''
    this.rebuild()
  }

  /** @deprecated use selectObject — kept for any stray callers */
  activateObject(ob: SceneObject, addToSelection = false) {
    this.selectObject(ob, {shiftKey: addToSelection})
  }

  update() {
    super.update()
    this.rebuild()
  }

  copy() {
    const ret = UIBase.createElement('outliner-editor-x') as this
    ret.ctx = this.ctx
    return ret
  }
}

Editor.register(OutlinerEditor)
