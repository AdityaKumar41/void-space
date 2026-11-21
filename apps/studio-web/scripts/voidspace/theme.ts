/**
 * VOID·STUDIO theme — Blender Dark UI.
 *
 * path.ux ships exactly one theme, `DefaultTheme`, and it is **light**: dark text on a light grey
 * ground. Re-colouring only the surfaces would therefore produce a dark editor with near-black
 * labels on it, which is unreadable — so this module rebuilds the parts that carry the identity,
 * typography included, and everything else is inherited untouched.
 *
 * Two mechanisms are needed, and getting only the first is a trap worth naming: `base` re-colours
 * everything that inherits from it, but path.ux style classes are matched ahead of `base` and many
 * of them pin their own light fills. Those are overridden individually — see `surfaceOverrides`.
 * A theme that only rewrites `base` renders a dark ground with upstream's grey panels sitting on it.
 *
 * Why a derived theme rather than an edited `theme.ts`:
 *
 *   - `theme.ts` lives in `scripts/path.ux/`, which is a **pinned submodule**. Editing it would break
 *     the pinned SHA and make `git submodule update` lose the change. Anything of ours must live
 *     outside it.
 *   - The derivation is a shallow spread, not a deep clone. `DefaultTheme` holds class instances
 *     (`CSSFont`, `BoxBorder`, …) whose behaviour depends on their prototypes, and a deep clone would
 *     quietly strip them. Overriding `base` key-by-key leaves every other entry the same object.
 *
 * The palette tracks Blender's default Dark theme (4.x): graphite panels, blue UI selection, nearly
 * square corners, system UI faces. Creators who know Blender should feel at home immediately.
 */
import {CSSFont} from '../path.ux/scripts/core/cssfont'
import {DefaultTheme} from '../path.ux/scripts/core/theme'
import {setTheme} from '../path.ux/scripts/core/base/ui_theme_key'
import {ThemeScrollBars} from '../path.ux/scripts/core/ui_theme'
import type {ThemeRecord} from '../path.ux/scripts/core/ui_theme'

/**
 * Blender Dark theme tokens.
 *
 * Numbers approximate Blender's shipped theme XML (window back, panel, header, widget inner,
 * blue `item` highlight). Kept as named hex so the shell CSS vars in `index.html` can stay in step.
 */
export const VOID_STUDIO_PALETTE = {
  bg        : '#303030',
  surface   : '#2e2e2e',
  surface2  : '#232323',
  surface3  : '#3d3d3d',
  line      : '#1d1d1d',
  lineStrong: '#545454',

  fg     : '#eeeeee',
  fgDim  : '#b8b8b8',
  fgFaint: '#888888',

  /** Blender's UI selection / active control blue. */
  accent    : '#5680c2',
  accentWarm: '#6b95d6',
  signal    : '#6fb86f',

  /** Blender's object-selection orange — used for status chips, not primary chrome. */
  gold: '#e87d0d',
  heat: '#e87d0d',

  fontSans: 'Segoe UI, Helvetica Neue, Arial, system-ui, sans-serif',
  fontMono: 'JetBrains Mono, ui-monospace, Menlo, monospace',
} as const

