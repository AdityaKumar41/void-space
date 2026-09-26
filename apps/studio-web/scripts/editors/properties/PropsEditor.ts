import {Icons} from '../icon_enum'

import {DataBlockBrowser, Editor, MaterialPanel} from '../editor_base'
import {
  DataAPI,
  LastToolPanel,
  loadUIData,
  nstructjs,
  Number3,
  PanelContents,
  TabContainer,
  TabItemContainer,
  saveUIData,
} from '../../path.ux/scripts/pathux'

import {UIBase} from '../../path.ux/scripts/core/ui_base'
import {Container} from '../../path.ux/scripts/core/ui'
import {ColumnFrame} from '../../path.ux/scripts/core/ui_containers'
import {ProceduralTex, ProceduralTexUser} from '../../texture/proceduralTex'
import {listPropsPanels} from '../../core/props_panels'
import {VOID_STUDIO_PALETTE} from '../../voidspace/theme'
import type {ViewContext} from '../../core/context'
import messageBus from '../../core/bus'
import {FeatureFlagManager} from '../../core/feature-flag'
import {ToolMode} from '../view3d/view3d_toolmode'
import {SceneObject} from '../../sceneobject/sceneobject'
import {SettingsEditor} from '../settings/SettingsEditor'

export const TexturePathModes = {
  BRUSH : 0,
  EDITOR: 1,
}

/**
 * Builds a vector property row with the units the quantity actually has.
 *
 * A slider row formats its numbers through `units.buildString`, whose arguments
 * default to the *module's* base unit — metres — so a widget that was never told
 * a unit appends " m" to everything it draws. Nothing tells it: the number
 * properties carry no unit metadata, `vector-panel-x` copies `undefined` straight
 * through, and every axis of every vector in the panel therefore read "0 m" —
 * including rotation, where metres are meaningless.
 *
 * `vector-panel-x` copies `baseUnit`, `displayUnit` and `decimalPlaces` onto each
 * axis slider it builds, and only its own `undefined` values may be filled in
 * from the property metadata later, so setting them here and rebuilding is what
 * makes the row stick.
 *
 * `displayUnit` differs from `baseUnit` only for angles: the socket stores
 * radians, an angle is shown and typed in degrees, and the widget converts on
 * the way in and out. Scale is dimensionless and must be told `none` explicitly
 * — leaving it `undefined` lands back on the metre default this exists to avoid.
 *
 * A free function rather than a method because either side of the properties
 * editor needs it — the object panel for the transform, the data panels built
 * from the registry — and none of them has anything else to say about vehicles.
 */
function vectorRow(
  panel: PanelContents<ViewContext>,
  path: string,
  opts: {unit: string; displayUnit?: string; decimals: number}
): void {
  const widget = panel.prop(path) as unknown as VectorRow

  widget.baseUnit = opts.unit
  widget.displayUnit = opts.displayUnit ?? opts.unit
  widget.decimalPlaces = opts.decimals

  widget.rebuild?.()

  /*
   * Now that a row is as wide as the panel (see `PropsEditor._stretchTabBody`),
   * the slider inside it does not follow: path.ux sizes a number slider from its
   * own label text and the theme's `width`, and never grows it, so the rest of
   * the row was dead space with the value field floating in the middle of it. A
   * row is 374px wide with a 128px slider and a 57px field; growing the slider
   * takes it to 317.
   *
   * `flex` is written to the element rather than through a theme key because a
   * number slider is not a `Container`, the one place path.ux reads a `flex-grow`
   * default. It also survives: the widget's own `setCSS` writes `width`, not
   * `flex`.
   *
   * Twice, because `VectorPanel` builds its axis rows in `init()`, which path.ux
   * runs once the widget has joined the tree — so on the first call there may be
   * nothing to widen yet, and `doOnce` is the hook for "as soon as it is live".
   */
  const widen = () => {
    for (const row of widget.sliders ?? []) {
      const slider = row?.numslider ?? row

      if (slider?.style) {
        slider.style.flex = '1 1 auto'
      }
    }
  }

  widen()
  widget.doOnce?.(widen)
}

