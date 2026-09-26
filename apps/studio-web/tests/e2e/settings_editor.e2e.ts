import {expect, test} from '@playwright/test'

/**
 * Settings UI coverage: the Theme Editor, and the PropsEditor's Settings tab.
 *
 * This file replaces an earlier `settings_editor.e2e.ts` that asserted a tabbed
 * `SettingsEditor` (`ed.tabs` with "Feature Flags" and "Addons" tabs). That
 * structure no longer exists: the General, Addons and Feature Flags panels moved
 * into the PropsEditor's Settings tab, and the `SettingsEditor` — retitled "Theme
 * Editor" — now builds a single theme panel with no tabs at all
 * (`_buildSettingsPanels` in `PropsEditor.ts`, which reuses the `SettingsEditor`
 * static builders). The old spec could not pass against the current app, and had
 * never run anyway because the sculptcore WASM artifact did not exist.
 *
 * Both destinations are covered here so the migration stays pinned: panels are
 * asserted through the `datapath` bindings they create, which is what actually
 * carries the setting to its storage path.
 */

test('Theme Editor builds its theme panel', async ({page}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))

  await page.goto('/?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any)._appstate?.screen, undefined, {timeout: 90_000})
  await page.setViewportSize({width: 1280, height: 800})

  const opened = await page.evaluate(() => {
    const w = window as any
    const result = w.CTX.debug.showEditor({editorType: 'settings-editor', minVisibleWidth: 500})
    w.__settingsEd = result.editor
    return {tag: result.editor?.tagName?.toLowerCase()}
  })

  expect(opened.tag).toBe('settings-editor-x')

  // init() is deferred to the screen's update tick; the theme panel adds a
  // `theme-editor-x` element, so wait on that rather than on `.tabs` (which
  // this editor no longer has).
  await page.waitForFunction(
    () => {
      const ed = (window as any).__settingsEd
      if (!ed?.shadowRoot) return false
      const walk = (root: Element | ShadowRoot): boolean => {
        for (const el of (root as ParentNode).querySelectorAll('*')) {
          if (el.tagName?.toLowerCase() === 'theme-editor-x') return true
          if ((el as Element).shadowRoot && walk((el as Element).shadowRoot as ShadowRoot)) return true
        }
        return false
      }
      return walk(ed.shadowRoot)
    },
    undefined,
    {timeout: 30_000}
  )

  // The migration's defining property: this editor has no tab container.
  const hasTabs = await page.evaluate(() => !!(window as any).__settingsEd?.tabs)
  expect(hasTabs, 'the Theme Editor must not reintroduce a tabbed layout').toBe(false)

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
})

test('PropsEditor Settings tab binds feature flags and addons', async ({page}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))

  await page.goto('/?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any)._appstate?.screen, undefined, {timeout: 90_000})
  await page.setViewportSize({width: 1280, height: 800})

  // The PropsEditor (`props-editor-x`) is part of the default screen; find the
  // live instance rather than mounting a second one. Note `scene-object-panel-x`
  // is a different class (`ObjectPanel`) — the editor tag is `props-editor-x`.
  await page.waitForFunction(
    () => {
      const find = (root: Document | ShadowRoot | Element): any => {
        for (const el of (root as ParentNode).querySelectorAll('*')) {
          if (el.tagName?.toLowerCase() === 'props-editor-x') return el
          if ((el as Element).shadowRoot) {
            const hit = find((el as Element).shadowRoot as ShadowRoot)
            if (hit) return hit
          }
        }
        return null
      }
      const ed = find(document)
      if (!ed) return false
      ;(window as any).__propsEd = ed
      return !!ed.tabs
    },
    undefined,
    {timeout: 60_000}
  )

  await page.waitForFunction(
    () => !!((window as any).__propsEd as any)?._settingsTab,
    undefined,
    {timeout: 30_000}
  )

  const bindings = await page.evaluate(async () => {
    const ed = (window as any).__propsEd as any
    const target = ed._settingsTab
    ed.tabs.setActive(target)

    // Let the tab swap and widget updates flush.
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => requestAnimationFrame(r))
    }

    const paths: string[] = []
    const walk = (root: Element | ShadowRoot) => {
      for (const el of root.querySelectorAll('*')) {
        const dp = el.getAttribute?.('datapath')
        if (dp) paths.push(dp)
        if (el.shadowRoot) walk(el.shadowRoot)
      }
    }
    walk(ed.shadowRoot ?? ed)
    return paths
  })

  expect(bindings).toContain('settings.featureFlags.sculptcore_quad_remesher')
  expect(bindings.some((p) => p.startsWith('settings.addons['))).toBe(true)

  // The bound path round-trips through the FeatureFlagManager singleton.
  const roundtrip = await page.evaluate(() => {
    const w = window as any
    const path = 'settings.featureFlags.sculptcore_quad_remesher'
    const initial = w.CTX.api.getValue(w.CTX, path)
    w.CTX.api.setValue(w.CTX, path, !initial)
    const flipped = w.FeatureFlags.get('sculptcore.quad_remesher')
    w.FeatureFlags.reset('sculptcore.quad_remesher')
    const restored = w.CTX.api.getValue(w.CTX, path)
    return {initial, flipped, restored}
  })

  expect(roundtrip.flipped).toBe(!roundtrip.initial)
  expect(roundtrip.restored).toBe(true)

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