/** `#rrggbb` + alpha -> the `rgba(...)` string path.ux theme values expect. */
function rgba(hex: string, alpha: number): string {
  const value = hex.startsWith('#') ? hex.slice(1) : hex
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * The editor's body face.
 *
 * A fresh `CSSFont` rather than a mutation of the inherited one: `CSSFont` caches a digest of its
 * fields, and writing `.color` in place leaves that digest stale, so the generated CSS can keep the
 * old colour. Constructing one is the difference between a theme that applies and one that applies
 * *sometimes*.
 */
function font(args: {size: number; weight?: string; color: string; family?: string}): CSSFont {
  return new CSSFont({
    font   : args.family ?? VOID_STUDIO_PALETTE.fontSans,
    weight : args.weight ?? 'normal',
    variant: 'normal',
    style  : 'normal',
    size   : args.size,
    color  : args.color,
  })
}

/**
 * The style classes that pin a surface of their own.
 *
 * Overriding `base` alone does *not* theme the editor, which is worth stating
 * plainly because the failure is invisible in the CSS and only shows up on
 * screen: path.ux resolves a widget by class first and consults `base` only for
 * keys the class leaves unset. Every class below writes its own light
 * `background-color`, so it keeps that value no matter what `base` says — the
 * first cut of this theme therefore produced a dark ground with upstream's grey
 * panels on top of it, i.e. exactly the unreadable combination the module
 * header warns about.
 *
 * Each entry spreads the shipped class so keys this module does not intend to
 * change (sizes, padding, sub-objects) survive untouched and upstream additions
 * are adopted rather than shadowed.
 */
function surfaceOverrides(): Partial<ThemeRecord> {
  const p = VOID_STUDIO_PALETTE
  const fieldBG = p.surface3
  const fieldText = font({size: 12, color: p.fg})

  return {
    /* Panels: Blender section boxes — flat, tight, dark header strip. */
    panel: {
      ...DefaultTheme.panel,
      'background-color': p.surface,
      'border-color'    : p.line,
      'border-style'    : 'solid',
      'border-width'    : 1,
      'margin-left'     : 0,
      'margin-right'    : 0,
      'margin-bottom'   : 2,
      TitleBackground   : p.surface2,
      TitleBorder       : p.line,
      TitleText         : font({size: 11, weight: '600', color: p.fg}),
    },

    checkbox: {
      ...DefaultTheme.checkbox,
      'background-color': p.lineStrong,
      'border-color'    : p.lineStrong,
      DefaultText       : font({size: 11, color: p.fgDim}),
    },

    dropbox: {
      ...DefaultTheme.dropbox,
      'background-color': p.surface2,
      dropTextBG        : p.surface3,
      DefaultText       : font({size: 12, weight: '600', color: p.fg}),
    },

    textbox : {...DefaultTheme.textbox, 'background-color': fieldBG, DefaultText: fieldText},
    richtext: {...DefaultTheme.richtext, 'background-color': fieldBG, DefaultText: fieldText},
    tooltip : {...DefaultTheme.tooltip, 'background-color': p.surface3, ToolTipText: fieldText},

    assetgallery: {...DefaultTheme.assetgallery, 'background-color': p.surface},
    assetthumb  : {...DefaultTheme.assetthumb, 'background-color': p.surface2},

    numslider: {
      ...DefaultTheme.numslider,
      'background-color': p.surface3,
      'border-color'    : p.line,
      highlight         : {...DefaultTheme.numslider.highlight, 'background-color': p.accent, DefaultText: fieldText},
      pressed           : {...DefaultTheme.numslider.pressed, 'background-color': p.surface2, DefaultText: fieldText},
    },
    numslider_simple : {...DefaultTheme.numslider_simple, 'background-color': p.surface3},
    numslider_textbox: {...DefaultTheme.numslider_textbox, 'background-color': p.surface3},

    button: {
      ...DefaultTheme.button,
      'background-color': p.surface3,
      'border-color'    : p.lineStrong,
      'border-width'    : 1,
      DefaultText       : font({size: 12, weight: '600', color: p.fg}),

      disabled: {
        ...DefaultTheme.button.disabled,
        DefaultText       : font({size: 11, color: p.fgFaint}),
        'background-color': p.surface,
        'border-color'    : 'transparent',
        'border-width'    : 0,
      },
    },

    label: {
      ...DefaultTheme.label,
      LabelText  : font({size: 11, color: p.fgDim}),
      DefaultText: font({size: 11, color: p.fgFaint}),
    },

    propLabels: {...DefaultTheme.propLabels, font: font({size: 11, color: p.fgDim})},

    tabs: {
      ...DefaultTheme.tabs,
      'background-color': p.surface,
      TabActive         : p.lineStrong,
      TabInactive       : p.surface2,
      TabHighlight      : p.surface3,
      TabStrokeStyle2   : p.accent,
      TabText           : font({size: 12, weight: '600', color: p.fg}),
    },

    strip: {...DefaultTheme.strip, 'background-color': 'rgba(255, 255, 255, 0.04)', 'border-color': p.line},

    screenborder: {
      ...DefaultTheme.screenborder,
      'border-inner': p.line,
      'border-outer': p.line,
    },

    scrollbars: new ThemeScrollBars({
      color : p.bg,
      color2: p.lineStrong,
      width : 11,
      border: 'none',
    }),

    listbox: {
      ...DefaultTheme.listbox,
      'background-color' : p.surface2,
      'border-color'     : p.line,
      ListActive         : p.accent,
      ListActiveHighlight: p.accentWarm,
      ListHighlight      : p.lineStrong,
      width              : 330,
      height             : 120,
    },

    sidebar: {...DefaultTheme.sidebar, 'background-color': p.surface2},

    treeview: {
      ...DefaultTheme.treeview,
      itemIndent: 12,
      rowHeight : 20,
    },

    menu: {
      ...DefaultTheme.menu,
      MenuBG          : p.surface2,
      MenuBorder      : `1px solid ${p.lineStrong}`,
      MenuHighlight   : p.accent,
      MenuTextDisabled: p.fgFaint,
      MenuText        : font({size: 12, color: p.fg}),
      HotkeyText      : font({size: 11, color: p.fgFaint}),
      HotkeyTextColor : p.fgFaint,
    },
  }
}

/**
 * Derives the VOID·STUDIO theme from the shipped one.
 *
 * `base` is the inheritance root, so every style class that leaves a key unset picks these up —
 * that is the bulk of the editor. The classes that write their own surfaces are handled separately
 * by `surfaceOverrides`, because `base` cannot reach them.
 */
export function buildVoidStudioTheme(): ThemeRecord {
  const palette = VOID_STUDIO_PALETTE

  const base = {
    ...DefaultTheme.base,

    'background-color': palette.bg,
    DefaultPanelBG    : palette.surface,
    InnerPanelBG      : palette.surface2,
    BoxSubBG          : palette.surface3,
    BoxSub2BG         : palette.surface3,

    'border-color': palette.lineStrong,
    BoxBorder     : rgba(palette.lineStrong, 1),

    BoxHighlight: rgba(palette.accent, 1),
    BoxDepressed: palette.surface3,

    AreaHeaderBG: palette.surface2,

    DefaultText: font({size: 12, color: palette.fg}),
    LabelText  : font({size: 11, color: palette.fgDim}),
    TitleText  : font({size: 11, weight: '600', color: palette.fg}),

    /* Blender widgets are nearly square. */
    'border-radius': 3,
  }

  return {...DefaultTheme, base, ...surfaceOverrides()} as ThemeRecord
}

/** What `applyVoidStudioTheme` did, returned rather than logged so a caller can assert on it. */
export interface ThemeApplicationResult {
  readonly applied: boolean
  /** Why it did nothing, when it did nothing. */
  readonly reason?: string
}

let alreadyApplied = false

/**
 * Applies the theme. Safe to call more than once, and safe to call early.
 *
 * Idempotent because the editor can rebuild its UI on reload and on distribution switch, and a second
 * `setTheme` with an equal-but-not-identical record would invalidate every widget's cached style for
 * no reason. It never throws because a theme is presentation: an editor that refuses to start over a
 * colour is worse than an editor in upstream's palette.
 */
export function applyVoidStudioTheme(): ThemeApplicationResult {
  if (alreadyApplied) return {applied: false, reason: 'already applied'}

  try {
    setTheme(buildVoidStudioTheme())
    if (typeof document !== 'undefined') {
      if (document.body) {
        document.body.style.backgroundColor = VOID_STUDIO_PALETTE.bg
        document.body.style.color = VOID_STUDIO_PALETTE.fg
        document.body.style.fontFamily = VOID_STUDIO_PALETTE.fontSans
      }
      if (document.documentElement) {
        document.documentElement.style.backgroundColor = VOID_STUDIO_PALETTE.bg
        document.documentElement.style.color = VOID_STUDIO_PALETTE.fg
      }
    }
    alreadyApplied = true
    return {applied: true}
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('VOID·STUDIO theme: could not apply; staying on the default palette', err)
    return {applied: false, reason: (err as Error).message}
  }
}

/** Test seam: lets a suite exercise the first-application path more than once. */
export function __resetVoidStudioThemeForTests(): void {
  alreadyApplied = false
}
