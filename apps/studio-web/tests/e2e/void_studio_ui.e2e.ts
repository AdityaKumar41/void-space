import {expect, test} from '@playwright/test'

/**
 * Viewport UI shape: the Blender-like header, tool panel, properties rail, the
 * transform gizmo, and the `Shift-A` Add menu.
 *
 * Each assertion pins a defect this suite was written to catch:
 *
 *   1. The viewport header was a wall. `SculptCorePaintMode.buildHeader` appended
 *      four rows to the header itself, so sculpt mode covered the top ~180px of
 *      the viewport with unlabelled icons. The checks below can only pass while
 *      the header is one row and the tool rows live in the docked panel instead.
 *   2. The properties rail rendered its category names as rotated text in a
 *      ~14px column, which clipped into an unreadable strip. It is now icon-only
 *      with the name in a tooltip, so every tab must have an icon and no label.
 *   3. The transform gizmo had never been built in any mode: `ObjectEditor`
 *      defaulted `transformWidget` to 0, and `ToolMode.update()` indexes
 *      `transWidgets` with `transformWidget - 1`, so `tcls` was always
 *      undefined. Asserting a live `TranslateWidget` is what pins the fix.
 *   4. `Shift-A` ran a bare cube op instead of opening the Add menu.
 *
 * Every lookup walks shadow roots: path.ux renders into nested shadow DOM, so a
 * plain `document.querySelector` finds nothing. Each test inlines its own walker
 * rather than sharing one, because `page.evaluate` serializes a function by
 * source and a captured helper would not come with it.
 */

test('viewport header is one row and the toolmode rows live in the docked panel', async ({page}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))

  await page.goto('/?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any)._appstate?.screen, undefined, {timeout: 90_000})
  await page.setViewportSize({width: 1600, height: 1000})
  await page.waitForTimeout(1500)

  const shape = await page.evaluate(() => {
    const find = (root: any, tag: string): any => {
      for (const el of root.querySelectorAll('*')) {
        if (el.tagName?.toLowerCase() === tag) return el
        if (el.shadowRoot) {
          const hit = find(el.shadowRoot, tag)
          if (hit) return hit
        }
      }
      return null
    }

    const w = window as any
    const v3d: any = find(document, 'view3d-editor-x')
    const host = v3d?._toolmodeHost
    const cols = v3d?.header?.shadowRoot?.children

    // The header is a column of rows. Only the switcher and note rows belong to
    // makeHeader, so the viewport adding exactly one more is what a single
    // header row means here.
    const headerRows = cols
      ? [...cols].filter((el: any) => el.tagName?.toLowerCase().endsWith('-x')).length
      : -1

    return {
      toolHostChildCount: host?.shadowRoot?.children?.length ?? -1,
      panelIds          : v3d?.panels ? [...v3d.panels.defs.keys()] : null,
      leftRegionSize    : v3d?.panels?.regions?.left?.size ?? null,
      headerRows,
      toolmodeName      : w.CTX?.toolmode?.constructor?.toolModeDefine?.().name ?? null,
    }
  })

  // The toolmode's rows went to the panel, not the header.
  expect(shape.toolHostChildCount, 'the toolmode contributed no rows to the tool panel').toBeGreaterThan(4)
  expect(shape.panelIds).toContain('viewport_tools')
  expect(shape.leftRegionSize).toBe(320)

  // Five toolmode rows used to push this to eight or more.
  expect(shape.headerRows, `header grew back into a wall (${shape.headerRows} rows)`).toBeLessThanOrEqual(3)

  expect(shape.toolmodeName).toBe('sculptcore')
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
})

