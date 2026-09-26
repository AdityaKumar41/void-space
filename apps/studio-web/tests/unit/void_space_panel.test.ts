/**
 * The VOID·SPACE panel is the editor's half of the two-product link (§3.5.2): it shows *where* a
 * publish goes and *what* the destination already holds. The shipped shell mounts it at boot
 * (`scripts/entry_point.js`), so the failures worth pinning are the ones a boot would hit:
 *
 *   1. An unreachable Studio API has to render as a *state*, never throw. The shell mounts this
 *      without awaiting it and the boot-integrity e2e asserts on uncaught page errors, so a
 *      rejection here would be reported as a broken editor.
 *   2. The panel must contact the Studio API and nothing else. It holds no credential, and §5.3
 *      makes the API the single component permitted to talk to VOID·SPACE.
 *   3. A second mount must replace the first. `init()` runs again on every hot reload, and a card
 *      appended blindly would leave a stack of them in the same corner.
 */

import {mountVoidSpacePanel, studioApiBaseUrl} from '../../scripts/voidspace/bridge_panel'

/** What `GET /studio/api/v1/voidspace/status` answers with a live API and a populated catalogue. */
const STATUS = {
  mode      : 'live',
  apiBaseUrl: 'https://void.example',
  links     : {consoleUrl: 'https://void.example', catalogUrl: 'https://void.example/catalog'},
  reachable : true,
  publish   : {enabled: true, requirement: null},
  catalog   : {publishedAssets: 424242, categories: ['Environment', 'Prop']},
  provenance: {
    assetId        : 'asset-1',
    name           : 'Cargo Crate',
    contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
    tokenId        : '42',
    txHash         : '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    ipfsCid        : 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    licenseType    : 'Commercial',
    url            : 'https://void.example/catalog/asset-1',
  },
}

function respond(body: unknown): Response {
  return {ok: true, status: 200, json: async () => body} as unknown as Response
}

/** jsdom provides no `fetch`, so every test installs its own and this restores the previous one. */
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  // One test drives the poll timer with fake timers; leaving them installed would silently stop
  // every later suite's timers from firing.
  jest.useRealTimers()
})

test('paints the link and the provenance the Studio API reports', async () => {
  const calls: string[] = []
  globalThis.fetch = (async (url: unknown) => {
    calls.push(String(url))
    return respond(STATUS)
  }) as unknown as typeof fetch

  const panel = await mountVoidSpacePanel()

  const badge = panel.element.querySelector('[data-role="badge"]')
  expect(badge?.textContent).toBe('linked')

  const text = panel.element.textContent ?? ''
  expect(text).toContain('Cargo Crate')
  expect(text).toContain('Commercial')
  expect(text).toContain('424242')

  // The Studio API is the only origin contacted — never VOID·SPACE itself.
  expect(calls).toEqual(['http://localhost:4100/studio/api/v1/voidspace/status'])

  panel.unmount()
  expect(document.body.contains(panel.element)).toBe(false)
})

test('chooses the Studio API base URL from the page it finds itself on', () => {
  /*
   * The rule, in priority order. Case 3 is the one that matters for a deployment: under the Studio
   * edge (`docker/studio/nginx.conf`) the editor and `/studio/api/` share an origin, so reaching for a
   * hardcoded localhost port there would be a cross-origin request to a port that does not exist.
   *
   * Asserted on the pure function rather than through the DOM, because jsdom makes `window.location`
   * unforgeable and the https case would otherwise be untestable.
   */
  const page = {search: '', protocol: 'http:', origin: 'http://localhost:5007'}

  // 1. An explicit query override wins, and its trailing slash is trimmed so joining cannot yield `//`.
  expect(studioApiBaseUrl({...page, search: '?studioApi=https://api.example/'})).toBe('https://api.example')

  // 2. An embedder's global override, for a page that cannot change its own URL.
  expect(studioApiBaseUrl({...page, override: 'https://embedded.example'})).toBe('https://embedded.example')

  // 3. Same origin when the page is on https — the case that makes the containerized edge work with
  // no configuration at all.
  expect(studioApiBaseUrl({search: '', protocol: 'https:', origin: 'https://localhost:8443'})).toBe(
    'https://localhost:8443'
  )

  // 4. Otherwise the editor's dev server, where the API genuinely is a second process on its own port.
  expect(studioApiBaseUrl(page)).toBe('http://localhost:4100')

  // An empty override is absent, not a base URL of ''.
  expect(studioApiBaseUrl({...page, override: ''})).toBe('http://localhost:4100')
})

test('an unreachable Studio API is a rendered state, not a rejection', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch')
  }) as unknown as typeof fetch

  const panel = await mountVoidSpacePanel()

  expect(panel.element.querySelector('[data-role="badge"]')?.textContent).toBe('offline')
  expect(panel.element.textContent).toContain('The Studio API is not reachable')
  // The remedy is named, because "offline" without it is a dead end for whoever is looking at it.
  expect(panel.element.textContent).toContain('pnpm studio:api:dev')

  panel.unmount()
})

test('a second mount replaces the first rather than stacking a card', async () => {
  globalThis.fetch = (async () => respond(STATUS)) as unknown as typeof fetch

  const first = await mountVoidSpacePanel()
  const second = await mountVoidSpacePanel()

  expect(document.querySelectorAll('.vsp')).toHaveLength(1)
  expect(second.element).not.toBe(first.element)

  second.unmount()
})

test('refresh re-reads the API and repaints', async () => {
  let published = 1
  globalThis.fetch = (async () =>
    respond({...STATUS, catalog: {publishedAssets: published, categories: []}})) as unknown as typeof fetch

  const panel = await mountVoidSpacePanel()
  expect(panel.element.textContent).not.toContain('424242')

  published = 424242
  await panel.refresh()

  expect(panel.element.textContent).toContain('424242')
  panel.unmount()
})

test('polls on the cadence the Studio API reports, and stops when unmounted', async () => {
  jest.useFakeTimers()

  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return respond({...STATUS, publish: {enabled: true, requirement: null, pollIntervalMs: 1000}})
  }) as unknown as typeof fetch

  const panel = await mountVoidSpacePanel()
  // The first read happens during the mount, not on the timer.
  expect(calls).toBe(1)

  await jest.advanceTimersByTimeAsync(3000)
  // The reported 1000 ms cadence must have been adopted: three ticks on top of the mount read.
  expect(calls).toBe(4)

  // A timer that outlives its panel keeps reading on behalf of a card that is gone.
  panel.unmount()
  await jest.advanceTimersByTimeAsync(5000)
  expect(calls).toBe(4)
})

test('keeps polling while the API is unreachable, so starting it needs no reload', async () => {
  jest.useFakeTimers()

  let fail = true
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    if (fail) throw new TypeError('Failed to fetch')
    return respond(STATUS)
  }) as unknown as typeof fetch

  const panel = await mountVoidSpacePanel()
  expect(panel.element.querySelector('[data-role="badge"]')?.textContent).toBe('offline')

  // The API comes up, and the panel notices on its own next read.
  fail = false
  await jest.advanceTimersByTimeAsync(30_000)

  expect(calls).toBeGreaterThan(1)
  expect(panel.element.querySelector('[data-role="badge"]')?.textContent).toBe('linked')

  panel.unmount()
})
