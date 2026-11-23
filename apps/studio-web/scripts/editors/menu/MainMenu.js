import {Area, BorderMask, AreaFlags} from '../../path.ux/scripts/screen/ScreenArea.js'
import {Icons} from '../icon_enum.js'
import {View3DFlags} from '../view3d/view3d_base.js'
import {getAvailableToolModes} from '../view3d/view3d_toolmode'
import {DrawModes} from '../../sceneobject/drawmode.js'

import {NoteFrame, Note} from '../../path.ux/scripts/widgets/ui_noteframe.js'
import {Editor, VelPan} from '../editor_base.ts'

import {saveFile, loadFile, DataPathError, KeyMap, HotKey} from '../../path.ux/scripts/pathux.js'

import {
  UIBase,
  color2css,
  _getFont,
  css2color,
  nstructjs,
  DropBox,
  createMenu,
  startMenu,
} from '../../path.ux/pathux.js'

import {Container} from '../../path.ux/scripts/core/ui.js'
import {RowFrame, ColumnFrame} from '../../path.ux/scripts/core/ui_containers.js'
import {Vector2, Vector3, Vector4, Quat, Matrix4} from '../../util/vectormath.js'
import * as util from '../../util/util.js'
import {DataRef} from '../../core/lib_api.js'
import {NodeEditorBase} from '../node/NodeEditor.js'
import * as cconst from '../../core/const.js'
import {Menu} from '../../path.ux/scripts/widgets/ui_menu.js'

/** Blender's top bar is a single compact strip; keep room for workspace tabs. */
const menuSize = 28

import * as platform from '../../core/platform.js'
import addonManager from '../../addon/addon.js'
import {getAppState} from '../../core/app_instance.js'

/**
 * The View3D "Add" menu's contents: the host's own light op plus every addon's
 * `menuEntries('add', …)` contribution.
 *
 * Shared by the menu bar's Add menu and the `Shift-A` popup below, so the two
 * cannot drift — previously `Shift-A` ran the cube op directly and the other
 * primitives were reachable only by navigating the menu bar.
 */
export function addMenuEntries() {
  // Blender Add order (subset): Mesh… / Light / Camera / Empty
  return [
    ...addonManager.getAddonMenuEntries(),
    Menu.SEP,
    'light.new()|Light',
    'object.add_camera()|Camera',
    'object.add_empty()|Empty',
  ]
}

/**
 * Opens the Add menu at the cursor — Blender's `Shift-A`.
 *
 * Built through `createMenu` + `startMenu` rather than by hand: `createMenu`
 * already resolves each tool path to its uiname, icon, hotkey and refusal, and
 * `startMenu` owns popup placement and the menu-wrangler's close-on-click-out.
 */
export function spawnAddMenu(ctx) {
  try {
    const menu = createMenu(ctx, 'Add', addMenuEntries())
    startMenu(menu, ctx.screen.mpos[0], ctx.screen.mpos[1])
  } catch (error) {
    util.print_stack(error)
    ctx.warning('Could not open the Add menu')
  }
}

/**
 * When a workspace tab is activated, nudge the scene into the mode Blender
 * users expect for that workspace (docs → Workspaces).
 */
export function applyWorkspaceToolMode(ctx, workspaceName) {
  const scene = ctx?.scene
  const prop = scene?.constructor?.toolModeProp
  if (!scene || !prop?.values) return

  const available = getAvailableToolModes(ctx)
  const name = String(workspaceName || '')
  let targetKey = 'object'
  if (/sculpt/i.test(name) && available.some((mode) => mode.name === 'sculptcore')) {
    targetKey = 'sculptcore'
  } else if (/model/i.test(name)) {
    targetKey = available.find((mode) => mode.editMenuLabel === 'Mesh')?.name ?? 'object'
  } else if (/layout/i.test(name) || !name || /^screen/i.test(name)) {
    targetKey = 'object'
  } else if (/script/i.test(name)) {
    targetKey = 'object'
  }

  const idx = prop.values[targetKey]
  if (idx === undefined || scene.toolmode_i === idx) return
  scene.switchToolMode(idx)
  window.redraw_viewport?.(true)
}

