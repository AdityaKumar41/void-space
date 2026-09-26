/**
 * The widget fixes a theme cannot express.
 *
 * `theme.ts` covers everything path.ux reads through `getDefault(...)`. Two things it cannot reach,
 * both of them literals written into an element rather than resolved from the theme:
 *
 *   - `Check` re-fonts its label with `normal 14px poppins` *after* the themed face is applied, and
 *     this build ships Plus Jakarta Sans and JetBrains Mono but not poppins. Every checkbox label in
 *     the editor — the Draw panel's "Force Xray" and "Wireframe", the addon list — was therefore
 *     painted in whatever the browser falls back to for an unknown family, at 14px where every other
 *     label is 12. That is the "one of these is not like the others" defect in a properties panel:
 *     it is not a size anyone chose.
 *
 *   - `PanelFrame.init` sets `width: 100%` on itself, and the frame is content-box with a border from
 *     the theme — so a panel is always `2 x border-width` wider than the column it sits in. At
 *     `border-width: 1` that is 2px of overflow, which is enough for the properties body
 *     (`overflow: scroll`) to grow a horizontal scrollbar and pan sideways: a panel that is off by
 *     two pixels is the kind of thing that reads as "not finished" without anyone being able to say
 *     why.
 *
 * Both are prototype patches rather than forks, because `scripts/path.ux/` is a **pinned submodule**:
 * editing it in place would break the pin and be lost by the next `git submodule update`. Each patch
 * wraps the original and re-applies the value the theme already asked for, so there is one source of
 * truth for both.
 *
 * Applied once, from `mountVoidStudio`, before the first widget is built.
 */
import {Check} from '../path.ux/scripts/widgets/ui_widgets.js'
import {PanelContents, PanelFrame} from '../path.ux/scripts/widgets/ui_panel.js'
import {ListBox} from '../path.ux/scripts/widgets/ui_listbox.js'
import {TabBar, type TabItem} from '../path.ux/scripts/widgets/ui_tabs.js'
import {drawRoundBox} from '../path.ux/scripts/core/base/ui_draw.js'
import {iconmanager} from '../path.ux/scripts/core/ui_base.js'
import type {UIBase} from '../path.ux/scripts/core/ui_base.js'
import type {CSSFont} from '../path.ux/scripts/core/cssfont.js'
import {VOID_STUDIO_PALETTE} from './theme.js'

let applied = false

/**
 * Re-applies the themed label face after `Check.setCSS` overwrites it.
 *
 * Wrapping the original rather than replacing it keeps upstream's layout, canvas sizing and the
 * transparent element background exactly as they are; the only thing this adds is the font the
 * theme already asked for. Guarded because a `Check` that has not built its label yet is a legal
 * state — `_label` is assigned in the constructor, but a subclass or a future upstream change could
 * reorder that, and a checkbox is not worth an exception.
 */
function patchCheckLabelFont(): void {
  const proto = Check.prototype as unknown as {
    setCSS: () => void
    _label?: HTMLElement
    getDefault?: (key: string) => unknown
  }

  const original = proto.setCSS

  proto.setCSS = function (this: unknown) {
    original.call(this)

    const self = this as {_label?: HTMLElement; getDefault: (key: string) => unknown}
    const label = self._label
    const font = self.getDefault('DefaultText') as CSSFont | undefined

    if (!label || typeof font?.genCSS !== 'function') {
      return
    }

    label.style.font = font.genCSS()
    label.style.color = font.color
  }
}

/**
 * Redraws a checked box's tick in the theme's foreground.
 *
 * `Check._redraw` fills the box from the theme (`drawRoundBox` reads the widget's
 * `background-color`, which this theme sets to the chip grey) and then stamps
 * `Icons.LARGE_CHECK` on top from the icon sheet. That tile is a **white square with
 * a black tick** — the light theme's checkbox — so a checked box in this palette
 * came out as a white chip with a black mark, i.e. the inverse of every other
 * surface in the panel, and the one widget in the editor that still looked
 * unstyled. Measured: canvas centre `255,255,255` against a `#34343d` box.
 *
 * Painting the tick instead of stamping the tile keeps the box, its radius and its
 * DPI sizing exactly as upstream computed them, and takes the two colours from the
 * theme rather than hardcoding them here.
 */
