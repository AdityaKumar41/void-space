import {expect, test} from '@playwright/test'

test('free deployment explains backend availability and round-trips a project locally', async ({page}) => {
  const apiRequests: string[] = []
  page.on('request', request => {
    if (request.url().includes('/studio/api/')) apiRequests.push(request.url())
  })
  await page.goto('./?renderer=webgpu')
  await page.waitForFunction(() => !!(window as any)._appstate?.screen, undefined, {timeout: 90_000})
  await expect(page.locator('.vsp__badge')).toHaveText('local editor')
  await page.locator('.vsp-trigger').click()
  await expect(page.getByText('Create in your browser')).toBeVisible()
  await expect(page.getByText(/unavailable on this free editor deployment/)).toBeVisible()

  const result = await page.evaluate(async () => {
    const app = (window as any)._appstate
    const scene = () => [...app.ctx.scene.objects].map((ob: any) => ({name: ob.name, type: ob.data?.constructor.name}))
    const before = scene()
    const file = app.createFile({save_screen: false, save_settings: false, save_library: true})
    await app.loadFileAsync(file, {reset_toolstack: true, load_screen: false, load_settings: false})
    return {before, after: scene(), size: file.byteLength}
  })
  expect(result.size).toBeGreaterThan(0)
  expect(result.before.length).toBeGreaterThan(0)
  expect(result.after).toEqual(result.before)
  expect(apiRequests).toEqual([])
})