/**
 * Blender Ctrl-Tab — pick Object / Sculpt / Edit (LeafMesh) / Box Model.
 * docs.blender.org → Modes
 */
export function spawnModeSwitchMenu(ctx) {
  const scene = ctx?.scene
  const prop = scene?.constructor?.toolModeProp
  if (!scene || !prop?.values) return

  const entries = []
  const add = (key, label) => {
    if (!(key in prop.values)) return
    entries.push([
      label,
      () => {
        scene.switchToolMode(prop.values[key])
        window.redraw_viewport?.(true)
      },
    ])
  }

  for (const mode of getAvailableToolModes(ctx)) add(mode.name, mode.uiname)

  if (entries.length === 0) return
  try {
    const menu = createMenu(ctx, 'Mode', entries)
    startMenu(menu, ctx.screen.mpos[0], ctx.screen.mpos[1])
  } catch (error) {
    console.warn('Could not open the Mode menu', error)
  }
}

export class ToolHistoryConsole extends ColumnFrame {
  constructor() {
    super()

    this._buf = undefined
    this.tooltable = undefined
  }

  rebuild() {
    if (!this.tooltable) {
      return
    }

    let table = this.tooltable
    let toolstack = this.ctx.toolstack

    let lines = []
    let count = 28

    for (let i = toolstack.length - 1; i >= toolstack.length - count; i--) {
      if (i < 0) {
        break
      }

      let l = toolstack[i].genToolString()
      l = {
        line: l,
        i   : i,
      }

      lines = [l].concat(lines)
    }

    let buf = lines.join('\n') + toolstack.cur
    if (buf !== this._buf) {
      this._buf = buf

      table.clear()

      let focusrow
      let lastrow

      for (let l of lines) {
        let row = table.row()

        if (l.i === toolstack.cur) {
          focusrow = row
          row.style['background-color'] = 'rgb(10, 100, 75, 0.5)'
        }

        row.label('' + (l.i + 1))
        row.label(l.line)
        lastrow = row
      }

      if (!focusrow) focusrow = lastrow

      window.fp = focusrow

      if (!this.hidden && focusrow !== undefined) {
        focusrow.scrollIntoView()
      }

      this.setCSS()
    }
  }

  init() {
    this.setCSS()

    this.tooltable = this.table()
    this.rebuild()

    this.style['background-color'] = 'rgba(50, 50, 50, 0.5)'
  }

  update() {
    super.update()

    this.rebuild()
  }

  setCSS() {
    super.setCSS()
  }

  static define() {
    return {
      tagname: 'tool-console-x',
    }
  }
}

UIBase.register(ToolHistoryConsole)

export class MenuBarEditor extends Editor {
  static STRUCT = nstructjs.inlineRegister(
    this,
    `
MenuBarEditor {
}
  `
  )

  constructor() {
    super()

    this.needNativeMenuRebuild = true

    this.menuSize = menuSize
    this.areaDragToolEnabled = false

    this._switcher_key = ''
    this._ignore_tab_change = false
    this._last_toolmode = undefined

    this.borderLock = BorderMask.TOP | BorderMask.BOTTOM
  }

  buildEditMenu() {
    this.needNativeMenuRebuild = true

    let def = this._editMenuDef

    def.length = 0
    def.push([
      'Undo',
      () => {
        getAppState().toolstack.undo()
      },
      'Ctrl+Z',
      Icons.UNDO,
    ])
    def.push([
      'Redo',
      () => {
        getAppState().toolstack.redo()
      },
      'Ctrl+Shift+Z',
      Icons.REDO,
    ])

    def.push(Menu.SEP)
    def.push('view3d.view_selected()')

    if (this.ctx && this.ctx.scene && this.ctx.toolmode) {
      let toolmode = this.ctx.toolmode
      toolmode.checkCtx(this.ctx)
      if (toolmode.ctx && toolmode.ctx !== this.ctx) {
        this.ctx = toolmode.ctx
      }
      let def2 = toolmode.constructor.buildEditMenu()

      for (let item of def2) {
        def.push(item)
      }
    }
  }