test('properties rail is icon-only with the category name in a tooltip', async ({page}) => {
  await page.goto('/?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any)._appstate?.screen, undefined, {timeout: 90_000})
  await page.setViewportSize({width: 1600, height: 1000})

  await page.waitForFunction(
    () => {
      const walk = (root: Document | ShadowRoot | Element): any => {
        for (const el of (root as ParentNode).querySelectorAll('*')) {
          if (el.tagName?.toLowerCase() === 'props-editor-x') return el
          if ((el as Element).shadowRoot) {
            const hit = walk((el as Element).shadowRoot as ShadowRoot)
            if (hit) return hit
          }
        }
        return null
      }
      const ed = walk(document)
      if (!ed) return false
      ;(window as any).__propsEd = ed
      return !!ed.tabs?.tbar?.tabs?.length
    },
    undefined,
    {timeout: 60_000}
  )

  const tabs = await page.evaluate(() => {
    const ed = (window as any).__propsEd as any
    return ed.tabs.tbar.tabs.map((t: any) => ({
      name   : t.name,
      icon   : t.icon,
      tooltip: t.tooltip,
      width  : Math.round(t.size?.[0] ?? -1),
    }))
  })

  expect(tabs.length, 'the properties editor lost its category tabs').toBe(8)

  for (const tab of tabs) {
    // Empty label plus an icon is what makes the rail a narrow icon column
    // rather than a column of clipped, rotated names.
    expect(tab.name, `tab "${tab.tooltip}" still renders a text label`).toBe('')
    expect(typeof tab.icon, `tab "${tab.tooltip}" has no icon`).toBe('number')
    // The label moved into the tooltip, so the category stays discoverable.
    expect(tab.tooltip, 'tab lost its tooltip').toBeTruthy()
    expect(tab.width, `tab "${tab.tooltip}" is ${tab.width}px wide`).toBeLessThan(60)
  }

  // An icon-only rail is navigable only while the glyphs are distinct — two
  // categories sharing one glyph is the "I cannot tell what these are" defect.
  const icons = tabs.map((t: {icon: number}) => t.icon)
  expect(new Set(icons).size, 'two category tabs share an icon').toBe(tabs.length)

  // The nearest readable match from the icon sheet, per category, in rail order.
  // Pinned rather than merely counted so a reshuffle has to be deliberate:
  //   Workspace 77 (gear)      Scene 44 (camera)     Material 121 (colour)
  //   Object 133 (cube)        ObData 53 (mesh)      Texture 93 (picture)
  //   Last Command 5 (redo)    Settings 81 (panel)
  expect(icons).toEqual([77, 44, 121, 133, 53, 93, 5, 81])
})

test('property labels are tall enough for their own descenders', async ({page}) => {
  await page.goto('/?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any)._appstate?.screen, undefined, {timeout: 90_000})
  await page.setViewportSize({width: 1600, height: 1000})
  await page.waitForTimeout(2000)

  const measured = await page.evaluate(() => {
    const found: {text: string; height: number; fontSize: number}[] = []

    const walk = (root: Document | ShadowRoot | Element) => {
      for (const el of (root as ParentNode).querySelectorAll('*')) {
        if (el instanceof HTMLElement && el.classList.contains('_labelx')) {
          const r = el.getClientRects()[0]
          const size = parseFloat(getComputedStyle(el).fontSize)
          const text = (el.textContent ?? '').trim()
          if (r && text && Number.isFinite(size)) {
            found.push({text: text.slice(0, 22), height: r.height, fontSize: size})
          }
        }
        if ((el as Element).shadowRoot) walk((el as Element).shadowRoot as ShadowRoot)
      }
    }
    walk(document)

    return found
  })

  expect(measured.length, 'no laid-out labels in the properties panel').toBeGreaterThan(3)

  for (const label of measured) {
    // A label whose box is shorter than its own line box has its descenders
    // painted into the row below, which is where the widget covers them: every
    // "Spacing"/"Rotation Y" came out with its tail sliced off.
    expect(
      label.height,
      `label "${label.text}" is ${label.height}px tall for a ${label.fontSize}px font`
    ).toBeGreaterThanOrEqual(label.fontSize * 1.2)
  }
})

test('object mode builds a transform gizmo, and Shift-A opens the Add menu', async ({page}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))

  await page.goto('/?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any)._appstate?.screen, undefined, {timeout: 90_000})
  await page.setViewportSize({width: 1600, height: 1000})
  await page.waitForTimeout(1500)

  const gizmo = await page.evaluate(async () => {
    const w = window as any
    const scene = w.CTX.scene

    // A ToolModes enum *name*, not a lookup in `scene.toolmodes` — that array is
    // only the instantiation cache and is empty until a mode has been used once.
    scene.switchToolMode('object')
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r))
    for (let i = 0; i < 5; i++) {
      scene.updateWidgets?.()
      await new Promise((r) => requestAnimationFrame(r))
    }

    const tm = w.CTX.toolmode
    const tw = tm?.transWidget

    // The shape meshes come from `WidgetManager.loadShapes`, which copies each
    // entry of `Shapes`. `SimpleMesh.copy()` used to keep the constructor's
    // placeholder island, so every shape began with a zero-vertex island; the
    // gizmo was "built" and submitted and still drew nothing.
    const shapeMeshes = ([tw, ...(tw?.axes ?? []), tw?.center_widget] as any[])
      .map((widget) => widget?.shape?.mesh)
      .filter(Boolean)
      .map((mesh: any) => ({
        islands: mesh.islands.length,
        tris   : mesh.islands.reduce((n: number, island: any) => n + island.tottri, 0),
      }))

    return {
      toolmode       : tm?.constructor?.name,
      transformWidget: tm?.transformWidget,
      transWidget    : tw?.constructor?.name ?? null,
      // `create()` is what builds the three axis arrows.
      axesBuilt      : tw?.axes === undefined ? 0 : tw.axes.length,
      inManager      : tw ? !!scene.widgets.widgets.includes(tw) : false,
      shapeMeshes,
    }
  })

  expect(gizmo.toolmode, 'could not switch to the object toolmode').toBe('ObjectEditor')
  expect(gizmo.transformWidget, 'transformWidget must not default to NONE (0)').toBeGreaterThan(0)
  expect(gizmo.transWidget, 'no transform widget was instantiated').toBe('TranslateWidget')
  expect(gizmo.axesBuilt, 'the gizmo was never given any geometry').toBe(3)
  expect(gizmo.inManager).toBe(true)

  expect(gizmo.shapeMeshes.length, 'the gizmo has no shape meshes').toBeGreaterThan(0)
  for (const mesh of gizmo.shapeMeshes) {
    expect(mesh.islands, 'a widget shape carried the copy() placeholder island').toBe(1)
    expect(mesh.tris, 'a widget shape mesh has no triangles to draw').toBeGreaterThan(0)
  }

  await page.keyboard.press('Shift+A')
  await page.waitForTimeout(600)

  const menu = await page.evaluate(() => {
    const menus: Element[] = []
    const collect = (root: Document | ShadowRoot | Element) => {
      for (const el of (root as ParentNode).querySelectorAll('*')) {
        if (el.tagName?.toLowerCase() === 'menu-x') menus.push(el)
        if ((el as Element).shadowRoot) collect((el as Element).shadowRoot as ShadowRoot)
      }
    }
    collect(document)

    const first = menus[0] as any
    return {
      menuCount: menus.length,
      items    : first?.items?.length ?? first?.widgets?.length ?? 0,
    }
  })

  expect(menu.menuCount, 'Shift-A did not open a menu').toBeGreaterThan(0)
  // The host's light op plus add_cube / add_sphere / add_plane from litemesh's
  // `menuEntries('add', …)`.
  expect(menu.items, 'the Add menu has too few entries').toBeGreaterThanOrEqual(4)

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
})

