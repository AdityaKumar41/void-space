import {expect, test} from '@playwright/test'

test('viewport navigation, shading and mode icons stay usable', async ({page}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /\[(webgpu|webgl|overlay)\]|GPUValidationError/.test(message.text()))
      errors.push(message.text())
  })
  await page.goto('./?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).CTX?.scene)
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
  const viewport = page.locator('view3d-editor-x').first()
  const distance = () =>
    page.evaluate(() => {
      const cam = (window as any).CTX.view3d.activeCamera
      return cam.pos.vectorDistance(cam.target)
    })
  const originalDistance = await distance()
  await viewport.getByRole('button', {name: 'Zoom in', exact: true}).click()
  await expect.poll(distance).toBeLessThan(originalDistance)
  await viewport.getByRole('button', {name: 'Zoom out', exact: true}).click()
  await expect.poll(distance).toBeCloseTo(originalDistance, 4)
  await viewport.getByRole('button', {name: 'View Z axis', exact: true}).click()
  await expect.poll(() => page.evaluate(() => (window as any).CTX.view3d.cameraMode)).toBe(1)
  await viewport.getByRole('button', {name: 'Toggle perspective / orthographic', exact: true}).click()
  await expect.poll(() => page.evaluate(() => (window as any).CTX.view3d.cameraMode)).toBe(0)
  await page.evaluate(() => {
    const w = window as any
    const mesh = w.CTX.object.data
    const draw = mesh.drawQGPU
    mesh.drawQGPU = function (...args: any[]) {
      w.__meshDraw = {wire: args[4], surface: args[7]}
      return draw.apply(this, args)
    }
  })
  for (const [mode, value] of [
    ['WIRE', 2],
    ['SOLID', 4],
    ['TEXTURED', 8],
  ] as const) {
    await viewport.locator(`iconcheck-x[datapath="view3d.drawmode[${mode}]"]`).click()
    await expect.poll(() => page.evaluate(() => (window as any).CTX.view3d.drawmode)).toBe(value)
    await expect
      .poll(() => page.evaluate(() => (window as any).__meshDraw))
      .toEqual({wire: mode === 'WIRE', surface: mode !== 'WIRE'})
  }
  const beforeHeaderScroll = await distance()
  await viewport.locator('dropbox-x[name="Object Mode"]').hover()
  await page.mouse.wheel(0, 120)
  await expect.poll(distance).toBeCloseTo(beforeHeaderScroll, 4)
  for (const mode of ['object', 'boxmodel', 'sculptcore']) {
    await page.evaluate((mode) => (window as any).CTX.scene.switchToolMode(mode), mode)
    await expect
      .poll(() => page.evaluate(() => (window as any).CTX.toolmode.constructor.toolModeDefine().name))
      .toBe(mode)
    const audit = await viewport.evaluate((viewport: any) => {
      const missing: string[] = []
      const walk = (root: any) => {
        for (const element of root.querySelectorAll('*')) {
          if (['ICONBUTTON-X', 'ICONCHECK-X'].includes(element.tagName) && element.getBoundingClientRect().width > 0) {
            if (!Number.isInteger(element.icon) || element.icon < 0)
              missing.push(element.getAttribute('datapath') ?? element.title)
          }
          if (element.shadowRoot) walk(element.shadowRoot)
        }
      }
      walk(viewport.shadowRoot)
      return {missing, height: viewport.header.getBoundingClientRect().height}
    })
    expect(audit.missing, `missing icons in ${mode}`).toEqual([])
    expect(audit.height).toBeLessThanOrEqual(32)
  }
  expect(errors).toEqual([])
})

