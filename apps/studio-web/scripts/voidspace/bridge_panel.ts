/**
 * The VOID·SPACE panel (VS2-SRS-1.0 §3.5.2, FR-14.3, FR-15.2, §7.1–7.5).
 *
 * What this is for:
 * 1. Shows a Creator where their work goes when they publish and what the destination already holds.
 * 2. Authenticates through VOID·SPACE's signed JWT token carried via URL (?token=...) or localStorage.
 * 3. Runs the pre-publish quality audit against /studio/api/v1/projects/:id/audit and shows the score.
 * 4. Enables direct 1-click publishing of models to VOID·SPACE with live status tracking.
 * 5. Provides an interactive AI Copilot drawer for natural language 3D assistance.
 *
 * All DOM searches are strictly scoped to the panel root element (satisfies document_scope guard).
 */
import {VOID_STUDIO_PALETTE as p} from './theme.js'
import {getFileFormat, formatForFilename} from '../core/file_formats.js'
import {peekAppState, getAppState} from '../core/app_instance.js'
import {Light} from '../light/light.js'
import {SceneObject} from '../sceneobject/sceneobject.js'
import {Vector3, Vector4} from '../path.ux/pathux.js'
import addonManager from '../addon/addon.js'
import {ImageBlock, ImageTypes} from '../image/image.js'
import {Material} from '../core/material.js'
import {ImageNode, DiffuseNode, OutputNode, GeometryNode} from '../shadernodes/shader_nodes.js'
import {
  buildPrimitive,
  heightfieldFromLuminance,
  interpretInstruction,
  readableCopilotText,
  pbrFromPrompt,
  primitiveForPrompt,
  type PbrAssignment,
} from '../../../../packages/studio-engine/src/generative/index.ts'
import {applyEditorCommands, commandsForToolCalls, fetchMeshyGlb} from './ai_scene.js'

export function getToolContext(): any {
  try {
    const active = peekAppState() ?? (typeof getAppState === 'function' ? getAppState() : undefined)
    if (active && (active as any).ctx) {
      return (active as any).ctx
    }
  } catch {}
  return (window as any)._appstate?.ctx ?? (window as any).CTX
}

/** The inputs the rule below reads, gathered into one shape so the rule is assertable on its own. */
export interface StudioApiUrlSource {
  readonly search: string
  readonly protocol: string
  readonly origin: string
  readonly override?: string
}

export function studioApiBaseUrl(source: StudioApiUrlSource): string {
  const fromQuery = new URLSearchParams(source.search).get('studioApi')
  if (fromQuery) return stripTrailingSlashes(fromQuery)

  if (source.override) return stripTrailingSlashes(source.override)

  if (source.protocol === 'https:') return source.origin

  return 'http://localhost:4100'
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as {message?: unknown; error?: unknown}
    if (typeof data.message === 'string' && data.message.length > 0) return data.message
    if (typeof data.error === 'string' && data.error.length > 0) return data.error
  } catch {
    // A non-JSON body still needs a sentence the panel can show.
  }
  return `${fallback} (HTTP ${res.status}).`
}

/** Counts the scene the way the readiness route scores it (`SceneMetrics`). */
export function measureScene(ctx: any): {
  totalPolycount: number
  objectCount: number
  materialCount: number
  textureResolutions: number[]
  maxHierarchyDepth: number
  unnamedObjects: number
  meshesWithoutUvs: number
} {
  let totalPolycount = 0
  let objectCount = 0
  let unnamedObjects = 0
  let meshesWithoutUvs = 0
  const materials = new Set<string>()
  const list = ctx?.scene?.objects ? [...ctx.scene.objects] : []

  for (const ob of list) {
    if (!ob?.data) continue
    const kind = String(ob.data.constructor?.name ?? ob.data.type ?? '')
    if (/light|camera/i.test(kind)) continue
    objectCount += 1
    const name = String(ob.name ?? '').trim()
    if (name.length === 0 || /^(cube|mesh|object)(\.\d+)?$/i.test(name)) unnamedObjects += 1
    const mesh = ob.data.mesh ?? ob.data
    const faces = Number(mesh?.f?.length ?? mesh?.faces?.length ?? 0)
    if (Number.isFinite(faces)) totalPolycount += faces
    if (mesh?.attrs && typeof mesh.attrs.has === 'function' && mesh.attrs.has(1, 'uv') === false) {
      meshesWithoutUvs += 1
    }
    const mat = ob.material ?? ob.data.material
    if (mat) materials.add(String(mat.name ?? mat.id ?? materials.size))
  }

  return {
    totalPolycount,
    objectCount,
    materialCount: materials.size,
    textureResolutions: [],
    maxHierarchyDepth: objectCount > 0 ? 1 : 0,
    unnamedObjects,
    meshesWithoutUvs,
  }
}

/**
 * Prefers a live object walk. When the walk cannot see a mesh but the exporter can,
 * the exported polycount is what would actually be published.
 */
function metricsForAudit(ctx: any): ReturnType<typeof measureScene> {
  const measured = measureScene(ctx)
  if (measured.objectCount > 0 && measured.totalPolycount > 0) return measured
  try {
    const exported = getActiveSceneMetrics(ctx)
    if (exported.polycount > 0) {
      return {
        ...measured,
        objectCount: Math.max(measured.objectCount, 1),
        totalPolycount: Math.max(measured.totalPolycount, exported.polycount),
        materialCount: Math.max(measured.materialCount, exported.materialCount || 1),
      }
    }
  } catch {
    // An exporter that cannot run is itself a reason the audit should see an empty scene.
  }
  return measured
}

