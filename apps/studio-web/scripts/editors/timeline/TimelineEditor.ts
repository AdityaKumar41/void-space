import {readWorkflow} from '../../core/object_workflows'
/**
 * Timeline — Blender Layout's bottom animation strip (subset).
 *
 * Transport + playhead scrubbing over scene.time / timeStart / timeEnd.
 * docs.blender.org → Editors → Timeline
 */
import {Editor} from '../editor_base'
import {Icons} from '../icon_enum.js'
import {BorderMask, nstructjs, UIBase, type Container} from '../../path.ux/scripts/pathux.js'
import type {ViewContext} from '../../core/context'
import {VOID_STUDIO_PALETTE as p} from '../../voidspace/theme.js'

const TIMELINE_H = 96

function setStyle(el: {style: CSSStyleDeclaration}, props: Record<string, string>) {
  for (const [k, v] of Object.entries(props)) {
    el.style.setProperty(k, v)
  }
}

function frameOf(scene: {time?: number}): number {
  return Math.round(Number(scene.time) || 0)
}

export class TimelineEditor extends Editor {
  static STRUCT = nstructjs.inlineRegister(
    this,
    `
TimelineEditor {
}
  `
  )

  body!: Container<ViewContext>
  _frameLabel: {text: string; style: CSSStyleDeclaration} | undefined
  _rangeLabel: {text: string; style: CSSStyleDeclaration} | undefined
  _playBtn: {name: string; title?: string} | undefined
  _scrub!: HTMLCanvasElement
  _lastKey = ''
  _lastPlayTs = 0
  _dragging = false

  constructor() {
    super()
    this.areaDragToolEnabled = false
    this.borderLock = BorderMask.TOP | BorderMask.BOTTOM
    this.minSize[1] = TIMELINE_H
    this.maxSize[1] = TIMELINE_H
  }

  static define() {
    return {
      tagname : 'timeline-editor-x',
      areaname: 'TimelineEditor',
      uiname  : 'Timeline',
      icon    : Icons.SHOW_ANIMPATHS,
      flag    : 0,
    }
  }

  init() {
    super.init()
    this.background = p.surface2
    this.style.overflow = 'hidden'

    this.body = this.container.row()
    setStyle(this.body, {
      'align-items': 'center',
      gap: '6px',
      padding: '0 8px',
      height: `48px`,
      'font-size': '11px',
    })

    // Transport — Blender header: jump start / prev / play / next / jump end.
    const jumpStart = this.body.button('|◀', () => this.jumpToStart())
    jumpStart.title = 'Jump to Start'
    const prev = this.body.button('◀', () => this.stepFrame(-1))
    prev.title = 'Previous Frame'
    this._playBtn = this.body.button('▶', () => this.togglePlay())
    this._playBtn.title = 'Play / Pause'
    const next = this.body.button('▶', () => this.stepFrame(1))
    next.title = 'Next Frame'
    next.name = '▶|'
    const jumpEnd = this.body.button('▶▶', () => this.jumpToEnd())
    jumpEnd.title = 'Jump to End'

    const insert = this.body.button('◆', () => this.ctx.api.execTool(this.ctx, 'object.workflow(action=KEY_INSERT)'))
    insert.title = 'Insert Transform / Pose Keyframe'
    const remove = this.body.button('◇', () => this.ctx.api.execTool(this.ctx, 'object.workflow(action=KEY_DELETE)'))
    remove.title = 'Delete Keyframe at Current Frame'

    this._frameLabel = this.body.label('Frame 1')
    this._frameLabel.style.color = p.fg
    this._frameLabel.style.fontWeight = '600'
    this._frameLabel.style.minWidth = '72px'

    this._scrub = document.createElement('canvas')
    this._scrub.height = 28
    setStyle(this._scrub, {
      flex: '1',
      'min-width': '120px',
      height: '28px',
      cursor: 'ew-resize',
      'border-radius': '2px',
      background: p.surface,
    })
    this.body.shadow.appendChild(this._scrub)

    this._rangeLabel = this.body.label('1–250')
    this._rangeLabel.style.color = p.fgDim
    this._rangeLabel.style.minWidth = '64px'

    this._bindScrub()
    this.flushChrome()
  }