test('object transforms accept numeric input and undo through the viewport', async ({page}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /\[(webgpu|webgl|overlay)\]|GPUValidationError/.test(message.text()))
      errors.push(message.text())
  })
  await page.goto('./?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).CTX?.scene)
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
  const viewport = page.locator('view3d-editor-x').first()
  const bounds = await viewport.boundingBox()
  await page.waitForFunction(() => !!(window as any).CTX.object)
  await page.evaluate(() => (window as any)._appstate.toolstack.idle())
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
  for (const {keys, field, expected} of [
    {keys: ['g', 'x', '2', 'Enter'], field: 'location', expected: 2},
    {keys: ['r', 'z', '9', '0', 'Enter'], field: 'rotationEuler', expected: Math.PI / 2},
    {keys: ['s', '2', 'Enter'], field: 'scale', expected: 2},
  ]) {
    await page.keyboard.press(keys[0])
    await expect.poll(() => page.evaluate(() => Boolean((window as any).CTX.state.modalFlag & 1))).toBe(true)
    for (const key of keys.slice(1)) await page.keyboard.press(key)
    const axis = field === 'rotationEuler' ? 2 : 0
    await expect
      .poll(() => page.evaluate(({field, axis}) => (window as any).CTX.object[field][axis], {field, axis}))
      .toBeCloseTo(expected, 3)
    await page.evaluate(() => (window as any)._appstate.toolstack.undo())
  }
  expect(errors).toEqual([])
  await page.evaluate(async () => {
    const w = window as any
    w.redraw_viewport(true)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await w.__webgpuDebug?.viewport?.gpu?.device?.queue?.onSubmittedWorkDone()
  })
  await page.screenshot({path: '/tmp/void-studio-viewport-after.png'})
})

test('mesh menu tools change topology and cancel or undo cleanly', async ({page}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /\[(webgpu|webgl|overlay)\]|GPUValidationError/.test(message.text()))
      errors.push(message.text())
  })
  await page.goto('./?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
  const viewport = page.locator('view3d-editor-x').first()
  const topology = () =>
    page.evaluate(() => {
      const mesh = (window as any).CTX.object.data.mesh
      return [mesh.v.count, mesh.f.count]
    })
  for (const [label, modal] of [
    ['Extrude Region', true],
    ['Extrude Individual', true],
    ['Extrude Edges', true],
    ['Split', true],
    ['Inset Faces', true],
    ['Bevel Vertices', true],
    ['Subdivide', false],
    ['Triangulate', false],
  ] as const) {
    const target = await page.evaluate(async () => {
      const ctx = (window as any).CTX
      await ctx.api.execTool(ctx, 'litemesh.add_cube(goalFaces=6)')
      ctx.scene.switchToolMode('boxmodel')
      ctx.toolmode.boxModelSelMode = 4 // face selection; selects one visible region below
      await ctx.api.execTool(ctx, 'litemesh.select_all(mode=NONE)')
      const point = ctx.object.location.copy()
      ctx.view3d.project(point)
      return [point[0], point[1]]
    })
    const bounds = await viewport.boundingBox()
    await page.mouse.click(bounds!.x + target[0], bounds!.y + target[1])
    await expect
      .poll(() => page.evaluate(() => (window as any).CTX.object.data.mesh.selectedCount(2)), {
        message: `select face for ${label}`,
      })
      .toBeGreaterThan(0)
    const before = await topology()
    await viewport.locator('dropbox-x[name="Mesh"]').click()
    await page.locator('menu-x').getByText(label, {exact: true}).click()
    await expect.poll(topology, {message: `${label} must change geometry`}).not.toEqual(before)
    if (modal) {
      await page.keyboard.press('Escape')
      // Blender extrusion keeps the new topology when only its move is cancelled.
      if (label.startsWith('Extrude') || label === 'Split')
        await page.evaluate(() => (window as any)._appstate.toolstack.undo())
    } else await page.evaluate(() => (window as any)._appstate.toolstack.undo())
    await expect.poll(topology, {message: `${label} must restore geometry`}).toEqual(before)
  }
  expect(errors).toEqual([])
})

test('LeafMesh wire shading uses its edge geometry without renderer errors', async ({page}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /\[(webgpu|webgl|overlay)\]|GPUValidationError/.test(message.text()))
      errors.push(message.text())
  })
  await page.goto('./?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
  await page.evaluate(async () => {
    const w = window as any,
      ctx = w.CTX
    await ctx.api.execTool(ctx, 'leafmesh.add_cube()')
    ctx.scene.switchToolMode('object')
    const mesh = ctx.object.data
    const draw = mesh.drawWireframeQ
    mesh.drawWireframeQ = function (...args: any[]) {
      w.__leafWireDraws = (w.__leafWireDraws ?? 0) + 1
      return draw.apply(this, args)
    }
    ctx.view3d.drawmode = 2
    w.redraw_viewport(true)
  })
  await expect.poll(() => page.evaluate(() => (window as any).__leafWireDraws ?? 0)).toBeGreaterThan(0)
  await page.evaluate(async () => {
    await (window as any).__webgpuDebug.device.queue.onSubmittedWorkDone()
  })
  expect(errors).toEqual([])
})
