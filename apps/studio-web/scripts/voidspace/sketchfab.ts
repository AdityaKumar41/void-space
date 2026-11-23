import {ToolOp, UndoFlags} from '../path.ux/pathux.js'
import {getAppState} from '../core/app_instance.js'
import {getFileFormat} from '../core/file_formats.js'
import {readWorkflow, writeWorkflow} from '../core/object_workflows.js'
import addonManager from '../addon/addon.js'
import {sketchfabModelId, sketchfabEmbedUrl} from '../../../../packages/types/src/sketchfab.js'

export function spaceModelUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) return null
    return `${url.origin}/console/models`
  } catch { return null }
}

export class SketchfabImportOp extends ToolOp {
  bytes?: Uint8Array
  credit = ''
  static tooldef() { return {uiname: 'Import Sketchfab model', toolpath: 'voidspace.sketchfab_import', inputs: {}, outputs: {}} }
  exec(ctx: any) {
    if (!this.bytes) throw new Error('Choose a downloaded GLB model first.')
    if (!addonManager.isEnabled('leafmesh')) addonManager.enable('leafmesh')
    const format = getFileFormat('glb')
    if (!format?.importFromBytes) throw new Error('The GLB importer is not ready.')
    const before = new Set(ctx.scene.objects)
    format.importFromBytes(ctx, this.bytes, 'sketchfab-model.glb')
    for (const object of ctx.scene.objects) {
      if (before.has(object)) continue
      const workflow = readWorkflow(object.workflow)
      object.workflow = writeWorkflow({...workflow, sourceAttribution: this.credit})
    }
    ;(window as any).redraw_viewport?.(true)
  }
  override redo(_ctx: any) { this._was_redo = true; this.exec(getAppState().ctx) }
}
ToolOp.register(SketchfabImportOp)

export interface SketchfabTransfer {ticket: string; api: string; credit: string}
export function sketchfabTransferFromHash(hash: string): SketchfabTransfer | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const ticket = params.get('sketchfabTransfer') ?? ''
  const api = params.get('sketchfabApi') ?? ''
  const credit = (params.get('sketchfabCredit') ?? '').slice(0, 2000)
  if (!/^[a-f0-9]{64}$/.test(ticket) || !credit) return null
  try {
    const url = new URL(api)
    if (!spaceModelUrl(api) || url.pathname !== '/api/v1' || url.search || url.hash) return null
    return {ticket, api: url.toString(), credit}
  } catch { return null }
}

async function importGlb(bytes: Uint8Array, credit: string) {
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== 'glTF') throw new Error('Choose a GLB file. A ZIP download must first be converted or imported as glTF with its resources.')
  const op = new SketchfabImportOp(); op.bytes = bytes; op.credit = credit
  await getAppState().ctx.toolstack.execTool(getAppState().ctx, op)
}

export function receiveSketchfabTransfer() {
  const transfer = sketchfabTransferFromHash(location.hash)
  if (!transfer) return
  // Keep capability tickets out of history, screenshots and any subsequent copied URL.
  const params = new URLSearchParams(location.hash.slice(1))
  for (const key of ['sketchfabTransfer', 'sketchfabApi', 'sketchfabCredit']) params.delete(key)
  history.replaceState(null, '', location.pathname + location.search + (params.size ? '#' + params.toString() : ''))
  openSketchfabDialog(transfer)
}