function patchCheckTick(): void {
  const proto = Check.prototype as unknown as {
    _redraw?: () => void
    _checked?: boolean
    canvas?: HTMLCanvasElement
    g?: CanvasRenderingContext2D
    getDPI?: () => number
  }

  const original = proto._redraw

  if (original === undefined) {
    return
  }

  proto._redraw = function (this: unknown) {
    original.call(this)

    const self = this as {
      _checked?: boolean
      canvas?: HTMLCanvasElement
      g?: CanvasRenderingContext2D
      getDPI?: () => number
    }

    if (!self._checked || !self.canvas || !self.g) {
      return
    }

    const canvas = self.canvas
    const g = self.g
    const dpi = self.getDPI?.() ?? 1

    g.clearRect(0, 0, canvas.width, canvas.height)
    drawRoundBox(self as unknown as UIBase, canvas, g)

    const w = canvas.width
    const h = canvas.height

    g.lineWidth = Math.max(1.5, 2 * dpi)
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.strokeStyle = VOID_STUDIO_PALETTE.fg

    // A hand-drawn tick rather than a font glyph: the stroke has to scale with the
    // box, and a glyph's baseline makes that fragile at other DPIs.
    g.beginPath()
    g.moveTo(w * 0.24, h * 0.52)
    g.lineTo(w * 0.43, h * 0.72)
    g.lineTo(w * 0.78, h * 0.3)
    g.stroke()
  }
}

/**
 * Draws the active tab's icon, which upstream's tab bar never draws.
 *
 * `TabBar._redraw` walks the tabs with `if (tab === this.tabs.active) continue;` and
 * then draws the active one separately — a filled chip, its name, its close button,
 * and **no icon**. That is invisible in a horizontal tab strip, where the name is
 * right there, but this editor's properties rail is an icon-only column: activating
 * a tab erased the only thing that identified it, which reads as "clicking an icon
 * makes it disappear".
 *
 * The transform is the one the inactive branch uses for a vertical bar; the active
 * chip has already been filled by the time this runs, so the icon lands on top of it.
 */
function patchTabBarActiveIcon(): void {
  const proto = TabBar.prototype as unknown as {
    _redraw?: () => void
    horiz?: boolean
    iconsheet?: number
    tabs: (TabItem[] & {active?: TabItem}) | undefined
    canvas?: HTMLCanvasElement
    g?: CanvasRenderingContext2D
    getDefault?: (key: string, ...rest: unknown[]) => unknown
    _getFont?: () => CSSFont
  }

  const original = proto._redraw

  if (original === undefined) {
    return
  }

  proto._redraw = function (this: unknown) {
    original.call(this)

    const self = this as {
      horiz?: boolean
      iconsheet: number
      tabs?: TabItem[] & {active?: TabItem}
      canvas?: HTMLCanvasElement
      g?: CanvasRenderingContext2D
      getDefault?: (key: string, ...rest: unknown[]) => unknown
      _getFont?: () => CSSFont
      getDPI?: () => number
    }

    const tab = self.tabs?.active
    const canvas = self.canvas
    const g = self.g

    // Only the vertical bar needs this: a horizontal tab shows its name anyway.
    if (!tab || tab.icon === undefined || canvas === undefined || g === undefined || self.horiz) {
      return
    }

    const font = self._getFont?.()
    const dpi = self.getDPI?.() ?? 1
    const tsize = (font?.size ?? 12) * dpi

    const x = tab.pos[0]
    const y = tab.pos[1]
    const y3 = y + tsize
    const paddingRight = (tab.getDefault?.('iconPaddingRight', undefined, 2) ?? 2) as number

    g.save()
    g.translate(x, 0)
    g.translate(0, y3)
    g.rotate(Math.PI / 2)
    g.translate(-tsize, -y3 - tsize * 0.5)

    iconmanager.canvasDraw(self as unknown as UIBase, canvas, g, tab.icon, paddingRight, y, self.iconsheet)

    g.restore()

    /*
     * An accent bar down the leading edge. A 26px-wide rail has room for exactly one
     * clear marker, and "which section am I in" should not depend on telling two
     * near-identical greys apart.
     */
    g.save()
    g.translate(x, 0)
    g.fillStyle = VOID_STUDIO_PALETTE.accent
    g.fillRect(0, y + 3, 3, Math.max(4, tab.size[1] - 6))
    g.restore()
  }
}