  init() {
    super.init()
    this.background = this.getDefault('DefaultPanelBG')

    let header = this.header
    let strip = (this._strip = header.row())

    this.console = document.createElement('tool-console-x')
    this.container.add(this.console)
    this.console.hidden = true

    let menubar = (this._menubar = strip.row())

    const fileMenu = [
      'app.new()',
      Menu.SEP,
      /* ["Save", () => {
         console.log("File save");

         platform.platform.showSaveDialog("Save File", getAppState().createFile(),{
           filters : [
             {
               defaultPath : "unnamed." + cconst.FILE_EXT,
               name : "Project Files",
               extensions : [cconst.FILE_EXT]
             }
           ]
         }).then(() => {
           this.ctx.message("File saved");
         });
         //saveFile(getAppState().createFile(), "unnamed."+cconst.FILE_EXT, ["."+cconst.FILE_EXT]);
       }],*/
      'app.open()',
      'app.load_last_autosave()',
      'app.save(forceDialog=false saveToolStack=true)|Save With Toolstack',
      'app.save(forceDialog=true)|Save As',
      Menu.SEP,
      'app.import_file()|Import 3D Asset...',
      'voidspace.sketchfab()|Sketchfab Models...',
      Menu.SEP,
      'app.export_glb()|Export glTF 2.0 (.glb)',
      'app.export_obj()|Export Wavefront (.obj)',
      'app.export_stl()|Export Stereolithography (.stl)',
      'app.export_ply()|Export Stanford (.ply)',
    ]

    // Only the NW.js shell owns a window to close; the browser build has no Exit.
    if (window.haveNwjs) {
      fileMenu.push(Menu.SEP, [
        'Exit',
        () => {
          globalThis.nw.Window.get().close()
        },
      ])
    }

    menubar.menu('File', fileMenu)

    this._editMenuDef = []

    menubar.menu('Edit', this._editMenuDef)

    this.buildEditMenu()

    // Dynamically generated menu — Blender's Shift+A sibling.
    const addMenu = menubar.menu('Add', ['light.new()'])
    addMenu._build_menu = function () {
      if (this._menu?.parentNode !== undefined) {
        this._menu.remove()
      }

      const list = addMenuEntries()
      this._menu = createMenu(this.ctx, 'Add', list)
      return this._menu
    }

    menubar.menu('View', [
      'view3d.view_selected()',
      Menu.SEP,
      [
        'Toggle Grid Floor',
        () => {
          const v3d = this.ctx?.view3d
          if (!v3d) return
          v3d.flag ^= View3DFlags.SHOW_GRID
          window.redraw_viewport?.(true)
        },
        'Shift+Z',
      ],
      [
        'Toggle 3D Cursor',
        () => {
          const v3d = this.ctx?.view3d
          if (!v3d) return
          v3d.flag ^= View3DFlags.SHOW_CURSOR
          window.redraw_viewport?.(true)
        },
      ],
      [
        'Toggle Camera View Frame',
        () => {
          const v3d = this.ctx?.view3d
          if (!v3d) return
          v3d.flag ^= View3DFlags.SHOW_CAMERA_VIEW
          window.redraw_viewport?.(true)
        },
      ],
      [
        'Toggle Rendered Preview',
        () => {
          const v3d = this.ctx?.view3d
          if (!v3d) return
          v3d.flag ^= View3DFlags.SHOW_RENDER
          window.redraw_viewport?.(true)
        },
      ],
      Menu.SEP,
      [
        'Wireframe',
        () => {
          const v3d = this.ctx?.view3d
          if (!v3d) return
          v3d.flag &= ~View3DFlags.SHOW_RENDER
          v3d.drawmode = DrawModes.WIRE
          window.redraw_viewport?.(true)
        },
        'Z',
      ],
      [
        'Solid',
        () => {
          const v3d = this.ctx?.view3d
          if (!v3d) return
          v3d.flag &= ~View3DFlags.SHOW_RENDER
          v3d.drawmode = DrawModes.SOLID
          window.redraw_viewport?.(true)
        },
      ],
      [
        'Material Preview',
        () => {
          const v3d = this.ctx?.view3d
          if (!v3d) return
          v3d.flag &= ~View3DFlags.SHOW_RENDER
          v3d.drawmode = DrawModes.TEXTURED
          window.redraw_viewport?.(true)
        },
      ],
      [
        'Rendered',
        () => {
          const v3d = this.ctx?.view3d
          if (!v3d) return
          v3d.flag |= View3DFlags.SHOW_RENDER
          window.redraw_viewport?.(true)
        },
      ],
      Menu.SEP,
      ['Front', () => this.ctx?.view3d?.viewAxis?.(1, 1), 'Numpad 1'],
      ['Right', () => this.ctx?.view3d?.viewAxis?.(0, 1), 'Numpad 3'],
      ['Top', () => this.ctx?.view3d?.viewAxis?.(2, 1), 'Numpad 7'],
      [
        'Toggle Perspective/Orthographic',
        () => {
          const v3d = this.ctx?.view3d
          if (!v3d) return
          v3d.cameraMode ^= 1
          window.redraw_viewport?.(true)
        },
        'Numpad 5',
      ],
    ])

    menubar.menu('Object', [
      "object.toggle_select_all(mode='AUTO')|Select All",
      "object.toggle_select_all(mode='SUB')|Deselect All",
      'object.select_box()|Box Select',
      Menu.SEP,
      'object.delete_selected()|Delete',
    ])

    menubar.menu('Window', [
      [
        'Save Startup File',
        () => {
          getAppState().saveStartupFile()
        },
      ],
      [
        'Load Factory Settings',
        () => {
          getAppState().clearStartupFile()
        },
      ],
      Menu.SEP,
      [
        'New Workspace',
        () => {
          this._on_tab_change({id: 'maketab'})
        },
      ],
    ])

    menubar.menu('Help', [
      [
        'Manual',
        () => {
          window.open(new URL('manual.html', document.baseURI).href, '_blank', 'noopener')
        },
        'F1',
      ],
      [
        'About VOID·STUDIO',
        () => {
          this.ctx?.message?.('VOID·STUDIO — Blender-style authoring for VOID·SPACE')
        },
      ],
    ])

    menubar.update()

    strip.iconbutton(Icons.CONSOLE, 'Show Console', () => {
      if (this.menuSize !== menuSize) {
        this.menuSize = menuSize
        this.console.hidden = true
        this.console.style['overflow'] = 'hidden'
      } else {
        this.menuSize = 200
        this.console.hidden = false
        this.console.style['overflow'] = 'scroll'
      }
    }).iconsheet = 0

    strip.noteframe()

    // Workspace tabs — Blender's Layout / Modeling / … switcher.
    this.makeScreenSwitcher(strip)

    this.setCSS()
    this.flushUpdate()

    // NW.js native menu-bar click delivery is unreliable (clicks don't reach the
    // JS handler); use the in-app HTML menubar instead — same as the browser
    // build. The nwjs platform still provides native file dialogs + fs.
  }

