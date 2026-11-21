import {expect, test} from '@playwright/test'
test.beforeEach(async ({page}) => {
  await page.goto('/?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
})
test('viewport middle drag orbits, Shift-middle pans and wheel zooms over the scene', async ({
  page,
}) => {
  const view = page.locator('view3d-editor-x').first(),
    box = (await view.boundingBox())!
  const camera = () =>
    page.evaluate(() => Array.from((window as any).CTX.view3d.camera.pos))
  const before = await camera()
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.6)
  await page.mouse.down({button: 'middle'})
  await page.mouse.move(
    box.x + box.width * 0.65 + 110,
    box.y + box.height * 0.6 + 55,
    {steps: 12}
  )
  await page.mouse.up({button: 'middle'})
  await expect.poll(camera).not.toEqual(before)
  const target = () =>
    page.evaluate(() => Array.from((window as any).CTX.view3d.camera.target))
  const beforePan = await target()
  await page.keyboard.down('Shift')
  await page.mouse.down({button: 'middle'})
  await page.mouse.move(
    box.x + box.width * 0.65 + 160,
    box.y + box.height * 0.6 + 80,
    {steps: 10}
  )
  await page.mouse.up({button: 'middle'})
  await page.keyboard.up('Shift')
  await expect.poll(target).not.toEqual(beforePan)
  const panned = await camera()
  await page.mouse.wheel(0, 160)
  await expect.poll(camera).not.toEqual(panned)
})
test('viewport clicks deselect empty space and select the visible cube', async ({
  page,
}) => {
  const view = page.locator('view3d-editor-x').first(),
    box = (await view.boundingBox())!
  const selected = () =>
    page.evaluate(() =>
      [...(window as any).CTX.scene.objects.selected].map((o: any) => o.name)
    )
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.75)
  await expect.poll(selected).toEqual([])
  const center = await page.evaluate(() => {
    const ctx = (window as any).CTX,
      p = ctx.object?.location.copy() ?? ctx.scene.objects[0].location.copy()
    ctx.view3d.project(p)
    return [p[0], p[1]]
  })
  await page.mouse.click(box.x + center[0], box.y + center[1] + 40)
  await expect.poll(selected, {timeout: 5000}).toContain('Cube')
})

test('dragging the rendered move handle transforms the selected object and undoes', async ({
  page,
}) => {
  const view = page.locator('view3d-editor-x').first(),
    box = (await view.boundingBox())!
  await page.waitForFunction(
    () => !!(window as any).CTX.toolmode.transWidget?.axes
  )
  const point = await page.evaluate(() => {
    const ctx = (window as any).CTX,
      root = ctx.toolmode.transWidget,
      axis = root.axes[0]
    const mat = root.matrix
      .copy()
      .scale(root.wscale, root.wscale, root.wscale)
      .multiply(axis.matrix)
    const p = ctx.object.location.copy().load([0, 0, 0.8])
    p.multVecMatrix(mat)
    ctx.view3d.project(p)
    return [p[0], p[1]]
  })
  const location = () =>
    page.evaluate(() => Array.from((window as any).CTX.object.location))
  const before = await location()
  await page.mouse.move(box.x + point[0], box.y + point[1])
  await page.mouse.down()
  await page.mouse.move(box.x + point[0] + 100, box.y + point[1] + 40, {
    steps: 12,
  })
  await page.mouse.up()
  await expect.poll(location, {timeout: 5000}).not.toEqual(before)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(location).toEqual(before)
})

test('moving across empty viewport space avoids redundant render requests', async ({
  page,
}) => {
  const view = page.locator('view3d-editor-x').first(),
    box = (await view.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.75)
  await page.evaluate(() => {
    const w = window as any,
      original = w.redraw_viewport
    w.__hoverRedraws = 0
    w.redraw_viewport = (...args: any[]) => {
      w.__hoverRedraws++
      return original(...args)
    }
  })
  for (let i = 0; i < 12; i++)
    await page.mouse.move(
      box.x + box.width * 0.8 + i * 2,
      box.y + box.height * 0.75 + i
    )
  const count = await page.evaluate(() => (window as any).__hoverRedraws)
  expect(count).toBeLessThan(5)
})