/**
 * Gives a `ListBox` a visible surface and hairline border.
 *
 * The record carries both, but the box is sized in `init()` and its fill resolved
 * later, so an empty list came out as *nothing* — no fill, no border — with only its
 * scroll arrows painted, which is what made an empty material list look like a stray
 * arrow floating on the panel body. Setting the two from the theme on the element
 * makes the box read as a box at any size.
 */
function patchListBoxSurface(): void {
  const proto = ListBox.prototype as unknown as {
    init?: () => void
    getDefault?: (key: string) => unknown
    style?: CSSStyleDeclaration
  }

  const original = proto.init

  if (original === undefined) {
    return
  }

  proto.init = function (this: unknown) {
    original.call(this)

    const self = this as {getDefault?: (key: string) => unknown; style?: CSSStyleDeclaration}
    const bg = self.getDefault?.('background-color')
    const border = self.getDefault?.('border-color')

    if (!self.style) {
      return
    }

    if (typeof bg === 'string') {
      self.style.background = bg
    }
    if (typeof border === 'string') {
      self.style.border = `1px solid ${border}`
    }
    self.style.borderRadius = '3px'
  }
}

/**
 * Gives a section's contents room to breathe.
 *
 * The panels' contents element is where a group of properties lives, and it is laid
 * out with no padding and no gap, so every row sat flush against the frame and
 * against its neighbours — a group of properties read as one grey block rather than
 * a list of rows. A stylesheet cannot reach it (each path.ux widget is its own shadow
 * root, so nothing above it can select into it), which leaves setting the two
 * lengths on the element itself.
 */
function patchPanelContentsSpacing(): void {
  const proto = PanelContents.prototype as unknown as {
    init?: () => void
    style?: CSSStyleDeclaration
  }

  const original = proto.init

  if (original === undefined) {
    return
  }

  proto.init = function (this: unknown) {
    original.call(this)

    const self = this as {style?: CSSStyleDeclaration}

    if (!self.style) {
      return
    }

    // `gap` needs a flex column; path.ux's column frames are one, and the property is
    // inert if a future panel is not.
    self.style.gap = '3px'
    self.style.padding = '4px 2px 6px'
  }
}

/**
 * Keeps a panel frame inside the column it was given.
 *
 * The subtraction is derived from the theme's own `border-width` rather than written as `2px`, so the
 * frame stays exactly as wide as its parent whatever border the theme asks for. A frame with no
 * border is left alone: `100%` already fits, and rewriting the width for it would only be a second
 * way of saying the same thing.
 */
function patchPanelFrameWidth(): void {
  const proto = PanelFrame.prototype as unknown as {
    init: () => void
    getDefault?: (key: string) => unknown
  }

  const original = proto.init

  proto.init = function (this: unknown) {
    original.call(this)

    const self = this as {getDefault?: (key: string) => unknown; style?: CSSStyleDeclaration}
    const borderWidth = Number(self.getDefault?.('border-width') ?? 0)

    if (!self.style || !Number.isFinite(borderWidth) || borderWidth <= 0) {
      return
    }

    self.style.width = `calc(100% - ${borderWidth * 2}px)`
  }
}

/**
 * Applies every fix, once. Safe to call more than once and safe to skip: it never throws, because an
 * editor that refuses to start over a label's font is worse than one with the wrong font.
 */
export function applyVoidStudioUIOverrides(): void {
  if (applied) {
    return
  }

  applied = true

  for (const [what, patch] of [
    ['checkbox label font', patchCheckLabelFont],
    ['checkbox tick', patchCheckTick],
    ['active tab icon', patchTabBarActiveIcon],
    ['section spacing', patchPanelContentsSpacing],
    ['list box surface', patchListBoxSurface],
    ['panel frame width', patchPanelFrameWidth],
  ] as const) {
    try {
      patch()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`VOID·STUDIO UI overrides: could not patch the ${what}`, err)
    }
  }
}

/** Test seam: lets a suite exercise the first-application path more than once. */
export function __resetVoidStudioUIOverridesForTests(): void {
  applied = false
}