  onFileLoad() {
    super.onFileLoad()
    this.rebuildScreenSwitcher()
  }

  rebuildScreenSwitcher() {
    if (this.tabs !== undefined) {
      this.tabs.remove()
      this.tabs = undefined
    }

    if (this._strip) {
      this.makeScreenSwitcher(this._strip)
    }
  }

  _on_tab_change(tab) {
    if (this._ignore_tab_change) {
      return
    }

    console.warn('Screen tab change!', tab, this.ctx.datalib.getLibrary('screen').active.lib_id)

    if (tab.id == 'maketab') {
      console.log('new screen!')

      let lib = this.ctx.datalib.getLibrary('screen')
      let sblock = lib.active

      if (sblock === undefined) {
        sblock = lib[0]
      }

      let sblock2 = sblock.copy()
      sblock2.name = lib.uniqueName(sblock2.name)

      lib.add(sblock2)
      lib.setActive(sblock2)

      getAppState().switchScreen(sblock2)
      //this.rebuildScreenSwitcher();
    } else {
      console.log(tab.id)
      let sblock = this.ctx.datalib.get(tab.id)

      if (sblock !== undefined) {
        this.ctx.state.switchScreen(sblock)
        // Blender workspaces imply a mode focus (Layout/Modeling → Object,
        // Sculpting → Sculpt). Apply after the screen swap so the viewport
        // header matches the tab the Creator just chose.
        applyWorkspaceToolMode(this.ctx, sblock.name)
      } else {
        console.log('failed to load screen', tab.id, tab)
      }
    }
  }