  _bindScrub() {
    const canvas = this._scrub
    const pick = (e: PointerEvent) => {
      const scene = this.ctx?.scene
      if (!scene) return
      const rect = canvas.getBoundingClientRect()
      const t = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(rect.width, 1)))
      const start = Number(scene.timeStart) || 1
      const end = Math.max(start + 1, Number(scene.timeEnd) || 250)
      const frame = Math.round(start + t * (end - start))
      scene.changeTime(frame)
      this.flushChrome()
    }

    canvas.addEventListener('pointerdown', (e) => {
      this._dragging = true
      canvas.setPointerCapture(e.pointerId)
      pick(e)
      e.preventDefault()
    })
    canvas.addEventListener('pointermove', (e) => {
      if (!this._dragging) return
      pick(e)
    })
    canvas.addEventListener('pointerup', () => {
      this._dragging = false
    })
    canvas.addEventListener('pointercancel', () => {
      this._dragging = false
    })
  }

  ensureFrameRange(scene: any) {
    // Blender default scene range is 1–250 @ 24 fps when unset / legacy tiny range.
    if (!(scene.timeEnd > scene.timeStart) || scene.timeEnd <= 10) {
      scene.timeStart = 1
      scene.timeEnd = 250
    }
    if (!(scene.fps > 0)) scene.fps = 24
  }

  jumpToStart() {
    const scene = this.ctx?.scene
    if (!scene) return
    this.ensureFrameRange(scene)
    this.ctx.stop()
    scene.changeTime(scene.timeStart)
    this.flushChrome()
  }

  jumpToEnd() {
    const scene = this.ctx?.scene
    if (!scene) return
    this.ensureFrameRange(scene)
    this.ctx.stop()
    scene.changeTime(scene.timeEnd)
    this.flushChrome()
  }

  stepFrame(delta: number) {
    const scene = this.ctx?.scene
    if (!scene) return
    this.ensureFrameRange(scene)
    const next = Math.min(scene.timeEnd, Math.max(scene.timeStart, frameOf(scene) + delta))
    scene.changeTime(next)
    this.flushChrome()
  }

  togglePlay() {
    if (this.ctx.playing) this.ctx.stop()
    else this.ctx.play()
    this._lastPlayTs = performance.now()
    this.flushChrome()
  }

  flushChrome() {
    const scene = this.ctx?.scene
    if (!scene || !this._frameLabel) return
    this.ensureFrameRange(scene)

    const frame = frameOf(scene)
    const start = Math.round(scene.timeStart)
    const end = Math.round(scene.timeEnd)
    const playing = !!this.ctx.playing

    this._frameLabel.text = `Frame ${frame}`
    if (this._rangeLabel) this._rangeLabel.text = `${start}–${end}`
    if (this._playBtn) this._playBtn.name = playing ? '❚❚' : '▶'

    this.drawScrub(frame, start, end)
  }

  drawScrub(frame: number, start: number, end: number) {
    const canvas = this._scrub
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cssW = Math.max(canvas.clientWidth || 200, 40)
    const cssH = 28
    const w = Math.floor(cssW * dpr)
    const h = Math.floor(cssH * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const g = canvas.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, cssW, cssH)

    g.fillStyle = p.surface
    g.fillRect(0, 0, cssW, cssH)
    g.strokeStyle = p.lineStrong
    g.strokeRect(0.5, 0.5, cssW - 1, cssH - 1)

    const span = Math.max(1, end - start)
    const xOf = (f: number) => ((f - start) / span) * cssW
    g.fillStyle = p.fgFaint
    for (let f = start; f <= end; f += 10) {
      const x = xOf(f)
      const major = f % 50 === 0 || f === start || f === end
      g.fillRect(x, major ? 4 : 12, 1, major ? cssH - 8 : cssH - 16)
    }

    for (const key of readWorkflow(this.ctx?.object?.workflow).keys) {
      if (key.frame < start || key.frame > end) continue
      const x = xOf(key.frame)
      g.fillStyle = '#e9b64e'
      g.beginPath(); g.moveTo(x, 10); g.lineTo(x + 4, 14); g.lineTo(x, 18); g.lineTo(x - 4, 14); g.closePath(); g.fill()
    }

    const px = xOf(frame)
    g.fillStyle = '#4a90d9'
    g.fillRect(px - 1, 0, 2, cssH)
    g.beginPath()
    g.moveTo(px, 0)
    g.lineTo(px + 5, 8)
    g.lineTo(px - 5, 8)
    g.closePath()
    g.fill()
  }

  update() {
    super.update()

    if (this.minSize[1] !== TIMELINE_H) {
      this.minSize[1] = TIMELINE_H
      this.maxSize[1] = TIMELINE_H
      try {
        this.ctx?.screen?.solveAreaConstraints()
      } catch {
        // early boot
      }
    }

    const scene = this.ctx?.scene
    if (!scene) return
    this.ensureFrameRange(scene)

    const driver = this.ctx.screen.sareas.find(sa => sa.area instanceof TimelineEditor)?.area
    if (this.ctx.playing && driver === this) {
      const now = performance.now()
      if (!this._lastPlayTs) this._lastPlayTs = now
      const fps = Math.max(1, Number(scene.fps) || 24)
      const elapsed = (now - this._lastPlayTs) / 1000
      if (elapsed >= 1 / fps) {
        const steps = Math.floor(elapsed * fps)
        this._lastPlayTs += (steps / fps) * 1000
        let next = frameOf(scene) + steps
        if (next > scene.timeEnd) next = scene.timeStart
        scene.changeTime(next)
      }
    } else {
      this._lastPlayTs = 0
    }

    const key = `${this.ctx.object?.workflow}|${frameOf(scene)}|${scene.timeStart}|${scene.timeEnd}|${this.ctx.playing}|${this._scrub?.clientWidth}`
    if (key === this._lastKey) return
    this._lastKey = key
    this.flushChrome()
  }

  on_area_inactive() {
    this.ctx?.stop()
    this._lastPlayTs = 0
    super.on_area_inactive()
  }

  copy() {
    const ret = UIBase.createElement('timeline-editor-x') as this
    ret.ctx = this.ctx
    return ret
  }
}

Editor.register(TimelineEditor)