/**
 * What this file needs of a `vector-panel-x`: the three numbers it copies onto
 * the axis sliders it builds, the rows themselves, and each row's slider.
 * `container.prop()` is typed as the generic `UIBase`, so the fields are declared
 * here rather than the whole widget being named.
 */
interface VectorRow {
  baseUnit?: string
  displayUnit?: string
  decimalPlaces?: number
  rebuild?: () => void
  sliders?: AxisRow[]
  doOnce?: (func: () => void) => void
}

/** One axis of a vector row: the `numslider-textbox-x` wrapper, or a bare slider. */
interface AxisRow {
  style?: {flex?: string}
  numslider?: {style?: {flex?: string}}
}

export class ObjectPanel extends ColumnFrame<ViewContext> {
  _last_update_key: string

  constructor() {
    super()

    this._last_update_key = ''
  }

  static define() {
    return {
      tagname: 'scene-object-panel-x',
    }
  }

  init() {
    super.init()
    this.rebuild()
    //this.doOnce(this.rebuild);
  }

  rebuild() {
    if (!this.ctx) {
      if (!this.isDead()) {
        this.doOnce(this.rebuild)
      }

      return
    }

    this.clear()

    /*
     * The object's name heads the tab, the way an ID block heads Blender's
     * Object tab. `pathlabel` watches the datapath so the row follows a rename;
     * the label half is empty because the datapath already supplies "name" and
     * the tab is *the Object tab* — that combination is what left the panel
     * headed "name Object4". `TitleText` is the panel titles' 12px/600 face, so
     * the name reads as the tab's subject rather than as one more property row.
     */
    const nameLabel = this.pathlabel('object.name', '')
    nameLabel.font = 'TitleText'

    let panel: PanelContents<ViewContext>

    panel = this.panel('Transform')
    panel.useIcons(false)

    vectorRow(panel, `object.inputs["loc"].value`, {unit: 'meter', decimals: 3})
    vectorRow(panel, `object.inputs["rot"].value`, {
      unit       : 'radian',
      displayUnit: 'degree',
      decimals   : 1,
    })

    // The order the euler angles are applied in. It belongs with Rotation, not
    // after it, because it changes what the three numbers above it mean.
    panel.prop('object.inputs["rotOrder"].value')

    vectorRow(panel, `object.inputs["scale"].value`, {unit: 'none', decimals: 3})

    panel.tool('object.apply_transform()')

    panel = this.panel('Draw')
    panel.useIcons(false)
    panel.prop('object.drawMode')
    panel.prop('object.drawFlag[FORCE_XRAY]')
    panel.prop('object.drawFlag[WIREFRAME]')

    const ob = this.ctx.object
    if (!ob) {
      return
    }

    // Panels for the object's data kind come from the registry, so a geometry
    // type contributes UI from its own addon instead of appearing in a branch
    // here. See scripts/core/props_panels.ts and plan §3.3.
    const data = ob.data
    if (!data) {
      return
    }

    for (const contribution of listPropsPanels(data.lib_type)) {
      if (contribution.poll && !contribution.poll(this.ctx, data)) {
        continue
      }

      // The registry is context-agnostic — core cannot name ViewContext without
      // closing a cycle — so the container's context parameter is re-bound here.
      const sub = (contribution.uiName ? this.panel(contribution.uiName) : this) as unknown as Container
      contribution.build(sub, this.ctx, data)
    }
  }

  update() {
    super.update()

    if (!this.ctx?.object) {
      return
    }

    const ob = this.ctx.object
    const key = '' + ob.lib_id + ':' + ob.data.lib_id

    if (key !== this._last_update_key) {
      this._last_update_key = key
      this.rebuild()
    }
  }
}

UIBase.register(ObjectPanel)

export class TexturePanel extends Container<ViewContext> {
  canvas: HTMLCanvasElement
  g: CanvasRenderingContext2D
  previewSize: number
  _lastkey: string | undefined
  _drawreq: number | undefined
  _rebuildReq: boolean
  mode!: ReturnType<Container<ViewContext>['listenum']>
  settings!: PanelContents<ViewContext>
  preview!: PanelContents<ViewContext>