  _makeSwitcherHash() {
    let ret = ''
    try {
      const lib = getAppState()?.datalib?.screen
      if (!lib) return ''
      for (let k of lib) {
        ret += k + '|'
      }
    } catch {
      return ''
    }
    return ret
  }

  makeScreenSwitcher(container) {
    let tabs = (this.tabs = container.tabs())

    this._switcher_key = this._makeSwitcherHash()

    tabs.onchange = (tab) => {
      this._on_tab_change(tab)
    }

    let lib = this.ctx?.datalib?.getLibrary?.('screen')
    if (!lib) {
      this._ignore_tab_change = false
      return
    }

    this._ignore_tab_change = true

    for (let sblock of lib) {
      const raw = sblock.name || ''
      const name = !raw || raw === 'screen' || raw === 'Screen' || /^Screen\d*$/i.test(raw) ? 'Layout' : raw
      let tab = tabs.tab(name, sblock.lib_id)

      if (sblock === lib.active) {
        tabs.setActive(tab)
      }
    }

    tabs.tab('+', 'maketab')
    this._ignore_tab_change = false
  }

  on_area_active() {
    //this.rebuildScreenSwitcher();
    this.setCSS()
  }

  update() {
    super.update()

    if (this.ctx?.toolmode?.constructor && this.ctx.toolmode.constructor.name !== this._last_toolmode) {
      this._last_toolmode = this.ctx.toolmode.constructor.name
      this.buildEditMenu()
    }

    const switcherKey = this._makeSwitcherHash()
    if (this.tabs && switcherKey !== this._switcher_key) {
      this.rebuildScreenSwitcher()
    }

    if (this.minSize[1] !== this.menuSize) {
      this.minSize[1] = this.menuSize
      this.maxSize[1] = this.menuSize

      this.ctx.screen.solveAreaConstraints()
      this.ctx.screen.snapScreenVerts()
      this.ctx.screen.regenBorders()
      this.setCSS()
    }
  }

  copy() {
    let ret = document.createElement('menu-editor-x')
    ret.ctx = this.ctx

    return ret
  }

  setCSS() {
    if (this.console) {
      this.console.style['width'] = this.size[0] + 'px'
      this.console.style['height'] = this.size[1] - menuSize + 'px'
    }

    super.setCSS()
  }

  static define() {
    return {
      tagname : 'menu-editor-x',
      areaname: 'MenuBarEditor',
      uiname  : 'Main Menu',
      icon    : Icons.EDITOR_MENU,
      flag    : AreaFlags.HIDDEN | AreaFlags.NO_SWITCHER,
    }
  }
}

Editor.register(MenuBarEditor)