test('the properties panel fills its column, in the units each quantity has', async ({page}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))

  await page.goto('/?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any)._appstate?.screen, undefined, {timeout: 90_000})
  await page.setViewportSize({width: 1600, height: 1000})
  await page.waitForTimeout(1500)

  // The Object category, clicked the way a user reaches it.
  const rail = await page.evaluate(() => {
    const walk = (root: Document | ShadowRoot | Element): any => {
      for (const el of (root as ParentNode).querySelectorAll('*')) {
        if (el.tagName?.toLowerCase() === 'props-editor-x') return el
        if ((el as Element).shadowRoot) {
          const hit = walk((el as Element).shadowRoot as ShadowRoot)
          if (hit) return hit
        }
      }
      return null
    }
    const ed = walk(document)
    ;(window as any).__propsEd = ed
    return ed.tabs.tbar.tabs.map((t: any) => {
      const r = t.getClientRects()[0]
      return {
        tooltip: (t.tooltip ?? '').split(' ')[0],
        x      : Math.round(r.x + r.width / 2),
        y      : Math.round(r.y + r.height / 2),
      }
    })
  })

  const objectTab = rail.find((t: {tooltip: string}) => t.tooltip === 'Object')
  expect(objectTab, 'the Object category is missing from the rail').toBeTruthy()
  await page.mouse.click(objectTab!.x, objectTab!.y)
  await page.waitForTimeout(1200)

  const shape = await page.evaluate(() => {
    const walk = (root: Document | ShadowRoot | Element, tag: string): any => {
      for (const el of (root as ParentNode).querySelectorAll('*')) {
        if (el.tagName?.toLowerCase() === tag) return el
        if ((el as Element).shadowRoot) {
          const hit = walk((el as Element).shadowRoot as ShadowRoot, tag)
          if (hit) return hit
        }
      }
      return null
    }

    const ed: any = (window as any).__propsEd
    const rect = (el: any) => {
      const r = el?.getClientRects?.()[0]
      return r ? {w: Math.round(r.width), x: Math.round(r.x)} : null
    }

    const collect = (tag: string, root: any = ed): any[] => {
      const found: any[] = []
      const scan = (r: any) => {
        for (const el of r.children ?? []) {
          if (el.tagName?.toLowerCase() === tag) found.push(el)
          scan(el.shadowRoot ?? el)
        }
      }
      scan(root.shadowRoot ?? root)
      return found
    }

    const objPanel = walk(document, 'scene-object-panel-x')
    const frame = collect('panelframe-x', objPanel)[0]
    const titleFrame = collect('rowframe-x', objPanel)[0]
    const checkLabel = collect('check-x', objPanel)[0]?.shadowRoot?.querySelector('label')

    return {
      editorW : rect(ed)?.w ?? -1,
      railW   : rect(ed.tabs.tbar)?.w ?? -1,
      bodyW   : rect(ed.tabs.tbar._contentsWrapper)?.w ?? -1,
      panelW  : rect(objPanel)?.w ?? -1,
      frameW  : rect(frame)?.w ?? -1,
      // The editor's own scroll box is what grows a scrollbar when a panel is
      // wider than the column it was given.
      scrollW : ed.scrollWidth,
      clientW : ed.clientWidth,
      vecNames: collect('vector-panel-x', objPanel).map((v: any) => v.name),
      formats : collect('numslider-textbox-x', objPanel).map((s: any) => s.formatNumber(1.23456)),
      sliderW : {
        slider: rect(collect('numslider-x', objPanel)[0])?.w ?? -1,
        row   : rect(collect('numslider-textbox-x', objPanel)[0])?.w ?? -1,
      },
      nameLabel: (() => {
        const label = collect('label-x', objPanel)[0]
        return {
          text: (label?.dom?.textContent ?? '').trim(),
          font: label?.dom ? getComputedStyle(label.dom).font : '',
        }
      })(),
      titleColour: titleFrame ? getComputedStyle(titleFrame).borderTopColor : '',
      check      : {
        label: (checkLabel?.textContent ?? '').trim(),
        font : checkLabel ? getComputedStyle(checkLabel).font : '',
      },
    }
  })

  console.log('panel shape:', JSON.stringify(shape))

  // The body fills the column beside the rail: a shrink-wrapped body was the defect
  // — 193px of content in a 374px column, with the rest empty ground, and every
  // slider reduced to a stub.
  expect(
    shape.bodyW,
    `the tab body is ${shape.bodyW}px in a ${shape.editorW - shape.railW}px column`
  ).toBeGreaterThanOrEqual(shape.editorW - shape.railW - 2)

  // And a panel frame fits inside it: `PanelFrame` is `width: 100%` with content-box
  // sizing, so without an inset its own 1px borders pushed it 2px past the column
  // and the scroll box grew a horizontal scrollbar.
  expect(
    shape.frameW,
    `panel frame (${shape.frameW}) is wider than its column (${shape.panelW})`
  ).toBeLessThanOrEqual(shape.panelW)
  expect(shape.scrollW, 'the properties body scrolls sideways').toBe(shape.clientW)

  // One slider absorbs the row's slack; two part-width fields followed by dead space
  // is what the panel looked like before.
  expect(shape.sliderW.slider, 'the axis slider did not grow into its row').toBeGreaterThan(
    shape.sliderW.row * 0.6
  )

  // Labels and units. A slider formats its numbers through `units.buildString`, which
  // falls back to metres for anything it was never told about — so rotation read "0 m"
  // and so did scale.
  expect(shape.vecNames).toEqual(['Location', 'Rotation', 'Scale'])
  expect(shape.formats.slice(0, 3)).toEqual(['1.235 m', '1.235 m', '1.235 m'])
  expect(shape.formats.slice(3, 6)).toEqual(['70.7 °', '70.7 °', '70.7 °'])
  expect(shape.formats.slice(6, 9)).toEqual(['1.235', '1.235', '1.235'])

  // The tab is headed by the object's own name, not by the datapath's "name".
  expect(shape.nameLabel.text, 'the panel is headed by the raw datapath label').not.toMatch(/^name\b/)
  expect(shape.nameLabel.font, 'the object name is not set in the theme title face').toContain('600 12px')

  // Section headers stroke their own border from `panel.TitleBorder`, which upstream
  // ships as `rgba(104,104,104,1)` — a light grey box around every header, the single
  // most "unstyled form" element in the panel.
  expect(shape.titleColour, 'the section header is outlined in upstream grey').not.toBe('rgb(104, 104, 104)')

  // A checkbox label is a property name: 12px in the theme's face. Upstream re-fonts
  // it `14px poppins`, a family this build never loads.
  expect(shape.check.label).toBeTruthy()
  expect(shape.check.font, 'the checkbox label is not in the theme face').toContain('12px')
  expect(shape.check.font).not.toContain('poppins')

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
})

