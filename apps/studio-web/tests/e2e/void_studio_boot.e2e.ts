import {expect, test} from '@playwright/test'

/**
 * Boot + theme verification for VOID·STUDIO.
 *
 * This suite requires `sculptcore/typescript/build/sculptcore-browser.{wasm,js}`,
 * produced by `cd sculptcore && node make.mjs build wasm` (see VENDOR.md). Until
 * that artifact exists the page cannot boot, so these assertions would be
 * vacuous.
 *
 * Two things are pinned down:
 *
 *   1. The app reaches a live screen with no uncaught errors — which is what
 *      proves the WASM module instantiated and the WebGPU renderer started,
 *      since either failing surfaces as a page error.
 *   2. The VOID·STUDIO theme reached the *computed* styles of the real surfaces.
 *
 * Point 2 deliberately measures `getComputedStyle` rather than grepping the
 * generated CSS. An earlier version of this test searched shadow-root `<style>`
 * text for the palette and passed while the editor was still painting upstream's
 * light grey panels: path.ux matched the `panel` class ahead of `base`, so the
 * values were present in the stylesheet but never applied to a widget. Only the
 * computed value distinguishes "the theme was registered" from "the theme is
 * visible", and the grey is the failure this suite exists to catch.
 */

/** `surface` / `surface3` from `scripts/voidspace/theme.ts`, as `getComputedStyle` reports them. */
const VOID_SURFACE = 'rgb(16, 16, 19)' // #101013
const VOID_FIELD = 'rgb(29, 29, 34)' // #1d1d22

test('app boots, loads sculptcore WASM, and applies the VOID·STUDIO theme', async ({page}) => {
  const pageErrors: string[] = []

  page.on('pageerror', (err) => pageErrors.push(String(err)))

  await page.goto('/?renderer=webgpu')

  // The screen is the boot barrier: it exists only once the process boot (which
  // loads sculptcore) has resolved.
  await page.waitForFunction(() => !!(window as any)._appstate?.screen, undefined, {timeout: 90_000})

  await page.setViewportSize({width: 1280, height: 800})
  // Let the first layout pass settle so panels have been styled.
  await page.waitForTimeout(1000)

  // --- 1. boot integrity ---------------------------------------------------
  const boot = await page.evaluate(() => {
    const w = window as any
    return {
      hasScreen: !!w._appstate?.screen,
      hasCtx   : !!w.CTX,
      // Cross-origin isolation is a prerequisite for the WASM pthread pool;
      // without it sculptcore cannot allocate SharedArrayBuffer.
      crossOriginIsolated: window.crossOriginIsolated,
      canvasCount: document.querySelectorAll('canvas').length,
    }
  })

  expect(boot.hasScreen).toBe(true)
  expect(boot.hasCtx).toBe(true)
  expect(boot.crossOriginIsolated, 'COOP/COEP must be set for SharedArrayBuffer').toBe(true)
  expect(boot.canvasCount, 'the WebGPU renderer must own a canvas').toBeGreaterThan(0)

  // --- 2. the theme is actually visible ------------------------------------
  const measured = await page.evaluate(
    ({surface, field}) => {
      const found: {tag: string; bg: string}[] = []
      const seen = new Set<string>()

      const visit = (root: Document | ShadowRoot | Element) => {
        const all = (root as ParentNode).querySelectorAll?.('*') ?? []
        for (const el of all) {
          const tag = el.tagName?.toLowerCase() ?? ''
          if (/^(dock-panel|panelframe|panel-contents|textbox)-x$/.test(tag)) {
            const bg = getComputedStyle(el as Element).backgroundColor
            if (!seen.has(`${tag}|${bg}`)) {
              seen.add(`${tag}|${bg}`)
              found.push({tag, bg})
            }
          }
          if ((el as Element).shadowRoot) visit((el as Element).shadowRoot as ShadowRoot)
        }
      }
      visit(document)

      const panels = found.filter((f) => /panel|frame/.test(f.tag))
      return {
        found,
        // Every panel surface must be the VOID ground; upstream's is
        // rgba(184,184,184,0.76).
        panelsAreDark  : panels.length > 0 && panels.every((f) => f.bg === surface),
        fieldIsDark    : found.filter((f) => f.tag.startsWith('textbox')).every((f) => f.bg === field),
        // Nothing may keep upstream's light grey.
        anyUpstreamGrey: found.some((f) => f.bg.includes('184, 184, 184')),
      }
    },
    {surface: VOID_SURFACE, field: VOID_FIELD}
  )

  expect(measured.found.length, 'no themed editor surfaces were found in the DOM').toBeGreaterThan(0)

  expect(
    measured.panelsAreDark,
    `panel surfaces are not the VOID ground ${VOID_SURFACE} — measured ${JSON.stringify(measured.found)}`
  ).toBe(true)

  expect(
    measured.anyUpstreamGrey,
    `upstream's light grey survived: ${JSON.stringify(measured.found.filter((f) => f.bg.includes('184, 184, 184')))}`
  ).toBe(false)

  expect(measured.fieldIsDark, `input fills are not ${VOID_FIELD}`).toBe(true)

  // --- 3. evidence artifact ------------------------------------------------
  await page.screenshot({path: 'test-results/void-studio-boot.png'})

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
