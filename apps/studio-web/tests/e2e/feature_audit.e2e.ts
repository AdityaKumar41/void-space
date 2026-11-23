import {expect, test} from '@playwright/test'

test('object selection undo and repeated redo restore exact membership', async ({page}) => {
  await page.goto('./?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
  const initial = await page.evaluate(() => [...(window as any).CTX.scene.objects.selected].map((o: any) => o.lib_id))
  const viewport = page.locator('view3d-editor-x').first()
  await viewport.hover()
  await page.keyboard.press('Alt+a')
  await expect.poll(() => page.evaluate(() => [...(window as any).CTX.scene.objects.selected].length)).toBe(0)
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => (window as any)._appstate.toolstack.undo())
    await expect
      .poll(() => page.evaluate(() => [...(window as any).CTX.scene.objects.selected].map((o: any) => o.lib_id)))
      .toEqual(initial)
    await page.evaluate(() => (window as any)._appstate.toolstack.redo())
    await expect.poll(() => page.evaluate(() => [...(window as any).CTX.scene.objects.selected].length)).toBe(0)
  }
})

test('viewport hide and reveal enter undo history and dirty the project', async ({page}) => {
  await page.goto('./?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
  const before = await page.evaluate(() => (window as any).CTX.state.changeId)
  await page.locator('view3d-editor-x').first().hover()
  await page.keyboard.press('h')
  await expect.poll(() => page.evaluate(() => !!((window as any).CTX.object.flag & 2))).toBe(true)
  await expect.poll(() => page.evaluate(() => (window as any).CTX.state.changeId)).toBeGreaterThan(before)
  await page.evaluate(() => (window as any)._appstate.toolstack.undo())
  await expect.poll(() => page.evaluate(() => !!((window as any).CTX.object.flag & 2))).toBe(false)
  await page.evaluate(() => (window as any)._appstate.toolstack.redo())
  await expect.poll(() => page.evaluate(() => !!((window as any).CTX.object.flag & 2))).toBe(true)
  await page.keyboard.press('Alt+h')
  await expect.poll(() => page.evaluate(() => !!((window as any).CTX.object.flag & 2))).toBe(false)
  await page.evaluate(() => (window as any)._appstate.toolstack.undo())
  await expect.poll(() => page.evaluate(() => !!((window as any).CTX.object.flag & 2))).toBe(true)
})

const primitives = [
  'Mesh: Cube',
  'Mesh: UV Sphere',
  'Mesh: Ico Sphere',
  'Mesh: Cylinder',
  'Mesh: Cone',
  'Mesh: Torus',
  'Mesh: Plane',
  'Mesh: Grid',
  'Mesh: Monkey (Suzanne)',
  'Mesh: Tube',
  'Add Cube (SculptCore)',
  'Add Sphere (Sculptcore)',
  'Add Plane (SculptCore)',
  'Light',
  'Camera',
  'Empty',
]
for (const label of primitives)
  test(`Add menu creates ${label} with undo/redo`, async ({page}) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('./?renderer=webgpu')
    await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
    await page.locator('view3d-editor-x').first().hover()
    const before = await page.evaluate(() => (window as any).CTX.scene.objects.length)
    await page.keyboard.press('Shift+a')
    await page.locator('menu-x input').fill(label)
    await expect(page.locator('menu-x li')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate(() => (window as any).CTX.scene.objects.length)).toBe(before + 1)
    if (label !== 'Light' && label !== 'Camera' && label !== 'Empty') {
      const mesh = await page.evaluate(() => {
        const m = (window as any).CTX.object.data.extractTriangles()
        return {indices: m.indices.length, finite: Array.from(m.positions).every(Number.isFinite)}
      })
      expect(mesh.indices).toBeGreaterThan(0)
      expect(mesh.finite).toBe(true)
    }
    await page.evaluate(() => (window as any)._appstate.toolstack.undo())
    await expect.poll(() => page.evaluate(() => (window as any).CTX.scene.objects.length)).toBe(before)
    await page.evaluate(() => (window as any)._appstate.toolstack.redo())
    await expect.poll(() => page.evaluate(() => (window as any).CTX.scene.objects.length)).toBe(before + 1)
    expect(errors).toEqual([])
  })