export function openSketchfabDialog(transfer?: SketchfabTransfer) {
  const existing = document.getElementById('void-sketchfab-dialog') as HTMLDialogElement | null
  if (existing) { existing.focus(); return }
  const dialog = document.createElement('dialog')
  dialog.id = 'void-sketchfab-dialog'
  dialog.setAttribute('aria-label', 'Sketchfab models')
  dialog.style.cssText = 'width:min(880px,94vw);max-height:90vh;overflow:auto;background:#232529;color:#eee;border:1px solid #555;border-radius:8px;padding:20px;font:14px system-ui;box-sizing:border-box'
  // All provider/user values below are assigned as text or checked URLs, never interpolated HTML.
  dialog.innerHTML = `<form method="dialog" style="display:flex;justify-content:space-between;align-items:center;gap:16px"><h2 style="margin:0;font-size:20px">Sketchfab models</h2><button aria-label="Close Sketchfab" autofocus>Close</button></form>
    <p>Preview a shared model, then import a permitted GLB download to edit it. Author credit is saved with imported objects.</p>
    <form data-role="preview-form" style="display:flex;gap:8px;flex-wrap:wrap"><label style="flex:1;min-width:240px">Model link or ID<input data-role="link" style="display:block;width:100%;box-sizing:border-box" placeholder="https://sketchfab.com/3d-models/…" maxlength="1000"></label><button type="submit">Preview model</button></form>
    <div data-role="viewer" style="margin:12px 0"></div><a data-role="original" target="_blank" rel="noopener noreferrer" hidden>Original model, author and license</a>
    <p>Editable downloads require your own Sketchfab account and the author’s permission. When account connection is configured, use Void Space to download an editable GLB. You can also download a permitted GLB from Sketchfab directly.</p>
    <label style="display:block">Void Space website<input data-role="space" placeholder="https://your-void-space.example" style="display:block;width:100%;box-sizing:border-box"></label><button data-role="open-space" type="button" style="margin-top:8px">Open model search and account connection</button>
    <hr style="margin:16px 0;border-color:#555"><label style="display:block">Credit and license to keep with this import<textarea data-role="credit" rows="2" maxlength="2000" style="display:block;width:100%;box-sizing:border-box" placeholder="Model name — author — license — original Sketchfab URL"></textarea></label>
    <label style="display:block;margin-top:12px">Import downloaded editable GLB<input data-role="file" type="file" accept=".glb,model/gltf-binary" style="display:block;margin-top:6px"></label>
    <p data-role="status" role="status" style="white-space:pre-wrap"></p>`
  for (const field of dialog.querySelectorAll<HTMLElement>('button,input,textarea')) field.style.cssText += ';background:#33363b;color:#fff;border:1px solid #666;border-radius:4px;padding:8px;font:inherit'
  for (const anchor of dialog.querySelectorAll<HTMLAnchorElement>('a')) anchor.style.cssText = 'color:#a8ceff;text-decoration:underline;display:inline-block;margin:4px 0'
  const link = dialog.querySelector<HTMLInputElement>('[data-role="link"]')!
  const credit = dialog.querySelector<HTMLTextAreaElement>('[data-role="credit"]')!
  const status = dialog.querySelector<HTMLElement>('[data-role="status"]')!
  const space = dialog.querySelector<HTMLInputElement>('[data-role="space"]')!
  try { const saved = readWorkflow(getAppState().ctx.scene?.objects?.active?.workflow).sourceAttribution; if (saved) credit.value = saved } catch {}
  try { space.value = localStorage.getItem('void_space_web_origin') ?? (location.hostname === 'localhost' ? 'http://localhost:3000' : '') } catch {}
  dialog.querySelector('[data-role="preview-form"]')!.addEventListener('submit', event => {
    event.preventDefault()
    const uid = sketchfabModelId(link.value)
    if (!uid) { status.textContent = 'Use a full Sketchfab model link or its 32-character ID. Short links and other websites are not supported.'; return }
    const viewer = dialog.querySelector('[data-role="viewer"]')!
    const iframe = document.createElement('iframe')
    iframe.title = 'Interactive Sketchfab model preview'
    // Isolated Studio pages require credentialless embeds; Sketchfab login happens in its own window.
    ;(iframe as HTMLIFrameElement & {credentialless: boolean}).credentialless = true
    iframe.src = sketchfabEmbedUrl(uid)
    iframe.allowFullscreen = true
    iframe.allow = 'fullscreen; xr-spatial-tracking'
    iframe.style.cssText = 'width:100%;height:380px;max-height:50vh;border:0'
    viewer.replaceChildren(iframe)
    const original = dialog.querySelector<HTMLAnchorElement>('[data-role="original"]')!
    original.href = `https://sketchfab.com/3d-models/${uid}`; original.hidden = false
    if (!credit.value.trim() || credit.value.includes('Add the model name, author and license before import.')) credit.value = `Source: ${original.href}. Add the model name, author and license before import.`
    status.textContent = 'Drag to orbit and scroll to zoom. If the embedded viewer cannot load, open the original model link.'
  })
  dialog.querySelector('[data-role="open-space"]')!.addEventListener('click', () => {
    const url = spaceModelUrl(space.value)
    if (!url) { status.textContent = 'Enter your Void Space HTTPS website, or http://localhost:3000 for local development. The public Studio does not include a hosted Space backend.'; return }
    try { localStorage.setItem('void_space_web_origin', new URL(url).origin) } catch {}
    window.open(url, '_blank', 'noopener,noreferrer')
  })
  const file = dialog.querySelector<HTMLInputElement>('[data-role="file"]')!
  file.addEventListener('change', async () => {
    const selected = file.files?.[0]
    if (!selected) return
    file.disabled = true
    try {
      if (!credit.value.trim() || credit.value.includes('Add the model name, author and license before import.')) throw new Error('Add the model name, author, license and original link before importing.')
      if (selected.size > 200 * 1024 * 1024) throw new Error('Model exceeds the 200 MB import limit.')
      const bytes = new Uint8Array(await selected.arrayBuffer())
      await importGlb(bytes, credit.value.trim())
      status.textContent = 'Model imported into the scene. Undo restores the previous scene. Attribution is saved on each imported object.'
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Model import failed.' }
    finally { file.disabled = false; file.value = '' }
  })
  if (transfer) {
    credit.value = transfer.credit
    const action = document.createElement('button')
    action.textContent = `Import linked model from ${new URL(transfer.api).origin}`
    action.type = 'button'
    action.style.cssText = 'background:#394b67;color:white;border:1px solid #91a5c5;border-radius:4px;padding:10px;font:inherit'
    file.parentElement!.before(action)
    status.textContent = 'Void Space prepared a single-use model import. Review the source and credit, then import. The link expires after five minutes.'
    action.addEventListener('click', async () => {
      action.disabled = true; file.disabled = true
      try {
        status.textContent = 'Downloading and preparing the linked model…'
        const response = await fetch(`${transfer.api}/tools/sketchfab/receive`, {method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ticket: transfer.ticket}), signal: AbortSignal.timeout(120000)})
        if (!response.ok || !response.body) throw new Error('The transfer failed or expired. Open Void Space and start a fresh import. Its server must allow this Studio origin in CORS_ORIGINS.')
        const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
        try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 200 * 1024 * 1024) throw new Error('Model exceeds the 200 MB import limit.'); chunks.push(part.value) } } finally { await reader.cancel() }
        const bytes = new Uint8Array(size); let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
        await importGlb(bytes, credit.value.trim() || transfer.credit)
        status.textContent = 'Linked model imported. Attribution is saved with its objects. Undo restores the previous scene.'
        action.remove()
      } catch (error) {
        status.textContent = error instanceof TypeError
          ? 'The model transfer failed or expired because Void Space could not be reached. Open Void Space and start a fresh import. The API must use reachable HTTPS and allow this Studio origin in CORS_ORIGINS.'
          : error instanceof Error ? error.message : 'Linked model import failed. Open Void Space and start a fresh import.'
      }
      finally { file.disabled = false }
    })
  }
  const previous = document.activeElement as HTMLElement | null
  dialog.addEventListener('close', () => { dialog.remove(); previous?.focus() }, {once: true})
  document.body.append(dialog); dialog.showModal()
}

class SketchfabDialogOp extends ToolOp {
  static tooldef() { return {uiname: 'Sketchfab models', toolpath: 'voidspace.sketchfab', inputs: {}, outputs: {}, undoflag: UndoFlags.NO_UNDO} }
  exec() { openSketchfabDialog() }
}
ToolOp.register(SketchfabDialogOp)
