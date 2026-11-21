import {MenuBarEditor, applyWorkspaceToolMode} from './menu/MainMenu.js'
import {PropsEditor} from './properties/PropsEditor.js'
import {View3D} from './view3d/view3d.js'
import {OutlinerEditor} from './outliner/OutlinerEditor.js'
import {StatusBarEditor} from './statusbar/StatusBarEditor.js'
import {TimelineEditor} from './timeline/TimelineEditor.js'
import {ConsoleEditor} from './console/console.js'
import {getAppState} from '../core/app_instance.js'

export function genResBrowserScreen(appstate, ResourceBrowser) {
  let screen = document.createElement('webgl-app-x')

  let oldscreen = appstate.screen

  screen.ctx = appstate.ctx
  screen.size[0] = oldscreen.size[0]
  screen.size[1] = oldscreen.size[1]

  let sarea = document.createElement('screenarea-x')

  sarea.ctx = appstate.ctx
  sarea.floating = false

  sarea.pos[0] = 0.0
  sarea.pos[1] = 0.0

  sarea.size[0] = oldscreen.size[0]
  sarea.size[1] = oldscreen.size[1]

  sarea.switch_editor(ResourceBrowser)
  screen.appendChild(sarea)

  return screen
}

/**
 * Blender Layout workspace (modeling focus — no Timeline):
 *
 *   [ Topbar                                                         ]
 *   [ 3D Viewport                              | Outliner            ]
 *   [                                          |---------------------]
 *   [                                          | Properties          ]
 *   [ Status bar                                                     ]
 */
function buildLayoutAreas(screen, appstate) {
  let sarea = document.createElement('screenarea-x')

  sarea.ctx = appstate.ctx
  sarea.floating = false

  sarea.pos[0] = sarea.pos[1] = 0.0
  sarea.size[0] = screen.size[0]
  sarea.size[1] = screen.size[1]

  sarea.switchEditor(View3D)
  screen.appendChild(sarea)

  const menuH = Math.min(0.05, 28 / Math.max(sarea.size[1], 1))
  let menuArea = sarea
  let belowMenu = screen.splitArea(sarea, menuH, true)
  menuArea.area.closed = true
  menuArea.switchEditor(MenuBarEditor)

  const statusFrac = Math.min(0.04, 24 / Math.max(belowMenu.size[1], 1))
  let main = belowMenu
  let statusArea = screen.splitArea(belowMenu, 1.0 - statusFrac, true)
  statusArea.area.closed = true
  statusArea.switchEditor(StatusBarEditor)

  // Right ~20%: Outliner (top third) over Properties — Blender proportions.
  let rightCol = screen.splitArea(main, 0.8, false)
  rightCol.area.closed = true
  rightCol.switchEditor(PropsEditor)

  let outlinerArea = rightCol
  screen.splitArea(rightCol, 0.32, true)
  outlinerArea.area.closed = true
  outlinerArea.switchEditor(OutlinerEditor)
}

/** Split the View3D so a Console sits below it (Scripting workspace). */
function attachConsoleUnderViewport(screen) {
  let viewArea
  for (const sa of screen.sareas) {
    const name = sa.area?.constructor?.define?.()?.areaname
    if (name === 'view3d') {
      viewArea = sa
      break
    }
  }
  if (!viewArea) return

  const consoleArea = screen.splitArea(viewArea, 0.62, true)
  consoleArea.area.closed = true
  consoleArea.switchEditor(ConsoleEditor)
}

/** Animation has a real timeline; modeling workspaces retain their viewport area. */
function attachTimelineUnderViewport(screen) {
  const area = screen.sareas.find(sa => sa.area?.constructor?.define?.()?.areaname === 'view3d')
  if (!area) return
  const timeline = screen.splitArea(area, 0.82, true)
  timeline.area.closed = true
  timeline.switchEditor(TimelineEditor)
}

/**
 * Seeds modeling, sculpting, scripting and animation workspaces.
 */
export function seedBlenderWorkspaces(appstate) {
  const lib = appstate.datalib?.getLibrary?.('screen')
  if (!lib) return

  const layout = lib.active || lib[0]
  if (!layout) return
  if (!layout.name || layout.name === 'screen' || /^Screen/i.test(layout.name)) {
    layout.name = 'Layout'
  }

  const existing = new Set([...lib].map((b) => b.name))

  let template = layout
  for (const b of lib) {
    if (b.name === 'Layout') {
      template = b
      break
    }
  }

  const addCopy = (name, tweak) => {
    if (existing.has(name) || typeof template.copy !== 'function') return
    const block = template.copy()
    block.name = name
    lib.add(block)
    existing.add(name)
    if (tweak && block.screen) {
      block.screen.ctx = appstate.ctx
      tweak(block.screen)
    }
  }

  addCopy('Modeling')
  addCopy('Sculpting')
  addCopy('Scripting', attachConsoleUnderViewport)

  addCopy('Animation', attachTimelineUnderViewport)

  lib.setActive(layout)
}

/** Remove Timeline areas left behind by older builds / startup files. */
export function removeTimelineFromScreen(screen) {
  if (!screen?.sareas) return false
  let removed = false

  for (const sa of [...screen.sareas]) {
    const name = sa.area?.constructor?.define?.()?.areaname
    if (name !== 'TimelineEditor') continue

    // Collapse the timeline strip into its neighbor by switching it to View3D
    // then removing via screen helper when available; otherwise just reassign
    // the area to StatusBar so it stops showing transport chrome.
    try {
      if (typeof screen.removeArea === 'function') {
        screen.removeArea(sa)
      } else if (typeof screen.collapseArea === 'function') {
        screen.collapseArea(sa)
      } else {
        sa.area.closed = true
        sa.switchEditor(StatusBarEditor)
      }
      removed = true
    } catch {
      try {
        sa.switchEditor(View3D)
        removed = true
      } catch {
        // leave it
      }
    }
  }

  return removed
}

/**
 * Bring a loaded screen up to modeling Layout chrome:
 * no Timeline, workspace tabs, Object Mode on Layout.
 */
export function ensureBlenderChrome(appstate) {
  const screen = appstate?.screen
  if (!screen) return

  const currentWorkspace = appstate.datalib?.getLibrary?.('screen')?.active?.name
  if (currentWorkspace !== 'Animation') removeTimelineFromScreen(screen)
  seedBlenderWorkspaces(appstate)

  const active = appstate.datalib?.getLibrary?.('screen')?.active
  applyWorkspaceToolMode(appstate.ctx, active?.name || 'Layout')

  try {
    screen.regenBorders?.()
    screen.solveAreaConstraints?.()
  } catch {
    // early boot
  }
}

export function genDefaultScreen(appstate) {
  let screen = getAppState().screen

  screen.clear()
  screen.ctx = appstate.ctx

  buildLayoutAreas(screen, appstate)
  screen.listen()

  seedBlenderWorkspaces(appstate)
  ensureBlenderChrome(appstate)
}

window._genDefaultScreen = genDefaultScreen
window._ensureBlenderChrome = ensureBlenderChrome
