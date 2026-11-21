import {expect, test} from '@playwright/test'

for (const [domain, verticesAfter] of [
  ['VERTICES', 0],
  ['EDGES', 0],
  ['FACES', 0],
  ['FACES_ONLY', 8],
] as const) {
  test(`LiteMesh ${domain} deletion preserves the object and supports undo/redo`, async ({page}) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/?renderer=webgpu')
    await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
    const before = await page.evaluate(async (domain) => {
      const ctx = (window as any).CTX
      await ctx.api.execTool(ctx, 'litemesh.add_cube(goalFaces=6)')
      ctx.scene.switchToolMode('boxmodel')
      ctx.toolmode.boxModelSelMode = domain === 'VERTICES' ? 1 : domain === 'EDGES' ? 2 : 4
      await ctx.api.execTool(ctx, 'litemesh.select_all(mode=ALL)')
      return {id: ctx.object.lib_id, objects: ctx.scene.objects.length}
    }, domain)
    const viewport = page.locator('view3d-editor-x').first()
    await viewport.locator('dropbox-x[name="Mesh"]').click()
    const label = {
      VERTICES  : 'Delete Vertices',
      EDGES     : 'Delete Edges',
      FACES     : 'Delete Faces',
      FACES_ONLY: 'Delete Only Faces',
    }[domain]
    await page.locator('menu-x').getByText(label, {exact: true}).click()
    const stats = () =>
      page.evaluate(() => {
        const ctx = (window as any).CTX
        return {
          id      : ctx.object?.lib_id,
          objects : ctx.scene.objects.length,
          vertices: ctx.object?.data.mesh.v.count,
          faces   : ctx.object?.data.mesh.f.count,
        }
      })
    await expect.poll(stats).toEqual({...before, vertices: verticesAfter, faces: 0})
    await page.evaluate(() => (window as any)._appstate.toolstack.undo())
    await expect.poll(stats).toEqual({...before, vertices: 8, faces: 6})
    await page.evaluate(() => (window as any)._appstate.toolstack.redo())
    await expect.poll(stats).toEqual({...before, vertices: verticesAfter, faces: 0})
    expect(errors).toEqual([])
  })
}

test('loop cut places a cut under the pointer and undoes the topology', async ({page}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
  const point = await page.evaluate(async () => {
    const ctx = (window as any).CTX
    await ctx.api.execTool(ctx, 'litemesh.add_cube(goalFaces=6)')
    ctx.scene.switchToolMode('boxmodel')
    const point = ctx.object.location.copy()
    ctx.view3d.project(point)
    return [point[0], point[1]]
  })
  const viewport = page.locator('view3d-editor-x').first()
  await viewport.locator('dropbox-x[name="Mesh"]').click()
  await page.locator('menu-x').getByText('Loop Cut', {exact: true}).click()
  const bounds = await viewport.boundingBox()
  await page.mouse.move(bounds!.x + point[0], bounds!.y + point[1])
  await page.mouse.click(bounds!.x + point[0], bounds!.y + point[1])
  await expect.poll(() => page.evaluate(() => (window as any).CTX.object.data.mesh.f.count)).toBeGreaterThan(6)
  await page.evaluate(() => (window as any)._appstate.toolstack.undo())
  await expect.poll(() => page.evaluate(() => (window as any).CTX.object.data.mesh.f.count)).toBe(6)
  expect(errors).toEqual([])
})

test('portable file import reads OBJ without the File System Access API', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', {value: undefined, configurable: true})
  })
  await page.goto('/?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
  const chooser = page.waitForEvent('filechooser')
  // Trigger the real import operation and complete its standard browser picker.
  const importing = page.evaluate(() => (window as any).CTX.api.execTool((window as any).CTX, 'app.import_file()'))
  await (
    await chooser
  ).setFiles({
    name    : 'triangle.obj',
    mimeType: 'text/plain',
    buffer  : Buffer.from('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'),
  })
  await importing
  await expect
    .poll(() => page.evaluate(() => (window as any).CTX.object.data.extractTriangles().indices.length))
    .toBe(3)
})

