import {expect, test} from '@playwright/test'

async function boot(page: any, hash = '') {
  await page.goto(`./?renderer=webgpu&voidspacePanel=0${hash}`)
  await page.waitForFunction(() => !!(window as any)._appstate?.screen && !!(window as any)._appstate?.ctx?.scene)
}

test('Sketchfab menu validates model links, previews, imports with attribution and round-trips undo/save', async ({page}) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await boot(page)
  await page.locator('dropbox-x[name="File"]').click()
  await page.locator('menu-x').getByText('Sketchfab Models...', {exact: true}).click()
  const dialog = page.getByRole('dialog', {name: 'Sketchfab models', exact: true})
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', {name: 'Model link or ID'}).fill('https://evil.example/models/0123456789abcdef0123456789abcdef')
  await dialog.getByRole('button', {name: 'Preview model', exact: true}).click()
  await expect(dialog.getByRole('status')).toContainText('Use a full Sketchfab model link')
  await expect(dialog.locator('iframe')).toHaveCount(0)
  await dialog.getByRole('textbox', {name: 'Model link or ID'}).fill('https://sketchfab.com/3d-models/test-0123456789abcdef0123456789abcdef')
  await dialog.getByRole('button', {name: 'Preview model', exact: true}).click()
  await expect(dialog.locator('iframe')).toHaveAttribute('src', /sketchfab.com\/models\/0123456789abcdef0123456789abcdef\/embed/)
  await expect(dialog.locator('iframe')).toHaveAttribute('credentialless', '')
  const payload = await page.evaluate(async () => {
    const app = (window as any)._appstate
    // Native exporter produces real geometry for the importer, without relying on a provider account.
    const formats = await import(new URL('build/addons/leafmesh/src/main.js', document.baseURI).href)
    const format = formats.LEAFMESH_GLB_FORMAT
    const data = format.exportToBytes!(app.ctx)
    return {bytes: [...new Uint8Array(data as ArrayBuffer)], count: [...app.ctx.scene.objects].length}
  })
  const credit = 'Test cube by QA author · CC0 · https://sketchfab.com/3d-models/0123456789abcdef0123456789abcdef'
  await dialog.getByRole('textbox', {name: 'Credit and license to keep with this import'}).fill(credit)
  await dialog.locator('input[type="file"]').setInputFiles({name: 'test.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(payload.bytes)})
  await expect(dialog.getByRole('status')).toContainText('Model imported into the scene')
  const count = () => page.evaluate(() => [...(window as any)._appstate.ctx.scene.objects].length)
  await expect.poll(count).toBeGreaterThan(payload.count)
  const imported = await count()
  expect(await page.evaluate(() => [...(window as any)._appstate.ctx.scene.objects].flatMap((ob: any) => ob.workflow ? [JSON.parse(ob.workflow).sourceAttribution].filter(Boolean) : []))).toContain(credit)
  await page.evaluate(() => (window as any)._appstate.toolstack.undo())
  await expect.poll(count).toBe(payload.count)
  await page.evaluate(() => (window as any)._appstate.toolstack.redo())
  await expect.poll(count).toBe(imported)
  const credits = await page.evaluate(async () => {
    const app = (window as any)._appstate
    const file = app.createFile({save_screen: false, save_settings: false, save_library: true})
    await app.loadFileAsync(file, {reset_toolstack: true, load_screen: false, load_settings: false})
    return [...app.ctx.scene.objects].flatMap((ob: any) => ob.workflow ? [JSON.parse(ob.workflow).sourceAttribution].filter(Boolean) : [])
  })
  expect(credits).toContain(credit)
  await dialog.getByRole('button', {name: 'Close Sketchfab'}).click()
  await expect(dialog).toHaveCount(0)
  expect(errors).toEqual([])
})

test('single-use Space handoff removes its ticket from the URL and imports only after confirmation', async ({page, baseURL}) => {
  const ticket = 'a'.repeat(64)
  const hash = '#' + new URLSearchParams({sketchfabTransfer: ticket, sketchfabApi: 'https://void-space.invalid/api/v1', sketchfabCredit: 'Creator · CC BY · Sketchfab'}).toString()
  let received = 0
  await page.context().route('**/api/v1/tools/sketchfab/receive', async route => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({status: 204, headers: {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'}})
      return
    }
    received++
    expect(route.request().postDataJSON()).toEqual({ticket})
    await route.fulfill({status: 403, headers: {'Access-Control-Allow-Origin': '*'}, contentType: 'application/json', body: JSON.stringify({message: 'Expired'})})
  })
  await boot(page, hash)
  const dialog = page.getByRole('dialog', {name: 'Sketchfab models', exact: true})
  await expect(dialog).toBeVisible()
  expect(page.url()).not.toContain(ticket)
  expect(received).toBe(0)
  await dialog.getByRole('button', {name: 'Import linked model from https://void-space.invalid'}).click()
  await expect(dialog.getByRole('status')).toContainText('failed or expired')
  // Pages isolation uses a service worker; a worker-owned fetch may bypass routing.
  // The local regression verifies HTTP rejection; the live check also verifies actionable network failure.
  if (baseURL?.startsWith('http:')) expect(received).toBe(1)
})