  constructor() {
    super()

    this.canvas = document.createElement('canvas')
    this.g = this.canvas.getContext('2d')!
    this.previewSize = 100

    this._lastkey = undefined

    this._drawreq = undefined
    this._rebuildReq = false

    /*
    this.modebox = this.listenum(undefined, {
      name : "Mode",
      enumDef : ProceduralTex.buildGeneratorEnum(),
      defaultVal : 0,
      callback : (id) => {
        console.log("id", id);
        let tex = this.getTexture();
        if (tex) {
          tex.setGenerator(ProceduralTex.getPattern(id));
        }
      }
    });*/
  }

  static define() {
    return {
      tagname: 'texture-panel-x',
    }
  }

  getTexture() {
    const path = this.getAttribute('datapath')
    if (!path) {
      return undefined
    }

    return this.getPathValue<ProceduralTex>(this.ctx, path)
  }

  init() {
    super.init()

    this.mode = this.listenum(undefined, 'Type', {})
    this.preview = this.panel('Preview')
    this.settings = this.panel('Settings')
    this.preview.appendChild(this.canvas)

    this.flagRebuild()

    this.flagRedraw()
  }

  rebuild() {
    if (!this.ctx || !this.settings || !this.hasAttribute('datapath')) {
      this.flagRedraw()
      return
    }

    this._rebuildReq = false

    const panel = this.settings
    panel.clear()

    const tex = this.getTexture()

    if (!tex) {
      return
    }

    this.mode.ctx = this.ctx

    const path = this.getAttribute('datapath')!

    this.mode.setAttribute('datapath', path + '.mode')

    panel.dataPrefix = path

    tex.buildSettings(panel)

    this.flagRedraw()
    this.flushUpdate()
  }

  flagRebuild() {
    // check if we have an inflight request already
    if (this._rebuildReq) {
      return
    }

    this._rebuildReq = true
    window.setTimeout(() => {
      this.rebuild()
    })
  }

  update() {
    if (!this.preview) {
      return
    }

    const tex = this.getTexture()
    const texid = tex !== undefined ? tex.lib_id : -1

    let key = '' + texid
    if (tex) {
      key += ':' + (tex as any).generator.constructor.name
    }

    if (key !== this._lastkey) {
      this._lastkey = key
      this.flagRebuild()
      this.flagRedraw()
    }

    if (tex?.update()) {
      this.flagRedraw()
    }
  }

  flagRedraw() {
    if (this._drawreq) {
      return
    }

    this._drawreq = 1
    window.setTimeout(() => {
      this.redraw()
    })
  }

  redraw() {
    this._drawreq = undefined

    const g = this.g
    const canvas = this.canvas

    g.clearRect(0, 0, canvas.width, canvas.height)

    const f1 = 200
    const f2 = 135

    const colors = [`rgb(${f1},${f1},${f1})`, `rgb(${f2},${f2},${f2})`]

    const csize = 16
    const steps = Math.ceil(this.previewSize / csize)
    for (let i = 0; i < steps * steps; i++) {
      let x = i % steps
      let y = ~~(i / steps)

      const j = (x + y) % 2
      const color = colors[j]

      x *= csize
      y *= csize

      g.fillStyle = color

      g.beginPath()
      g.rect(x, y, csize, csize)
      g.fill()
    }

    const tex = this.getTexture()
    if (!tex) {
      return
    }

    const size = this.previewSize
    const image = tex.getPreview(size, size)

    g.drawImage(image, 0, 0)
  }

  setCSS() {
    super.setCSS()

    const dpi = UIBase.getDPI()
    const w = ~~(this.previewSize * dpi)

    const canvas = this.canvas
    canvas.width = w
    canvas.height = w

    const w2 = w / dpi
    const h2 = w / dpi

    canvas.style['width'] = w2 + 'px'
    canvas.style['height'] = h2 + 'px'

    this.flagRedraw()
  }
}

UIBase.register(TexturePanel)

export class TextureSelectPanel extends TexturePanel {
  browser: DataBlockBrowser<ProceduralTex>

  constructor() {
    super()

    this.browser = UIBase.createElement('data-block-browser-x')
    this.browser.blockClass = ProceduralTex
  }

  static define() {
    return {
      tagname: 'texture-select-panel-x',
    }
  }

