import {test, expect} from '@playwright/test'
test.beforeEach(async ({page}) => {
  await page.goto('./?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any).__webgpuDebug?.viewport)
})
test('native modifiers change vertices, toggle, apply, undo and survive project reload', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const result = await page.evaluate(async () => {
    const app = (window as any)._appstate
    let ctx = app.ctx
    await ctx.api.execTool(ctx, 'litemesh.add_cube()', {goalFaces: 6, size: 2})
    const base = Array.from(ctx.object.data.dumpVertCo().co.flat())
    await ctx.api.execTool(ctx, 'object.workflow(action=MOD_TWIST)')
    const bent = Array.from(ctx.object.data.dumpVertCo().co.flat()),
      state = JSON.parse(ctx.object.workflow)
    await ctx.api.execTool(ctx, 'object.workflow(action=MOD_TOGGLE)')
    const disabled = Array.from(ctx.object.data.dumpVertCo().co.flat())
    await ctx.api.execTool(ctx, 'object.workflow(action=MOD_TOGGLE)')
    const saved = app.createFile({
      save_screen  : false,
      save_settings: false,
      save_library : true,
    })
    await ctx.api.execTool(ctx, 'object.workflow(action=MOD_APPLY)')
    const applied = JSON.parse(ctx.object.workflow).modifiers.length
    await app.toolstack.undo()
    ctx = app.ctx
    const undone = JSON.parse(ctx.object.workflow).modifiers.length
    await app.loadFileAsync(saved, {
      load_screen  : false,
      load_settings: false,
      load_library : true,
    })
    ctx = app.ctx
    ctx.scene.changeTime(6)
    return {
      base,
      bent,
      disabled,
      applied,
      undone,
      count : JSON.parse(ctx.object.workflow).modifiers.length,
      loaded: Array.from(ctx.object.data.dumpVertCo().co.flat()),
      state,
    }
  })
  expect(result.bent).not.toEqual(result.base)
  expect(result.disabled).toEqual(result.base)
  expect(result.applied).toBe(0)
  expect(result.undone).toBe(1)
  expect(result.count).toBe(1)
  expect(result.loaded).toEqual(result.bent)
  expect(errors).toEqual([])
})
test('FK binding, pose keys, reset and unbind operate on the actual mesh', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const ctx = (window as any).CTX
    await ctx.api.execTool(ctx, 'litemesh.add_cube()', {goalFaces: 6, size: 2})
    const base = Array.from(ctx.object.data.dumpVertCo().co.flat())
    await ctx.api.execTool(ctx, 'object.workflow()', {
      action: 'RIG_CREATE',
      value : 2,
    })
    const rest = Array.from(ctx.object.data.dumpVertCo().co.flat())
    ctx.scene.changeTime(1)
    await ctx.api.execTool(ctx, 'object.workflow(action=KEY_INSERT)')
    ctx.scene.changeTime(11)
    await ctx.api.execTool(ctx, 'object.workflow()', {
      action: 'RIG_ROTATE',
      index : 0,
      axis  : 1,
      value : 90,
    })
    const posed = Array.from(ctx.object.data.dumpVertCo().co.flat())
    await ctx.api.execTool(ctx, 'object.workflow(action=KEY_INSERT)')
    ctx.scene.changeTime(6)
    const middle = Array.from(ctx.object.data.dumpVertCo().co.flat())
    const rig = JSON.parse(ctx.object.workflow).rig
    await ctx.api.execTool(ctx, 'object.workflow(action=RIG_RESET)')
    const reset = Array.from(ctx.object.data.dumpVertCo().co.flat())
    ctx.scene.changeTime(11)
    await ctx.api.execTool(ctx, 'object.workflow(action=RIG_UNBIND)')
    const unbound = Array.from(ctx.object.data.dumpVertCo().co.flat())
    return {
      base,
      rest,
      posed,
      middle,
      reset,
      unbound,
      rig,
      removed: !JSON.parse(ctx.object.workflow).rig,
    }
  })
  expect(result.rest).toEqual(result.base)
  expect(result.posed).not.toEqual(result.base)
  expect(result.middle).not.toEqual(result.posed)
  expect(result.middle).not.toEqual(result.base)
  expect(result.reset).toEqual(result.base)
  expect(result.unbound).toEqual(result.posed)
  expect(result.removed).toBe(true)
  expect(result.rig.bones.length).toBe(2)
})
test('transform keys interpolate, undo and play from the Animation workspace', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const app = (window as any)._appstate,
      ctx = app.ctx
    ctx.scene.changeTime(1)
    ctx.object.inputs.loc.getValue()[0] = 0
    await ctx.api.execTool(ctx, 'object.workflow(action=KEY_INSERT)')
    ctx.scene.changeTime(11)
    ctx.object.inputs.loc.getValue()[0] = 10
    await ctx.api.execTool(ctx, 'object.workflow(action=KEY_INSERT)')
    ctx.scene.changeTime(6)
    const linear = ctx.object.location[0]
    await ctx.api.execTool(ctx, 'object.workflow(action=CONSTANT)')
    const constant = ctx.object.location[0]
    await app.toolstack.undo()
    const fresh = app.ctx
    fresh.scene.changeTime(6)
    const undone = fresh.object.location[0]
    const lib = fresh.datalib.getLibrary('screen')
    app.switchScreen([...lib].find((s: any) => s.name === 'Animation'))
    app.ctx.scene.timeStart = 1
    app.ctx.scene.timeEnd = 11
    app.ctx.scene.changeTime(1)
    app.ctx.play()
    return {linear, constant, undone}
  })
  expect(result).toEqual({linear: 5, constant: 0, undone: 5})
  await expect(page.locator('timeline-editor-x')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window as any).CTX.scene.time))
    .toBeGreaterThan(1)
  await page.evaluate(() => (window as any).CTX.stop())
})
test('box physics bakes falling mesh onto a passive floor with undo', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const app = (window as any)._appstate,
      ctx = app.ctx
    await ctx.api.execTool(ctx, 'litemesh.add_cube()', {goalFaces: 6, size: 2})
    const actor = ctx.object
    actor.name = 'Falling'
    actor.inputs.loc.getValue()[2] = 5
    actor.graphUpdate()
    await ctx.api.execTool(ctx, 'object.workflow(action=BODY_ACTIVE)')
    await ctx.api.execTool(ctx, 'litemesh.add_cube()', {goalFaces: 6, size: 2})
    ctx.object.inputs.loc.getValue()[2] = -1
    ctx.object.inputs.scale.getValue().load([10, 10, 1])
    ctx.object.graphUpdate()
    await ctx.api.execTool(ctx, 'object.workflow(action=BODY_PASSIVE)')
    ;(window as any).updateDataGraph(true)
    ctx.scene.timeStart = 1
    ctx.scene.timeEnd = 90
    ctx.scene.fps = 24
    await ctx.api.execTool(ctx, 'scene.bake_box_physics()')
    ctx.scene.changeTime(90)
    const count = JSON.parse(actor.workflow).keys.length,
      z = actor.location[2]
    await app.toolstack.undo()
    const fresh = [...app.ctx.scene.objects].find(
      (o: any) => o.name === 'Falling'
    )
    return {count, z, undone: JSON.parse(fresh.workflow).keys.length}
  })
  expect(result.count).toBe(90)
  expect(result.z).toBeCloseTo(1, 2)
  expect(result.undone).toBe(0)
})