for (const format of ['GLB', 'OBJ', 'STL', 'PLY']) {
  test(`${format} export and import round-trip actual mesh geometry`, async ({page}) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/?renderer=webgpu')
    await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
    const result = await page.evaluate(async (format) => {
      const ctx = (window as any).CTX
      ctx.object.data.markAllSeams()
      await ctx.api.execTool(ctx, 'litemesh.generate_uv()')
      const addonUrl = new URL('build/addons/leafmesh/src/main.js', document.baseURI).href
      const formats = await import(addonUrl)
      const fmt = (formats as any)[`LEAFMESH_${format}_FORMAT`]
      const before = ctx.object.data.extractTriangles().indices.length
      const output = fmt.exportToBytes(ctx)
      const bytes = typeof output === 'string' ? new TextEncoder().encode(output) : new Uint8Array(output)
      fmt.importFromBytes(ctx, bytes, `roundtrip.${format.toLowerCase()}`)
      const after = ctx.object.data.extractTriangles().indices.length
      if (format === 'OBJ') {
        const exportedAgain = fmt.exportToBytes(ctx)
        fmt.importFromBytes(ctx, new TextEncoder().encode(exportedAgain), 'leaf-roundtrip.obj')
      }
      const uv = ctx.object.data.mesh.attrs.get(2, 'uv')
      return {before, after, bytes: bytes.length, uv: !!uv}
    }, format)
    expect(result.bytes).toBeGreaterThan(0)
    expect(result.after).toBe(result.before)
    if (format === 'GLB' || format === 'OBJ') expect(result.uv).toBe(true)
    expect(errors).toEqual([])
  })
}

test('browser sculpt engine deforms, masks, paints and mirrors a mesh', async ({page}) => {
  await page.goto('/?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
  const result = await page.evaluate(async () => {
    const w = window as any,
      ctx = w.CTX
    await ctx.api.execTool(ctx, 'litemesh.add_cube(goalFaces=6144 sphere=1)')
    ctx.scene.switchToolMode('sculptcore')
    // Let the real draw pipeline populate the spatial GPU batch before testing.
    w.redraw_viewport(true)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    return await w.__brushTest()
  })
  expect(result.ok, result.error).toBe(true)
  expect(result.drawForward.movedCount).toBeGreaterThan(0)
  expect(result.drawForward.meanAlongNormal).toBeGreaterThan(0)
  expect(result.drawInverted.meanAlongNormal).toBeLessThan(0)
  expect(result.drawMasked.maxDisp).toBeLessThan(result.drawForward.maxDisp * 0.2)
  expect(result.color.paintedCount).toBeGreaterThan(0)
  expect(result.symMirrorX.movedPos).toBeGreaterThan(0)
  expect(result.symMirrorX.movedNeg).toBeGreaterThan(0)
  expect(result.nonFiniteCount).toBe(0)
})

test('project save and reload preserve geometry, names and generated UVs', async ({page}) => {
  await page.goto('/?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
  const result = await page.evaluate(async () => {
    const app = (window as any)._appstate
    const ctx = app.ctx
    ctx.object.name = 'Saved Modeling Cube'
    ctx.object.data.markAllSeams()
    await ctx.api.execTool(ctx, 'litemesh.generate_uv()')
    const before = ctx.object.data.extractTriangles()
    const saved = app.createFile({save_screen: false, save_settings: false, save_library: true})
    ctx.object.name = 'Temporary Name'
    await app.loadFileAsync(saved, {load_screen: false, load_settings: false, load_library: true})
    const ob = [...app.ctx.scene.objects].find((ob: any) => ob.name === 'Saved Modeling Cube')
    const after = ob?.data.extractTriangles()
    return {
      name           : ob?.name,
      beforeUV       : Array.from(before.uvs ?? []),
      afterUV        : Array.from(after?.uvs ?? []),
      beforeTriangles: before.indices.length,
      afterTriangles : after?.indices.length,
    }
  })
  expect(result.name).toBe('Saved Modeling Cube')
  expect(result.beforeUV.length).toBeGreaterThan(0)
  expect(result.afterUV).toEqual(result.beforeUV)
  expect(result.afterTriangles).toBe(result.beforeTriangles)
})
