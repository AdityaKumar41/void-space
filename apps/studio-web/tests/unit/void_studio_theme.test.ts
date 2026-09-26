/**
 * The properties panel's surfaces.
 *
 * Every case here is a widget that path.ux paints from a literal or from a
 * *class* rather than from `base`, so a theme that only recolours `base` leaves it
 * in upstream's light palette — which is exactly what the panel looked like
 * before: white-on-white drop-down values, an empty dark checkbox, a pale grey
 * outline around every section header, and light scrollbars on a dark column.
 *
 * The keys are asserted by name because that is the failure mode: adding a new
 * `surfaceOverrides` entry is easy, remembering that `panel.TitleBorder` is the
 * one the section headers actually stroke their outline from is not.
 */
import {DefaultTheme} from '../../scripts/path.ux/scripts/core/theme'
import {ThemeScrollBars} from '../../scripts/path.ux/scripts/core/ui_theme'
import {buildVoidStudioTheme, VOID_STUDIO_PALETTE} from '../../scripts/voidspace/theme'

const p = VOID_STUDIO_PALETTE

function theme() {
  return buildVoidStudioTheme() as unknown as Record<string, Record<string, unknown>>
}

describe('VOID·STUDIO theme — properties panel surfaces', () => {
  test('the shipped theme stays dark text on light grey, so overrides are required', () => {
    // Sanity check on the premise: if upstream ever ships a dark theme, the
    // overrides below stop being the thing that makes the panel readable.
    expect(DefaultTheme.panel.TitleBorder).toBe('rgba(104,104,104, 1)')
    expect(DefaultTheme.dropbox.dropTextBG).toBe('rgba(233,233,233, 1)')
    expect(DefaultTheme.screenborder['border-inner']).toBe('grey')
  })

  test('section headers stroke their outline in the panel line colour, not light grey', () => {
    const panel = theme().panel

    // `ui_panel.makeHeader` writes this onto the title row's own border, so
    // `border-color` alone does not reach it.
    expect(panel.TitleBorder).toBe(p.line)
    expect(panel['border-color']).toBe(p.line)
    expect(panel['border-width']).toBe(1)
    expect(panel.TitleBackground).toBe(p.surface2)
  })

  test('drop-down values are painted on an input surface, not near-white', () => {
    const dropbox = theme().dropbox

    expect(dropbox.dropTextBG).toBe(p.surface3)
    // The value text is `#f3f3f5`; on upstream's fill that was white on white.
    expect(dropbox['background-color']).toBe(p.surface2)
  })

  test('an unchecked checkbox is a visible slot with a 12px label', () => {
    const checkbox = theme().checkbox
    const font = checkbox.DefaultText as {size: number; color: string}

    // The box is the *fill* alone until it takes focus, so the fill is the whole
    // affordance: upstream's `rgb(168,168,168)` is a light grey.
    expect(checkbox['background-color']).toBe(p.lineStrong)
    expect(font.size).toBe(12)
    expect(font.color).toBe(p.fgDim)
  })

  test('area dividers are a hairline rather than a pale line', () => {
    const screenborder = theme().screenborder

    expect(screenborder['border-inner']).toBe(p.line)
    expect(screenborder['border-outer']).toBe(p.line)
  })

  test('scrollbars are drawn from the palette', () => {
    const record = theme()
    // `scrollbars` is on the shipped theme record but not in path.ux's published
    // `Theme` interface, hence the intermediate `unknown` — and
    // `FrameManager.updateScrollStyling` bails unless the value really is a
    // `ThemeScrollBars`, so the class assertion below is load-bearing rather than
    // decorative.
    const scrollbars = record.scrollbars as unknown as ThemeScrollBars

    // Not a widget: `FrameManager` emits one global `::-webkit-scrollbar` rule
    // from this record, and the shipped record leaves every field undefined —
    // which is a 15px grey bar on a dark column.
    expect(scrollbars).toBeInstanceOf(ThemeScrollBars)
    expect(scrollbars.color).toBe(p.bg)
    expect(scrollbars.color2).toBe(p.lineStrong)
    expect(scrollbars.width).toBe(10)
  })

  test('buttons and sliders sit on the chip surface with a readable face', () => {
    const record = theme()

    expect(record.button['background-color']).toBe(p.surface3)
    expect(record.button['border-color']).toBe(p.lineStrong)
    expect((record.button.DefaultText as {size: number}).size).toBe(13)
    expect(record.numslider['background-color']).toBe(p.surface3)
  })
})