  init() {
    super.init()
    this.browser.setAttribute('datapath', this.getAttribute('datapath')!)

    this.prepend(this.browser)
  }

  update() {
    if (!this.ctx) {
      return
    }

    super.update()
    this.browser.setAttribute('datapath', this.getAttribute('datapath')!)
  }
}

UIBase.register(TextureSelectPanel)

export class PropsEditor extends Editor {
  tabs!: TabContainer<ViewContext>
  texPanel!: Container<ViewContext>
  objTab!: TabItemContainer<ViewContext>
  texTab!: TabItemContainer<ViewContext>
  workspaceTab!: TabItemContainer<ViewContext>
  _settingsTab?: TabItemContainer<ViewContext>
  _last_toolmode?: ToolMode
  _last_obj?: SceneObject
  texUser: ProceduralTexUser
  texturePathMode: number
  texturePath: string

  static STRUCT = nstructjs.inlineRegister(
    this,
    `
PropsEditor {
  texturePath     : string;
  texturePathMode : int;
}
`
  )

  constructor() {
    super()

    this.texUser = new ProceduralTexUser()

    this.texturePathMode = TexturePathModes.EDITOR
    this.texturePath = ''

    this._last_toolmode = undefined
  }

  //used by data path api
  get _texture() {
    if (this.texturePath === '') {
      return undefined
    }

    const path = this.texturePath
    return this.ctx.api.getValue<ProceduralTex>(this.ctx, path)
  }

  //used by data path api
  set _texture(val) {
    if (val !== undefined && val.lib_id < 0) {
      throw new Error('pattern is not in the datalib')
    }

    if (this.texturePathMode === TexturePathModes.EDITOR) {
      if (!val) {
        this.texturePath = ''
      } else {
        this.texturePath = `library.texture[${val.lib_id}]`
      }
    } else {
      this.setPathValue(this.ctx, this.texturePath, val)
      /*
      let rdef = this.ctx.resolvePath(this.texturePath);
      if (!rdef) {
        return;
      }

      let obj = rdef.obj;
      if (obj instanceof DataBlock && obj.lib_id >= 0) {
        let block = val === undefined ? -1 : val.lib_id;
        let path = this.texturePath;

        let toolpath = `datalib.default_assign(block=${block} dataPathToSet=${path})`;
        this.ctx.api.execTool(this.ctx, toolpath);
      } else {
        this.setPathValue(this.ctx, this.texturePathMode, val);
      }//*/
    }
  }

  static defineAPI(api: DataAPI<ViewContext>) {
    const st = super.defineAPI(api)

    st.string('texturePath', 'texturePath', 'Active Texture Path')
    st.struct('_texture', 'texture', 'Active Texture', api.mapStruct(ProceduralTex))
    st.enum('texturePathMode', 'texturePathMode', TexturePathModes, 'Source').uiNames({
      EDITOR: 'Any',
      BRUSH : 'Brush',
    })

    return st
  }

  static define() {
    return {
      tagname : 'props-editor-x',
      areaname: 'props',
      apiname : 'propsEditor',
      uiname  : 'Properties',
      icon    : Icons.EDITOR_PROPERTIES,
    }
  }

