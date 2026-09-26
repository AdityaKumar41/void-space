/**
 * The VOID·SPACE panel (VS2-SRS-1.0 §3.5.2, FR-14.3, FR-15.2).
 *
 * What this is for: a Creator should be able to see, from inside the editor, *where*
 * their work goes when they publish and *what* the destination already holds — rather
 * than pressing a button and being told a status with no way to follow it. It is also
 * the honest place to show which half of the product is reachable, because "the editor
 * is up" and "the platform it publishes to is up" are different facts.
 *
 * Deliberately plain DOM rather than `path.ux` widgets, for two reasons: this is chrome
 * *around* the editor rather than a dockable editor panel, so it should not take part in
 * the screen layout the fork owns; and it keeps the feature out of the `path.ux` import
 * graph, so it cannot introduce a cycle or a boot-order dependency into a framework
 * this feature has no other business touching.
 *
 * Nothing here is authoritative. Every value is read from the Studio API, which is the
 * only component that talks to VOID·SPACE (§5.3) — the browser never holds a tenant
 * credential, which is why publishing is a server-side action and this panel can only
 * *report* it.
 */
import {VOID_STUDIO_PALETTE as p} from './theme.js'

/** The inputs the rule below reads, gathered into one shape so the rule is assertable on its own. */
export interface StudioApiUrlSource {
  /** The page's query string, e.g. `location.search`. */
  readonly search: string
  /** `location.protocol`, e.g. `'https:'`. */
  readonly protocol: string
  /** `location.origin`. */
  readonly origin: string
  /** An embedder's override, normally `window.VOID_STUDIO_API_URL`. */
  readonly override?: string
}

/**
 * Which Studio API base URL a page should use.
 *
 * The order is deliberate, and the third case is the one that is easy to get wrong:
 *
 *   1. `?studioApi=<origin>` — an explicit override for a capture, a test or a non-default setup.
 *   2. `window.VOID_STUDIO_API_URL` — the same override for an embedder that cannot change the URL.
 *   3. **Same origin, when the page is on https.** `docker/studio/nginx.conf` serves the editor and
 *      proxies `/studio/api/` on one origin, so under the Studio edge the API is already *here*. An
 *      absolute `http://localhost:4100` would instead be a cross-origin request to a port that
 *      deployment does not have, and mixed content on an https page.
 *   4. `http://localhost:4100` — the editor's own dev server (`pnpm studio:fork:dev`, port 5007),
 *      where the API really is a second process on its own port.
 *
 * Pure, and exported, so the rule can be asserted without a browser: jsdom makes `window.location`
 * unforgeable, which would otherwise leave case 3 untestable.
 */
export function studioApiBaseUrl(source: StudioApiUrlSource): string {
  const fromQuery = new URLSearchParams(source.search).get('studioApi')
  if (fromQuery) return stripTrailingSlashes(fromQuery)

  if (source.override) return stripTrailingSlashes(source.override)

  if (source.protocol === 'https:') return source.origin

  return 'http://localhost:4100'
}

/** A base copied out of an address bar usually ends in a slash; joining must not produce `//`. */
function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

/** Reads the current page for {@link studioApiBaseUrl}. */
function apiBaseUrl(): string {
  return studioApiBaseUrl({
    search  : location.search,
    protocol: location.protocol,
    origin  : location.origin,
    override: (window as unknown as {VOID_STUDIO_API_URL?: string}).VOID_STUDIO_API_URL,
  })
}

export interface BridgeStatus {
  readonly mode: 'mock' | 'live'
  readonly apiBaseUrl: string
  readonly links: {readonly consoleUrl: string; readonly catalogUrl: string}
  readonly publish: {
    readonly enabled: boolean
    readonly requirement: string | null
    /** FR-14.3 — how often to re-read a publish status. Absent from an older API means no polling. */
    readonly pollIntervalMs?: number
  }
  readonly catalog: {readonly publishedAssets: number; readonly categories: readonly string[]}
  readonly provenance: {
    readonly name: string
    readonly contractAddress: string | null
    readonly tokenId: string | null
    readonly txHash: string | null
    readonly ipfsCid: string | null
    readonly licenseType: string | null
    readonly url: string
  } | null
}