test('workflow property controls are usable and rigs persist in project files', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.evaluate(async () => {
    const ctx = (window as any).CTX
    await ctx.api.execTool(ctx, 'litemesh.add_cube()', {goalFaces: 6, size: 2})
  })
  const openCategory = async (name: string) => {
    const point = await page.evaluate((name) => {
      const find = (root: Document | ShadowRoot | Element): any => {
        for (const el of root.querySelectorAll('*')) {
          if (el.tagName.toLowerCase() === 'props-editor-x') return el
          if (el.shadowRoot) {
            const found = find(el.shadowRoot)
            if (found) return found
          }
        }
      }
      const tab = find(document).tabs.tbar.tabs.find(
        (tab: any) =>
          tab.tooltip === name || tab.tooltip?.startsWith(`${name} —`)
      )
      tab.scrollIntoView({block: 'nearest'})
      const r = tab.getBoundingClientRect()
      return {x: r.x + r.width / 2, y: r.y + r.height / 2}
    }, name)
    await page.mouse.click(point.x, point.y)
  }
  await openCategory('Modifiers')
  await page.getByRole('button', {name: 'Add Twist', exact: true}).click()
  await expect(
    page.getByRole('spinbutton', {name: 'Modifier 1 Amount', exact: true})
  ).toBeVisible()
  await page
    .getByRole('spinbutton', {name: 'Modifier 1 Amount', exact: true})
    .fill('0.5')
  await page
    .getByRole('spinbutton', {name: 'Modifier 1 Amount', exact: true})
    .press('Tab')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse((window as any).CTX.object.workflow).modifiers[0].amount
      )
    )
    .toBe(0.5)
  await openCategory('Rigging')
  await page.getByRole('button', {name: 'Bind 2-Bone Rig', exact: true}).click()
  await expect(
    page.getByRole('spinbutton', {name: 'Bone 1 Rotation Y', exact: true})
  ).toBeVisible()
  await page
    .getByRole('spinbutton', {name: 'Bone 1 Rotation Y', exact: true})
    .fill('30')
  await page
    .getByRole('spinbutton', {name: 'Bone 1 Rotation Y', exact: true})
    .press('Tab')
  await expect(
    page.locator('svg[aria-label="FK rig bones"] line').first()
  ).toBeAttached()
  const persisted = await page.evaluate(async () => {
    const app = (window as any)._appstate,
      ctx = app.ctx
    await ctx.api.execTool(ctx, 'object.workflow()', {action: 'KEY_INSERT'})
    await ctx.api.execTool(ctx, 'object.workflow()', {action: 'BODY_ACTIVE'})
    const before = ctx.object.workflow,
      coords = Array.from(ctx.object.data.dumpVertCo().co.flat())
    const file = app.createFile({
      save_screen  : false,
      save_settings: false,
      save_library : true,
    })
    await app.loadFileAsync(file, {
      load_screen  : false,
      load_settings: false,
      load_library : true,
    })
    app.ctx.scene.changeTime(app.ctx.scene.time)
    return {
      before,
      after: app.ctx.object.workflow,
      coords,
      loaded: Array.from(app.ctx.object.data.dumpVertCo().co.flat()),
    }
  })
  expect(persisted.after).toBe(persisted.before)
  expect(persisted.loaded).toEqual(persisted.coords)
  await openCategory('Physics')
  await expect(
    page.getByRole('spinbutton', {name: 'Mass', exact: true})
  ).toBeVisible()
  await page.evaluate(async () => {
    await (window as any).redraw_viewport_p(true)
    await (window as any).__webgpuDebug.device.queue.onSubmittedWorkDone()
  })
  // Chromium headless screenshots can omit the GPU canvas. Read the submitted
  // texture to verify that reload still produces an opaque rendered frame.
  const pixel = await page.evaluate(async () => {
    const w = window as any,
      debug = w.__webgpuDebug,
      device = debug.device
    w.CTX.view3d.viewportDraw()
    const texture = debug.gpu.canvasContext.getCurrentTexture()
    const buffer = device.createBuffer({size: 256, usage: 9}) // COPY_DST | MAP_READ
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer(
      {texture, origin: {x: 600, y: 500}},
      {buffer, bytesPerRow: 256},
      {width: 1, height: 1}
    )
    device.queue.submit([encoder.finish()])
    await buffer.mapAsync(1)
    const pixel = Array.from(
      new Uint8Array(buffer.getMappedRange()).slice(0, 4)
    )
    buffer.unmap()
    buffer.destroy()
    return pixel
  })
  expect(pixel[3]).toBe(255)
  expect(pixel.slice(0, 3).some((value) => value > 0)).toBe(true)
  await page.screenshot({path: '/tmp/void-studio-workflows.png'})
  expect(errors).toEqual([])
})

