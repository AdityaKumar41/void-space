/**
 * VOID·STUDIO's theme for the in-canvas editor UI.
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
 * The palette mirrors `apps/web/src/app/globals.css`. It cannot be imported from there — this runs
 * inside the editor bundle, which shares no build step with the marketplace — so the two are kept in
 * step by hand. If a token moves in one, move it in both.
 */
import {CSSFont} from '../path.ux/scripts/core/cssfont'
import {DefaultTheme} from '../path.ux/scripts/core/theme'
import {setTheme} from '../path.ux/scripts/core/base/ui_theme_key'
import {ThemeScrollBars} from '../path.ux/scripts/core/ui_theme'
import type {ThemeRecord} from '../path.ux/scripts/core/ui_theme'

/**
 * The design tokens, named after their marketplace counterparts.
 *
 * `accent` is `--fc-heat`, which is what the marketplace's `brand` Tailwind token resolves to. The
 * ground and text ramp are the `--vs-*` "Ethereal Glass" values.
 */
export const VOID_STUDIO_PALETTE = {
  bg        : '#08080a',
  surface   : '#101013',
  surface2  : '#16161a',
  surface3  : '#1d1d22',
  line      : '#232329',
  lineStrong: '#34343d',

  fg     : '#f3f3f5',
  fgDim  : '#9d9daa',
  fgFaint: '#6c6c7a',

  accent    : '#fa5d19',
  accentWarm: '#ff7a3d',
  signal    : '#3ddc97',

  fontSans: 'Plus Jakarta Sans, Segoe UI, system-ui, sans-serif',
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
  const fieldText = font({size: 14, color: p.fg})

  return {
    /* Panels carry the most area, so they set the perceived theme. The shipped
     * class paints `rgba(184,184,184,.76)` with a `rgba(177,219,255,1)` title
     * bar and a black title face.
     *
     * `TitleBorder` is the key worth naming: the title row strokes *its own*
     * border from that key (`ui_panel.makeHeader`) rather than from
     * `border-color`, and upstream's value is `rgba(104,104,104,1)` — a light
     * grey outline drawn around every section header, which is what made
     * "Transform" and "Draw" read as unstyled form boxes. `border-width` is
     * upstream's `1.141`; a fraction lands on a half device pixel and renders
     * soft, so it becomes 1.
     */
    panel: {
      ...DefaultTheme.panel,
      'background-color': p.surface,
      'border-color'    : p.line,
      'border-style'    : 'solid',
      'border-width'    : 1,
      /* Upstream insets a panel 5.6px from the left and 0 from the right, an
       * asymmetry meant for a panel floating inside a wide column. The
       * properties body gives its panels the full width, so the insets go to 0
       * and the frame lines up with the labels and sliders inside it. */
      'margin-left'     : 0,
      'margin-right'    : 0,
      /* Sections sit flush by default, so the title bar of the next one reads as
       * part of the previous panel's contents. A little air between them is what
       * makes a group of properties read as a group. */
      'margin-bottom'   : 6,
      TitleBackground   : p.surface2,
      TitleBorder       : p.line,
      TitleText         : font({size: 12, weight: '600', color: p.fg}),
    },

    /*
     * Checkboxes. The box is drawn on a canvas: a rounded fill from
     * `background-color`, then the tick icon when checked. Upstream's fill is
     * `rgb(168,168,168)`, a light grey, and the *unchecked* box is the fill
     * alone — there is no stroke until the widget takes focus — so the fill is
     * the only affordance the control has and it has to read against the panel
     * behind it. `lineStrong` is the chip grey: visible as a slot, quiet enough
     * not to shout.
     *
     * `DefaultText` is the label beside the box. Upstream's class inherits the
     * button's 13px/600 face; a checkbox's label is a property name, so it takes
     * the same 12px dim face as every other label.
     */
    checkbox: {
      ...DefaultTheme.checkbox,
      'background-color': p.lineStrong,
      'border-color'    : p.lineStrong,
      DefaultText       : font({size: 12, color: p.fgDim}),
    },

    /*
     * Drop-downs. `dropTextBG` is the fill of the box carrying the current
     * value, and the shipped `rgba(233,233,233,1)` is near-white while the
     * widget's text stays `#f3f3f5` — so "Textured" and "xyz" were painted
     * white on white and could not be read at all. The widget's own
     * `background-color` resolves up to the ground (`#08080a`), which leaves the
     * value box to carry the field; it takes the input surface instead so a
     * drop-down matches the text fields beside it.
     */
    dropbox: {
      ...DefaultTheme.dropbox,
      'background-color': p.surface2,
      dropTextBG        : p.surface3,
      DefaultText       : font({size: 13, weight: '600', color: p.fg}),
    },

    /* Inputs. The shipped fills are near-white, the single most jarring thing
     * on a dark ground. */
    textbox : {...DefaultTheme.textbox, 'background-color': fieldBG, DefaultText: fieldText},
    richtext: {...DefaultTheme.richtext, 'background-color': fieldBG, DefaultText: fieldText},
    tooltip : {...DefaultTheme.tooltip, 'background-color': p.surface3, ToolTipText: fieldText},

    assetgallery: {...DefaultTheme.assetgallery, 'background-color': p.surface},
    assetthumb  : {...DefaultTheme.assetthumb, 'background-color': p.surface2},

    /* Sliders pin a top-level fill *and* per-state sub-objects (`highlight`,
     * `pressed`), each with its own light fill and black label. The accent is
     * the drag highlight, which is where it reads best. */
    numslider: {
      ...DefaultTheme.numslider,
      'background-color': p.surface3,
      'border-color'    : p.line,
      highlight         : {...DefaultTheme.numslider.highlight, 'background-color': p.accent, DefaultText: fieldText},
      pressed           : {...DefaultTheme.numslider.pressed, 'background-color': p.surface2, DefaultText: fieldText},
    },
    numslider_simple : {...DefaultTheme.numslider_simple, 'background-color': p.surface3},
    numslider_textbox: {...DefaultTheme.numslider_textbox, 'background-color': p.surface3},

    /*
     * Buttons. The shipped chip is `rgba(238,238,238,0.87)` with a near-black
     * `DefaultText`, so every tool button ("Triangulate", "Screen", …) painted
     * as a light chip on the dark ground.
     */
    button: {
      ...DefaultTheme.button,
      'background-color': p.surface3,
      /* The shipped chip's `border` is a 2px white `BoxBorder`, which resolves
       * to a pale outline around every tool button. */
      'border-color'    : p.lineStrong,
      'border-width'    : 1,
      DefaultText       : font({size: 13, weight: '600', color: p.fg}),

      /*
       * `button.disabled` is the record path.ux resolves for a disabled widget
       * (the check box on the Material tab's derived `has_shader`, among others),
       * and the shipped one pairs a near-black fill with a `#f58f8f` border and
       * bold poppins text — so a read-only control shouted with a pink outline,
       * louder than anything else in the panel. Disabled means quiet: no border,
       * the panel's surface, dimmed text.
       */
      disabled: {
        ...DefaultTheme.button.disabled,
        DefaultText       : font({size: 12, color: p.fgFaint}),
        'background-color': p.surface,
        'border-color'    : 'transparent',
        'border-width'    : 0,
      },
    },

    /*
     * Labels. `base.LabelText` is themed, but the `label` class re-declares
     * `LabelText: vars.labelFont` — the *shipped* label font, which is dark — so
     * it shadowed the override and left plain labels unreadable on the dark
     * ground. Re-pinning it here is what makes property labels legible.
     *
     * Size 12, not the shipped class's 14: path.ux lays a property row out as a
     * `widget-with-label-x` whose height comes from the widget, and the label is
     * a shrinking flex item inside it. At 14px the label's line box is taller
     * than the space it is given, so every descender ("Spacing", "Rotation Y")
     * was overlapped by the row below. The panel titles — 12px in the same
     * layout — are the control that shows 12px fits.
     *
     * `DefaultText` is the disabled face: `Label.on_disabled` re-points the font
     * at that key, and the shipped class inherits a near-black `bodyFont` for
     * it. A disabled property must *read* as disabled, not vanish.
     */
    label: {
      ...DefaultTheme.label,
      LabelText  : font({size: 12, color: p.fgDim}),
      DefaultText: font({size: 12, color: p.fgFaint}),
    },

    /*
     * `widget-with-label-x` — the wrapper that carries a property's name. Its
     * own `font` key is what its inner label inherits, so leaving it at
     * `bodyFont` put a 14px near-black label on the dark panel.
     */
    propLabels: {...DefaultTheme.propLabels, font: font({size: 12, color: p.fgDim})},

    /*
     * The properties editor's tab body, which most of the right-hand panel sits
     * on. Shipped as `rgba(222,222,222)` with `rgba(183,183,183)` inactive chips
     * and a black tab face. The `strip` class inside it is translucent
     * (`rgba(75,75,75,0.33)`), so darkening the parent is what makes those rows
     * read as dark chips rather than light ones.
     */
    tabs: {
      ...DefaultTheme.tabs,
      'background-color': p.surface,
      /*
       * Which tab is active has to be legible at a glance in an icon-only rail.
       * `TabActive` was `surface3` — two steps off the rail's own `surface2`, which
       * on a 26px-wide chip is very nearly the same colour, so the active section
       * was invisible; the accent stroke is the second half of the marker (the
       * leading edge bar is drawn in `ui_polish`). `TabHighlight` is the hover tone
       * and has to sit between the two.
       */
      TabActive         : p.lineStrong,
      TabInactive       : p.surface2,
      TabHighlight      : p.surface3,
      TabStrokeStyle2   : p.accent,
      TabText           : font({size: 13, weight: '600', color: p.fg}),
    },

    strip: {...DefaultTheme.strip, 'background-color': 'rgba(255, 255, 255, 0.045)', 'border-color': p.line},

    /*
     * The dividers between screen areas. `screenborder` is not a widget's class:
     * `FrameManager` draws one strip per area edge, taking its *background* from
     * `border-inner` and its outline from `border-outer`, and the shipped
     * `border-inner` is literally `grey`. Every seam between the viewport and the
     * panes — and around the whole window — was therefore a pale line, the
     * brightest structure on the screen. On a dark ground a divider should be a
     * hairline just off the ground, which is what `line` is.
     */
    screenborder: {
      ...DefaultTheme.screenborder,
      'border-inner': p.line,
      'border-outer': p.line,
    },

    /*
     * Scrollbars. These are not drawn by a widget — `FrameManager.updateScrollStyling`
     * emits one global `::-webkit-scrollbar` rule from this record — so a theme
     * that ignores it gets the browser's default light bar. On the properties
     * body, which is `overflow: scroll` (it reserves both axes), that produced a
     * pale grey band across the bottom of the panel and a light stripe down the
     * side of every long tab. The shipped record leaves every field `undefined`;
     * the defaults behind them are `grey` for the track and a 15px bar.
     *
     * `color` is the track, `color2` the thumb, and the pair is emitted as
     * `scrollbar-color: <thumb> <track>` — so the thumb takes the chip grey and
     * the track takes the ground, leaving the bar visible without being the
     * brightest thing in the column. `width` 10 keeps it under Chrome's default
     * but still grabbable; a grooved border is what made the default look like an
     * unstyled OS widget, so there is none.
     */
    scrollbars: new ThemeScrollBars({
      color : p.bg,
      color2: p.lineStrong,
      width : 10,
      border: 'none',
    }),

    /*
     * A `ListBox` — used once in the editor, for the material slots in the Material
     * tab (`MaterialChooser.rebuild`). The shipped record is a light-theme widget
     * through and through:
     *
     *   - `ListActive` is `rgba(200,205,215)` and the item's text is the same
     *     near-white, so a material name was painted white on light grey — the row
     *     that read as "an empty box with nothing in it".
     *   - `width: 110` is the list's whole width in a 374px column, so the list sat
     *     in a third of the panel with the rest empty, and `height: 200` made an
     *     empty list a 200px void rather than a small empty box.
     *
     * The list is the only one in this build, so the sizes are set here rather than
     * per-caller: five rows of `ItemHeight`, and a width that fills the panel column.
     */
    listbox: {
      ...DefaultTheme.listbox,
      'background-color' : p.surface2,
      'border-color'     : p.line,
      ListActive         : p.surface3,
      ListActiveHighlight: p.lineStrong,
      ListHighlight      : p.line,
      width              : 330,
      height             : 120,
    },

    sidebar: {...DefaultTheme.sidebar, 'background-color': p.surface2},

    /*
     * Popup menus — the menu bar's drop-downs and the `Shift-A` Add menu. The
     * shipped `MenuBG` is `rgba(250,250,250)` with a dark `MenuText`, i.e. a
     * white popup over a dark editor.
     */
    menu: {
      ...DefaultTheme.menu,
      MenuBG          : p.surface2,
      MenuBorder      : `1px solid ${p.lineStrong}`,
      MenuHighlight   : p.accent,
      MenuTextDisabled: p.fgFaint,
      MenuText        : font({size: 13, color: p.fg}),
      HotkeyText      : font({size: 12, color: p.fgFaint}),
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

    /* Ground and elevation. Panels step up in lightness so a nested panel reads as nested. */
    'background-color': palette.bg,
    DefaultPanelBG    : palette.surface,
    InnerPanelBG      : palette.surface2,
    BoxSubBG          : palette.surface3,
    BoxSub2BG         : palette.surface3,

    /* Borders are the only structure on a dark ground, so they stay legible rather than subtle. */
    'border-color': palette.lineStrong,
    BoxBorder     : rgba(palette.lineStrong, 1),

    /* The accent. `BoxHighlight` is what path.ux uses for a selected or focused box. */
    BoxHighlight: rgba(palette.accent, 1),
    BoxDepressed: palette.surface3,

    /* Headers get the second surface so areas separate without needing a shadow. */
    AreaHeaderBG: palette.surface2,

    /* Text. The inherited values are near-black, which is the readability problem this solves. */
    DefaultText: font({size: 14, color: palette.fg}),
    /* 12, matching `TitleText`: a 14px label overruns the row height path.ux
     * allots it and is overlapped by the widget below. See `surfaceOverrides`. */
    LabelText  : font({size: 12, color: palette.fgDim}),
    TitleText  : font({size: 12, weight: '600', color: palette.fg}),

    /* Sharper than the inherited ~12px pill, matching the marketplace's radius scale. */
    'border-radius': 8,
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
