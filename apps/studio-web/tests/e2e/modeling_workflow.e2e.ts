import {expect, test} from '@playwright/test'

test('context modes drive mesh selection, topology editing and undo', async ({page}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?renderer=webgpu')
  await page.setViewportSize({width: 1600, height: 1000})
  await page.waitForFunction(() => !!(window as any).CTX?.scene && !!(window as any)._appstate?.screen)
  const before = await page.evaluate(async () => {
    const ctx = (window as any).CTX
    ctx.scene.switchToolMode('object')
    await ctx.api.execTool(ctx, 'litemesh.add_cube(goalFaces=6)')
    return ctx.object.data.mesh.f.count
  })
  const viewport = page.locator('view3d-editor-x').first()
  await viewport.locator('dropbox-x[name="Object Mode"]').click()
  await page.getByText('Edit Mode', {exact: true}).click()
  await expect
    .poll(() => page.evaluate(() => (window as any).CTX.toolmode.constructor.toolModeDefine().name))
    .toBe('boxmodel')
  await expect(viewport.locator('dropbox-x[name="Mesh"]')).toBeVisible()
  await viewport.locator('dropbox-x[name="Select"]').click()
  await page.getByText('Deselect All', {exact: true}).click()
  await expect.poll(() => page.evaluate(() => (window as any).CTX.object.data.mesh.selectedCount(0))).toBe(0)
  await expect(page.getByText('Deselect All', {exact: true})).toHaveCount(0)
  // Native dropdowns briefly lock reopening after selection to absorb pointer-up.
  await expect(async () => {
    await viewport.locator('dropbox-x[name="Select"]').click()
    await expect(page.locator('menu-x').getByText('Select All', {exact: true})).toBeVisible({timeout: 500})
  }).toPass({intervals: [250], timeout: 5000})
  await page.locator('menu-x').getByText('Select All', {exact: true}).click()
  await viewport.locator('dropbox-x[name="Mesh"]').click()
  await page.getByText('Subdivide', {exact: true}).click()
  await expect.poll(() => page.evaluate(() => (window as any).CTX.object.data.mesh.f.count)).toBeGreaterThan(before)
  await page.evaluate(() => (window as any)._appstate.toolstack.undo())
  await expect.poll(() => page.evaluate(() => (window as any).CTX.object.data.mesh.f.count)).toBe(before)
  // Delete in Edit Mode must never fall back to deleting the entire object.
  const objectId = await page.evaluate(() => (window as any).CTX.object.lib_id)
  const bounds = await viewport.boundingBox()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
  await page.keyboard.press('Delete')
  await expect.poll(() => page.evaluate(() => (window as any).CTX.object?.lib_id)).toBe(objectId)
  // Keep the viewport active for its keyboard map, outside text fields.
  await viewport.locator('dropbox-x[name="Edit Mode"]').click()
  await page.getByText('Sculpt Mode', {exact: true}).click()
  await expect
    .poll(() => page.evaluate(() => (window as any).CTX.toolmode.constructor.toolModeDefine().name))
    .toBe('sculptcore')
  await expect(viewport.locator('dropbox-x[name="Sculpt"]')).toBeVisible()
  await page.evaluate(async () => {
    const ctx = (window as any).CTX
    await ctx.api.execTool(ctx, 'object.add_camera()')
  })
  await expect
    .poll(() => page.evaluate(() => (window as any).CTX.toolmode.constructor.toolModeDefine().name))
    .toBe('object')
  await viewport.locator('dropbox-x[name="Object Mode"]').click()
  await expect(page.getByText('Edit Mode', {exact: true})).toHaveCount(0)
  await expect(page.getByText('Sculpt Mode', {exact: true})).toHaveCount(0)
  expect(errors).toEqual([])
})

test('properties expose object, data, material, world and render contexts without stale selection', async ({page}) => {
  await page.goto('/?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).CTX?.scene)
  const contexts = await page.evaluate(() => {
    const find = (root: any): any => {
      for (const el of root.querySelectorAll('*')) {
        if (el.tagName?.toLowerCase() === 'props-editor-x') return el
        if (el.shadowRoot) {
          const found = find(el.shadowRoot)
          if (found) return found
        }
      }
    }
    const editor = find(document)
    ;(window as any).__modelingProps = editor
    return editor.tabs.tbar.tabs.map((tab: any) => tab.tooltip)
  })
  for (const name of ['Active Tool', 'Object', 'Object Data', 'Material', 'World', 'Render'])
    expect(contexts.some((title: string) => title.startsWith(name))).toBe(true)
  await page.evaluate(() => {
    const ctx = (window as any).CTX
    ctx.scene.objects.clearSelection()
    ctx.scene.objects.setActive(undefined)
    const editor = (window as any).__modelingProps
    editor.tabs.tbar.setActive(editor.tabs.tbar.tabs.find((tab: any) => tab.tooltip.startsWith('Object —')))
  })
  await expect(page.getByText('Select an object to inspect its properties.', {exact: true})).toBeVisible()
  await page.evaluate(() => {
    const editor = (window as any).__modelingProps
    editor.tabs.tbar.setActive(editor.tabs.tbar.tabs.find((tab: any) => tab.tooltip.startsWith('Object Data')))
  })
  await expect(page.getByText('Select an object to inspect its data.', {exact: true})).toBeVisible()
})
