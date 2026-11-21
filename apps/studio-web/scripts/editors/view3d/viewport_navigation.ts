import type {View3D} from './view3d'
import {poseBones, readWorkflow} from '../../core/object_workflows'
import {Vector3} from '../../util/vectormath'

/** Screen-space controls stay independent of scene geometry and picking. */
export class ViewportNavigation {
  readonly element = document.createElement('div')
  private readonly axes: HTMLButtonElement[] = []
  private readonly caption = document.createElement('div')
  private readonly rigOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg')

  constructor(private readonly view: View3D) {
    const host = this.element
    host.className = 'viewport-navigation'
    host.style.cssText = 'position:absolute;right:24px;top:40px;width:88px;height:200px;pointer-events:none;z-index:8'
    const style = document.createElement('style')
    style.textContent = `
      .viewport-navigation button {position:absolute;width:25px;height:25px;padding:0;border:1px solid #262626;
        border-radius:50%;background:#444;color:#ddd;font:600 11px system-ui;pointer-events:auto;cursor:pointer}
      .viewport-navigation button:hover {filter:brightness(1.35);border-color:#aaa}
      .viewport-navigation button:focus-visible {outline:2px solid #85b5ff;outline-offset:2px}
      .viewport-view-label {position:absolute;top:39px;left:62px;color:#b8b8b8;font:11px system-ui;
        pointer-events:none;z-index:7;white-space:pre;line-height:1.7}
    `
    view.shadow.appendChild(style)
    view.shadow.appendChild(host)
    this.caption.className = 'viewport-view-label'
    view.shadow.appendChild(this.caption)
    this.rigOverlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6'
    this.rigOverlay.setAttribute('aria-label', 'FK rig bones')
    view.shadow.appendChild(this.rigOverlay)
    for (const [axis, label, color] of [
      [0, 'X', '#b85c64'],
      [1, 'Y', '#83a752'],
      [2, 'Z', '#668fc2'],
    ] as const) {
      const button = this.button(label, `View ${label} axis`, () => {
        view.viewAxis(axis)
        view.cameraMode = 1
        window.redraw_viewport(true)
      })
      button.style.background = color
      button.style.color = '#161616'
      this.axes.push(button)
    }
    const controls: [string, string, () => void][] = [
      ['+', 'Zoom in', () => this.zoom(0.8)],
      ['−', 'Zoom out', () => this.zoom(1.25)],
      ['⌖', 'Frame selected', () => view.viewSelected()],
      [
        '▦',
        'Toggle perspective / orthographic',
        () => {
          view.cameraMode ^= 1
          window.redraw_viewport(true)
        },
      ],
    ]
    controls.forEach(([label, title, action], i) => {
      const button = this.button(label, title, action)
      button.style.right = '5px'
      button.style.top = `${90 + i * 28}px`
    })
  }

  private button(text: string, title: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.textContent = text
    button.title = title
    button.setAttribute('aria-label', title)
    button.addEventListener('pointerdown', (event) => event.stopPropagation())
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      action()
    })
    this.element.appendChild(button)
    return button
  }

  private zoom(factor: number): void {
    const camera = this.view.activeCamera
    if (camera.pos.vectorDistance(camera.target) * factor < camera.near * 5) return
    camera.pos.sub(camera.target).mulScalar(factor).add(camera.target)
    window.redraw_viewport(true)
  }

  private updateRig(): void {
    const ob = this.view.ctx?.object
    this.rigOverlay.replaceChildren()
    const rig = ob && readWorkflow(ob.workflow).rig
    if (!rig || !ob) return
    const ns = 'http://www.w3.org/2000/svg'
    for (const bone of poseBones(rig.bones)) {
      const head = new Vector3(bone.head), tail = new Vector3(bone.tail)
      head.multVecMatrix(ob.outputs.matrix.getValue()); tail.multVecMatrix(ob.outputs.matrix.getValue())
      this.view.project(head); this.view.project(tail)
      if (![...head, ...tail].every(Number.isFinite)) continue
      const line = document.createElementNS(ns, 'line')
      line.setAttribute('x1', String(head[0])); line.setAttribute('y1', String(head[1]))
      line.setAttribute('x2', String(tail[0])); line.setAttribute('y2', String(tail[1]))
      line.setAttribute('stroke', '#8bc5ff'); line.setAttribute('stroke-width', '4')
      this.rigOverlay.appendChild(line)
      for (const point of [head, tail]) {
        const joint = document.createElementNS(ns, 'circle')
        joint.setAttribute('cx', String(point[0])); joint.setAttribute('cy', String(point[1]))
        joint.setAttribute('r', '4'); joint.setAttribute('fill', '#d1e8ff')
        joint.setAttribute('stroke', '#263c50'); this.rigOverlay.appendChild(joint)
      }
    }
  }

  update(): void {
    const view = this.view
    const camera = view.activeCamera
    if (!camera) return
    this.updateRig()
    const origin = new Vector3(camera.target)
    view.project(origin)
    this.axes.forEach((button, axis) => {
      const point = new Vector3(camera.target)
      point[axis] = point[axis]! + 1
      view.project(point)
      const dx = point[0] - origin[0],
        dy = point[1] - origin[1]
      const length = Math.max(Math.hypot(dx, dy), 1)
      button.style.left = `${31 + (dx / length) * 26}px`
      button.style.top = `${29 + (dy / length) * 26}px`
    })
    this.caption.textContent = `${view.cameraMode ? 'User Orthographic' : 'User Perspective'}\n${view.ctx?.object?.name ?? ''}`
    // Leave space for an expanded N-sidebar.
    const right = view.panels?.regions?.right
    this.element.style.right = `${right && !right.railCollapsed ? right.size + 8 : 24}px`
  }
}