  /**
   * Lets the active tab fill the column beside the rail, and gives the rail its
   * own gutter.
   *
   * Two things path.ux does not do for a *side* rail:
   *
   *   - `TabContainer` wraps the active tab in a fresh `div` on every switch and
   *     `_remakeStyle` styles that wrapper `align-self: flex-start`. On a top bar
   *     that rule is what keeps the bar from stretching; on a side rail it lands on
   *     the *contents* wrapper instead, which then shrink-wraps to its widest row —
   *     so the Object panel drew 193px wide inside a 374px column, the rest of the
   *     properties area was empty ground, and every slider was a stub.
   *   - It paints the bar and the body the same colour, which left the category
   *     icons looking like they floated on top of the panel.
   *
   * Both are expressed as CSS from here because `path.ux` is a pinned submodule:
   * our changes live outside it. The wrapper is tagged with a class of ours, and
   * the gutter is a `:host` rule on the container — a container-wide rule rather
   * than a taller bar, because the bar's own items grow with it and stretching it
   * re-laid the icons out into a column of blank tiles.
   *
   * `!important` where path.ux writes the same property inline: `TabContainer.setCSS`
   * re-applies its themed background on every restyle, so a plain rule would be
   * overwritten and the gutter would flicker back to the body colour. The tracked
   * class also keeps working for the wrapper `TabContainer` recreates on each switch.
   */
  private _stretchTabBody(): void {
    /*
     * Every colour is read back out of the theme — the ground for the gutter, the
     * body surface for the column beside it, and the border colour for the hairline
     * between them — so this stays in step with the palette rather than
     * second-guessing it.
     *
     * `DefaultPanelBG` has to be read from the *theme*, not from this editor: this
     * widget's own style class leaves it unset, so `this.getDefault(...)` answered
     * `transparent` and the two rules below painted nothing. The panels' own
     * `surface` fill covered the content, and the area below it — the tail of a short
     * tab, which is most of the column — fell through to the area background in a
     * different grey. Two greys in one column is the "half black, half not" look.
     */
    const ground = this.getDefault('background-color') as string
    const body = VOID_STUDIO_PALETTE.surface
    const divider = this.getDefault('border-color') as string

    /*
     * Typography is set on the tab container rather than left to each widget.
     * `font-family` and `color` are inherited properties and they cross a shadow
     * boundary, so one rule covers every widget that does not ask for a face of its
     * own — which is the gap: a container built from raw widgets (the Material
     * panel's `ColumnFrame`s) has no `font` in its theme record at all, so its
     * labels rendered in the browser default, `16px Times`, at full size next to
     * 12px themed labels. That is what made the panel read as a page with no CSS.
     */
    const font = this.getDefault('DefaultText') as {family?: string; weight?: number; color?: string} | undefined
    // 12px, not the sheet's own 14px: every label the panel records carry is 12, and
    // these are the widgets that have no face of their own.
    const fontCss = `${font?.weight ?? 400} 12px ${font?.family ?? 'system-ui, sans-serif'}`

    const style = document.createElement('style')
    style.textContent = `
      :host {
        background-color: ${ground} !important;
        font: ${fontCss};
        color: ${font?.color ?? 'inherit'};

        /* The tab container has to fill the editor, not hug the active tab's
         * content: a short tab left the tail of the column to the area background,
         * which is the band. */
        flex: 1 1 auto !important;
        min-height: 0;
      }

      .vs-props-tab-body {
        align-self: stretch !important;
        flex: 1 1 auto !important;
        min-height: 0;
        min-width: 0;
        background-color: ${body} !important;
        border-left: 1px solid ${divider};
      }

      /* The wrapper is a flex row holding the one tab container; without this the
       * child keeps its content width and the two rules above change nothing. */
      .vs-props-tab-body > * {
        flex: 1 1 auto !important;
        min-width: 0;
      }

      /* The rail itself stays transparent so the gutter above shows through it. */
      ._tbar_${this.tabs._id} {
        background-color: transparent !important;
      }
    `

    this.tabs.shadow.prepend(style)

    const mark = () => this.tabs.tbar._contentsWrapper?.classList.add('vs-props-tab-body')
    mark()

    // `TabContainer` builds the contents wrapper inside its own change handler,
    // so the tag has to be re-applied each time rather than once here.
    const onChange = this.tabs.on_change
    this.tabs.on_change = (tab, event) => {
      onChange?.(tab, event)
      mark()
    }
  }

  on_area_active() {
    super.on_area_active()

    if (!this.ctx) {
      return
    }

    // check that init has been called
    this._init()
    this.setCSS()
    // on_area_active could be called during file load, so put
    // flushUpdate in a try block

    try {
      this.flushUpdate()
    } catch {
      // ignore -- may run during file load, before data is ready
    }
  }