const STYLE_ID = 'void-space-panel-style'

/**
 * Whether this document already carries the panel's stylesheet.
 *
 * A module-level flag rather than a `document.getElementById(STYLE_ID)` probe, and the second
 * reason is a gate rather than a preference: `tests/unit/document_scope.test.ts` fails on *any*
 * `document.getElementById|querySelector*` call under `scripts/`, because the app is embeddable and
 * host code reaches its DOM through the instance it was handed, never through the document. So
 * every lookup below is made against the panel's own root element, and the elements it owns are
 * remembered here.
 */
let styleInjected = false

function injectStyles(): void {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .vsp {
      position: fixed;
      /*
       * Bottom-centre, deliberately not the bottom-right corner.
       *
       * The properties rail is the rightmost column of the editor and its category tabs run the full
       * height of it, so a fixed card in that corner covers the last two categories — including the
       * one the UI suite clicks by coordinate. Centred, just above the status bar, it covers empty
       * viewport instead of a control.
       */
      left: 50%;
      transform: translateX(-50%);
      bottom: 34px;
      width: 322px;
      z-index: 40;
      font: 400 12px/1.55 'Plus Jakarta Sans', system-ui, sans-serif;
      color: ${p.fg};
      background: ${p.surface2};
      border: 1px solid ${p.line};
      border-radius: 10px;
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55);
      overflow: hidden;
    }
    .vsp__bar {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 12px;
      background: ${p.surface3};
      border-bottom: 1px solid ${p.line};
      cursor: pointer; user-select: none;
    }
    .vsp__mark {
      width: 9px; height: 9px; border-radius: 2px;
      background: ${p.accent}; transform: rotate(45deg); flex: none;
    }
    .vsp__title {
      font-weight: 600; letter-spacing: 0.14em; font-size: 10px;
      text-transform: uppercase; flex: 1;
    }
    .vsp__badge {
      font: 600 9px/1 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.06em; padding: 3px 6px; border-radius: 4px;
      text-transform: uppercase; border: 1px solid ${p.line}; color: ${p.fgDim};
    }
    .vsp__badge--ok { color: ${p.accent}; border-color: ${p.accent}; }
    .vsp__badge--bad { color: #ff8a8a; border-color: #7a3535; }
    .vsp__body { padding: 10px 12px 12px; display: grid; gap: 9px; max-height: 62vh; overflow: auto; }
    .vsp[data-collapsed='true'] .vsp__body { display: none; }
    .vsp__row { display: flex; justify-content: space-between; gap: 10px; }
    .vsp__k { color: ${p.fgDim}; }
    .vsp__v { text-align: right; word-break: break-all; }
    .vsp__mono { font: 400 11px/1.5 'JetBrains Mono', ui-monospace, monospace; }
    .vsp__card {
      border: 1px solid ${p.line}; border-radius: 7px; padding: 8px 9px;
      background: ${p.surface}; display: grid; gap: 4px;
    }
    .vsp__name { font-weight: 600; font-size: 12px; }
    .vsp__links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
    a.vsp__link {
      color: ${p.accent}; text-decoration: none; border: 1px solid ${p.line};
      border-radius: 5px; padding: 3px 7px; font-size: 11px;
    }
    a.vsp__link:hover { border-color: ${p.accent}; }
    .vsp__note {
      color: ${p.fgDim}; font-size: 10.5px;
      border-left: 2px solid ${p.line}; padding-left: 7px;
    }
    .vsp__err { color: #ffb4b4; font-size: 11px; }
  `
  document.head.appendChild(style)
}

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c] as string)
}

/** A contract address or hash is unreadable in full; its ends are what identify it. */
function shorten(value: string, lead = 10, tail = 6): string {
  return value.length <= lead + tail + 1 ? value : `${value.slice(0, lead)}…${value.slice(-tail)}`
}

/**
 * The live panel, so a second mount replaces the first rather than stacking a second card in the
 * same corner.
 *
 * A hot-reloading dev server calls the shell's boot again on every save, and `init()` mounts the
 * panel unconditionally — appending blindly is what would leave three of them stacked.
 */
let panel: VoidSpacePanelHandle | undefined

/**
 * A mounted panel. Handed back so the shell (and a test) can refresh it or take it down again
 * without reaching into the document for an element by id.
 */
export interface VoidSpacePanelHandle {
  readonly element: HTMLElement
  /** Contacts the Studio API again and repaints. */
  refresh(): Promise<void>
  /** Removes the panel and its listeners. Safe to call twice. */
  unmount(): void
}

/**
 * Renders the panel and performs its first refresh. Safe to call before the Studio API is up: an
 * unreachable backend is rendered as a state rather than thrown, which is what lets the shipped
 * shell mount it unconditionally at boot.
 *
 * This is shell chrome, mounted by the shell (`scripts/entry_point.js`) and *not* by
 * `mountVoidStudio` — an embedder placing a second editor instance inside its own page must not
 * inherit a floating card it never asked for.
 */
export async function mountVoidSpacePanel(): Promise<VoidSpacePanelHandle> {
  panel?.unmount()

  injectStyles()

  const base = apiBaseUrl()
  const root = document.createElement('div')
  root.className = 'vsp'
  root.dataset.collapsed = 'false'
  root.innerHTML = `
    <div class="vsp__bar" role="button" tabindex="0" aria-expanded="true">
      <span class="vsp__mark"></span>
      <span class="vsp__title">VOID·SPACE</span>
      <span class="vsp__badge" data-role="badge">…</span>
    </div>
    <div class="vsp__body" data-role="body">
      <div class="vsp__note">Contacting the Studio API…</div>
    </div>
  `
  document.body.appendChild(root)

  const bar = root.querySelector('.vsp__bar') as HTMLElement
  const badge = root.querySelector('[data-role="badge"]') as HTMLElement
  const body = root.querySelector('[data-role="body"]') as HTMLElement

  bar.addEventListener('click', () => {
    const collapsed = root.dataset.collapsed === 'true'
    root.dataset.collapsed = collapsed ? 'false' : 'true'
    bar.setAttribute('aria-expanded', String(collapsed))
  })

  /**
   * The cadence to re-read at, until the API states one. Also the offline cadence, so an API that
   * is started after the editor is noticed without a reload.
   */
  const DEFAULT_POLL_MS = 30_000
  let pollMs = DEFAULT_POLL_MS
  let pollTimer: number | undefined

  /**
   * (Re)arms the refresh timer. One timer, replaced rather than added to, so a refresh that reports
   * a new cadence cannot leave the old one running — two timers reading the same endpoint, each
   * resetting nothing, is the shape of a leak that only shows up as somebody's bandwidth.
   */
  const armPoll = (intervalMs: number): void => {
    if (pollTimer !== undefined) {
      window.clearInterval(pollTimer)
    }
    pollTimer = intervalMs > 0 ? window.setInterval(() => void render(), intervalMs) : undefined
  }

  /**
   * Reads the two-platform link from the Studio API and paints it.
   *
   * Every value shown is the API's, never the browser's own guess: this panel holds no credential
   * and never contacts VOID·SPACE, because §5.3 leaves that crossing to the API alone.
   */
  const render = async (): Promise<void> => {
    let status: BridgeStatus | null = null
    let failure: string | null = null

    try {
      const response = await fetch(`${base}/studio/api/v1/voidspace/status`, {
        headers: {accept: 'application/json'},
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      status = (await response.json()) as BridgeStatus
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }

    if (!status) {
      badge.textContent = 'offline'
      badge.className = 'vsp__badge vsp__badge--bad'
      body.innerHTML = `
      <div class="vsp__err">The Studio API is not reachable.</div>
      <div class="vsp__row"><span class="vsp__k">Expected at</span><span class="vsp__v vsp__mono">${esc(base)}</span></div>
      <div class="vsp__row"><span class="vsp__k">Reason</span><span class="vsp__v">${esc(failure ?? 'unknown')}</span></div>
      <div class="vsp__note">
        Start it with <span class="vsp__mono">pnpm studio:api:dev</span>. The editor works without it —
        publishing is the part that needs the backend.
      </div>
    `
      // Keep polling while the API is unreachable. An API started a minute after the editor is the
      // normal case during development, and requiring a page reload to notice it is a worse answer
      // than one request every 30 seconds.
      armPoll(pollMs)
      return
    }

    /*
     * FR-14.3: the cadence is the API's to set, so a deployment can slow it down without shipping a
     * new bundle. Adopted only when it is a number, so an older API that does not send one leaves the
     * default in place rather than stopping the timer.
     */
    if (typeof status.publish.pollIntervalMs === 'number' && status.publish.pollIntervalMs > 0) {
      pollMs = status.publish.pollIntervalMs
    }
    armPoll(pollMs)

    badge.textContent = status.mode === 'live' ? 'linked' : 'sandbox'
    badge.className = `vsp__badge ${status.mode === 'live' ? 'vsp__badge--ok' : ''}`

    const prov = status.provenance
    body.innerHTML = `
    <div class="vsp__row"><span class="vsp__k">Platform</span><span class="vsp__v vsp__mono">${esc(status.apiBaseUrl)}</span></div>
    <div class="vsp__row"><span class="vsp__k">Published assets</span><span class="vsp__v">${status.catalog.publishedAssets}</span></div>
    ${
      status.catalog.categories.length > 0
        ? `<div class="vsp__row"><span class="vsp__k">Categories</span><span class="vsp__v">${esc(
            status.catalog.categories.join(', ')
          )}</span></div>`
        : ''
    }
    ${
      prov
        ? `
      <div class="vsp__card">
        <div class="vsp__name">${esc(prov.name)}</div>
        <div class="vsp__row"><span class="vsp__k">Token</span><span class="vsp__v">#${esc(prov.tokenId ?? '—')}</span></div>
        <div class="vsp__row"><span class="vsp__k">Licence</span><span class="vsp__v">${esc(prov.licenseType ?? '—')}</span></div>
        <div class="vsp__row"><span class="vsp__k">Contract</span><span class="vsp__v vsp__mono">${esc(shorten(prov.contractAddress ?? '—'))}</span></div>
        <div class="vsp__row"><span class="vsp__k">Tx</span><span class="vsp__v vsp__mono">${esc(shorten(prov.txHash ?? '—'))}</span></div>
        <div class="vsp__row"><span class="vsp__k">IPFS</span><span class="vsp__v vsp__mono">${esc(shorten(prov.ipfsCid ?? '—', 12, 6))}</span></div>
        <div class="vsp__links">
          <a class="vsp__link" href="${esc(prov.url)}" target="_blank" rel="noopener">Open asset ↗</a>
          <a class="vsp__link" href="${esc(status.links.consoleUrl)}" target="_blank" rel="noopener">Console ↗</a>
        </div>
      </div>`
        : ''
    }
    <div class="vsp__card">
      <div class="vsp__row">
        <span class="vsp__k">Publishing</span>
        <span class="vsp__v" style="color:${status.publish.enabled ? p.accent : p.fgDim}">
          ${status.publish.enabled ? 'enabled' : 'browse only'}
        </span>
      </div>
      <div class="vsp__note">${
        status.publish.requirement
          ? esc(status.publish.requirement)
          : 'Exports are validated and handed to VOID·SPACE by the Studio API — the tenant credential never reaches this page.'
      }</div>
    </div>
    <div class="vsp__links">
      <a class="vsp__link" href="${esc(status.links.catalogUrl)}" target="_blank" rel="noopener">Browse catalogue ↗</a>
    </div>
  `
  }

  await render()

  const handle: VoidSpacePanelHandle = {
    element: root,
    refresh: render,
    unmount(): void {
      // The timer reads the Studio API, so it outliving the panel would be a request made on behalf
      // of a card that no longer exists.
      if (pollTimer !== undefined) {
        window.clearInterval(pollTimer)
        pollTimer = undefined
      }
      root.remove()
      if (panel === handle) {
        panel = undefined
      }
    },
  }

  panel = handle
  return handle
}