/** The compact scene the Copilot route validates (`SceneSummary`). */
export function summarizeScene(ctx: any): {
  objects: {id: string; name: string; type: 'mesh' | 'light' | 'camera' | 'empty' | 'armature'; childCount: number; materialIds: string[]}[]
  selection: string[]
  unit: 'metre'
} {
  const objects: {id: string; name: string; type: 'mesh' | 'light' | 'camera' | 'empty' | 'armature'; childCount: number; materialIds: string[]}[] = []
  const list = ctx?.scene?.objects ? [...ctx.scene.objects] : []
  for (const ob of list) {
    const kind = String(ob?.data?.constructor?.name ?? ob?.data?.type ?? '')
    const type: 'mesh' | 'light' | 'camera' | 'empty' =
      /light/i.test(kind) ? 'light' : /camera/i.test(kind) ? 'camera' : ob?.data ? 'mesh' : 'empty'
    const id = String(ob?.lib_id ?? ob?.id ?? ob?.name ?? `object-${objects.length + 1}`)
    objects.push({
      id,
      name: String(ob?.name ?? 'Object').slice(0, 200),
      type,
      childCount: 0,
      materialIds: [],
    })
  }
  const active = ctx?.scene?.objects?.active
  const activeId = active ? String(active.lib_id ?? active.id ?? active.name ?? '') : ''
  return {
    objects,
    selection: activeId ? [activeId] : [],
    unit: 'metre',
  }
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

/** `#rrggbb` plus alpha, for the panel chrome. The editor theme keeps its own copy. */
function rgbaCss(hex: string, alpha: number): string {
  const value = hex.startsWith('#') ? hex.slice(1) : hex
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

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
    readonly pollIntervalMs?: number
  }
  readonly catalog: {
    readonly publishedAssets: number
    readonly categories: readonly string[]
    readonly allowedCategories?: readonly string[]
  }
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
let styleInjected = false

function injectStyles(): void {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .vsp-trigger {
      position: fixed;
      left: 18px;
      bottom: 18px;
      z-index: 99999;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 9px 18px 9px 13px;
      border-radius: 9999px;
      background: rgba(13, 14, 20, 0.92);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid ${rgbaCss(p.accent, 0.45)};
      color: ${p.fg};
      font: 600 11px/1.2 'Plus Jakarta Sans', system-ui, sans-serif;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      cursor: pointer;
      user-select: none;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65), 0 0 18px ${rgbaCss(p.accent, 0.18)};
      transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .vsp-trigger:hover {
      border-color: ${p.accent};
      background: rgba(18, 20, 32, 0.98);
      color: #ffffff;
      transform: translateY(-2px);
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.75), 0 0 24px ${rgbaCss(p.accent, 0.35)};
    }
    .vsp-trigger.active {
      border-color: ${p.accent};
      background: rgba(22, 26, 40, 0.98);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7), 0 0 22px ${rgbaCss(p.accent, 0.35)};
    }
    .vsp-trigger__mark {
      width: 9px;
      height: 9px;
      border-radius: 2px;
      background: ${p.accent};
      transform: rotate(45deg);
      flex: none;
      box-shadow: 0 0 8px ${p.accent};
      transition: transform 0.25s ease;
    }
    .vsp-trigger:hover .vsp-trigger__mark {
      transform: rotate(135deg);
    }
    .vsp-trigger__status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      margin-left: 2px;
    }

    .vsp {
      position: fixed;
      left: 18px;
      bottom: 66px;
      width: 380px;
      max-width: calc(100vw - 36px);
      z-index: 99998;
      font: 400 12px/1.55 'Plus Jakarta Sans', system-ui, sans-serif;
      color: ${p.fg};
      background: rgba(14, 15, 22, 0.95);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid ${rgbaCss(p.accent, 0.35)};
      border-radius: 12px;
      box-shadow: 0 24px 50px rgba(0, 0, 0, 0.75), 0 0 24px ${rgbaCss(p.accent, 0.12)};
      overflow: hidden;
      transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.22s;
      transform-origin: bottom left;
    }
    .vsp[data-open='false'] {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateY(12px) scale(0.96);
    }
    .vsp[data-open='true'] {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateY(0) scale(1);
    }
    .vsp[data-tab='copilot'] {
      width: 440px;
    }
    .vsp__bar {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 14px;
      background: ${p.surface3};
      border-bottom: 1px solid ${p.line};
      user-select: none;
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
    .vsp__close-btn {
      background: transparent;
      border: none;
      color: ${p.fgDim};
      font-size: 13px;
      line-height: 1;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 4px;
      margin-left: 4px;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.15s ease;
    }
    .vsp__close-btn:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.12);
    }
    
    .vsp__nav {
      display: flex;
      border-bottom: 1px solid ${p.line};
      background: ${p.surface};
    }
    .vsp__tab-btn {
      flex: 1; padding: 6px 10px;
      background: none; border: none; border-bottom: 2px solid transparent;
      color: ${p.fgDim}; font-size: 11px; font-weight: 500; cursor: pointer;
      text-align: center; transition: all 0.15s ease;
    }
    .vsp__tab-btn:hover { color: ${p.fg}; background: rgba(255,255,255,0.03); }
    .vsp__tab-btn.active {
      color: ${p.accent}; border-bottom-color: ${p.accent}; font-weight: 600;
    }

    .vsp__body { padding: 10px 12px 12px; display: grid; gap: 9px; max-height: 64vh; overflow-y: auto; }
    .vsp[data-collapsed='true'] .vsp__body,
    .vsp[data-collapsed='true'] .vsp__nav { display: none; }
    
    .vsp__row { display: flex; justify-content: space-between; gap: 10px; }
    .vsp__k { color: ${p.fgDim}; }
    .vsp__v { text-align: right; word-break: break-all; }
    .vsp__mono { font: 400 11px/1.5 'JetBrains Mono', ui-monospace, monospace; }
    .vsp__card {
      border: 1px solid ${p.line}; border-radius: 7px; padding: 8px 9px;
      background: ${p.surface}; display: grid; gap: 6px;
    }
    .vsp__name { font-weight: 600; font-size: 12px; }
    .vsp__links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
    a.vsp__link, button.vsp__btn_link {
      color: ${p.accent}; text-decoration: none; border: 1px solid ${p.line};
      border-radius: 5px; padding: 4px 8px; font-size: 11px; background: transparent;
      cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
    }
    a.vsp__link:hover, button.vsp__btn_link:hover { border-color: ${p.accent}; background: ${rgbaCss(p.accent, 0.08)}; }
    
    .vsp__btn {
      width: 100%; border: 1px solid ${p.accent}; background: ${p.accent};
      color: #fff; padding: 7px 12px; border-radius: 6px; font-size: 12px;
      font-weight: 600; cursor: pointer; transition: opacity 0.15s ease;
      text-align: center;
    }
    .vsp__btn:hover { opacity: 0.9; }
    .vsp__btn--subtle {
      background: transparent; border-color: ${p.line}; color: ${p.fg};
    }
    .vsp__btn--subtle:hover { border-color: ${p.fgDim}; }
    
    .vsp__note {
      color: ${p.fgDim}; font-size: 10.5px;
      border-left: 2px solid ${p.line}; padding-left: 7px;
    }
    .vsp__issues {
      margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 4px;
    }
    .vsp__issues li {
      font-size: 11px; line-height: 1.4; color: ${p.fg};
      padding-left: 8px; border-left: 2px solid ${p.gold};
    }
    .vsp__err { color: #ffb4b4; font-size: 11px; }
    .vsp__success {
      background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3);
      padding: 8px 10px; border-radius: 6px; color: #4ade80; font-size: 11px;
    }
    
    /* Audit & Publish styles */
    .vsp__audit_box {
      border: 1px solid ${p.line}; border-radius: 6px; padding: 8px; background: ${p.surface3};
    }
    .vsp__audit_score {
      display: flex; align-items: center; justify-content: space-between; font-weight: 600;
    }
    .vsp__score_val {
      font-size: 13px; font-family: 'JetBrains Mono', monospace; padding: 2px 6px; border-radius: 4px;
    }
    .vsp__score_pass { color: #4ade80; background: rgba(34, 197, 94, 0.15); }
    .vsp__score_warn { color: #fbbf24; background: rgba(251, 191, 36, 0.15); }
    
    .vsp__form { display: grid; gap: 7px; margin-top: 4px; }
    .vsp__input, .vsp__select, .vsp__textarea {
      width: 100%; border: 1px solid ${p.line}; border-radius: 5px;
      background: ${p.surface}; color: ${p.fg}; padding: 5px 8px;
      font: inherit; font-size: 11.5px; box-sizing: border-box;
    }
    .vsp__input:focus, .vsp__select:focus, .vsp__textarea:focus {
      outline: none; border-color: ${p.accent};
    }
    
    /* Copilot chat */
    .vsp__chat { display: grid; gap: 8px; }
    .vsp__gen {
      display: grid;
      gap: 6px;
      padding-bottom: 8px;
      border-bottom: 1px solid ${p.line};
    }
    .vsp__gen-row { display: flex; gap: 6px; align-items: center; }
    .vsp__gen-row .vsp__input { flex: 1; }
    .vsp__file { font-size: 11px; color: ${p.fgDim}; max-width: 140px; }
    .vsp__chat_stream {
      display: grid; gap: 6px; max-height: 38vh; overflow-y: auto;
      padding-right: 4px;
    }
    .vsp__msg {
      padding: 6px 8px; border-radius: 6px; font-size: 11.5px; line-height: 1.45;
      white-space: pre-wrap; overflow-wrap: anywhere;
    }
    .vsp__msg--pending { color: ${p.fgDim}; font-style: italic; }
    .vsp__msg--user {
      background: rgba(139, 108, 246, 0.15); border: 1px solid rgba(139, 108, 246, 0.3);
      justify-self: end; max-width: 85%;
    }
    .vsp__msg--ai {
      background: ${p.surface}; border: 1px solid ${p.line}; justify-self: start; max-width: 95%;
    }
    .vsp__chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .vsp__chip {
      font-size: 10.5px; padding: 3px 6px; border-radius: 12px;
      background: ${p.surface3}; border: 1px solid ${p.line};
      color: ${p.fgDim}; cursor: pointer;
    }
    .vsp__chip:hover { border-color: ${p.accent}; color: ${p.accent}; }
    .vsp__chat_row { display: flex; gap: 6px; }
  `
  document.head.appendChild(style)
}

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c] as string)
}

function shorten(value: string, lead = 10, tail = 6): string {
  return value.length <= lead + tail + 1 ? value : `${value.slice(0, lead)}…${value.slice(-tail)}`
}

let panel: VoidSpacePanelHandle | undefined

export interface VoidSpacePanelHandle {
  readonly element: HTMLElement
  refresh(): Promise<void>
  unmount(): void
}

function generateCrystalData(): {
  positions: Float32Array
  normals: Float32Array
  indices: Uint16Array
} {
  const r = 1.0
  const h = 1.5
  const verts: number[] = [
    0, h, 0,  // 0: top apex (+Y in glTF)
    0, -h, 0, // 1: bottom apex (-Y in glTF)
  ]
  const sides = 8
  for (let i = 0; i < sides; i++) {
    const angle = (i * 2 * Math.PI) / sides
    verts.push(r * Math.cos(angle), 0, r * Math.sin(angle))
  }
  const idxs: number[] = []
  for (let i = 0; i < sides; i++) {
    const curr = 2 + i
    const next = 2 + ((i + 1) % sides)
    idxs.push(0, curr, next)
  }
  for (let i = 0; i < sides; i++) {
    const curr = 2 + i
    const next = 2 + ((i + 1) % sides)
    idxs.push(1, next, curr)
  }

  const normals = new Float32Array(verts.length)
  for (let i = 0; i < idxs.length; i += 3) {
    const i0 = idxs[i], i1 = idxs[i + 1], i2 = idxs[i + 2]
    const ax = verts[i0 * 3], ay = verts[i0 * 3 + 1], az = verts[i0 * 3 + 2]
    const bx = verts[i1 * 3], by = verts[i1 * 3 + 1], bz = verts[i1 * 3 + 2]
    const cx = verts[i2 * 3], cy = verts[i2 * 3 + 1], cz = verts[i2 * 3 + 2]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    normals[i0 * 3] += nx; normals[i0 * 3 + 1] += ny; normals[i0 * 3 + 2] += nz
    normals[i1 * 3] += nx; normals[i1 * 3 + 1] += ny; normals[i1 * 3 + 2] += nz
    normals[i2 * 3] += nx; normals[i2 * 3 + 1] += ny; normals[i2 * 3 + 2] += nz
  }
  for (let i = 0; i < verts.length / 3; i++) {
    const len = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1
    normals[i * 3] /= len; normals[i * 3 + 1] /= len; normals[i * 3 + 2] /= len
  }

  return {
    positions: new Float32Array(verts),
    normals,
    indices: new Uint16Array(idxs),
  }
}

export function extractTextureBytesFromMaterial(mat: any): {bytes?: Uint8Array; mimeType?: string} {
  if (!mat?.graph?.nodes) return {}
  for (const node of mat.graph.nodes) {
    if (node instanceof ImageNode || (node as any).constructor?.name === 'ImageNode') {
      const imgBlock = (node as any).imageUser?.image || (node as any).image
      if (!imgBlock) continue
      let url: string = imgBlock.url || imgBlock.data || ''
      if (!url && imgBlock._image?.src) {
        url = imgBlock._image.src
      }
      if (!url && imgBlock._image?.image) {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = imgBlock.width || imgBlock._image.image.width || 512
          canvas.height = imgBlock.height || imgBlock._image.image.height || 512
          const g = canvas.getContext('2d')
          if (g) {
            g.putImageData(imgBlock._image.image, 0, 0)
            url = canvas.toDataURL('image/png')
          }
        } catch {}
      }
      if (url && url.startsWith('data:')) {
        try {
          const [header, b64] = url.split(',')
          const mimeType = header.split(':')[1]?.split(';')[0] || 'image/png'
          const raw = atob(b64)
          const bytes = new Uint8Array(raw.length)
          for (let i = 0; i < raw.length; i++) {
            bytes[i] = raw.charCodeAt(i)
          }
          return {bytes, mimeType}
        } catch {}
      }
    }
  }
  return {}
}

export function ensureMeshUVs(mesh: any): boolean {
  if (!mesh || !mesh.attrs || !mesh.v || !mesh.f) return false
  const DOMAIN_CORNER = 1
  const ATTR_FLOAT2 = 3

  let uvLayer = mesh.attrs.get?.(DOMAIN_CORNER, 'uv')
  if (!uvLayer) {
    try {
      uvLayer = mesh.attrs.add(DOMAIN_CORNER, 'uv', ATTR_FLOAT2)
    } catch {
      return false
    }
  }

  const uvData = uvLayer?.column?.data
  if (!uvData || uvData.length === 0) return false

  let allZero = true
  for (let i = 0; i < Math.min(uvData.length, 64); i++) {
    if (uvData[i] !== 0) {
      allZero = false
      break
    }
  }

  if (allZero) {
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    const co = mesh.v.co
    if (!co) return false
    for (let i = 0; i < co.length; i += 3) {
      const x = co[i], y = co[i + 1], z = co[i + 2]
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
    const spanX = Math.max(maxX - minX, 1e-4)
    const spanZ = Math.max(maxZ - minZ, 1e-4)

    for (const f of mesh.f) {
      for (const l of mesh.faceLoops?.(f) || []) {
        for (const c of mesh.loopCorners?.(l) || []) {
          const vIdx = mesh.c?.v?.[c]
          if (vIdx !== undefined) {
            const px = co[vIdx * 3]
            const pz = co[vIdx * 3 + 2]
            uvData[c * 2] = (px - minX) / spanX
            uvData[c * 2 + 1] = (pz - minZ) / spanZ
          }
        }
      }
    }
    return true
  }
  return true
}

export function createProceduralUVGridDataUrl(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 1024
  const g = canvas.getContext('2d')!
  const steps = 16
  const colors = ['#232635', '#12131c']
  const cellSize = canvas.width / steps

  for (let y = 0; y < steps; y++) {
    for (let x = 0; x < steps; x++) {
      g.fillStyle = colors[(x + y) % 2]
      g.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)

      g.strokeStyle = 'rgba(250, 93, 25, 0.35)'
      g.lineWidth = 1
      g.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize)

      g.fillStyle = '#fa5d19'
      g.font = 'bold 16px monospace'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      const label = `${String.fromCharCode(65 + x)}${y + 1}`
      g.fillText(label, (x + 0.5) * cellSize, (y + 0.5) * cellSize)
    }
  }

  g.strokeStyle = '#f43f5e'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(512, 0); g.lineTo(512, 1024)
  g.moveTo(0, 512); g.lineTo(1024, 512)
  g.stroke()

  return canvas.toDataURL('image/png')
}

export function applyTextureToMeshObject(ctx: any, ob: any, dataUrl: string, texName = 'BaseColor'): void {
  const lib = ctx?.datalib
  if (!lib || !ob?.data) return

  if (ob.data.mesh) {
    ensureMeshUVs(ob.data.mesh)
  }

  const imgBlock = new ImageBlock()
  imgBlock.name = texName
  imgBlock.type = ImageTypes.URL
  imgBlock.url = dataUrl
  imgBlock.update()
  lib.add(imgBlock)

  let mat = (ob as any).material || ob.data.material || ob.data.materials?.[0]
  if (!mat || !mat.graph) {
    mat = new Material()
    mat.name = (ob.name || 'Model') + '_PBR'
    lib.add(mat)
    if (Array.isArray(ob.data.materials)) {
      ob.data.materials.push(mat)
    } else {
      ob.data.material = mat
    }
    ob.material = mat
    mat.lib_addUser(ob.data)
  }

  let imgNode: ImageNode | undefined
  let diffNode: DiffuseNode | undefined
  let outNode: OutputNode | undefined
  let geomNode: GeometryNode | undefined

  for (const n of mat.graph.nodes) {
    if (n instanceof ImageNode || (n as any).constructor?.name === 'ImageNode') imgNode = n as ImageNode
    if (n instanceof DiffuseNode || (n as any).constructor?.name === 'DiffuseNode') diffNode = n as DiffuseNode
    if (n instanceof OutputNode || (n as any).constructor?.name === 'OutputNode') outNode = n as OutputNode
    if (n instanceof GeometryNode || (n as any).constructor?.name === 'GeometryNode') geomNode = n as GeometryNode
  }

  if (!diffNode) {
    diffNode = new DiffuseNode()
    mat.graph.add(diffNode)
  }
  if (!outNode) {
    outNode = new OutputNode()
    mat.graph.add(outNode)
    diffNode.outputs.surface.connect(outNode.inputs.surface)
  }
  if (!geomNode) {
    geomNode = new GeometryNode()
    mat.graph.add(geomNode)
    geomNode.outputs.normal.connect(diffNode.inputs.normal)
  }

  if (!imgNode) {
    imgNode = new ImageNode()
    mat.graph.add(imgNode)
    imgNode.outputs.color.connect(diffNode.inputs.color)
  }

  imgNode.imageUser.image = imgBlock
  imgBlock.lib_addUser(mat)
  ;(mat as any)._regen = true

  ob.graphUpdate?.()
  ob.data?.graphUpdate?.()

  const rw = window as any
  if (typeof rw.redraw_viewport === 'function') {
    rw.redraw_viewport(true)
  }
}

export function packGlbBinary(
  name: string,
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint16Array | Uint32Array,
  materialColor: [number, number, number, number] = [0.85, 0.88, 0.94, 1.0],
  metallic = 0.35,
  roughness = 0.40,
  options?: {uv?: Float32Array; textureBytes?: Uint8Array; textureMimeType?: string},
): Uint8Array {
  const vertCount = Math.floor(positions.length / 3)
  if (vertCount === 0 || indices.length === 0) {
    const fb = generateCrystalData()
    return packGlbBinary(name, fb.positions, fb.normals, fb.indices, materialColor, metallic, roughness, options)
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z
  }

  const is32Bit = indices instanceof Uint32Array
  const posBytes = positions.byteLength
  const posPadded = (posBytes + 3) & ~3
  const normBytes = normals.byteLength
  const normPadded = (normBytes + 3) & ~3
  const idxBytes = indices.byteLength
  const idxPadded = (idxBytes + 3) & ~3

  const hasUV = options?.uv && options.uv.length >= vertCount * 2
  const uvBytes = hasUV ? options!.uv!.byteLength : 0
  const uvPadded = (uvBytes + 3) & ~3

  const hasTex = options?.textureBytes && options.textureBytes.length > 0
  const texBytes = hasTex ? options!.textureBytes!.byteLength : 0
  const texPadded = (texBytes + 3) & ~3

  const totalBinBytes = posPadded + normPadded + idxPadded + uvPadded + texPadded

  const binBuffer = new Uint8Array(totalBinBytes)
  binBuffer.set(new Uint8Array(positions.buffer, positions.byteOffset, posBytes), 0)
  binBuffer.set(new Uint8Array(normals.buffer, normals.byteOffset, normBytes), posPadded)
  binBuffer.set(new Uint8Array(indices.buffer, indices.byteOffset, idxBytes), posPadded + normPadded)

  let uvOffset = 0
  if (hasUV) {
    uvOffset = posPadded + normPadded + idxPadded
    binBuffer.set(new Uint8Array(options!.uv!.buffer, options!.uv!.byteOffset, uvBytes), uvOffset)
  }

  let texOffset = 0
  if (hasTex) {
    texOffset = posPadded + normPadded + idxPadded + uvPadded
    binBuffer.set(options!.textureBytes!, texOffset)
  }

  const bufferViews: any[] = [
    {buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962},
    {buffer: 0, byteOffset: posPadded, byteLength: normBytes, target: 34962},
    {buffer: 0, byteOffset: posPadded + normPadded, byteLength: idxBytes, target: 34963},
  ]

  const accessors: any[] = [
    {
      bufferView: 0,
      byteOffset: 0,
      componentType: 5126,
      count: vertCount,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
    {
      bufferView: 1,
      byteOffset: 0,
      componentType: 5126,
      count: vertCount,
      type: 'VEC3',
    },
    {
      bufferView: 2,
      byteOffset: 0,
      componentType: is32Bit ? 5125 : 5123,
      count: indices.length,
      type: 'SCALAR',
      min: [0],
      max: [vertCount - 1],
    },
  ]

  const attributes: any = {POSITION: 0, NORMAL: 1}

  if (hasUV) {
    const uvViewIdx = bufferViews.length
    bufferViews.push({buffer: 0, byteOffset: uvOffset, byteLength: uvBytes, target: 34962})
    const uvAccIdx = accessors.length
    accessors.push({
      bufferView: uvViewIdx,
      byteOffset: 0,
      componentType: 5126,
      count: vertCount,
      type: 'VEC2',
    })
    attributes.TEXCOORD_0 = uvAccIdx
  }

  const materialDef: any = {
    name: 'PBR_Studio',
    pbrMetallicRoughness: {
      baseColorFactor: materialColor,
      metallicFactor: metallic,
      roughnessFactor: roughness,
    },
    doubleSided: true,
  }

  const gltfJson: any = {
    asset: {version: '2.0', generator: 'VOID·STUDIO 1.0'},
    scenes: [{name: 'Scene', nodes: [0]}],
    nodes: [{name, mesh: 0}],
    meshes: [
      {
        name,
        primitives: [
          {
            attributes,
            indices: 2,
            material: 0,
          },
        ],
      },
    ],
    materials: [materialDef],
    buffers: [{byteLength: totalBinBytes}],
    bufferViews,
    accessors,
  }

  if (hasTex) {
    const texViewIdx = bufferViews.length
    bufferViews.push({buffer: 0, byteOffset: texOffset, byteLength: texBytes})
    gltfJson.images = [{bufferView: texViewIdx, mimeType: options!.textureMimeType || 'image/png'}]
    gltfJson.samplers = [{magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497}]
    gltfJson.textures = [{sampler: 0, source: 0}]
    materialDef.pbrMetallicRoughness.baseColorTexture = {index: 0}
  }

  const jsonStr = JSON.stringify(gltfJson)
  const jsonPadding = (4 - (jsonStr.length % 4)) % 4
  const jsonPadded = jsonStr + ' '.repeat(jsonPadding)
  const jsonBytes = new TextEncoder().encode(jsonPadded)

  const totalLength = 12 + 8 + jsonBytes.length + 8 + totalBinBytes
  const glb = new Uint8Array(totalLength)
  const view = new DataView(glb.buffer)

  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, totalLength, true)

  view.setUint32(12, jsonBytes.length, true)
  view.setUint32(16, 0x4e4f534a, true)
  glb.set(jsonBytes, 20)

  const binHeaderOffset = 20 + jsonBytes.length
  view.setUint32(binHeaderOffset, totalBinBytes, true)
  view.setUint32(binHeaderOffset + 4, 0x004e4942, true)
  glb.set(binBuffer, binHeaderOffset + 8)

  return glb
}

export function extractSceneMeshes(ctx: any): {
  positions: Float32Array
  normals: Float32Array
  indices: Uint16Array | Uint32Array
  polycount: number
  vertCount: number
  materialColor: [number, number, number, number]
} {
  const scene = ctx?.scene
  const allPos: number[] = []
  const allNorm: number[] = []
  const allIdx: number[] = []
  let vertOffset = 0
  let detectedColor: [number, number, number, number] = [0.85, 0.88, 0.94, 1.0]

  if (scene?.objects) {
    for (const ob of scene.objects) {
      if (!ob?.data) continue

      const mat = ob.material || ob.data?.material
      if (mat?.color && Array.isArray(mat.color) && mat.color.length >= 3) {
        detectedColor = [mat.color[0], mat.color[1], mat.color[2], mat.color[3] ?? 1.0]
      }

      const worldMat = ob.outputs?.matrix?.getValue?.() || ob.matrix

      let tris: {positions: Float64Array | number[]; indices: Int32Array | number[]; normals?: Float64Array | number[]} | null = null
      if (typeof ob.data.extractTriangles === 'function') {
        try {
          tris = ob.data.extractTriangles()
        } catch (e) {
          console.warn('extractTriangles threw error:', e)
        }
      }

      if ((!tris || !tris.positions || tris.positions.length === 0) && ob.data.mesh?.f && ob.data.mesh?.v) {
        try {
          const mesh = ob.data.mesh
          const positions: number[] = []
          const indices: number[] = []
          const vertMap = new Map<any, number>()
          let vIdx = 0
          for (const v of mesh.v) {
            vertMap.set(v, vIdx++)
            positions.push(v[0] || v.co?.[0] || 0, v[1] || v.co?.[1] || 0, v[2] || v.co?.[2] || 0)
          }
          for (const f of mesh.f) {
            const fVerts = Array.from(f.verts || f.v || [])
            if (fVerts.length >= 3) {
              const v0 = vertMap.get(fVerts[0]) ?? 0
              for (let j = 1; j < fVerts.length - 1; j++) {
                indices.push(v0, vertMap.get(fVerts[j]) ?? 0, vertMap.get(fVerts[j + 1]) ?? 0)
              }
            }
          }
          if (positions.length > 0 && indices.length > 0) {
            tris = {positions, indices}
          }
        } catch (e) {
          console.warn('LeafMesh fallback threw error:', e)
        }
      }

      if (tris && tris.positions && tris.positions.length >= 9 && tris.indices && tris.indices.length >= 3) {
        const numVerts = Math.floor(tris.positions.length / 3)
        const v = new Vector3()
        const n = new Vector3()

        for (let i = 0; i < numVerts; i++) {
          const rawX = tris.positions[i * 3]
          const rawY = tris.positions[i * 3 + 1]
          const rawZ = tris.positions[i * 3 + 2]

          v.loadXYZ(rawX, rawY, rawZ)
          if (worldMat) {
            v.multVecMatrix(worldMat)
          }

          // VOID·STUDIO (Z-up: +X right, +Y forward, +Z up)
          // to glTF 2.0 (Y-up: +X right, +Y up, -Z forward)
          allPos.push(v[0], v[2], -v[1])

          if (tris.normals && (i * 3 + 2) < tris.normals.length) {
            n.loadXYZ(tris.normals[i * 3], tris.normals[i * 3 + 1], tris.normals[i * 3 + 2])
            if (worldMat) {
              n.multVecMatrix(worldMat)
              n.normalize()
            }
            allNorm.push(n[0], n[2], -n[1])
          } else {
            allNorm.push(0, 1, 0)
          }
        }

        for (let i = 0; i < tris.indices.length; i++) {
          allIdx.push(tris.indices[i] + vertOffset)
        }
        vertOffset += numVerts
      }
    }
  }

  if (allPos.length === 0 || allIdx.length === 0) {
    const fb = generateCrystalData()
    return {
      positions: fb.positions,
      normals: fb.normals,
      indices: fb.indices,
      polycount: fb.indices.length / 3,
      vertCount: fb.positions.length / 3,
      materialColor: detectedColor,
    }
  }

  const isLarge = vertOffset >= 65535
  const indices = isLarge ? new Uint32Array(allIdx) : new Uint16Array(allIdx)

  return {
    positions: new Float32Array(allPos),
    normals: new Float32Array(allNorm),
    indices,
    polycount: allIdx.length / 3,
    vertCount: vertOffset,
    materialColor: detectedColor,
  }
}

export function exportActiveSceneGlb(ctx: any, name: string): {
  bytes: Uint8Array
  polycount: number
  vertCount: number
} {
  const meshData = extractSceneMeshes(ctx)
  const glbBytes = packGlbBinary(
    name,
    meshData.positions,
    meshData.normals,
    meshData.indices,
    meshData.materialColor,
  )
  return {
    bytes: glbBytes,
    polycount: meshData.polycount,
    vertCount: meshData.vertCount,
  }
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  const chunkSize = 16384
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len))
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
}

export function getActiveSceneMetrics(ctx: any): {
  polycount: number
  vertCount: number
  materialCount: number
  sizeBytes: number
  glbBase64: string
} {
  const exported = exportActiveSceneGlb(ctx, 'SceneModel')
  const glbBase64 = uint8ArrayToBase64(exported.bytes)

  return {
    polycount: exported.polycount,
    vertCount: exported.vertCount,
    materialCount: 1,
    sizeBytes: exported.bytes.byteLength,
    glbBase64,
  }
}

export async function mountVoidSpacePanel(): Promise<VoidSpacePanelHandle> {
  panel?.unmount()
  injectStyles()

  const base = apiBaseUrl()

  // Token management from query or storage
  const urlParams = new URLSearchParams(location.search)
  let authToken = urlParams.get('token') ?? urlParams.get('accessToken')
  if (authToken) {
    try {
      localStorage.setItem('void_studio_token', authToken)
    } catch {
      // ignore
    }
    // A bearer in the address bar is copied with every screenshot and lives in history.
    urlParams.delete('token')
    urlParams.delete('accessToken')
    const next = urlParams.toString()
    const cleaned = `${location.pathname}${next ? `?${next}` : ''}${location.hash}`
    history.replaceState(history.state, '', cleaned)
  } else {
    try {
      authToken = localStorage.getItem('void_studio_token')
    } catch {
      // ignore
    }
  }

  const importAssetId = urlParams.get('assetId')
  const importAssetName = urlParams.get('name') ?? 'Studio Asset'
  const importModelUrl = urlParams.get('modelUrl')
  let modelImportStatus: {
    status: 'idle' | 'loading' | 'success' | 'error'
    message?: string
  } = {status: 'idle'}
  let activeProjectId: string | null = null
  let activeSession: {displayName: string; roles: string[]; tenantId: string} | null = null
  let latestAudit: {score: number; passed: boolean; threshold: number; issues: any[]} | null = null
  let activeTab: 'bridge' | 'copilot' = 'bridge'

  let isOpen = Boolean(importAssetId || importModelUrl)

  const triggerBtn = document.createElement('button')
  triggerBtn.type = 'button'
  triggerBtn.className = `vsp-trigger${isOpen ? ' active' : ''}`
  triggerBtn.title = 'Toggle VOID·SPACE Studio Panel'
  triggerBtn.innerHTML = `
    <span class="vsp-trigger__mark"></span>
    <span>VOID·SPACE</span>
    <span class="vsp-trigger__status-dot" data-role="status-dot"></span>
  `
  document.body.appendChild(triggerBtn)

  const root = document.createElement('div')
  root.className = 'vsp'
  root.dataset.open = String(isOpen)
  root.dataset.collapsed = 'false'
  root.dataset.tab = 'bridge'
  root.innerHTML = `
    <div class="vsp__bar">
      <span class="vsp__mark"></span>
      <span class="vsp__title">VOID·SPACE</span>
      <span class="vsp__badge" data-role="badge">…</span>
      <button type="button" class="vsp__close-btn" data-role="close" title="Minimize VOID·SPACE Panel">✕</button>
    </div>
    <div class="vsp__nav">
      <button type="button" class="vsp__tab-btn active" data-tab-target="bridge">Bridge & Publish</button>
      <button type="button" class="vsp__tab-btn" data-tab-target="copilot">AI Copilot ✨</button>
    </div>
    <div class="vsp__body" data-role="body">
      <div class="vsp__note">Contacting the Studio API…</div>
    </div>
  `
  document.body.appendChild(root)

  const bar = root.querySelector('.vsp__bar') as HTMLElement
  const badge = root.querySelector('[data-role="badge"]') as HTMLElement
  const body = root.querySelector('[data-role="body"]') as HTMLElement
  const closeBtn = root.querySelector('[data-role="close"]') as HTMLElement | null
  const triggerDot = triggerBtn.querySelector('[data-role="status-dot"]') as HTMLElement | null
  const tabBtns = root.querySelectorAll('.vsp__tab-btn')

  const togglePanel = (force?: boolean): void => {
    isOpen = force !== undefined ? force : !isOpen
    root.dataset.open = String(isOpen)
    triggerBtn.classList.toggle('active', isOpen)
    if (isOpen) {
      void render()
    }
  }

  triggerBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    togglePanel()
  })

  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      togglePanel(false)
    })
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const target = (btn as HTMLElement).dataset.tabTarget as 'bridge' | 'copilot'
      activeTab = target
      root.dataset.tab = target
      tabBtns.forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      void render()
    })
  })

  const DEFAULT_POLL_MS = 30_000
  let pollMs = DEFAULT_POLL_MS
  let pollTimer: number | undefined

  const armPoll = (intervalMs: number): void => {
    if (pollTimer !== undefined) {
      window.clearInterval(pollTimer)
    }
    pollTimer = intervalMs > 0 ? window.setInterval(() => void render(), intervalMs) : undefined
  }

  /**
   * Verifies the launch token against the Studio API and nothing else.
   *
   * The panel does not call VOID·SPACE, and it does not ask the API for the tenant
   * developer key. That key is a server credential; putting it in this browser would
   * make every Creator in the tenant able to publish as the tenant.
   */
  const checkSession = async (): Promise<void> => {
    if (!authToken) {
      activeSession = null
      return
    }
    try {
      const res = await fetch(`${base}/studio/api/v1/auth/session`, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${authToken}`,
        },
      })
      if (res.ok) {
        const data = await res.json()
        if (data.authenticated && data.user) {
          activeSession = {
            displayName: data.user.displayName || 'Creator',
            roles: data.user.roles || ['Creator'],
            tenantId: data.tenant?.id || 'default',
          }
          return
        }
      }
    } catch {
      // The Studio API is the only origin this panel contacts.
    }
    activeSession = null
  }

  const adoptStoredToken = (): void => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem('void_studio_token')
    } catch {
      return
    }
    if (!stored || stored === authToken) return
    authToken = stored
    void checkSession().then(() => render())
  }

  const onStorageChange = (e: StorageEvent): void => {
    if (e.key === 'void_studio_token') adoptStoredToken()
  }
  window.addEventListener('storage', onStorageChange)

  // The handoff tab writes the token and closes. Coming back to this window
  // covers the browsers that do not deliver the storage event.
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') adoptStoredToken()
  }
  document.addEventListener('visibilitychange', onVisible)

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
      if (triggerDot) {
        triggerDot.style.background = '#ef4444'
        triggerDot.style.boxShadow = '0 0 8px #ef4444'
      }
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
      armPoll(pollMs)
      return
    }

    if (triggerDot) {
      const dotColor = status.mode === 'live' ? '#10b981' : p.accent
      triggerDot.style.background = dotColor
      triggerDot.style.boxShadow = `0 0 8px ${dotColor}`
    }

    if (typeof status.publish.pollIntervalMs === 'number' && status.publish.pollIntervalMs > 0) {
      pollMs = status.publish.pollIntervalMs
    }
    armPoll(pollMs)

    badge.textContent = status.mode === 'live' ? 'linked' : 'sandbox'
    badge.className = `vsp__badge ${status.mode === 'live' ? 'vsp__badge--ok' : ''}`

    if (activeTab === 'copilot') {
      renderCopilotView()
      return
    }

    // Default Bridge View
    renderBridgeView(status)
  }

  const renderBridgeView = (status: BridgeStatus): void => {
    const prov = status.provenance
    let html = `
      <div class="vsp__row"><span class="vsp__k">Platform</span><span class="vsp__v vsp__mono">${esc(status.apiBaseUrl)}</span></div>
      <div class="vsp__row"><span class="vsp__k">Published assets</span><span class="vsp__v">${status.catalog.publishedAssets}</span></div>
      ${
        status.catalog.categories.length > 0
          ? `<div class="vsp__row"><span class="vsp__k">Categories</span><span class="vsp__v">${esc(status.catalog.categories.join(', '))}</span></div>`
          : ''
      }
    `

    if (activeSession) {
      html += `
        <div class="vsp__card">
          <div class="vsp__row">
            <span class="vsp__k">Creator</span>
            <span class="vsp__v font-bold" style="color:#10b981">✓ ${esc(activeSession.displayName)} (${esc(activeSession.roles[0] ?? 'Creator')})</span>
          </div>
        </div>
      `
    } else {
      html += `
        <div class="vsp__card" style="border-color: ${rgbaCss(p.accent, 0.55)}; background: ${rgbaCss(p.accent, 0.06)};">
          <div style="font-weight:600; font-size:11px; color:${p.accent}; margin-bottom:3px;">Connect VOID·SPACE Account</div>
          <div class="vsp__note">Opens VOID·SPACE. If you are already signed in there, this editor links itself and that tab closes.</div>
          <div style="display:flex; gap:6px; margin-top:8px;">
            <a href="${esc(`${stripTrailingSlashes(status.links.consoleUrl)}/login?next=${encodeURIComponent('/studio/connect')}`)}" target="_blank" rel="noopener" class="vsp__btn" style="text-align:center; text-decoration:none; flex:1.2;">
              Sign in on VOID·SPACE ↗
            </a>
            <button type="button" class="vsp__btn vsp__btn--subtle" data-action="toggle-token-input" style="flex:1;">
              Token Link
            </button>
          </div>
          <div class="vsp__token_box" data-role="token-box" style="display:none; margin-top:8px;">
            <input type="text" class="vsp__input" data-role="token-field" placeholder="Paste session token..." />
            <button type="button" class="vsp__btn" data-action="submit-token" style="margin-top:5px;">Link Session</button>
          </div>
        </div>
      `
    }

    if (importAssetId) {
      html += `
        <div class="vsp__card" style="border-color:${p.accent}">
          <div class="vsp__name">Editing VOID·SPACE Asset</div>
          <div class="vsp__row"><span class="vsp__k">Name</span><span class="vsp__v">${esc(importAssetName)}</span></div>
          <div class="vsp__row"><span class="vsp__k">Asset ID</span><span class="vsp__v vsp__mono">${esc(shorten(importAssetId, 8, 4))}</span></div>
          ${
            importModelUrl
              ? `
            <div class="vsp__row" style="margin-top:4px">
              <span class="vsp__k">3D Sync</span>
              <span class="vsp__v" style="color:${
                modelImportStatus.status === 'success'
                  ? p.accent
                  : modelImportStatus.status === 'loading'
                    ? p.gold
                    : modelImportStatus.status === 'error'
                      ? p.heat
                      : p.fgDim
              }">
                ${
                  modelImportStatus.status === 'success'
                    ? '● Loaded in Viewport'
                    : modelImportStatus.status === 'loading'
                      ? 'Downloading…'
                      : modelImportStatus.status === 'error'
                        ? 'Failed'
                        : 'Ready'
                }
              </span>
            </div>
            ${modelImportStatus.message ? `<div class="vsp__note" style="margin-top:4px">${esc(modelImportStatus.message)}</div>` : ''}
            ${
              modelImportStatus.status === 'error'
                ? `<button type="button" class="vsp__btn vsp__btn--subtle" data-action="retry-import" style="margin-top:6px">Retry 3D Import</button>`
                : ''
            }
          `
              : ''
          }
        </div>
      `
    }

    if (prov) {
      html += `
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
        </div>
      `
    }

    // Readiness audit section
    html += `
      <div class="vsp__audit_box">
        <div class="vsp__audit_score">
          <span>Pre-Publish Audit</span>
          ${
            latestAudit
              ? `<span class="vsp__score_val ${latestAudit.passed ? 'vsp__score_pass' : 'vsp__score_warn'}">${latestAudit.score}/100</span>`
              : `<span class="vsp__score_val" style="color:${p.fgDim}">Not run</span>`
          }
        </div>
        <button type="button" class="vsp__btn vsp__btn--subtle" data-action="run-audit" style="margin-top:6px">
          Run Readiness Audit
        </button>
        ${
          latestAudit && latestAudit.issues.length > 0
            ? `<ul class="vsp__issues">${latestAudit.issues
                .slice(0, 6)
                .map((issue) => `<li>${esc(issue.message || issue.category || 'Issue')}</li>`)
                .join('')}</ul>`
            : ''
        }
      </div>
    `

    const ctx = getToolContext()
    const activeOb = ctx?.scene?.objects?.active || [...(ctx?.scene?.objects || [])].find((o: any) => o?.data)
    const activeMat = activeOb?.material || activeOb?.data?.material || activeOb?.data?.materials?.[0]
    const hasTexture = Boolean(activeMat && extractTextureBytesFromMaterial(activeMat).bytes)
    let currentModeName = 'Object Mode'
    if (ctx?.scene?.toolmode_i !== undefined && ctx.scene.toolModeProp?.uiNames) {
      currentModeName = ctx.scene.toolModeProp.uiNames[ctx.scene.toolmode_i] || 'Object Mode'
    } else if (ctx?.scene?.toolMode) {
      currentModeName = String(ctx.scene.toolMode)
    }

    // Blender Parity Tool Modes
    html += `
      <div class="vsp__card">
        <div class="vsp__row">
          <span class="vsp__k">Studio Tool Mode</span>
          <span class="vsp__v" style="color:${p.accent}; font-weight:600" data-role="active-toolmode">${esc(currentModeName)}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px">
          <button type="button" class="vsp__btn vsp__btn--subtle" data-action="switch-mode" data-mode="object">Object Mode</button>
          <button type="button" class="vsp__btn vsp__btn--subtle" data-action="switch-mode" data-mode="sculptcore">Sculpt Mode</button>
          <button type="button" class="vsp__btn vsp__btn--subtle" data-action="switch-mode" data-mode="leafmesh">Edit Mesh</button>
          <button type="button" class="vsp__btn vsp__btn--subtle" data-action="switch-mode" data-mode="boxmodel">Box Model</button>
        </div>
      </div>
    `

    // PBR Textures & Materials Manager
    html += `
      <div class="vsp__card">
        <div class="vsp__row">
          <span class="vsp__k">PBR Textures & Material</span>
          <span class="vsp__v" style="color:${hasTexture ? '#10b981' : p.fgDim}; font-weight:600">
            ${hasTexture ? 'Mapped ✨' : 'Default Color'}
          </span>
        </div>
        <div style="font-size:11px;color:${p.fgDim};display:flex;justify-content:space-between;margin-top:2px">
          <span>Active: ${activeOb?.name ? esc(activeOb.name) : 'No mesh'}</span>
          <span>${activeOb?.data?.mesh?.attrs?.has?.(1, 'uv') ? 'UVs: Ready' : 'UVs: Auto'}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">
          <label class="vsp__btn vsp__btn--subtle" style="display:flex;align-items:center;justify-content:center;cursor:pointer;margin:0;font-size:11px">
            <span>Apply Texture 📁</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/jpg" data-role="texture-file-input" style="display:none" />
          </label>
          <button type="button" class="vsp__btn vsp__btn--subtle" data-action="apply-uvgrid" style="font-size:11px">UV Test Grid 🏁</button>
          <button type="button" class="vsp__btn vsp__btn--subtle" data-action="auto-unwrap" style="font-size:11px">Box UVs 📐</button>
          <button type="button" class="vsp__btn vsp__btn--subtle" data-action="clear-texture" style="font-size:11px">Reset Mat ↺</button>
        </div>
        <div class="vsp__note">Drag & drop any image (.png/.jpg) or 3D model (.fbx/.glb/.obj) onto the viewport.</div>
      </div>
    `

    // Publishing section
    html += `
      <div class="vsp__card">
        <div class="vsp__row">
          <span class="vsp__k">Publishing</span>
          <span class="vsp__v" style="color:${status.publish.enabled ? p.accent : p.fgDim}">
            ${status.publish.enabled ? 'enabled' : 'browse only'}
          </span>
        </div>
        <button type="button" class="vsp__btn" data-action="open-publish">
          Publish to VOID·SPACE
        </button>
        <div class="vsp__note">${
          status.publish.requirement
            ? esc(status.publish.requirement)
            : 'Exports are validated and handed to VOID·SPACE by the Studio API — the tenant credential never reaches this page.'
        }</div>
      </div>
      <div class="vsp__card">
        <div class="vsp__row">
          <span class="vsp__k">Local Export</span>
          <span class="vsp__v" style="color:${p.accent}">Multi-Format</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
          <button type="button" class="vsp__btn vsp__btn--subtle" data-action="quick-export" data-fmt="glb">glTF (.glb)</button>
          <button type="button" class="vsp__btn vsp__btn--subtle" data-action="quick-export" data-fmt="fbx">FBX (.fbx)</button>
          <button type="button" class="vsp__btn vsp__btn--subtle" data-action="quick-export" data-fmt="obj">Wavefront (.obj)</button>
          <button type="button" class="vsp__btn vsp__btn--subtle" data-action="quick-export" data-fmt="stl">STL (.stl)</button>
          <button type="button" class="vsp__btn vsp__btn--subtle" data-action="quick-export" data-fmt="ply" style="grid-column: span 2">Stanford (.ply)</button>
        </div>
      </div>
      <div class="vsp__links">
        <a class="vsp__link" href="${esc(status.links.catalogUrl)}" target="_blank" rel="noopener">Browse catalogue ↗</a>
      </div>
      <div data-role="publish-target"></div>
    `

    body.innerHTML = html

    // Wire mode buttons
    body.querySelectorAll('[data-action="switch-mode"]').forEach((el) => {
      el.addEventListener('click', () => {
        const mode = el.getAttribute('data-mode')
        const c = getToolContext()
        if (c?.scene && typeof c.scene.switchToolMode === 'function' && mode) {
          try {
            c.scene.switchToolMode(mode)
            const rw = window as any
            rw.redraw_viewport?.(true)
            void render()
          } catch (e) {
            console.warn('switchToolMode failed:', e)
          }
        }
      })
    })

    // Wire texture controls
    const texInput = body.querySelector('[data-role="texture-file-input"]') as HTMLInputElement | null
    if (texInput) {
      texInput.addEventListener('change', () => {
        const file = texInput.files?.[0]
        if (!file) return
        const c = getToolContext()
        const ob = c?.scene?.objects?.active || [...(c?.scene?.objects || [])].find((o: any) => o?.data)
        if (!ob) {
          alert('Please select or create a 3D model first.')
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          applyTextureToMeshObject(c, ob, reader.result as string, file.name)
          void render()
        }
        reader.readAsDataURL(file)
      })
    }

    const uvGridBtn = body.querySelector('[data-action="apply-uvgrid"]')
    if (uvGridBtn) {
      uvGridBtn.addEventListener('click', () => {
        const c = getToolContext()
        const ob = c?.scene?.objects?.active || [...(c?.scene?.objects || [])].find((o: any) => o?.data)
        if (!ob) {
          alert('Please select or create a 3D model first.')
          return
        }
        applyTextureToMeshObject(c, ob, createProceduralUVGridDataUrl(), 'UV_Grid')
        void render()
      })
    }

    const unwrapBtn = body.querySelector('[data-action="auto-unwrap"]')
    if (unwrapBtn) {
      unwrapBtn.addEventListener('click', () => {
        const c = getToolContext()
        const ob = c?.scene?.objects?.active || [...(c?.scene?.objects || [])].find((o: any) => o?.data)
        if (ob?.data?.mesh) {
          ensureMeshUVs(ob.data.mesh)
          ob.graphUpdate?.()
          ob.data?.graphUpdate?.()
          const rw = window as any
          rw.redraw_viewport?.(true)
          void render()
        }
      })
    }

    const clearTexBtn = body.querySelector('[data-action="clear-texture"]')
    if (clearTexBtn) {
      clearTexBtn.addEventListener('click', () => {
        const c = getToolContext()
        const ob = c?.scene?.objects?.active || [...(c?.scene?.objects || [])].find((o: any) => o?.data)
        if (ob) {
          ob.material = undefined
          if (ob.data) ob.data.material = undefined
          ob.graphUpdate?.()
          ob.data?.graphUpdate?.()
          const rw = window as any
          rw.redraw_viewport?.(true)
          void render()
        }
      })
    }

    // Wire audit & publish buttons
    const auditBtn = body.querySelector('[data-action="run-audit"]')
    if (auditBtn) {
      auditBtn.addEventListener('click', () => void handleRunAudit())
    }

    const openPublishBtn = body.querySelector('[data-action="open-publish"]')
    if (openPublishBtn) {
      openPublishBtn.addEventListener('click', () => renderPublishForm(status))
    }

    body.querySelectorAll('[data-action="quick-export"]').forEach((el) => {
      el.addEventListener('click', () => {
        const fmt = el.getAttribute('data-fmt') || 'glb'
        const c = getToolContext()
        const exported = exportSceneFormat(c, fmt, 'StudioModel')
        if (exported.bytes && exported.bytes.length > 0) {
          const blob = new Blob([new Uint8Array(exported.bytes)], {type: 'application/octet-stream'})
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `StudioModel${exported.extension}`
          document.body.appendChild(a)
          a.click()
          setTimeout(() => {
            a.remove()
            URL.revokeObjectURL(url)
          }, 1000)
        } else if (c?.api && typeof c.api.execTool === 'function') {
          c.api.execTool(c, `app.export_${fmt}()`)
        }
      })
    })

    const retryImportBtn = body.querySelector('[data-action="retry-import"]')
    if (retryImportBtn) {
      retryImportBtn.addEventListener('click', () => void triggerModelImport())
    }

    const toggleTokenBtn = body.querySelector('[data-action="toggle-token-input"]')
    const tokenBox = body.querySelector('[data-role="token-box"]') as HTMLElement | null
    if (toggleTokenBtn && tokenBox) {
      toggleTokenBtn.addEventListener('click', () => {
        tokenBox.style.display = tokenBox.style.display === 'none' ? 'block' : 'none'
      })
    }

    const submitTokenBtn = body.querySelector('[data-action="submit-token"]')
    const tokenField = body.querySelector('[data-role="token-field"]') as HTMLInputElement | null
    if (submitTokenBtn && tokenField) {
      submitTokenBtn.addEventListener('click', () => {
        const val = tokenField.value.trim()
        if (val) {
          authToken = val
          try {
            localStorage.setItem('void_studio_token', val)
          } catch {}
          void checkSession().then(() => render())
        }
      })
    }
  }

  const triggerModelImport = async (): Promise<void> => {
    if (!importModelUrl) return
    modelImportStatus = {status: 'loading', message: 'Fetching 3D model from VOID·SPACE…'}
    void render()

    try {
      let res: Response | null = null

      // Attempt 1: Direct fetch with cache-busting to bypass poisoned disk cache
      try {
        const cacheBustUrl = importModelUrl.includes('?')
          ? `${importModelUrl}&_cb=${Date.now()}`
          : `${importModelUrl}?_cb=${Date.now()}`
        const directRes = await fetch(cacheBustUrl, { cache: 'no-store' })
        if (directRes.ok) {
          res = directRes
        }
      } catch (directErr) {
        // eslint-disable-next-line no-console
        console.warn('Direct fetch failed, trying proxy fallback...', directErr)
      }

      // Attempt 2: If direct fetch failed or threw CORS error, fetch via Studio API proxy
      if (!res || !res.ok) {
        try {
          const proxyUrl = `${base}/studio/api/v1/voidspace/model-proxy?url=${encodeURIComponent(importModelUrl)}`
          const proxyRes = await fetch(proxyUrl)
          if (proxyRes.ok) {
            res = proxyRes
          }
        } catch (proxyErr) {
          // eslint-disable-next-line no-console
          console.warn('Proxy fetch failed:', proxyErr)
        }
      }

      // Attempt 3: If still failing and URL is /ipfs/<cid>, try Kubo direct on port 8080
      if (!res || !res.ok) {
        const match = importModelUrl.match(/\/ipfs\/([a-zA-Z0-9]+)/)
        if (match) {
          const cid = match[1]
          try {
            const kuboUrl = `http://localhost:8080/ipfs/${cid}`
            const kuboRes = await fetch(kuboUrl)
            if (kuboRes.ok) {
              res = kuboRes
            }
          } catch {}
        }
      }

      if (!res || !res.ok) {
        throw new Error(res ? `Gateway returned HTTP ${res.status}` : 'Unable to fetch model bytes')
      }

      const arrayBuffer = await res.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)

      const ctx = getToolContext()
      if (!ctx || !ctx.scene) {
        setTimeout(() => void triggerModelImport(), 600)
        return
      }

      // 1. Determine format and filename
      const explicitFormat = (urlParams.get('format') || '').toLowerCase().trim()
      const explicitFilename = urlParams.get('filename') || ''

      let detectedExt = ''
      if (explicitFormat) {
        detectedExt = explicitFormat.startsWith('.') ? explicitFormat : '.' + explicitFormat
      } else if (explicitFilename && explicitFilename.includes('.')) {
        detectedExt = '.' + explicitFilename.split('.').pop()!.toLowerCase()
      } else {
        const urlPath = importModelUrl.split('?')[0].split('#')[0]
        const lastPart = urlPath.split('/').pop() || ''
        if (lastPart.includes('.')) {
          detectedExt = '.' + lastPart.split('.').pop()!.toLowerCase()
        }
      }

      // Sniff format from magic bytes if not detected
      if (!detectedExt) {
        // GLB magic: 0x46546c67 ('glTF' in little endian uint32 or bytes)
        const isGlb =
          bytes.length >= 12 &&
          bytes[0] === 0x67 &&
          bytes[1] === 0x6c &&
          bytes[2] === 0x54 &&
          bytes[3] === 0x46
        if (isGlb) {
          detectedExt = '.glb'
        } else {
          const headerPreview = new TextDecoder().decode(bytes.subarray(0, Math.min(1024, bytes.length)))
          if (headerPreview.includes('"asset"') || headerPreview.includes('"scenes"') || headerPreview.trim().startsWith('{')) {
            detectedExt = '.gltf'
          } else if (headerPreview.startsWith('solid') || (bytes.length >= 84 && bytes.length % 50 === 84)) {
            detectedExt = '.stl'
          } else if (/^\s*(#|v |vn |vt |f )/m.test(headerPreview)) {
            detectedExt = '.obj'
          } else {
            detectedExt = '.glb'
          }
        }
      }

      const cleanName = (explicitFilename || importAssetName || 'model').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_\- ]/g, '_')
      const targetFilename = `${cleanName}${detectedExt}`

      // Clean up default template / startup objects (e.g. startup cube) so user gets clean scene, while preserving lights and cameras
      if (ctx.scene && ctx.scene.objects) {
        const existingObs = [...ctx.scene.objects]
        for (const ob of existingObs) {
          const isLightOrCam =
            ob.data &&
            (ob.data instanceof Light ||
              (ob.data as any).constructor?.name === 'Light' ||
              (ob.data as any).constructor?.name === 'Camera' ||
              (ob.data as any).type === 'light' ||
              (ob.data as any).type === 'camera')
          if (isLightOrCam) continue

          ctx.scene.remove(ob)
          if (ctx.datalib) {
            ctx.datalib.remove(ob)
            if (ob.data) {
              ctx.datalib.remove(ob.data)
            }
          }
        }

        // Ensure scene has at least one light for render mode illumination
        if (!ctx.scene.lights || ctx.scene.lights.length === 0) {
          try {
            const light = new Light()
            ctx.datalib?.add(light)
            const lightOb = new SceneObject(light)
            ctx.datalib?.add(lightOb)
            lightOb.location[0] = 5.0
            lightOb.location[1] = -5.0
            lightOb.location[2] = 7.0
            ctx.scene.add(lightOb)
          } catch (lErr) {
            // eslint-disable-next-line no-console
            console.warn('Could not add fallback light:', lErr)
          }
        }
      }

      if (addonManager && !addonManager.isEnabled('leafmesh')) {
        addonManager.enable('leafmesh')
      }

      let fmt = formatForFilename(targetFilename)
      if (!fmt) {
        const formatId = detectedExt.replace(/^\./, '')
        fmt = getFileFormat(formatId) || getFileFormat('glb')
      }

      // If addons are still completing async boot, poll briefly for format registration
      if (!fmt || typeof fmt.importFromBytes !== 'function') {
        for (let attempt = 0; attempt < 12; attempt++) {
          if (addonManager && !addonManager.isEnabled('leafmesh')) {
            addonManager.enable('leafmesh')
          }
          await new Promise((resolve) => setTimeout(resolve, 250))
          fmt = formatForFilename(targetFilename) || getFileFormat(detectedExt.replace(/^\./, '')) || getFileFormat('glb')
          if (fmt && typeof fmt.importFromBytes === 'function') {
            break
          }
        }
      }

      // Dynamic fallback import if format is still not resolved
      if (!fmt || typeof fmt.importFromBytes !== 'function') {
        try {
          if (addonManager && !addonManager.isEnabled('leafmesh')) {
            addonManager.enable('leafmesh')
          }
          const addonUrl = new URL('./build/addons/leafmesh/src/main.js', document.baseURI).href
          const leafmeshMod = (await import(/* @vite-ignore */ addonUrl)) as any
          const extClean = detectedExt.replace(/^\./, '').toLowerCase()
          if (extClean === 'glb' || extClean === 'gltf') {
            fmt = leafmeshMod?.LEAFMESH_GLB_FORMAT
          } else if (extClean === 'obj') {
            fmt = leafmeshMod?.LEAFMESH_OBJ_FORMAT
          } else if (extClean === 'stl') {
            fmt = leafmeshMod?.LEAFMESH_STL_FORMAT
          } else if (extClean === 'ply') {
            fmt = leafmeshMod?.LEAFMESH_PLY_FORMAT
          }
          if (!fmt) {
            fmt = leafmeshMod?.LEAFMESH_GLB_FORMAT
          }
        } catch (dynErr) {
          // eslint-disable-next-line no-console
          console.warn('Fallback dynamic import failed:', dynErr)
        }
      }

      if (fmt && typeof fmt.importFromBytes === 'function') {
        fmt.importFromBytes(ctx, bytes, targetFilename)

        // Set document title
        document.title = `VOID·STUDIO — ${importAssetName}`

        // Find the active or imported scene object
        const scene = ctx.scene
        const activeOb =
          scene?.objects?.active ||
          (scene?.objects && scene.objects.length > 0
            ? scene.objects[scene.objects.length - 1]
            : undefined)

        if (activeOb && scene?.objects) {
          try {
            if (typeof scene.objects.setActive === 'function') {
              scene.objects.setActive(activeOb)
            }
            if (typeof scene.objects.setSelect === 'function') {
              scene.objects.setSelect(activeOb, true)
            }
          } catch (selErr) {
            // eslint-disable-next-line no-console
            console.warn('Could not set active/select object:', selErr)
          }

          // Switch toolmode to leafmesh or object so sculpt brush does not obscure model
          if (typeof scene.switchToolMode === 'function') {
            try {
              scene.switchToolMode('leafmesh')
            } catch {
              try {
                scene.switchToolMode('object')
              } catch {}
            }
          }

          // Frame camera on the imported model
          let view3d =
            (ctx as any).view3d ||
            (ctx.state as any)?.view3d ||
            (window as any)._appstate?.ctx?.view3d
          if (!view3d && ctx?.screen?.sareas) {
            for (const sarea of ctx.screen.sareas) {
              if (sarea.area && (sarea.area.constructor?.define?.().areaname === 'view3d' || typeof sarea.area.viewSelected === 'function')) {
                view3d = sarea.area
                break
              }
            }
          }
          if (view3d && typeof view3d.viewSelected === 'function') {
            try {
              view3d.viewSelected(activeOb)
            } catch (vErr) {
              // eslint-disable-next-line no-console
              console.warn('Could not frame viewSelected on imported object:', vErr)
            }
          }
        }

        const rw = window as unknown as {redraw_viewport?: (force?: boolean) => void}
        if (typeof rw.redraw_viewport === 'function') {
          rw.redraw_viewport(true)
          setTimeout(() => rw.redraw_viewport?.(true), 60)
          setTimeout(() => rw.redraw_viewport?.(true), 200)
          setTimeout(() => rw.redraw_viewport?.(true), 500)
        }

        const metrics = getActiveSceneMetrics(ctx)
        modelImportStatus = {
          status: 'success',
          message: `Loaded ${targetFilename} (${metrics.polycount.toLocaleString()} faces, ${(bytes.length / 1024 / 1024).toFixed(2)} MB)`,
        }
      } else {
        modelImportStatus = {
          status: 'error',
          message: `No importer found for ${targetFilename}`,
        }
      }
    } catch (err: unknown) {
      modelImportStatus = {
        status: 'error',
        message: `Import failed: ${(err as Error)?.message || String(err)}`,
      }
    }
    void render()
  }

  const handleRunAudit = async (): Promise<void> => {
    const auditBtn = body.querySelector('[data-action="run-audit"]') as HTMLButtonElement | null
    if (auditBtn) {
      auditBtn.disabled = true
      auditBtn.textContent = 'Auditing Scene…'
    }

    try {
      const projId = await ensureActiveProject()
      const metrics = metricsForAudit(getToolContext())

      const res = await fetch(`${base}/studio/api/v1/projects/${projId}/audit`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authToken ? {authorization: `Bearer ${authToken}`} : {}),
        },
        body: JSON.stringify({metrics, persist: false}),
      })

      if (!res.ok) {
        throw new Error(await errorMessage(res, 'Readiness audit failed'))
      }
      const auditRes = await res.json()
      const report = auditRes.report
      if (!report || typeof report.score !== 'number') {
        throw new Error('The audit response did not include a score.')
      }
      latestAudit = {
        score: report.score,
        passed: Boolean(report.passed),
        threshold: typeof report.threshold === 'number' ? report.threshold : 80,
        issues: Array.isArray(report.issues) ? report.issues : [],
      }
    } catch (error) {
      latestAudit = {
        score: 0,
        passed: false,
        threshold: 80,
        issues: [
          {
            severity: 'critical',
            category: 'format',
            message: error instanceof Error ? error.message : 'The Studio API could not run the audit.',
          },
        ],
      }
    }

    void render()
  }

  function exportSceneFormat(ctx: any, format: string, name: string): { bytes: Uint8Array; extension: string } {
    try {
      const fmt = getFileFormat(format.toLowerCase())
      if (fmt && typeof fmt.exportToBytes === 'function') {
        const res = fmt.exportToBytes(ctx)
        if (res instanceof Uint8Array && res.length > 0) {
          return { bytes: res, extension: `.${format.toLowerCase()}` }
        } else if (typeof res === 'string' && res.length > 0) {
          return { bytes: new TextEncoder().encode(res), extension: `.${format.toLowerCase()}` }
        } else if (res instanceof ArrayBuffer && res.byteLength > 0) {
          return { bytes: new Uint8Array(res), extension: `.${format.toLowerCase()}` }
        }
      }
    } catch (e) {
      console.warn(`Format exporter for ${format} fallback:`, e)
    }

    const exported = exportActiveSceneGlb(ctx, name)
    return { bytes: exported.bytes, extension: '.glb' }
  }

  const renderPublishForm = (status: BridgeStatus): void => {
    const target = body.querySelector('[data-role="publish-target"]') as HTMLElement | null
    if (!target) return

    // These are VOID·SPACE's defaults. A workspace may replace them; when the
    // status payload names that list, it wins, because a category outside it is
    // rejected after the export has already been built.
    const fallbackCategories = [
      'Machinery',
      'Safety Equipment',
      'Environment',
      'Character',
      'Prop',
      'Tooling',
      'Vehicle',
      'Architecture',
      'Other',
    ]
    const fromWorkspace = status.catalog?.allowedCategories ?? []
    const availableCategories = fromWorkspace.length > 0 ? [...fromWorkspace] : fallbackCategories

    target.innerHTML = `
      <div class="vsp__card" style="margin-top:8px; border-color:${p.accent}">
        <div class="vsp__name">Publish Scene to VOID·SPACE</div>
        <form class="vsp__form" data-role="publish-form">
          <div>
            <label class="vsp__k" style="font-size:10.5px">Asset Name</label>
            <input type="text" class="vsp__input" name="name" value="${esc(importAssetName || 'New 3D Model')}" required />
          </div>
          <div>
            <label class="vsp__k" style="font-size:10.5px">Publish Format</label>
            <select class="vsp__select" name="format">
              <option value="glb" selected>glTF 2.0 Binary (.glb) — Recommended (PBR & Textures)</option>
              <option value="fbx">Autodesk FBX (.fbx)</option>
              <option value="obj">Wavefront OBJ (.obj)</option>
              <option value="stl">Stereolithography (.stl)</option>
              <option value="ply">Stanford PLY (.ply)</option>
            </select>
          </div>
          <div>
            <label class="vsp__k" style="font-size:10.5px">Category</label>
            <select class="vsp__select" name="category">
              ${availableCategories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="vsp__k" style="font-size:10.5px">Tags (comma-separated)</label>
            <input type="text" class="vsp__input" name="tags" value="3d, model, void-studio" />
          </div>
          <div>
            <label class="vsp__k" style="font-size:10.5px">Description</label>
            <textarea class="vsp__textarea" name="description" rows="2">Authored in VOID·STUDIO with checked provenance.</textarea>
          </div>
          ${
            importAssetId
              ? `<div style="display:flex; gap:6px; align-items:center;">
                  <input type="checkbox" id="vsp-republish" name="republish" checked />
                  <label for="vsp-republish" style="font-size:11px">Publish as new version of ${esc(shorten(importAssetId, 8, 4))}</label>
                 </div>`
              : ''
          }
          <button type="submit" class="vsp__btn" data-role="submit-publish">
            Publish to VOID·SPACE
          </button>
        </form>
      </div>
    `

    const form = target.querySelector('[data-role="publish-form"]') as HTMLFormElement | null
    form?.addEventListener('submit', (e) => {
      e.preventDefault()
      const formData = new FormData(form)
      void handlePublishSubmit(formData, status, target)
    })
  }

  const handlePublishSubmit = async (
    data: FormData,
    status: BridgeStatus,
    target: HTMLElement,
    acknowledge = false,
  ): Promise<void> => {
    const submitBtn = target.querySelector('[data-role="submit-publish"]') as HTMLButtonElement | null
    if (submitBtn) {
      submitBtn.disabled = true
      submitBtn.textContent = 'Packaging & Ingesting…'
    }

    try {
      if (!authToken) {
        throw new Error('Please connect your VOID·SPACE account before publishing. Click "Sign in on VOID·SPACE" or "Token Link" above.')
      }

      const projId = await ensureActiveProject()
      const name = String(data.get('name') || '3D Asset')
      const category = String(data.get('category') || 'Props')
      const tags = String(data.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean)
      const description = String(data.get('description') || '')
      const shouldRepublish = Boolean(data.get('republish')) && importAssetId
      const chosenFormat = String(data.get('format') || 'glb').toLowerCase()

      target.innerHTML = `
        <div class="vsp__card" style="margin-top:8px; padding:12px; border-color:${p.accent};">
          <div style="font-weight:600; font-size:12px; color:${p.accent};">Checking readiness…</div>
          <div class="vsp__note" style="margin-top:6px">Scoring the scene before anything is uploaded.</div>
        </div>
      `

      const auditResponse = await fetch(`${base}/studio/api/v1/projects/${projId}/audit`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authToken ? {authorization: `Bearer ${authToken}`} : {}),
        },
        body: JSON.stringify({metrics: metricsForAudit(getToolContext()), persist: false}),
      })
      if (!auditResponse.ok) {
        throw new Error(await errorMessage(auditResponse, 'Readiness audit failed'))
      }
      const auditBody = await auditResponse.json()
      const report = auditBody.report
      if (!report || typeof report.score !== 'number') {
        throw new Error('The audit response did not include a score.')
      }
      latestAudit = {
        score: report.score,
        passed: Boolean(report.passed),
        threshold: typeof report.threshold === 'number' ? report.threshold : 80,
        issues: Array.isArray(report.issues) ? report.issues : [],
      }

      if (!latestAudit.passed && !acknowledge) {
        const issueList = latestAudit.issues
          .slice(0, 6)
          .map((issue) => `<li>${esc(issue.message || issue.category || 'Issue')}</li>`)
          .join('')
        target.innerHTML = `
          <div class="vsp__card" style="margin-top:8px; border-color:${p.gold};">
            <div class="vsp__name">Readiness ${latestAudit.score}/100</div>
            <div class="vsp__note">Below the recommended ${latestAudit.threshold}. Review can still accept it if you publish anyway.</div>
            ${issueList ? `<ul class="vsp__issues">${issueList}</ul>` : ''}
            <button type="button" class="vsp__btn" data-action="publish-anyway" style="margin-top:8px">Publish anyway</button>
            <button type="button" class="vsp__btn vsp__btn--subtle" data-action="publish-back" style="margin-top:6px">Back</button>
          </div>
        `
        target.querySelector('[data-action="publish-anyway"]')?.addEventListener('click', () => {
          void handlePublishSubmit(data, status, target, true)
        })
        target.querySelector('[data-action="publish-back"]')?.addEventListener('click', () => {
          void render()
        })
        return
      }

      const readiness = latestAudit
      if (!readiness) {
        throw new Error('The readiness audit did not produce a score.')
      }

      if (submitBtn) {
        submitBtn.disabled = true
        submitBtn.textContent = 'Publishing…'
      }

      // Progress Phase 1: Mesh & Transform Extraction
      target.innerHTML = `
        <div class="vsp__card" style="margin-top:8px; padding:12px; border-color:${p.accent}; background:rgba(13,14,20,0.95); border-radius:8px;">
          <div style="font-weight:600; font-size:12px; color:${p.accent}; margin-bottom:6px; display:flex; align-items:center; gap:8px;">
            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${p.accent}; box-shadow:0 0 10px ${p.accent}; animation:pulse 1.2s infinite;"></span>
            Extracting 3D Scene Geometry…
          </div>
          <div style="background:rgba(255,255,255,0.08); height:5px; border-radius:3px; overflow:hidden; margin:8px 0;">
            <div style="background:linear-gradient(90deg, ${p.accent}, #10b981); height:100%; width:28%; transition:width 0.3s ease;"></div>
          </div>
          <div style="font-size:11px; color:#9ca3af;">Reading vertex buffers, normals, and orientation transforms…</div>
        </div>
      `
      await new Promise((r) => setTimeout(r, 220))

      const ctx = getToolContext()
      const metrics = getActiveSceneMetrics(ctx)
      const exported = exportSceneFormat(ctx, chosenFormat, name)
      const fileBase64 = uint8ArrayToBase64(exported.bytes)
      const actualSizeBytes = exported.bytes.byteLength
      const isGltf = exported.extension === '.glb' || exported.extension === '.gltf'
      const sizeDisplay = actualSizeBytes > 1024 * 1024
        ? `${(actualSizeBytes / 1024 / 1024).toFixed(2)} MB`
        : `${(actualSizeBytes / 1024).toFixed(1)} KB`

      // Progress Phase 2: glTF Binary Compilation & Bounding Box
      target.innerHTML = `
        <div class="vsp__card" style="margin-top:8px; padding:12px; border-color:${p.accent}; background:rgba(13,14,20,0.95); border-radius:8px;">
          <div style="font-weight:600; font-size:12px; color:${p.accent}; margin-bottom:6px; display:flex; align-items:center; gap:8px;">
            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${p.accent}; box-shadow:0 0 10px ${p.accent}; animation:pulse 1.2s infinite;"></span>
            Compiling glTF 2.0 Binary (${sizeDisplay})…
          </div>
          <div style="background:rgba(255,255,255,0.08); height:5px; border-radius:3px; overflow:hidden; margin:8px 0;">
            <div style="background:linear-gradient(90deg, ${p.accent}, #10b981); height:100%; width:60%; transition:width 0.3s ease;"></div>
          </div>
          <div style="font-size:11px; color:#9ca3af;">Serialized ${metrics.polycount.toLocaleString()} polygons across ${metrics.vertCount.toLocaleString()} vertices with PBR metallic-roughness.</div>
        </div>
      `
      await new Promise((r) => setTimeout(r, 300))

      // Progress Phase 3: Streaming to VOID·SPACE Gateway
      target.innerHTML = `
        <div class="vsp__card" style="margin-top:8px; padding:12px; border-color:${p.accent}; background:rgba(13,14,20,0.95); border-radius:8px;">
          <div style="font-weight:600; font-size:12px; color:${p.accent}; margin-bottom:6px; display:flex; align-items:center; gap:8px;">
            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981; box-shadow:0 0 10px #10b981; animation:pulse 1.2s infinite;"></span>
            Streaming Asset to VOID·SPACE Gateway…
          </div>
          <div style="background:rgba(255,255,255,0.08); height:5px; border-radius:3px; overflow:hidden; margin:8px 0;">
            <div style="background:linear-gradient(90deg, ${p.accent}, #10b981); height:100%; width:85%; transition:width 0.3s ease;"></div>
          </div>
          <div style="font-size:11px; color:#9ca3af;">Streaming ${sizeDisplay} to repository endpoint…</div>
        </div>
      `

      const payload = {
        name,
        category,
        description,
        tags,
        export: {
          extension: exported.extension,
          sizeBytes: actualSizeBytes,
          polycount: metrics.polycount,
          textureResolutions: [],
          materialCount: metrics.materialCount,
          gltfHeaderValid: isGltf,
          unsupportedMaterialFeatures: [],
        },
        readiness,
        ...(!readiness.passed
          ? {
              acknowledgment: {
                acknowledgedBy: activeSession?.displayName ?? 'Studio Creator',
                acknowledgedAt: new Date().toISOString(),
              },
            }
          : {}),
        ...(shouldRepublish ? {republishAssetId: importAssetId} : {}),
        fileBase64,
        filename: `${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}${exported.extension}`,
      }

      const res = await fetch(`${base}/studio/api/v1/projects/${projId}/publish`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authToken ? {authorization: `Bearer ${authToken}`} : {}),
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        throw new Error(await errorMessage(res, 'Publish failed'))
      }

      const result = await res.json()
      const pub = result.publish || result
      const publishedAssetId = pub.voidspaceAssetId || pub.id || result.assetId || 'asset'
      const assetUrl = pub.url || `${status.links.catalogUrl}/${publishedAssetId}`
      const consoleUrl = `${status.links.consoleUrl}/console/assets/${publishedAssetId}`

      const isPublished = pub.status === 'published'
      target.innerHTML = `
        <div class="vsp__success" style="margin-top:8px; padding:12px; border-radius:8px; background:rgba(16, 185, 129, 0.12); border:1px solid #10b981;">
          <div style="font-weight:600; font-size:12px; margin-bottom:6px; color:#10b981; display:flex; align-items:center; gap:6px;">
            <span>✨</span> Successfully Published to VOID·SPACE!
          </div>
          <div class="vsp__row"><span class="vsp__k">Asset ID</span><span class="vsp__v vsp__mono">${esc(shorten(publishedAssetId, 10, 6))}</span></div>
          <div class="vsp__row"><span class="vsp__k">Status</span><span class="vsp__v" style="color:${p.accent}; text-transform:uppercase; font-size:10.5px; font-weight:600;">${esc(pub.status || 'pending')}</span></div>
          <div class="vsp__row"><span class="vsp__k">Size</span><span class="vsp__v">${sizeDisplay} (${metrics.polycount.toLocaleString()} polys)</span></div>
          ${pub.exportSha256 ? `<div class="vsp__row"><span class="vsp__k">SHA-256</span><span class="vsp__v vsp__mono" title="${esc(pub.exportSha256)}">${esc(shorten(pub.exportSha256, 8, 4))}</span></div>` : ''}
          ${!isPublished ? `<div style="font-size:11px; color:#9ca3af; margin-top:8px; line-height:1.4;">Asset submitted for review. Once approved by an assessor, it will appear publicly on the marketplace.</div>` : ''}
          <div class="vsp__links" style="margin-top:10px; display:flex; gap:8px;">
            <a class="vsp__btn vsp-open-console-link" href="${esc(consoleUrl)}" target="_blank" rel="noopener noreferrer" style="text-align:center; text-decoration:none; flex:1; cursor:pointer;" onclick="window.open('${esc(consoleUrl)}', '_blank'); return false;">Manage in Console ↗</a>
            ${isPublished ? `<a class="vsp__btn vsp__btn--subtle vsp-open-catalog-link" href="${esc(assetUrl)}" target="_blank" rel="noopener noreferrer" style="text-align:center; text-decoration:none; flex:1; cursor:pointer;" onclick="window.open('${esc(assetUrl)}', '_blank'); return false;">Public Entry ↗</a>` : ''}
          </div>
        </div>
      `

      // Ensure click handlers reliably open the link
      const openConsoleBtn = target.querySelector('.vsp-open-console-link') as HTMLElement | null
      if (openConsoleBtn) {
        openConsoleBtn.addEventListener('click', (ev) => {
          ev.preventDefault()
          window.open(consoleUrl, '_blank')
        })
      }
      const openCatBtn = target.querySelector('.vsp-open-catalog-link') as HTMLElement | null
      if (openCatBtn) {
        openCatBtn.addEventListener('click', (ev) => {
          ev.preventDefault()
          window.open(assetUrl, '_blank')
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Publish failed.'
      target.innerHTML = `
        <div class="vsp__card" style="margin-top:8px;">
          <div class="vsp__err">Publish failed: ${esc(message)}</div>
          <button type="button" class="vsp__btn vsp__btn--subtle" data-action="publish-back" style="margin-top:8px">Back</button>
        </div>
      `
      target.querySelector('[data-action="publish-back"]')?.addEventListener('click', () => {
        void render()
      })
    }
  }

  const ensureActiveProject = async (): Promise<string> => {
    if (activeProjectId) return activeProjectId
    const res = await fetch(`${base}/studio/api/v1/projects`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authToken ? {authorization: `Bearer ${authToken}`} : {}),
      },
      body: JSON.stringify({name: importAssetName || 'Studio Workspace Project', storageMode: 'local'}),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message ?? `Could not initialize project (HTTP ${res.status}). Ensure you are signed in.`)
    }
    const data = await res.json()
    activeProjectId = data.project?.id ?? data.id
    if (!activeProjectId) {
      throw new Error('Could not determine project id from the VOID·SPACE response.')
    }
    return activeProjectId
  }

  // Copilot View
  let copilotSessionId: string | null = null
  let copilotPending = false
  const copilotMessages: {role: 'user' | 'assistant'; text: string}[] = [
    {
      role: 'assistant',
      text: 'Ask for a change to this scene. Accepted commands are applied in the viewport as one undo step. Image-to-3D and PBR maps are below.',
    },
  ]

  const objectKey = (ob: any): string => String(ob?.lib_id ?? ob?.id ?? ob?.name ?? '')

  const placeImported = (ob: any, name: string, location: readonly number[], scale: readonly number[]): void => {
    ob.name = name
    if (ob.inputs?.loc) {
      const loc = new Vector3()
      loc[0] = location[0] ?? 0
      loc[1] = location[1] ?? 0
      loc[2] = location[2] ?? 0
      ob.inputs.loc.setValue(loc)
      ob.inputs.loc.graphUpdate?.()
    }
    if (ob.inputs?.scale) {
      const sc = new Vector3()
      sc[0] = scale[0] ?? 1
      sc[1] = scale[1] ?? 1
      sc[2] = scale[2] ?? 1
      ob.inputs.scale.setValue(sc)
      ob.inputs.scale.graphUpdate?.()
    }
    ob.graphUpdate?.()
  }

  const importMeshBytes = (
    ctx: any,
    name: string,
    bytes: Uint8Array,
    location: readonly [number, number, number],
    scale: readonly [number, number, number],
  ): string => {
    if (addonManager && !addonManager.isEnabled('leafmesh')) addonManager.enable('leafmesh')
    const fmt = formatForFilename(`${name}.glb`) || getFileFormat('glb')
    if (!fmt || typeof fmt.importFromBytes !== 'function') {
      throw new Error('The GLB importer is not ready yet. Wait for the editor to finish loading.')
    }
    const before = new Set((ctx.scene?.objects ? [...ctx.scene.objects] : []).map(objectKey))
    fmt.importFromBytes(ctx, bytes, `${name}.glb`)
    const list = ctx.scene?.objects ? [...ctx.scene.objects] : []
    const created = list.find((ob) => !before.has(objectKey(ob))) ?? ctx.scene?.objects?.active
    if (!created) throw new Error('The mesh imported, but no new object appeared in the scene.')
    placeImported(created, name, location, scale)
    ctx.scene?.objects?.setActive?.(created)
    ctx.scene?.objects?.setSelect?.(created, true)
    return objectKey(created)
  }

  const pixelsToDataUrl = (pixels: Uint8ClampedArray, size: number): string => {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const g = canvas.getContext('2d')
    if (!g) throw new Error('Could not draw a texture.')
    g.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0)
    return canvas.toDataURL('image/png')
  }

  const reliefFromDataUrl = async (dataUrl: string) => {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Could not read that image.'))
      img.src = dataUrl
    })
    const edge = 48
    const canvas = document.createElement('canvas')
    canvas.width = edge
    canvas.height = edge
    const g = canvas.getContext('2d')
    if (!g) throw new Error('Could not sample that image.')
    g.drawImage(image, 0, 0, edge, edge)
    const data = g.getImageData(0, 0, edge, edge).data
    const luminance = new Float32Array(edge * edge)
    for (let i = 0; i < edge * edge; i++) {
      const offset = i * 4
      luminance[i] = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255
    }
    return heightfieldFromLuminance(luminance, edge, edge)
  }

  const sceneIo = () => ({
    importBuffers: (ctx: any, name: string, buffers: {positions: Float32Array; normals: Float32Array; indices: Uint32Array; uvs: Float32Array}, location: readonly [number, number, number], scale: readonly [number, number, number]) => {
      const bytes = packGlbBinary(name, buffers.positions, buffers.normals, buffers.indices, [0.85, 0.88, 0.94, 1], 0.35, 0.4, {uv: buffers.uvs})
      return importMeshBytes(ctx, name, bytes, location, scale)
    },
    importGlb: importMeshBytes,
    applyMaps: (ctx: any, objectId: string, maps: PbrAssignment) => {
      const list = ctx.scene?.objects ? [...ctx.scene.objects] : []
      const ob = list.find((item) => objectKey(item) === objectId || String(item?.name ?? '') === objectId)
      if (!ob) throw new Error('No object is selected for the PBR maps.')
      applyTextureToMeshObject(ctx, ob, pixelsToDataUrl(maps.albedo, maps.size), 'Albedo')
      const channels: ReadonlyArray<readonly [string, Uint8ClampedArray]> = [
        ['Normal', maps.normal],
        ['Roughness', maps.roughness],
        ['Metallic', maps.metallic],
      ]
      for (const [label, pixels] of channels) {
        const block = new ImageBlock()
        block.name = `${ob.name || 'Mesh'}_${label}`
        block.type = ImageTypes.URL
        block.url = pixelsToDataUrl(pixels, maps.size)
        block.update()
        ctx.datalib.add(block)
      }
      const mat = ob.material || ob.data?.material || ob.data?.materials?.[0]
      const nodes = mat?.graph?.nodes
      if (nodes) {
        for (const node of nodes) {
          if (node instanceof DiffuseNode || node?.constructor?.name === 'DiffuseNode') {
            node.inputs?.roughness?.setValue?.(maps.roughnessValue)
            if (node.inputs?.color?.setValue) {
              const color = new Vector4()
              const hex = maps.baseColor.replace('#', '')
              color[0] = Number.parseInt(hex.slice(0, 2), 16) / 255
              color[1] = Number.parseInt(hex.slice(2, 4), 16) / 255
              color[2] = Number.parseInt(hex.slice(4, 6), 16) / 255
              color[3] = 1
              node.inputs.color.setValue(color)
            }
          }
        }
      }
      if (mat) {
        mat.metallic = maps.metallicValue
        mat._regen = true
      }
      ob.graphUpdate?.()
    },
  })

  const prepareMesh = async (input: Record<string, unknown>) => {
    const prompt = typeof input.prompt === 'string' ? input.prompt : ''
    const imageRef = typeof input.imageRef === 'string' ? input.imageRef : ''
    if (imageRef.startsWith('data:image')) {
      if (authToken) {
        const meshy = await fetchMeshyGlb(base, authToken, {kind: 'image-to-3d', imageUrl: imageRef, ...(prompt ? {prompt} : {})})
        if ('bytes' in meshy) return {glb: meshy.bytes, note: 'Meshy image-to-3D.'}
        const buffers = await reliefFromDataUrl(imageRef)
        const why = 'failed' in meshy ? meshy.failed : 'Meshy is not configured.'
        return {buffers, note: `${why} Local relief mesh from the image. This is a height field, not a reconstructed object.`}
      }
      const buffers = await reliefFromDataUrl(imageRef)
      return {buffers, note: 'Local relief mesh from the image. Meshy is not configured, so this is a height field, not a reconstructed object.'}
    }
    if (prompt && authToken) {
      const meshy = await fetchMeshyGlb(base, authToken, {kind: 'text-to-3d', prompt})
      if ('bytes' in meshy) return {glb: meshy.bytes, note: 'Meshy text-to-3D.'}
      if ('failed' in meshy) {
        const kind = primitiveForPrompt(prompt)
        return {buffers: buildPrimitive(kind), note: `${meshy.failed} Local ${kind} stand-in instead.`}
      }
    }
    const kind = primitiveForPrompt(prompt || 'object')
    return {
      buffers: buildPrimitive(kind),
      note: `Local ${kind} stand-in. Meshy is not configured, so the prompt did not become a generated model.`,
    }
  }

  const runSceneCalls = async (
    calls: {name: string; input: Record<string, unknown>}[],
  ): Promise<{lines: string[]; commandId: string}> => {
    const prepared = await Promise.all(
      calls.map(async (call) => {
        if (call.name === 'generateMesh') return prepareMesh(call.input)
        if (call.name === 'generateTexture') {
          const prompt = String(call.input.prompt ?? 'surface')
          const maps = pbrFromPrompt(prompt, 128)
          return {
            maps,
            note: `Local ${maps.label} PBR maps assigned. Albedo is on the material. Normal, roughness and metallic are stored with it. A Meshy texture needs a public mesh URL, which this draft does not have.`,
          }
        }
        return null
      }),
    )
    return applyEditorCommands(getToolContext(), commandsForToolCalls(calls, prepared), sceneIo())
  }

  const renderCopilotView = (): void => {
    body.innerHTML = `
      <div class="vsp__chat">
        <div class="vsp__gen">
          <div class="vsp__gen-row">
            <input class="vsp__file" data-role="image-file" type="file" accept="image/png,image/jpeg,image/webp" />
            <button type="button" class="vsp__btn" data-role="image-go" style="width:auto; padding:5px 10px">Image to 3D</button>
          </div>
          <form class="vsp__gen-row" data-role="pbr-form">
            <input class="vsp__input" name="pbr" placeholder="PBR prompt, e.g. brushed chrome" />
            <button type="submit" class="vsp__btn" style="width:auto; padding:5px 10px">PBR maps</button>
          </form>
        </div>
        <div class="vsp__chips">
          <span class="vsp__chip" data-prompt="Check topology and polygon budget">Audit budget</span>
          <span class="vsp__chip" data-prompt="Create metallic industrial crate">Add crate</span>
          <span class="vsp__chip" data-prompt="Apply brushed chrome PBR material">Chrome material</span>
        </div>
        <div class="vsp__chat_stream" data-role="chat-stream">
          ${copilotMessages
            .map((m) => {
              const bodyText = m.role === 'assistant' ? readableCopilotText(m.text) || m.text.trim() : m.text
              return `
            <div class="vsp__msg vsp__msg--${m.role === 'user' ? 'user' : 'ai'}">
              ${esc(bodyText)}
            </div>
          `
            })
            .join('')}
          ${copilotPending ? `<div class="vsp__msg vsp__msg--ai vsp__msg--pending">Working on that…</div>` : ''}
        </div>
        <form class="vsp__chat_row" data-role="copilot-form">
          <input type="text" class="vsp__input" name="prompt" placeholder="Ask Copilot..." autocomplete="off" required />
          <button type="submit" class="vsp__btn" style="width:auto; padding:5px 12px">Send</button>
        </form>
      </div>
    `

    const form = body.querySelector('[data-role="copilot-form"]') as HTMLFormElement | null
    form?.addEventListener('submit', (e) => {
      e.preventDefault()
      const input = form.querySelector('input[name="prompt"]') as HTMLInputElement
      const val = input.value.trim()
      if (val) {
        input.value = ''
        void sendCopilotMessage(val)
      }
    })

    const chips = body.querySelectorAll('.vsp__chip')
    chips.forEach((c) => {
      c.addEventListener('click', () => {
        const text = (c as HTMLElement).dataset.prompt
        if (text) void sendCopilotMessage(text)
      })
    })

    body.querySelector('[data-role="image-go"]')?.addEventListener('click', () => {
      const file = (body.querySelector('[data-role="image-file"]') as HTMLInputElement | null)?.files?.[0]
      if (file) void sendImageToMesh(file)
    })

    const pbrForm = body.querySelector('[data-role="pbr-form"]') as HTMLFormElement | null
    pbrForm?.addEventListener('submit', (event) => {
      event.preventDefault()
      const prompt = (pbrForm.querySelector('input[name="pbr"]') as HTMLInputElement | null)?.value.trim() ?? ''
      if (prompt) void sendPbrPrompt(prompt)
    })

    const stream = body.querySelector('[data-role="chat-stream"]')
    if (stream) stream.scrollTop = stream.scrollHeight
  }

  const pushAssistant = (text: string): void => {
    copilotMessages.push({role: 'assistant', text})
    renderCopilotView()
  }

  const sendImageToMesh = async (file: File): Promise<void> => {
    copilotMessages.push({role: 'user', text: `Image to 3D: ${file.name}`})
    renderCopilotView()
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read that image.'))
        reader.readAsDataURL(file)
      })
      const applied = await runSceneCalls([
        {name: 'generateMesh', input: {imageRef: dataUrl, name: file.name.replace(/\.[^.]+$/, '') || 'Image draft'}},
      ])
      pushAssistant(applied.lines.join('\n'))
    } catch (error) {
      pushAssistant(error instanceof Error ? error.message : 'Image-to-3D failed.')
    }
  }

  const sendPbrPrompt = async (promptText: string): Promise<void> => {
    copilotMessages.push({role: 'user', text: `PBR: ${promptText}`})
    renderCopilotView()
    try {
      const scene = summarizeScene(getToolContext())
      const objectId = scene.selection[0] ?? '$active'
      const applied = await runSceneCalls([{name: 'generateTexture', input: {objectId, prompt: promptText}}])
      pushAssistant(applied.lines.join('\n'))
    } catch (error) {
      pushAssistant(error instanceof Error ? error.message : 'The PBR maps could not be built.')
    }
  }

  const sendCopilotMessage = async (promptText: string): Promise<void> => {
    copilotMessages.push({role: 'user', text: promptText})
    copilotPending = true
    renderCopilotView()

    try {
      const localCalls = () =>
        interpretInstruction(promptText, summarizeScene(getToolContext())).map((call) => ({
          name : call.name,
          input: call.input,
        }))

      if (!authToken) {
        const local = localCalls()
        if (local.length === 0) {
          throw new Error('Sign in from VOID·SPACE before using the Copilot. The editor does not keep a model credential of its own.')
        }
        const applied = await runSceneCalls(local)
        copilotMessages.push({
          role: 'assistant',
          text: `${applied.lines.join('\n')}\n\nSigned out, so this was a local command rather than the model. Undo reverses the whole step.`,
        })
        return
      }

      if (!copilotSessionId) {
        const projId = await ensureActiveProject()
        const sessRes = await fetch(`${base}/studio/api/v1/copilot/sessions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({projectId: projId, title: promptText.slice(0, 80)}),
        })
        if (!sessRes.ok) {
          throw new Error(await errorMessage(sessRes, 'Could not open a Copilot session'))
        }
        const sess = await sessRes.json()
        copilotSessionId = sess.session?.id ?? null
        if (!copilotSessionId) {
          throw new Error('The Studio API did not return a Copilot session.')
        }
      }

      const msgRes = await fetch(`${base}/studio/api/v1/copilot/sessions/${copilotSessionId}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          instruction: promptText,
          scene: summarizeScene(getToolContext()),
        }),
      })
      if (!msgRes.ok) {
        throw new Error(await errorMessage(msgRes, 'The Copilot could not answer'))
      }
      const res = await msgRes.json()
      const prose = readableCopilotText(String(res.messages?.assistant?.content ?? ''))
      const modelCalls = Array.isArray(res.applied)
        ? res.applied
            .filter((call: {name?: string}) => typeof call?.name === 'string')
            .map((call: {name: string; input?: Record<string, unknown>}) => ({
              name : call.name,
              input: call.input ?? {},
            }))
        : []
      const rejected = Array.isArray(res.rejected) ? res.rejected.length : 0
      const parts = prose ? [prose] : []
      const calls = modelCalls.length > 0 ? modelCalls : localCalls()
      if (calls.length > 0) {
        const applied = await runSceneCalls(calls)
        parts.push(applied.lines.join('\n'))
        parts.push(
          modelCalls.length > 0
            ? 'Applied in the viewport as one undo step.'
            : 'The model returned no scene command, so a local reading of the instruction was applied. Undo reverses the whole step.',
        )
        const messageId = res.messages?.assistant?.id
        if (messageId && copilotSessionId) {
          void fetch(`${base}/studio/api/v1/copilot/sessions/${copilotSessionId}/messages/${messageId}/applied`, {
            method : 'POST',
            headers: {'content-type': 'application/json', authorization: `Bearer ${authToken}`},
            body   : JSON.stringify({appliedCommandIds: [applied.commandId]}),
          }).catch(() => undefined)
        }
      }
      if (rejected > 0) {
        const why = res.rejected
          .map((call: {message?: string; reason?: string}) => call.message || call.reason)
          .filter(Boolean)
          .slice(0, 3)
        parts.push(`${rejected} proposal${rejected === 1 ? '' : 's'} refused.${why.length ? ` ${why.join(' ')}` : ''}`)
      }
      if (parts.length === 0) {
        parts.push(
          calls.length > 0
            ? 'The scene change is applied below.'
            : 'The Copilot did not return an explanation. Try a shorter instruction, such as “Create a red metal crate”.',
        )
      }
      copilotMessages.push({role: 'assistant', text: parts.join('\n\n')})
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The Copilot could not answer.'
      const local = interpretInstruction(promptText, summarizeScene(getToolContext())).map((call) => ({
        name : call.name,
        input: call.input,
      }))
      if (local.length === 0) {
        copilotMessages.push({role: 'assistant', text: message})
      } else {
        try {
          const applied = await runSceneCalls(local)
          copilotMessages.push({
            role: 'assistant',
            text: `${message}\n\n${applied.lines.join('\n')}\n\nA local reading of the instruction was applied instead. Undo reverses the whole step.`,
          })
        } catch (applyError) {
          const why = applyError instanceof Error ? applyError.message : 'The local command also failed.'
          copilotMessages.push({role: 'assistant', text: `${message}\n\n${why}`})
        }
      }
    } finally {
      copilotPending = false
    }
    renderCopilotView()
  }

  await checkSession()
  await render()

  if (importModelUrl) {
    setTimeout(() => void triggerModelImport(), 600)
  }

  // Drag and drop 3D models and textures onto the viewport
  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return

    const file = files[0]
    const ext = '.' + file.name.split('.').pop()!.toLowerCase()
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp']

    if (imageExtensions.includes(ext)) {
      const c = getToolContext()
      const ob = c?.scene?.objects?.active || [...(c?.scene?.objects || [])].find((o: any) => o?.data)
      if (!ob) {
        alert('Please select or create a 3D model first before applying a texture.')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        applyTextureToMeshObject(c, ob, reader.result as string, file.name)
        void render()
      }
      reader.readAsDataURL(file)
    } else {
      const fmt = formatForFilename(file.name) || getFileFormat(ext.slice(1))
      if (fmt && typeof fmt.importFromBytes === 'function') {
        const c = getToolContext()
        const buf = await file.arrayBuffer()
        fmt.importFromBytes(c, new Uint8Array(buf), file.name)
        const rw = window as any
        rw.redraw_viewport?.(true)
        void render()
      }
    }
  }

  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)

  const handle: VoidSpacePanelHandle = {
    element: root,
    refresh: render,
    unmount(): void {
      if (pollTimer !== undefined) {
        window.clearInterval(pollTimer)
        pollTimer = undefined
      }
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('storage', onStorageChange)
      document.removeEventListener('visibilitychange', onVisible)
      triggerBtn.remove()
      root.remove()
      if (panel === handle) {
        panel = undefined
      }
    },
  }

  panel = handle
  return handle
}