  init() {
    super.init()
    // The editor's own background matches the tab body: anything the body does not
    // cover (the scroll gutter, a sliver beside a scrollbar) then reads as the same
    // surface instead of the area's grey.
    this.background = VOID_STUDIO_PALETTE.surface

    this.style['overflow'] = 'scroll'

    const container = this.container
    this.tabs = container.tabs('left')
    this._stretchTabBody()

    /*
    Blender's properties rail is an icon-only column whose labels live in
    tooltips. `TabContainer.tab()` renders the full name rotated 90 degrees,
    which at a rail's width produced a column of clipped, overlapping text.
    Setting the icon on the bar item and clearing its label narrows the rail to
    roughly one icon tile while keeping `tab()`'s own bar wiring (`_tab`) and
    the name in the tooltip, so the category is still discoverable on hover.

    Which icon carries a category is not cosmetic here: an icon-only rail is
    only navigable if the glyphs are recognisable and distinct, so each tab
    takes the nearest match from the sheet — a cube for Object, a camera for
    Scene, the colour wheel for Material, a picture for Texture, the subdiv
    grid for the object's mesh data. The tooltip spells the category out in
    full, which is what makes the rail learnable.
    */
    const iconTab = (name: string, icon: number, tooltip = name): TabItemContainer<ViewContext> => {
      const item = this.tabs.tab(name, undefined, tooltip)
      item._tab.icon = icon
      item._tab.name = ''
      return item
    }

    this.workspaceTab = iconTab(
      'Workspace',
      Icons.EDITOR_SETTINGS,
      'Active Tool — the settings of the tool in the viewport'
    )
    let panel: PanelContents<ViewContext>

    let tab = iconTab('Scene', Icons.RENDER, 'Scene — viewport and render settings')
    panel = tab.panel('Viewport Settings')
    panel.useIcons(false)
    panel.prop('view3d.cameraMode[PERSPECTIVE]')
    panel.prop('view3d.cameraMode[ORTHOGRAPHIC]')

    const viewAxis = (axis: Number3, sign: number) => {
      this.ctx.view3d.viewAxis(axis, sign)
    }

    const axes = {
      Front : [1, 1],
      Left  : [0, 1],
      Back  : [1, -1],
      Right : [0, -1],
      Top   : [2, 1],
      Bottom: [2, -1],
    } as const

    function makeAxis(key: string, axis: Number3, sign: number) {
      panel.button(key, () => {
        viewAxis(axis, sign)
      })
    }

    for (const k in axes) {
      const [axis, sign] = axes[k as keyof typeof axes]
      makeAxis(k, axis, sign)
    }

    panel = tab.panel('Render Settings')
    panel.prop('scene.envlight.color')
    panel.prop('scene.envlight.power')
    panel.prop('scene.envlight.flag')
    panel.prop('scene.envlight.ao_dist')
    panel.prop('scene.envlight.ao_fac')
    panel.prop('view3d.render.sharpen')

    tab = iconTab('Material', Icons.SCULPT_COLOR, 'Material — the material on the active object')
    this.materialPanel(tab)

    tab = this.objTab = iconTab('Object', Icons.BOX_MODEL, 'Object — transform, visibility and collections')
    const obpanel = UIBase.createElement('scene-object-panel-x') as ObjectPanel
    tab.add(obpanel)

    const obDataTab = iconTab('ObData', Icons.MESHTOOL, 'Object Data — the mesh this object points at')
    let obDataType: string | undefined
    const obDataUIDatas = new Map<string, string>()

    // Feature flags gate whole panels inside buildPropertiesTab (sculpt layers,
    // multires, VDM), so a flag flip must rebuild the tab, not wait for restart.
    let obDataForceRebuild = false
    messageBus.subscribe(
      () => (this.isDead() ? undefined : this),
      FeatureFlagManager,
      () => {
        obDataForceRebuild = true
        this.doOnce(rebuildObDataTab)
      },
      'FLAG_SET'
    )

    const rebuildObDataTab = () => {
      const type = this.ctx?.object?.data?.lib_type ?? undefined

      if (type === obDataType && !obDataForceRebuild) {
        return
      }
      obDataForceRebuild = false

      if (obDataType !== undefined) {
        obDataUIDatas.set(obDataType, saveUIData(obDataTab, 'obDataTab'))
      }

      obDataType = this.ctx?.object?.data?.lib_type
      obDataTab.clear()

      if (obDataType !== undefined && this.ctx?.object?.data !== undefined) {
        const cls = this.ctx?.object?.data?.constructor as any
        cls.buildPropertiesTab(obDataTab)

        const uidata = obDataUIDatas.get(obDataType)
        if (uidata !== undefined) {
          loadUIData(obDataTab, uidata)
        }
        obDataTab.flushUpdate()
      }
    }
    this.updateAfter(rebuildObDataTab)

    tab = this.texTab = iconTab('Texture', Icons.IMAGE_EDITOR, 'Texture — the procedural texture being edited')
    this.textureTab(tab)

    this._last_obj = undefined

    tab = iconTab('Last Command', Icons.REDO, 'Last Command — redo and adjust the previous operation')
    const last = document.createElement('last-tool-panel-x') as LastToolPanel<ViewContext>
    tab.add(last)

    this._settingsTab = iconTab('Settings', Icons.EDITOR_PROPERTIES, 'Settings — addons, brushes, feature flags')
    this._buildSettingsPanels()
  }

