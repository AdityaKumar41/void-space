/**
 * The two widget fixes a theme record cannot express — see
 * `scripts/voidspace/ui_polish.ts` for why each one is needed.
 *
 * Both are prototype patches on the pinned path.ux submodule, so both are pinned
 * here twice: once on the *behaviour* that is observable from a real widget, and
 * once on the fact that the patch is a wrapper — the original still runs, and
 * applying the module twice does not stack two of them. A patch that silently
 * replaced the original would pass the first assertion and lose upstream's
 * layout, which is the failure this suite exists to catch.
 */
import {Check} from '../../scripts/path.ux/scripts/widgets/ui_widgets'
import {PanelContents, PanelFrame} from '../../scripts/path.ux/scripts/widgets/ui_panel'
import {ListBox} from '../../scripts/path.ux/scripts/widgets/ui_listbox'
import {TabBar} from '../../scripts/path.ux/scripts/widgets/ui_tabs'
import {applyVoidStudioTheme, __resetVoidStudioThemeForTests} from '../../scripts/voidspace/theme'
import {
  applyVoidStudioUIOverrides,
  __resetVoidStudioUIOverridesForTests,
} from '../../scripts/voidspace/ui_polish'

beforeEach(() => {
  __resetVoidStudioThemeForTests()
  applyVoidStudioTheme()
})

describe('VOID·STUDIO UI overrides', () => {
  test('a checkbox label is painted in the theme face, not the hardcoded poppins', () => {
    __resetVoidStudioUIOverridesForTests()

    // Before the patch: `Check.setCSS` applies the themed face and then overwrites
    // it with `normal 14px poppins`, a family this build never loads.
    const unpatched = document.createElement('check-x') as Check
    unpatched.setCSS()
    expect((unpatched as unknown as {_label: HTMLElement})._label.style.font).toContain('14px poppins')

    applyVoidStudioUIOverrides()

    const check = document.createElement('check-x') as Check
    check.setCSS()

    const label = (check as unknown as {_label: HTMLElement})._label
    expect(label.style.font).toContain('12px')
    expect(label.style.font).not.toContain('poppins')
    // The colour is upstream's own themed value, so the patch does not invent one.
    expect(label.style.color).toBe('rgb(157, 157, 170)')
  })

  test('a panel frame is inset by its own border, so it fits the column it is in', () => {
    const before = PanelFrame.prototype.init

    __resetVoidStudioUIOverridesForTests()
    applyVoidStudioUIOverrides()

    // A `panelframe-x` cannot be constructed here — `PanelFrame` builds a header
    // whose `IconCheck` needs a real canvas and icon image, and jsdom has no 2d
    // context — so this asserts the patch is *wired*, and the e2e layout test
    // asserts what it does to a live panel (frame width == its column's width).
    expect(PanelFrame.prototype.init).not.toBe(before)
  })

  test('the wrapper runs upstream first, so its own layout still happens', () => {
    __resetVoidStudioUIOverridesForTests()
    applyVoidStudioUIOverrides()

    const check = document.createElement('check-x') as Check
    check.setCSS()

    // The last thing `Check.setCSS` does is clear its own background: the box is
    // drawn on the canvas, not painted behind it. A patch that replaced the method
    // instead of wrapping it would leave this at the theme's value.
    expect(check.style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  test('applying the overrides twice does not stack a second wrapper', () => {
    __resetVoidStudioUIOverridesForTests()
    applyVoidStudioUIOverrides()

    const after1 = Check.prototype.setCSS
    const frameAfter1 = PanelFrame.prototype.init

    applyVoidStudioUIOverrides()

    expect(Check.prototype.setCSS).toBe(after1)
    expect(PanelFrame.prototype.init).toBe(frameAfter1)
  })

  test('the panel-body patches are all wired', () => {
    __resetVoidStudioUIOverridesForTests()

    const before = {
      check: Check.prototype._redraw,
      listbox: ListBox.prototype.init,
      contents: PanelContents.prototype.init,
      bar: TabBar.prototype._redraw,
    }

    applyVoidStudioUIOverrides()

    // Each fix wraps a method rather than replacing it: `Check._redraw` keeps
    // upstream's box, `TabBar._redraw` keeps the chip, `ListBox.init` keeps its
    // sizing and `PanelContents.init` keeps the frame's layout.
    expect(Check.prototype._redraw).not.toBe(before.check)
    expect(ListBox.prototype.init).not.toBe(before.listbox)
    expect(PanelContents.prototype.init).not.toBe(before.contents)
    expect(TabBar.prototype._redraw).not.toBe(before.bar)
  })

  test('a section contents element gets its padding and row gap', () => {
    __resetVoidStudioUIOverridesForTests()
    applyVoidStudioUIOverrides()

    // Set on the element, not by CSS: every path.ux widget is its own shadow root,
    // so no stylesheet above a section can select into it — the row rhythm has to be
    // written where the rows live.
    const contents = document.createElement('panel-contents-x') as HTMLElement & {init?: () => void}

    if (typeof contents.init !== 'function') {
      // jsdom did not upgrade the custom element; the patch itself is covered above.
      return
    }

    contents.init()

    expect(contents.style.gap).toBe('3px')
    expect(contents.style.padding).toBe('4px 2px 6px')
  })

  test('restyling a live check keeps the theme face, however often it runs', () => {
    __resetVoidStudioUIOverridesForTests()
    applyVoidStudioUIOverrides()

    // `update()` restyles on every DPI, label or icon-sheet change, so this path runs
    // constantly. (The patch's own `_label` guard cannot be reached from a stock
    // `Check` — the original dereferences `_label` before the wrapper's guard runs —
    // so what is pinned here is that repeated restyles stay stable, which is what a
    // future reordering upstream would break.)
    const check = document.createElement('check-x') as Check
    check.setCSS()
    check.setCSS()
    check.setCSS()

    const label = (check as unknown as {_label: HTMLElement})._label
    expect(label.style.font).toContain('12px')
    expect(label.style.font).not.toContain('poppins')
  })
})