test('Edit Mode move handle edits mesh coordinates instead of moving the object', async ({
  page,
}) => {
  const view = page.locator('view3d-editor-x').first(),
    box = (await view.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await page.keyboard.press('Tab')
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).CTX.toolmode.constructor.toolModeDefine().name
      )
    )
    .toBe('boxmodel')
  await page.keyboard.press('a')
  await view
    .locator('iconcheck-x[datapath="scene.tool.transformWidget[translate]"]')
    .first()
    .click()
  await page.waitForFunction(
    () => !!(window as any).CTX.toolmode.transWidget?.axes
  )
  const before = await page.evaluate(() => {
    const ctx = (window as any).CTX
    return {
      location   : Array.from(ctx.object.location),
      coordinates: ctx.object.data.dumpVertCo().co.flat(),
    }
  })
  const point = await page.evaluate(() => {
    const ctx = (window as any).CTX,
      root = ctx.toolmode.transWidget
    const mat = root.matrix
      .copy()
      .scale(root.wscale, root.wscale, root.wscale)
      .multiply(root.axes[0].matrix)
    const p = ctx.object.location.copy().load([0, 0, 0.8])
    p.multVecMatrix(mat)
    ctx.view3d.project(p)
    return [p[0], p[1]]
  })
  await page.mouse.move(box.x + point[0], box.y + point[1])
  await page.mouse.down()
  await page.mouse.move(box.x + point[0] + 100, box.y + point[1] + 40, {
    steps: 12,
  })
  await page.mouse.up()
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as any).CTX.object.data.dumpVertCo().co.flat()
        ),
      {timeout: 5000}
    )
    .not.toEqual(before.coordinates)
  expect(
    await page.evaluate(() => Array.from((window as any).CTX.object.location))
  ).toEqual(before.location)
})

for (const kind of ['litemesh', 'leafmesh'])
  test(`${kind} Edit Mode transforms follow world axes on rotated objects`, async ({
    page,
  }) => {
    await page.evaluate(async (kind) => {
      const ctx = (window as any).CTX
      await ctx.api.execTool(ctx, `${kind}.add_cube()`)
      ctx.scene.switchToolMode('object')
      ctx.object.inputs.loc.getValue().load([3, 0, 0])
      ctx.object.inputs.rot.getValue().load([0, 0, Math.PI / 2])
      ctx.object.graphUpdate()
      ;(window as any).updateDataGraph(true)
    }, kind)
    const view = page.locator('view3d-editor-x').first(),
      box = (await view.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
    for (const key of ['Tab', 'Alt+a', 'a']) await page.keyboard.press(key)
    const before = await page.evaluate(() => {
      const ctx = (window as any).CTX
      ;(window as any).updateDataGraph(true)
      const positions = Array.from(
          ctx.object.data.extractTriangles().positions
        ) as number[],
        matrix = ctx.object.outputs.matrix.getValue(),
        p = ctx.object.location.copy()
      return positions.reduce((out: number[], _, i) => {
        if (i % 3) return out
        p.load(positions.slice(i, i + 3))
        p.multVecMatrix(matrix)
        out.push(...p)
        return out
      }, [])
    })
    for (const key of ['g', 'x', '1', 'Enter']) await page.keyboard.press(key)
    const after = await page.evaluate(() => {
      const ctx = (window as any).CTX
      ;(window as any).updateDataGraph(true)
      const positions = Array.from(
          ctx.object.data.extractTriangles().positions
        ) as number[],
        matrix = ctx.object.outputs.matrix.getValue(),
        p = ctx.object.location.copy()
      return positions.reduce((out: number[], _, i) => {
        if (i % 3) return out
        p.load(positions.slice(i, i + 3))
        p.multVecMatrix(matrix)
        out.push(...p)
        return out
      }, [])
    })
    expect(before.length).toBeGreaterThan(0)
    after.forEach((value, i) =>
      expect(value - before[i]).toBeCloseTo(i % 3 === 0 ? 1 : 0, 3)
    )
    expect(
      await page.evaluate(() => Array.from((window as any).CTX.object.location))
    ).toEqual([3, 0, 0])
  })

test('Delete with an empty selection preserves the unselected active object', async ({
  page,
}) => {
  const view = page.locator('view3d-editor-x').first(),
    box = (await view.boundingBox())!
  const count = await page.evaluate(
    () => (window as any).CTX.scene.objects.length
  )
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.75)
  await expect
    .poll(() =>
      page.evaluate(() => [...(window as any).CTX.selectedObjects].length)
    )
    .toBe(0)
  await page.keyboard.press('Delete')
  await page.evaluate(() => (window as any)._appstate.toolstack.idle())
  await expect
    .poll(() => page.evaluate(() => (window as any).CTX.scene.objects.length), {
      timeout: 3000,
    })
    .toBe(count)
})