  /** Build (or rebuild) the Settings tab. Folds the former Settings/Theme
   * editor's General, Addons and Feature Flags tabs in here as panels (#4);
   * theme editing stays in the (now "Theme Editor") SettingsEditor. */
  _buildSettingsPanels(): void {
    const tab = this._settingsTab
    if (!tab) return
    tab.clear()

    let panel = tab.panel('Brushes')
    const strip = panel.row()
    strip.useIcons(false)
    strip.prop('settings.brushSet')
    strip.useIcons(true)
    strip.tool('brush.reload_all_defaults()')

    panel = tab.panel('General')
    SettingsEditor.buildGeneralSettings(panel.col())

    panel = tab.panel('Addons')
    SettingsEditor.buildAddonsSettings(panel.col(), () => this.doOnce(this._buildSettingsPanels))

    panel = tab.panel('Feature Flags')
    SettingsEditor.buildFeatureFlagsSettings(panel.col())
  }

  textureTab(tab: TabItemContainer<ViewContext>) {
    //let tex = document.createElement("texture-panel-x");
    ;(this.texPanel = UIBase.createElement('texture-panel-x')) as TexturePanel
    const tex = this.texPanel

    const browser = UIBase.createElement('data-block-browser-x') as DataBlockBrowser<ProceduralTex>

    const path = 'propsEditor.texture'

    browser.setAttribute('datapath', path)
    browser.blockClass = ProceduralTex

    const strip = tab.row().strip()
    strip.label('Source')
    strip.prop('propsEditor.texturePathMode')

    tex.setAttribute('datapath', path)
    tex.ctx = this.ctx

    tab.add(browser)
    tab.add(tex)
  }

  materialPanel(tab: TabItemContainer<ViewContext>) {
    const panel = UIBase.createElement('material-panel-x') as MaterialPanel
    panel.setAttribute('datapath', 'object.data')
    tab.add(panel)
  }

  updateToolMode() {
    if (!this.ctx?.toolmode || !this.workspaceTab) {
      return
    }

    const toolmode = this.ctx.toolmode

    if (toolmode === this._last_toolmode) {
      return
    }

    this._last_toolmode = toolmode

    this.workspaceTab.clear()

    // propagate toolmode's ctx if it changed it
    toolmode.checkCtx(this.ctx)
    if (toolmode.ctx && toolmode.ctx !== this.workspaceTab.ctx) {
      this.workspaceTab.ctx = toolmode.ctx
    }

    try {
      toolmode.constructor.buildSettings(this.workspaceTab)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error((error as Error).stack)
      // eslint-disable-next-line no-console
      console.error((error as Error).message)
      // eslint-disable-next-line no-console
      console.warn('failed to build toolmode settings', this.ctx?.toolmode)
      // try to build again later
      this._last_toolmode = undefined
    }
  }

  update() {
    //check init
    if (this.texPanel) {
      this.texPanel._init()
    }

    // Refresh the Settings tab's Addons panel when the addon list changes.
    if (this._settingsTab && this.ctx?.settings.syncAddonList()) {
      this.doOnce(this._buildSettingsPanels)
    }

    this.updateToolMode()

    super.update()
  }

  copy() {
    const ret = UIBase.createElement('props-editor-x') as this
    ret.ctx = this.ctx
    return ret
  }

  setCSS() {
    super.setCSS()
  }
}

Editor.register(PropsEditor)