test('LeafMesh deformation stack evaluates and can return to mesh editing', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const app = (window as any)._appstate,
      ctx = app.ctx
    await ctx.api.execTool(ctx, 'leafmesh.add_cube()')
    const base = Array.from(ctx.object.data.extractTriangles().positions)
    await ctx.api.execTool(ctx, 'object.workflow()', {action: 'MOD_BEND'})
    await ctx.api.execTool(ctx, 'object.workflow()', {action: 'MOD_TAPER'})
    const forward = Array.from(ctx.object.data.extractTriangles().positions)
    await ctx.api.execTool(ctx, 'object.workflow()', {
      action: 'MOD_UP',
      index : 1,
    })
    const reversed = Array.from(ctx.object.data.extractTriangles().positions)
    await ctx.api.execTool(ctx, 'object.workflow()', {
      action: 'MOD_REMOVE',
      index : 1,
    })
    await ctx.api.execTool(ctx, 'object.workflow()', {
      action: 'MOD_REMOVE',
      index : 0,
    })
    const restored = Array.from(ctx.object.data.extractTriangles().positions)
    ctx.scene.switchToolMode('leafmesh')
    return {
      base,
      forward,
      reversed,
      restored,
      mode: ctx.toolmode.constructor.toolModeDefine().name,
    }
  })
  expect(result.forward).not.toEqual(result.base)
  expect(result.reversed).not.toEqual(result.forward)
  expect(result.restored).toEqual(result.base)
  expect(result.mode).toBe('leafmesh')
})