test('every properties category opens without an uncaught error', async ({page}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))

  await page.goto('/?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any)._appstate?.screen, undefined, {timeout: 90_000})
  await page.setViewportSize({width: 1600, height: 1000})
  await page.waitForTimeout(1500)

  const rail = await page.evaluate(() => {
    const walk = (root: Document | ShadowRoot | Element): any => {
      for (const el of (root as ParentNode).querySelectorAll('*')) {
        if (el.tagName?.toLowerCase() === 'props-editor-x') return el
        if ((el as Element).shadowRoot) {
          const hit = walk((el as Element).shadowRoot as ShadowRoot)
          if (hit) return hit
        }
      }
      return null
    }
    const ed = walk(document)
    ;(window as any).__propsEd = ed
    return ed.tabs.tbar.tabs.map((t: any) => {
      const r = t.getClientRects()[0]
      return {
        tooltip: t.tooltip,
        x      : Math.round(r.x + r.width / 2),
        y      : Math.round(r.y + r.height / 2),
      }
    })
  })

  expect(rail.length, 'the rail has no categories').toBe(8)

  const empty: string[] = []

  for (const item of rail) {
    const before = pageErrors.length
    await page.mouse.click(item.x, item.y)
    await page.waitForTimeout(900)

    // The category has to have built *something*. A panel whose `rebuild` threw
    // leaves its container empty, which a user sees as a blank column rather than
    // as an error.
    const built = await page.evaluate(() => {
      const ed: any = (window as any).__propsEd
      const host = ed.tabs.tbar._contentsWrapper?.lastElementChild
      let widgets = 0

      const scan = (r: any) => {
        for (const el of r.children ?? []) {
          if (el.tagName?.toLowerCase().endsWith('-x')) widgets++
          scan(el.shadowRoot ?? el)
        }
      }
      scan(host?.shadowRoot ?? host)

      return {hosted: !!host, widgets}
    })

    if (!built.hosted || built.widgets < 1) {
      empty.push(`${(item.tooltip ?? '').split(' ')[0]} (${built.widgets} widgets)`)
    }

    const added = pageErrors.slice(before)
    expect(added, `opening "${item.tooltip}" raised:\n${added.join('\n')}`).toEqual([])
  }

  expect(empty, `categories that built an empty panel: ${empty.join(', ')}`).toEqual([])
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
})