test('Outliner visibility, lock and rename are undoable and autosaved', async ({page}) => {
  await page.goto('./?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
  const outliner = page.locator('outliner-editor-x').first()
  await outliner.getByRole('button', {name: 'Hide object', exact: true}).first().click()
  await expect.poll(() => page.evaluate(() => !!((window as any).CTX.object.flag & 2))).toBe(true)
  await page.evaluate(() => (window as any)._appstate.toolstack.undo())
  await expect.poll(() => page.evaluate(() => !!((window as any).CTX.object.flag & 2))).toBe(false)
  await outliner.getByRole('button', {name: 'Lock (not selectable)', exact: true}).first().click()
  await expect(outliner.getByRole('button', {name: 'Unlock object', exact: true})).toHaveCount(1)
  await page.evaluate(() => (window as any)._appstate.toolstack.undo())
  await expect(outliner.getByRole('button', {name: 'Unlock object', exact: true})).toHaveCount(0)
  page.once('dialog', (d) => d.accept('Renamed audit cube'))
  await outliner.getByText('Cube', {exact: true}).dblclick()
  await expect.poll(() => page.evaluate(() => (window as any).CTX.object.name)).toBe('Renamed audit cube')
  await page.evaluate(() => (window as any)._appstate.toolstack.undo())
  await expect.poll(() => page.evaluate(() => (window as any).CTX.object.name)).toBe('Cube')
})

test('Help manual opens the packaged guide under the deployment path', async ({page}) => {
  await page.goto('./?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
  await page.locator('dropbox-x[name="Help"]').click()
  const popup = page.waitForEvent('popup')
  await page.locator('menu-x').getByText('Manual', {exact: true}).click()
  const guide = await popup
  await expect(guide).toHaveURL(new URL('manual.html', page.url()).href)
  await expect(guide.getByRole('heading', {name: 'Void Studio modeling guide'})).toBeVisible()
})

for (const label of ['Extrude Region', 'Inset Faces', 'Subdivide', 'Delete Selected Elements'])
  test(`LeafMesh Mesh menu ${label} changes topology and undoes`, async ({page}) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('./?renderer=webgpu')
    await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
    const before = await page.evaluate(async () => {
      const c = (window as any).CTX
      await c.api.execTool(c, 'leafmesh.add_cube()')
      c.scene.switchToolMode('leafmesh')
      c.toolmode.leafMeshSelMode = 4
      await c.api.execTool(c, 'leafmesh.select_all(mode=ALL)')
      const flags = c.object.data.mesh.attrs.get(4, '.select').column.data
      flags.fill(0)
      flags[0] = 1
      return c.object.data.extractTriangles().indices.length
    })
    const viewport = page.locator('view3d-editor-x').first()
    await viewport.locator('dropbox-x[name="Mesh"]').click()
    await page.locator('menu-x').getByText(label, {exact: true}).click()
    if (label === 'Extrude Region' || label === 'Inset Faces') {
      await expect
        .poll(() =>
          page.evaluate((label) => {
            const w = window as any
            return label === 'Extrude Region'
              ? !!(w.CTX.state.modalFlag & 1)
              : !!w._appstate.toolstack[w._appstate.toolstack.cur]?.modalRunning
          }, label)
        )
        .toBe(true)
      const b = (await viewport.boundingBox())!
      await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5)
      await page.mouse.move(b.x + b.width * 0.5 + 60, b.y + b.height * 0.5, {steps: 8})
      await page.keyboard.press('Enter')
    }
    await expect
      .poll(() => page.evaluate(() => (window as any).CTX.object.data.extractTriangles().indices.length))
      .not.toBe(before)
    await page.evaluate(() => (window as any)._appstate.toolstack.undo())
    await expect
      .poll(() => page.evaluate(() => (window as any).CTX.object.data.extractTriangles().indices.length))
      .toBe(before)
    expect(errors).toEqual([])
  })

test('search Add releases keyboard focus for viewport undo and redo', async ({page}) => {
  await page.goto('./?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
  await page.locator('view3d-editor-x').first().hover()
  const before = await page.evaluate(() => (window as any).CTX.scene.objects.length)
  await page.keyboard.press('Shift+a')
  await page.locator('menu-x input').fill('Mesh: Cube')
  await expect(page.locator('menu-x li')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).CTX.scene.objects.length)).toBe(before + 1)
  await page.locator('view3d-editor-x').first().hover()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => page.evaluate(() => (window as any).CTX.scene.objects.length)).toBe(before)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => page.evaluate(() => (window as any).CTX.scene.objects.length)).toBe(before + 1)
})

test('Escape cancels the whole LeafMesh extrude macro and restores original topology', async ({page}) => {
  await page.goto('./?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
  await page.evaluate(async () => {
    const c = (window as any).CTX
    await c.api.execTool(c, 'leafmesh.add_cube()')
    c.scene.switchToolMode('leafmesh')
    c.toolmode.leafMeshSelMode = 4
    await c.api.execTool(c, 'leafmesh.select_all(mode=ALL)')
    const flags = c.object.data.mesh.attrs.get(4, '.select').column.data
    flags.fill(0)
    flags[0] = 1
    void c.api.execTool(c, 'leafmesh.extrude_region(transform=true)')
  })
  await expect.poll(() => page.evaluate(() => !!((window as any).CTX.state.modalFlag & 1))).toBe(true)
  await expect
    .poll(() => page.evaluate(() => (window as any).CTX.object.data.extractTriangles().indices.length))
    .toBe(60)
  await page.keyboard.press('Escape')
  await page.evaluate(() => (window as any)._appstate.toolstack.idle())
  await expect
    .poll(() => page.evaluate(() => (window as any).CTX.object.data.extractTriangles().indices.length))
    .toBe(36)
})
