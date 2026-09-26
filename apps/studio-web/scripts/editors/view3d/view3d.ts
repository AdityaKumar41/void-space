import {
  Area,
  Container,
  DataAPI,
  IAreaDef,
  LastToolPanel,
  nstructjs,
  Number3,
  PanelManager,
  PanelSides,
  util,
} from '../../path.ux/scripts/pathux'

import {spawnToolSearchMenu} from '../editor_base'
import {spawnAddMenu} from '../menu/MainMenu.js'
import {getAppState, peekAppState} from '../../core/app_instance'

import {getBlueMask} from '../../shadernodes/shader_lib'

import {ToolMode} from './view3d_toolmode'

import './transform/all'
import './tools/tools'
import * as textsprite from '../../webgl/textsprite'
import {RealtimeEngine} from '../../renderengine/renderengine_realtime'
import {PackFlags} from '../../path.ux/scripts/core/ui_base'
import {Editor} from '../editor_base'
import {Camera, init_webgl} from '../../webgl/webgl'
import {DrawModes} from '../../sceneobject/drawmode'
import {EnvLightFlags} from '../../scene/scene'
import {UIBase, css2color} from '../../path.ux/scripts/core/ui_base'
import * as view3d_shaders from '../../shaders/shaders'
import {loadShader} from '../../shaders/shaders'
import {SimpleMesh, LayerTypes} from '../../webgl/simplemesh'
import {Vector3, Vector2, Vector4, Matrix4, Vector3Like} from '../../util/vectormath'
import {OrbitTool, TouchViewTool, PanTool, ZoomTool} from './view3d_ops'
import {KeyMap, HotKey} from '../editor_base'
import {calcTransCenter, calcTransMatrix, calcTransAABB} from './transform/transform_query'
import {CallbackNode, Node} from '../../core/graph'
import {DependSocket} from '../../core/graphsockets'
import {ConstraintSpaces} from './transform/transform_base'
import {eventWasTouch, haveModal} from '../../path.ux/scripts/util/simple_events'
import {BoundingBox, CursorModes, OrbitTargetModes} from './view3d_utils'
import {Icons} from '../icon_enum'
import {NoneWidget} from './widgets/widget_tools'
import {View3DFlags, CameraModes, view3dProject, view3dUnproject} from './view3d_base'
import {castViewRay} from './findnearest'
import {getKeymapEntries} from '../../core/keymap_contributions'
import {SelMask} from '../../core/select_types'
import type {Library} from '../../core/lib_api'
import {RenderEngine, RenderSettings} from '../../renderengine/renderengine_base'
import type {SceneObject} from '../../sceneobject/sceneobject'
import {Overdraw} from '../../path.ux/scripts/util/ScreenOverdraw'
import {WidgetBase, WidgetFlags} from './widgets/widgets'
import {OptionalIfNot} from '../../util/optionalIf'
import type {ViewContext} from '../../core/context'
import {BusMessage} from '../../core/bus'
import type {StructReader} from '../../path.ux/scripts/util/nstructjs'
import {isWebGPU} from '../../core/renderer_flag'
import {
  destroyWebGpuViewport,
  drawDrawLinesWebGpu,
  drawGridWebGpu,
  drawViewportWebGpu,
  makeWebGpuGlStub,
  primeWebGpuViewport,
  type ViewLike,
} from './view3d_draw_webgpu'

const curtemps = util.cachering.fromConstructor(Vector3, 32)

declare global {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  interface Window {
    _getShaderSource: (shader: string) => string
  }
  let _gl: WebGL2RenderingContext | undefined
}

export function getWebGL() {
  if (!window._gl) {
    initWebGL()
  }

  return window._gl
}

/**
 * Create the instance's 3D canvas and acquire its context. The canvas is owned
 * by the AppState (`state.glCanvas`) and appended to its container; `window._gl`
 * is kept as an alias to whichever instance drew last.
 */
export function initWebGL(state = peekAppState()) {
  const canvas = document.createElement('canvas')
  const dpi = UIBase.getDPI()
  let w: number
  let h: number

  canvas.style['opacity'] = '1.0'
  canvas.setAttribute('id', 'webgl')
  canvas.id = 'webgl'

  const screen = state?.screen
  if (screen !== undefined) {
    w = screen.size[0]
    h = screen.size[1]
  } else {
    w = h = 512
  }

  canvas.width = ~~(w * dpi)
  canvas.height = ~~(h * dpi)

  canvas.style['display'] = 'float'
  canvas.style['left'] = '0px'
  canvas.style['top'] = '0px'
  canvas.style['width'] = w + 'px'
  canvas.style['height'] = h + 'px'
  canvas.style['position'] = 'absolute'
  canvas.style.zIndex = '-2'

  canvas.dpi = dpi

  if (state !== undefined) {
    state.glCanvas = canvas
    state.onTeardown(() => disposeWebGL(state))
  }
  ;(state?.container ?? document.body).appendChild(canvas)

  if (isWebGPU()) {
    // WebGPU mode: skip WebGL2 acquisition + WebGL-only resource init.
    // view3d_draw_webgpu lazily acquires the GPUDevice + GPUCanvasContext
    // on first draw. `_gl` is a throwing Proxy so any code path that
    // forgot an isWebGPU() guard surfaces as a clear error.
    window._gl = makeWebGpuGlStub(canvas)
    loadWgslShaderStubs()
    return
  }

  const gl = init_webgl(canvas, {
    antialias            : false,
    alpha                : false,
    powerPreference      : 'high-performance',
    preserveDrawingBuffer: true,
    stencil              : true,
  }) as WebGL2RenderingContext
  window._gl = gl

  if (!('createVertexArray' in (gl as any))) {
    //*
    const extVAO = gl.getExtension('OES_vertex_array_object')

    if (!extVAO) {
      throw new Error('OES_vertex_array_object extension not supported')
    }

    gl.createVertexArray = extVAO.createVertexArrayOES.bind(extVAO)
    gl.bindVertexArray = extVAO.bindVertexArrayOES.bind(extVAO)
  }
  //*/

  //renderer.setSize( window.innerWidth, window.innerHeight );

  //_gl.canvas = canvas;
  loadShaders(window._gl)
  textsprite.defaultFont.update(_gl!)

  getBlueMask(_gl!)

  canvas.addEventListener(
    'webglcontextrestored',
    (e) => {
      loadShaders(_gl!)

      const state2 = getAppState()
      const datalib = (state2.ctx as any).datalib as Library

      for (const ob of datalib.object) {
        ob.onContextLost(e)
      }

      for (const sarea of state2.screen!.sareas) {
        for (const area of sarea.editors) {
          if (area instanceof View3D) {
            area.onContextLost(e as WebGLContextEvent)
          }
        }
      }

      textsprite.onContextLostTexSprite(e as WebGLContextEvent)
      textsprite.defaultFont.update(_gl!)
    },
    false
  )
}

/**
 * Undo initWebGL for one instance: drop the canvas out of the document and
 * release its GPU device. `window._gl` only clears if it still aliases this
 * instance's context.
 */
export function disposeWebGL(state: AppStateGlobal): void {
  const canvas = state.glCanvas
  if (canvas === undefined) {
    return
  }

  state.glCanvas = undefined
  destroyWebGpuViewport(canvas)
  canvas.remove()

  if (window._gl?.canvas === canvas) {
    window._gl = undefined
  }
}

export function loadShaders(gl: WebGL2RenderingContext) {
  for (const k in view3d_shaders.ShaderDef) {
    const key = k as keyof typeof view3d_shaders.ShaderDef
    view3d_shaders.Shaders[key] = loadShader(gl, view3d_shaders.ShaderDef[key])
  }
}

/**
 * Stand-in for `loadShaders` under the default WebGPU renderer. The
 * WebGL2 program object is replaced by a tag carrying the WGSL registry
 * key; `WebGPUDrawQueueAdapter` reads `.wgslKey` off the submission's
 * pipeline to resolve a `Pipeline` from `wgsl_shaders.ts`.
 *
 * The `ShaderProgram` methods (`bind`, `uniformloc`, etc.) are stubbed
 * to no-ops so legacy GL-style call sites that haven't been routed
 * through the queue yet don't crash. `uniforms` stays as a plain bag
 * so callers that read defaults off it still get something back.
 */
function loadWgslShaderStubs(): void {
  for (const k in view3d_shaders.ShaderDef) {
    const key = k as keyof typeof view3d_shaders.ShaderDef
    const stub = {
      wgslKey : key,
      name    : key,
      uniforms: {...(view3d_shaders.ShaderDef[key].uniforms ?? {})},
      bind() {},
      unbind() {},
      destroy() {},
      uniformloc() {
        return null
      },
      uniform_set(_k: string, _v: unknown) {},
    } as unknown as view3d_shaders.Shaders[typeof key]
    view3d_shaders.Shaders[key] = stub
  }
}

import {DrawLine, DrawQuad, type ITempText} from './view3d_base.js'
export {DrawLine, DrawQuad, type ITempText}

type CanvasWithExtra = (HTMLCanvasElement | OffscreenCanvas) & {dpi: number}

export class View3D<OPT extends {started?: true | false} = {}> extends Editor {
  _busSub: unknown
  widgettool?: WidgetBase
  widget?: WidgetBase
  drawline_mesh?: SimpleMesh
  canvas: OptionalIfNot<CanvasWithExtra, OPT['started']> = undefined as unknown as HTMLCanvasElement
  grid: OptionalIfNot<SimpleMesh, OPT['started']> = undefined as unknown as SimpleMesh
  mdown?: boolean
  gl: OptionalIfNot<WebGL2RenderingContext, OPT['started']> = undefined as unknown as WebGL2RenderingContext
  glSize: Vector2
  glPos: Vector2
  camera: Camera
  activeCamera: Camera
  _last_selectmode: number
  transformSpace: number
  renderEngine: OptionalIfNot<RenderEngine, OPT['started']>
  fps: number
  subViewPortSize: number
  subViewPortPos: Vector2
  renderSettings: RenderSettings
  overdraw?: Overdraw
  tempTexts = [] as ITempText[]

  /**
   * Where the active toolmode's `addHeaderRow()` rows go: a column owned by the
   * docked "Viewport Tools" panel. Assigned by that panel's `build`, which the
   * dock system runs eagerly from `makePanels()` in `init()` — i.e. before the
   * first `rebuildHeader()`. See `rebuildHeader` and `definePanels`.
   */
  _toolmodeHost?: Container<ViewContext>

  drawHash: number

  _last_camera_hash?: number
  _nodes: Node[]
  _pobj_map: any
  _last_render_draw: number

  _select_transparent: boolean
  orbitMode: OrbitTargetModes

  localCursor3D: Matrix4

  transformCursor3D = new Matrix4()
  cursorMode: CursorModes
  _viewvec_temps: util.cachering<Vector3>
  T: number
  start_mpos: Vector2
  end_mpos: Vector2 = new Vector2()
  last_mpos: Vector2
  drawlines: DrawLine[] = []
  drawquads: DrawQuad[] = []
  drawmode: DrawModes
  _graphnode?: CallbackNode<
    {},
    {
      onDrawPre: DependSocket
      onDrawPost: DependSocket
    }
  >
  static STRUCT = nstructjs.inlineRegister(
    this,
    `
View3D {
  camera              : Camera;
  transformSpace      : int; 
  drawmode            : int;
  _select_transparent : int;
  cursorMode          : int;
  orbitMode           : int;
  flag                : int;
  subViewPortSize     : float;
  subViewPortPos      : vec3;
  renderSettings      : renderengine_realtime.RenderSettings;
  transformCursor3D   : mat4;
  localCursor3D       : mat4;
}
  `
  )

  constructor() {
    super()

    this.drawHash = 0

    this.renderSettings = new RenderSettings()

    this._last_camera_hash = undefined

    //current calculated fps
    this.fps = 60.0

    this.subViewPortSize = 512
    this.subViewPortPos = new Vector2()

    this._nodes = []

    this._pobj_map = {}
    this._last_render_draw = 0
    this.renderEngine = undefined as unknown as RenderEngine

    this.flag = View3DFlags.SHOW_CURSOR | View3DFlags.SHOW_GRID

    this.orbitMode = OrbitTargetModes.FIXED
    this.localCursor3D = new Matrix4()
    this.cursorMode = CursorModes.TRANSFORM_CENTER

    this._viewvec_temps = util.cachering.fromConstructor(Vector3, 32)

    this.glPos = new Vector2([0, 0])
    this.glSize = new Vector2([512, 512])

    this.T = 0.0
    this.camera = this.activeCamera = new Camera()

    this.start_mpos = new Vector2()
    this.last_mpos = new Vector2()

    this.drawlines = []

    this.camera.pos = new Vector3([20, 0, 10])
    this.camera.target = new Vector3([0, 0, 0])

    this._select_transparent = false
    this._last_selectmode = -1
    this.transformSpace = ConstraintSpaces.WORLD

    const n = new Vector3(this.camera.pos).sub(this.camera.target)
    this.camera.up = new Vector3([0, 0, -1]).cross(n).cross(n)
    this.camera.up.normalize()

    this.camera.near = 0.01
    this.camera.far = 10000.0
    this.camera.fovy = 50.0

    this.drawmode = DrawModes.TEXTURED
  }

  get cursor3D() {
    if (this.flag & View3DFlags.LOCAL_CURSOR) {
      return this.localCursor3D
    }
    return this.ctx?.scene?.cursor3D ?? this.localCursor3D
  }

  set cursor3D(mat: Matrix4) {
    if (this.flag & View3DFlags.LOCAL_CURSOR || !this.ctx?.scene) {
      this.localCursor3D.load(mat)
    }
    this.ctx.scene.cursor3D.load(mat)
  }

  get cameraMode() {
    const cam = this.activeCamera
    return cam.isPerspective ? CameraModes.PERSPECTIVE : CameraModes.ORTHOGRAPHIC
  }

  set cameraMode(val) {
    const cam = this.activeCamera

    cam.isPerspective = val === CameraModes.PERSPECTIVE
    cam.regen_mats()
  }

  get selectmode() {
    return this.ctx.selectMask
  }

  get sortedObjects() {
    //implement me!
    return this.ctx.scene.objects.visible
  }

  updateClipping() {
    if (this.ctx?.scene === undefined) {
      return
    }

    const min = new Vector3()
    const max = new Vector3()
    const first = true

    for (const ob of this.ctx.scene.objects) {
      const bbox = ob.getBoundingBox()
      if (bbox === undefined) {
        continue
      }

      if (first) {
        min.load(bbox[0])
        max.load(bbox[1])
      } else {
        min.min(bbox[0])
        max.max(bbox[1])
      }
    }

    max.sub(min)

    let size = Math.max(Math.max(Math.abs(max[0]), Math.abs(max[1])), Math.abs(max[2]))
    size = Math.max(size, this.camera.pos.vectorDistance(this.camera.target))

    const clipend = Math.max(size * 15, 5000)
    const clipstart = clipend * 0.0001 + 0.001

    this.camera.near = clipstart
    this.camera.far = clipend
  }

  set selectmode(val) {
    // eslint-disable-next-line no-console
    console.warn('setting selectmode', val)
    this.ctx.scene.selectMask = val
  }

  get widgets() {
    return this.ctx.scene.widgets
  }

  onFileLoad(is_active: boolean) {
    //ensure toolmode has correct ctx
    if (this.ctx?.toolmode) {
      this.ctx.toolmode.ctx = this.ctx
    }

    window.redraw_viewport()

    window.setTimeout(() => {
      this.deleteGraphNodes()

      if (is_active) {
        this.makeGraphNodes()
      }
    }, 10)
  }

  makeGraphNodes() {
    const ctx = this.ctx
    const scene = ctx.scene

    if (scene === undefined) {
      return
    }

    if (this._nodes.length > 0) {
      this.deleteGraphNodes()
    }

    this._graphnode = CallbackNode.create(
      'view3d',
      () => {},
      {},
      {
        onDrawPre : new DependSocket('onDrawPre'),
        onDrawPost: new DependSocket('onDrawPost'),
      }
    )

    this.addGraphNode(this._graphnode)

    const node = CallbackNode.create(
      'toolmode change',
      () => {
        this.rebuildHeader()
      },
      {
        onToolModeChange: new DependSocket('onToolModeChange'),
      },
      {}
    )

    this.addGraphNode(node)

    node.inputs.onToolModeChange.connect(scene.outputs.onToolModeChange)
  }

  addGraphNode(node: Node) {
    this._nodes.push(node)
    this.ctx.graph.add(node)
  }

  remGraphNode(node: Node) {
    if (this._nodes.includes(node)) {
      this._nodes.remove(node)
      this.ctx.graph.remove(node)
    }
  }

  getGraphNode() {
    return this._graphnode
  }

  deleteGraphNodes() {
    for (const node of this._nodes) {
      try {
        const graph = this.ctx.graph
        if (graph.has(node)) {
          graph.remove(node)
        }
      } catch (error) {
        util.print_stack(error as Error)
        // eslint-disable-next-line no-console
        console.log('failed to delete graph node')
      }
    }

    this._nodes = []
  }

  getKeyMaps() {
    let ret = [] as KeyMap[]

    if (this.ctx.toolmode !== undefined) {
      ret = ret.concat(this.ctx.toolmode.getKeyMaps())
    }

    ret.push(this.keymap!)
    // Read per-dispatch rather than merged into `this.keymap`: an addon enabled
    // after this editor was built must still get its hotkeys, and a disabled one
    // must lose them.
    ret = ret.concat(getKeymapEntries('view3d'))

    return ret
  }

  viewAxis(axis: 0 | 1 | 2, sign = 1) {
    const cam = this.activeCamera

    const ups = {
      0: [0, 0, 1],
      1: [0, 0, 1],
      2: [0, 1, 0],
    }

    cam.pos.sub(cam.target)
    const len = cam.pos.vectorLength() || 0.1

    cam.pos.zero()
    cam.pos[axis] = sign
    cam.pos.mulScalar(len)

    cam.up.load(ups[axis])
    cam.pos.add(cam.target)

    window.redraw_viewport(true)
  }

  viewSelected(ob?: SceneObject) {
    //let cent = this.getTransCenter();
    let cent = new Vector3()
    let aabb: [Vector3Like, Vector3Like] | undefined

    if (ob === undefined) {
      if (this.ctx.scene !== undefined) {
        const toolmode = this.ctx.scene.toolmode

        if (toolmode !== undefined) {
          const center = toolmode.getViewCenter()

          if (center instanceof Vector3) {
            aabb = [center, center.copy()]
          } else if (center !== undefined) {
            aabb = center
          }
        }
      }

      if (aabb === undefined) {
        aabb = this.getTransBounds()
      }
    } else {
      aabb = ob.getBoundingBox()
    }

    if (aabb === undefined) {
      // eslint-disable-next-line no-console
      console.warn('could not get bounding box')
      return
    }

    const is_point = aabb[0].vectorDistance(aabb[1]) === 0.0

    if (aabb[0].vectorDistance(aabb[1]) === 0.0 && aabb[0].dot(aabb[0]) === 0.0) {
      cent.zero()
      cent.multVecMatrix(this.transformCursor3D)
    } else {
      cent.load(aabb[0]).interp(aabb[1], 0.5)
    }

    let dis = 0.001

    for (let i = 0; i < 3; i++) {
      const d = aabb[1][i as Number3] - aabb[0][i as Number3]
      dis = Math.max(dis, d)
    }

    dis *= Math.sqrt(3.0) * 1.25

    if (cent === undefined) {
      cent = new Vector3()
      cent.multVecMatrix(this.transformCursor3D)
    }

    const off = new Vector3(cent).sub(this.camera.target)

    this.camera.target.add(off)
    this.camera.pos.add(off)

    if (this.camera.pos.vectorDistance(this.camera.target) == 0.0) {
      this.camera.pos.addScalar(0.5)
    }
    this.camera.regen_mats()

    /*
    comment: in camera space;

    dx := 0.0;
    dy := 0.0;
    dz := 1.0;

    ex := dx*dis + size;
    ey := dy*dis;
    ez := dz*dis;

    f1 := atan(ex / ez) - fov;

    solve(f1, dis);
    */

    const fov = (Math.PI * this.camera.fovy) / 180

    //dis = Math.abs(Math.tan(fov)*dis);
    dis = Math.abs(dis / Math.tan(fov))

    dis = dis == 0.0 ? 0.005 : dis
    if (!is_point) {
      this.camera.pos.sub(this.camera.target).normalize().mulScalar(dis).add(this.camera.target)
    }

    this.updateClipping()

    this.camera.regen_mats()
    this.onCameraChange()

    window.redraw_viewport()
  }

  defineKeyMap() {
    this.keymap = new KeyMap([
      new HotKey('G', [], 'view3d.translate()'),
      // `R` was only bound inside the object toolmode's own map, so rotate did
      // nothing in every other mode while `G`/`S` worked.
      new HotKey('R', [], 'view3d.rotate()'),
      new HotKey('S', [], 'view3d.scale()'),
      new HotKey('.', [], 'view3d.view_selected()'),

      new HotKey('Space', [], () => {
        spawnToolSearchMenu(this.ctx)
      }),

      // Blender's Shift-A: the Add menu at the cursor, rather than picking one
      // primitive for the user. `addMenuEntries()` is the same list the menu
      // bar's Add menu builds, so the two stay in step.
      new HotKey('A', ['shift'], () => {
        spawnAddMenu(this.ctx)
      }),

      new HotKey('Key1', [], () => {
        this.viewAxis(1, 1)
      }),
      new HotKey('Key3', [], () => {
        this.viewAxis(0, 1)
      }),
      new HotKey('Key5', [], () => {
        this.cameraMode ^= 1
        window.redraw_viewport(true)
      }),
      new HotKey('Key7', [], () => {
        this.viewAxis(2, 1)
      }),
      new HotKey('Key1', ['ctrl'], () => {
        this.viewAxis(1, -1)
      }),
      new HotKey('Key3', ['ctrl'], () => {
        this.viewAxis(0, -1)
      }),
      new HotKey('Key7', ['ctrl'], () => {
        this.viewAxis(2, -1)
      }),
    ])

    return this.keymap
  }

  get select_transparent() {
    if (!(this.drawmode & (DrawModes.SOLID | DrawModes.TEXTURED))) return true
    return this._select_transparent
  }

  getViewVec(localX: number, localY: number) {
    const co = this._viewvec_temps.next()

    co[0] = localX
    co[1] = localY
    co[2] = -this.activeCamera.near - 0.001

    this.unproject(co)

    co.sub(this.activeCamera.pos).normalize()
    return co
  }

  project(co: Vector2 | Vector3 | Vector4, mat?: Matrix4) {
    return view3dProject(co, this.size!, mat ?? this.activeCamera.rendermat)
  }

  unproject(co: Vector2 | Vector3 | Vector4, imat?: Matrix4) {
    return view3dUnproject(co, this.size!, imat ?? this.activeCamera.irendermat)
  }

  setCursor(mat: Matrix4) {
    this.transformCursor3D.load(mat)

    const p = curtemps.next().zero()
    p.multVecMatrix(mat)

    if (this.orbitMode === OrbitTargetModes.CURSOR) {
      const redraw = this.camera.target.vectorDistance(p) > 0.0

      this.camera.target.load(p)

      if (redraw) {
        window.redraw_viewport()
      }
    }
    //this.camera.orbitTarget.load(p);
  }

  /**
   * Ctrl-click 3D-cursor placement. Raycasts the scene through the screen
   * point (castViewRay) and moves the cursor to the surface hit; over empty
   * space the cursor keeps its current depth relative to the camera — its
   * present position is projected, the screen xy replaced, and the point
   * unprojected back to 3D. Orientation is preserved; only the translation
   * moves.
   */
  setCursorFromScreen(localX: number, localY: number): void {
    const ctx = this.ctx
    if (!ctx?.scene) {
      return
    }

    let p: Vector3 | undefined
    const hits = castViewRay(ctx, SelMask.OBJECT | SelMask.GEOM, new Vector2([localX, localY]), this)
    if (hits.length > 0) {
      p = new Vector3(hits[0].p3d)
    }

    if (p === undefined) {
      p = new Vector3()
      p.multVecMatrix(this.cursor3D)
      const w = this.project(p) // p becomes (screenX, screenY, ndcZ)
      if (w <= 0) {
        // Cursor behind the camera — fall back to a mid-range depth.
        p[2] = 0.5
      }
      p[0] = localX
      p[1] = localY
      this.unproject(p)
    }

    const mat = new Matrix4(this.cursor3D)
    const m = mat.$matrix
    m.m41 = p[0]
    m.m42 = p[1]
    m.m43 = p[2]
    this.cursor3D = mat

    window.redraw_viewport()
  }

  rebuildHeader() {
    if (this.ctx === undefined) {
      this.doOnce(this.rebuildHeader)
      return
    }

    if (this.header !== undefined) {
      this.header.remove()
    }

    this.makeHeader(this.container)
    const header = this.header!

    //this.header.inherit_packflag |= PackFlags.SMALL_ICON;
    header.useIcons()

    /*
    One row.

    Blender's viewport header is a single ~26px strip; whatever else a mode
    needs lives in a side panel or the properties editor. This used to append
    the toolmode's `addHeaderRow()` rows directly beneath the header, so sculpt
    mode painted a five-row, ~180px wall of unlabelled icons across the top of
    the viewport. `addHeaderRow()` now targets the docked "Viewport Tools" panel
    (see definePanels), which is where Blender keeps the same controls.
    */
    const row = header.row()
    const toolmode = this.ctx.toolmode

    if (toolmode === undefined) {
      this.doOnce(this.rebuildHeader)
      return
    }

    toolmode.checkCtx(this.ctx)
    // propagate ctx into the widget tree if toolmode provided a modified one
    if (toolmode.ctx && toolmode.ctx !== row.ctx) {
      row.ctx = toolmode.ctx
    }

    // Cleared before the mode repopulates, so a mode switch cannot leave the
    // previous mode's rows behind. Undefined only if panel construction has not
    // reached this editor yet, in which case the next pass picks it up.
    const toolHost = this._toolmodeHost

    if (toolHost === undefined) {
      this.doOnce(this.rebuildHeader)
      return
    }

    toolHost.clear()

    let strip

    strip = row.strip()
    strip.inherit_packflag |= PackFlags.HIDE_CHECK_MARKS
    strip.useIcons(true)
    strip.prop('scene.toolmode')

    strip = row.strip()
    strip.iconbutton(Icons.UNDO, 'Undo', () => {
      this.ctx.toolstack.undo()
      window.redraw_viewport()
    })

    strip.iconbutton(Icons.REDO, 'Redo', () => {
      this.ctx.toolstack.redo()
      window.redraw_viewport()
    })

    /*
    The gizmo picker. `ToolMode.getTransformProp()` builds this enum from the
    active mode's `transWidgets`, so a mode listing move/rotate/scale gets
    Blender's three gizmo buttons here, and a mode listing none renders only the
    "off" member rather than an empty control.
    */
    strip = row.strip()
    strip.useIcons(true)
    strip.prop('scene.tool.transformWidget')

    toolmode.constructor.buildHeader(row, this._makeToolmodeRow)

    strip = row.strip()
    strip.prop('view3d.flag[SHOW_GRID]')
    strip.prop('view3d.flag[SHOW_RENDER]')

    strip = row.strip()
    strip.prop('scene.propEnabled')
    strip.listenum('scene.propMode')

    this.setCSS()
    this.flushUpdate()
  }

  /**
   * The `addHeaderRow` target handed to a toolmode's `buildHeader`: a row in the
   * docked "Viewport Tools" panel instead of a new header row. Only reachable
   * from `buildHeader`, which `rebuildHeader` calls after proving the panel
   * exists, so the guard is an invariant rather than a fallback.
   */
  _makeToolmodeRow = (): Container<ViewContext> => {
    const host = this._toolmodeHost

    if (host === undefined) {
      throw new Error('View3D.addHeaderRow: the Viewport Tools panel is not built')
    }

    return host.row()
  }

  doEvent(type: string, e: any, docontrols?: boolean) {
    if (this.ctx?.toolmode && !this.ctx.toolmode.ctx) {
      this.ctx.toolmode.ctx = this.ctx
    }

    if (!this.gl) {
      //wait for gl
      return
    }

    if (!this.ctx?.scene || !this.ctx.toolmode) {
      return
    }

    function exec(target: any, x: number, y: number) {
      if (target['on_'] + type) return target['on_' + type](e, x, y, e.was_touch)
      if (target['on'] + type) return target['on' + type](e, x, y, e.was_touch)
      if (target[type]) return target[type](e, x, y, e.was_touch)
    }

    const toolmode = this.ctx.toolmode
    const widgets = this.ctx.scene.widgets

    const ismouse = type.search('mouse') >= 0 || type.search('touch') >= 0 || type.search('pointer') >= 0

    // The press half of an interaction: `exec()` probes both `on_<type>` and
    // `on<type>`, so the names are spelled as the dispatcher will look for them.
    const is_press = type === 'mousedown' || type === 'pointerdown' || type === 'touchstart'

    if (ismouse) {
      const ret = this.getLocalMouse(e.x, e.y)

      const x = ret[0]
      const y = ret[1]

      widgets.updateHighlight(e, x, y, e.was_touch)

      // A widget under the cursor owns the press, whoever asks first. The toolmode
      // is offered the event before the widgets so that a sculpt stroke or a box
      // selection keeps working — but when the pointer is actually on a handle, a
      // stroke must not eat the drag: that is the whole point of a gizmo. Blender
      // arbitrates the same way.
      if (is_press && widgets.widgets.highlight !== undefined) {
        const flag = widgets.widgets.highlight.flag

        if (!(flag & WidgetFlags.IGNORE_EVENTS) && exec(widgets, x, y)) {
          return true
        }
      }

      if (exec(toolmode, x, y)) {
        return true
      } else if (!docontrols && exec(widgets, x, y)) {
        return true
      }

      return false
    } else {
      return exec(widgets, e.x, e.y) || exec(toolmode, e.x, e.y)
    }
  }

  busSubscribe() {
    if (this._busSub !== undefined) {
      return
    }

    // rebuild header, we will have missed toolmode registration events
    // while disconnected from the dom
    this.doOnce(this.rebuildHeader)

    const busgetter = () => {
      if (!this.isConnected) {
        this._busSub = undefined
        return undefined
      }

      return this
      //not working!!!! -> return document.getElementById(id);
    }

    this._busSub = this.ctx.messagebus.subscribe(
      busgetter,
      ToolMode,
      (msg: BusMessage) => {
        this.doOnce(this.rebuildHeader)
      },
      ['REGISTER', 'UNREGISTER']
    )
  }

  /** Dockable-panel catalog (path.ux dock system, see makePanels in init). */
  definePanels(panels: PanelManager<ViewContext>) {
    /*
    Left-docked home for the active toolmode's `addHeaderRow()` rows — the
    equivalent of Blender's tool/properties sidebar.

    Those rows used to be appended to the header itself, so sculpt mode stacked
    five of them and covered the top ~180px of the viewport with a wall of
    unlabelled icons. The header is now one row (see `rebuildHeader`) and this
    panel is where "everything else the mode needs" goes.

    `build` is called eagerly by `applyDefaultLayout()` during `makePanels()`,
    so `_toolmodeHost` is set before the first `rebuildHeader()` runs.
    */
    panels.panel({
      id     : 'viewport_tools',
      title  : 'Viewport Tools',
      icon   : Icons.EDITOR_VIEW3D,
      dock   : 'left',
      minSize: [320, undefined],
      build  : (c) => {
        const col = c.col()
        // A toolmode row is a horizontal strip of icons; wrapping keeps a long
        // one (sculptcore's mesh-operator set) inside the panel's width instead
        // of overflowing it. `wrap()` is the typed setter for `flex-wrap`.
        col.wrap()
        col.inherit_packflag |= PackFlags.USE_ICONS
        this._toolmodeHost = col
      },
    })

    // Wide enough for a slider or a labelled pair of buttons in a toolrow; the
    // 225px region default clipped them mid-control. `definePanels` runs before
    // `PanelManager.build()`, which is where a region's size is applied.
    panels.regions.left.size = 320

    panels.panel({
      id     : 'last_command',
      title  : 'Last Command',
      dock   : 'right',
      minSize: [225, undefined],
      build: (c) => {
        const last = document.createElement('last-tool-panel-x') as LastToolPanel<ViewContext>
        c.add(last)
      },
    })
  }

  /** True when node is one of the empty dock-frame skeleton containers
   *  (built by makePanels), i.e. not interactive UI. */
  _isDockSkeleton(node: UIBase<ViewContext> | undefined): boolean {
    const panels = this.panels

    if (node === undefined || panels === undefined) {
      return false
    }

    if (node === this.container || node === panels.outer || node === panels.center) {
      return true
    }

    if (node === panels.center.parentWidget) {
      return true
    }

    for (const side of PanelSides) {
      if (node === panels.regions[side].container) {
        return true
      }
    }

    return false
  }

  init() {
    super.init()

    this.makePanels(this.container)

    /* Prevent pinch zooming. */
    this.addEventListener('pointerdown', (e) => {
      /*
      if (e.pointerType !== 'mouse') {
        console.log('view3d pointerdown preventDefault for', e.pointerType, 'events')
        e.preventDefault()
      }*/
    })
    this.addEventListener('touchstart', (e) => {
      // prevent pinch zoom)
      if (!uiHasFocus(e)) {
        e.preventDefault()
      }
    })

    this.overdraw = document.createElement('overdraw-x') as Overdraw
    this.overdraw.ctx = this.ctx

    this.overdraw.startNode(this, this.ctx.screen, 'absolute')

    this.overdraw.remove()
    this.shadow.appendChild(this.overdraw as HTMLElement)

    this.overdraw.style['left'] = '0px'
    this.overdraw.style['top'] = '0px'

    const eventdom = this //this.overdraw;

    this.busSubscribe()
    this.makeGraphNodes()
    this.doOnce(this.rebuildHeader)

    const on_mousewheel = (e: WheelEvent) => {
      e.preventDefault()

      let df = e.deltaY / 100.0

      df = Math.min(Math.max(df, -0.5), 0.5)
      df = 1.0 + df * 0.4

      const cam = this.camera

      const dis = cam.pos.vectorDistance(cam.target)
      if (df < 1.0 && dis * df < cam.near * 5.0) {
        return
      }

      cam.pos.sub(cam.target).mulScalar(df).add(cam.target)
      window.redraw_viewport()
    }

    this.addEventListener('wheel', on_mousewheel)

    const uiHasFocus = (e: PointerEvent | TouchEvent) => {
      if (haveModal()) {
        return true
      }
      if (e instanceof TouchEvent && e.touches.length === 0) {
        return false
      }

      const x = e instanceof PointerEvent ? e.x : e.touches[0].pageX
      const y = e instanceof PointerEvent ? e.y : e.touches[0].pageY
      const node = this.pickElement(x, y)

      if (node === this || node === this.overdraw) {
        return false
      }

      /* the dock-panel skeleton overlays the viewport; its empty frame
         containers are not UI */
      return !this._isDockSkeleton(node)
    }

    const on_mousemove = (e: PointerEvent, was_mousemove = true) => {
      this.last_mpos.load(this.getLocalMouse(e.x, e.y))

      /*
      if (this.overdraw !== undefined) {
        let r = this.getLocalMouse(e.x, e.y);

        this.overdraw.clear();
        this.overdraw.text("Test!", r[0], r[1]);
      }//*/

      if (uiHasFocus(e)) {
        return
      }

      if (this.canvas === undefined) return
      this.doEvent('mousemove', e)
    }

    eventdom.addEventListener('pointermove', on_mousemove)

    eventdom.addEventListener('pointerup', (e) => {
      this.last_mpos.load(this.getLocalMouse(e.x, e.y))

      this.doEvent('mouseup', e)

      this.push_ctx_active()

      if (this.mdown) {
        this.mdown = false
      }
      this.pop_ctx_active()
    })

    const on_mousedown = (e: PointerEvent) => {
      if (uiHasFocus(e)) {
        return
      }

      /* prevent duplicate mousedown events from touch forwarding */
      e.preventDefault()
      e.stopPropagation()

      const r = this.getLocalMouse(e.clientX, e.clientY)
      this.start_mpos.load(r)
      this.last_mpos.load(r)

      this.push_ctx_active()

      let docontrols = e.button === 1 || e.button === 2 || e.altKey

      if (this.doEvent('mousedown', e, docontrols)) {
        this.pop_ctx_active()
        return
      }

      this.updateTransformCursor()

      // Ctrl-left-click/tap (no other modifiers) places the 3D cursor —
      // toolmodes got first crack via doEvent above (e.g. sculpt's ctrl-invert
      // stroke consumes the event there; box modeling deliberately does not).
      // Applies to mouse, pen and touch alike: ctrl is a keyboard modifier, so
      // holding it while tapping is always an explicit cursor placement (the
      // ctrl-less touch view gestures are handled below).
      if (e.button === 0 && e.ctrlKey && !e.shiftKey && !e.altKey) {
        this.setCursorFromScreen(r[0], r[1])
        this.pop_ctx_active()
        e.preventDefault()
        e.stopPropagation()
        return
      }

      if (!docontrols && e.button === 0) {
        docontrols = true
        this.mdown = true
      }

      if (docontrols && eventWasTouch(e) && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        const tool = new TouchViewTool()
        this.ctx.state.toolstack.execTool(this.ctx, tool)
        window.redraw_viewport()
      } else if (docontrols && !e.shiftKey && !e.ctrlKey) {
        const tool = new OrbitTool()
        this.ctx.state.toolstack.execTool(this.ctx, tool, e)
        window.redraw_viewport()
      } else if (docontrols && e.shiftKey && !e.ctrlKey) {
        const tool = new PanTool()
        this.ctx.state.toolstack.execTool(this.ctx, tool)
        window.redraw_viewport()
      } else if (docontrols && e.ctrlKey && !e.shiftKey) {
        const tool = new ZoomTool()
        this.ctx.state.toolstack.execTool(this.ctx, tool)
        window.redraw_viewport()
      }

      this.pop_ctx_active()

      e.preventDefault()
      e.stopPropagation()
    }

    eventdom.addEventListener('pointerdown', on_mousedown)

    window.redraw_viewport()
  }

  glInit() {
    if (this.gl !== undefined) {
      return
    }

    this.gl = getWebGL()!
    if (this.gl === undefined) {
      throw new Error('no webgl')
    }

    this.canvas = this.gl.canvas as CanvasWithExtra
    // Built at the default extent; `updateGridExtent()` keeps it covering the
    // view from the first frame on. Bookkeeping is set to match so that first
    // call only rebuilds if the camera has actually been moved.
    this._gridRadius = 8
    this._gridCell = View3D.GRID_CELL
    this.grid = this.makeGrid(this._gridRadius, this._gridCell)

    return this as View3D<{started: true}>
  }

  getTransBounds(): BoundingBox | undefined {
    return calcTransAABB(this.ctx, this.ctx.selectMask) as unknown as BoundingBox
  }

  getTransCenter(transformSpace = this.transformSpace) {
    const selectMask = this.ctx.selectMask
    return calcTransCenter(this.ctx, selectMask, transformSpace)
  }

  getTransMatrix(transformSpace = this.transformSpace) {
    const selectMask = this.ctx.selectMask
    return calcTransMatrix(this.ctx, selectMask, transformSpace)
  }

  getLocalMouse(x: number, y: number): Vector2 {
    const r = this.getClientRects()[0]

    //x -= this.pos[0];
    //y -= this.pos[1];

    if (r) {
      x = x - r.x // dpi;
      y = y - r.y // dpi;
    } else {
      x -= this.pos![0]
      y -= this.pos![1]
    }

    return new Vector2().loadXY(x, y)
  }

  _showCursor() {
    let ok = !!(this.flag & View3DFlags.SHOW_CURSOR)
    ok = ok && (this.widget === undefined || this.widget instanceof NoneWidget)

    return ok
  }

  updateTransformCursor() {
    if (this.cursorMode == CursorModes.TRANSFORM_CENTER) {
      this.transformCursor3D.makeIdentity()

      const res = this.getTransCenter()
      if (res === undefined) {
        return
      }

      const tcent = res.center
      this.transformCursor3D.translate(tcent[0], tcent[1], tcent[2])

      this.setCursor(this.transformCursor3D)
    }
  }

  checkCamera() {
    const cam = this.activeCamera

    if (cam) {
      const hash = cam.generateUpdateHash()

      if (hash !== this._last_camera_hash && this.renderEngine) {
        this._last_camera_hash = hash
        this.renderEngine.resetRender()
      }
    }
  }

  update() {
    if (this.ctx.scene !== undefined) {
      this.ctx.scene.updateWidgets()
    }

    if (this !== this.owning_sarea?.area) {
      return
    }

    const screen = this.ctx.screen
    if (this.pos![1] + this.size![1] > screen.size[1] + 4) {
      // eslint-disable-next-line no-console
      console.log('view3d is too big', this.pos![1] + this.size![1], screen.size[1])
      this.ctx.screen.snapScreenVerts()
      this.ctx.screen.regenBorders()
    }

    this.busSubscribe()
    this.checkCamera()

    // Keep the ground grid covering the view as the camera orbits and zooms.
    this.updateGridExtent()

    //TODO have limits for how many samplers to render
    if (util.time_ms() - this._last_render_draw > 100) {
      //window.redraw_viewport();
      //this._last_render_draw = util.time_ms();
    }

    this.push_ctx_active()
    super.update()

    if (this._last_selectmode !== this.ctx.selectMask) {
      this._last_selectmode = this.ctx.selectMask
      window.redraw_viewport()
    }

    this.pop_ctx_active()

    if (this.renderEngine !== undefined && this.gl !== undefined) {
      this.renderEngine.update(this.gl, this)
    }
  }

  /**
   * Preferred world-space cell size, in scene units.
   *
   * 0.5 is what the shipped fixed grid used, so the default camera keeps the
   * exact lattice it had. Coverage is grown by adding lines, not by coarsening
   * this, which is what keeps a 1-unit primitive readable when zoomed out.
   */
  static GRID_CELL = 0.5

  /**
   * Upper bound on lines per direction.
   *
   * Past this the cells coarsen instead, so a far-out camera cannot ask for a
   * mesh with tens of thousands of lines. 192 x 2 directions is ~770 lines,
   * trivial for a GPU but bounded.
   */
  static GRID_MAX_STEPS = 192

  /** Half-extent the current `grid` mesh was built for; 0 until first built. */
  _gridRadius = 0

  /** Cell size the current `grid` mesh was built with; 0 until first built. */
  _gridCell = 0

  /**
   * Rebuilds the ground grid so it always covers the view.
   *
   * The previous grid was a fixed 16x16-unit mesh built once in `glInit`, so
   * zooming out ran off its edge and left a small isolated box of lines in an
   * otherwise empty viewport — the grid appeared to end in nothing.
   *
   * Extent now follows the camera: the radius snaps to a power of two so a
   * continuous zoom rebuilds only on a threshold crossing rather than every
   * frame, and the cell size is held at GRID_CELL by growing the line count.
   * Only once the count would exceed GRID_MAX_STEPS does the cell coarsen, so
   * the fine lattice survives the whole useful zoom range.
   *
   * Cheap to call each frame: the common path is one hypot and two compares.
   */
  updateGridExtent() {
    const cam = this.activeCamera as {pos?: Vector3Like; target?: Vector3Like} | undefined
    if (!cam?.pos || !cam?.target || this.grid === undefined) {
      return
    }

    const p = cam.pos
    const t = cam.target
    const dist = Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2])

    // 1.5x the orbit distance puts the grid edge outside the frustum at typical
    // fields of view, while a lower bound of 8 keeps a close camera from asking
    // for a degenerate extent.
    const radius = Math.max(8, 2 ** Math.ceil(Math.log2(Math.max(dist, 1e-3) * 1.5)))

    // Hold the preferred cell size while it fits under the line budget; coarsen
    // only when it would not.
    const cell = Math.max(View3D.GRID_CELL, radius / View3D.GRID_MAX_STEPS)

    if (radius === this._gridRadius && cell === this._gridCell) {
      return
    }

    this._gridRadius = radius
    this._gridCell = cell
    this.grid = this.makeGrid(radius, cell)
  }

  /**
   * A square ground grid on the XY plane at cell size `cell`, spanning +/-
   * `radius`.
   *
   * `radius` is rounded to a whole number of cells so a line lands exactly on
   * the origin, where the two axis lines are drawn. Emphasis repeats every 2, 4
   * and 8 cells, so one mesh carries a readable hierarchy at any extent; the
   * lines through the origin are tinted to read as X (red) and Y (green).
   */
  makeGrid(radius = 8.0, cell = 0.5) {
    const mesh = new SimpleMesh(LayerTypes.LOC | LayerTypes.UV | LayerTypes.COLOR)

    // Snap so the lattice is symmetric and hits the origin exactly.
    const steps = Math.max(1, Math.round(radius / cell))
    const half = steps * cell

    for (let i = 0; i <= steps * 2; i++) {
      const t = -half + i * cell

      let d = 0.8
      if (i % 8 == 0) d = 0.3
      else if (i % 4 == 0.0) d = 0.6
      else if (i % 2 == 0.0) d = 0.7

      const clr = new Vector4([1.0 - d, 1.0 - d, 1.0 - d, 1.0])
      const onAxis = i === steps

      if (onAxis) {
        clr[1] = clr[2] = 0.0
        clr[0] = 1.0
      }
      let line = mesh.line(new Vector3([-half, t, 0.0]), new Vector3([half, t, 0.0]))
      line.colors(clr, clr)
      line.uvs(new Vector2([-1, -1]), new Vector2([1, 1]))

      if (onAxis) {
        clr[0] = clr[2] = 0.0
        clr[1] = 1.0
      }
      line = mesh.line(new Vector3([t, -half, 0.0]), new Vector3([t, half, 0.0]))
      line.colors(clr, clr)
      line.uvs(new Vector2([-1, -1]), new Vector2([1, 1]))
    }

    return mesh
  }

  setCSS() {
    super.setCSS()
  }

  on_resize(newsize: number[] | Vector2) {
    super.on_resize(newsize)

    if (this.gl === undefined) {
      return
    }

    //trigger rebuild of renderEngine, if necessary
    if (this.renderEngine !== undefined) {
      const engine = this.renderEngine
      const nonStarted = this as View3D<{started: false}>
      nonStarted.renderEngine = undefined
      nonStarted.gl!.bindFramebuffer(nonStarted.gl!.FRAMEBUFFER, null)
      engine.destroy(nonStarted.gl!)
    }

    this.setCSS()

    if (window.redraw_viewport) {
      window.redraw_viewport()
    }
  }

  _testCamera() {
    const th = this.T

    this.camera.pos = new Vector3([Math.cos(th) * 20, Math.sin(th) * 20, Math.cos(th * 2.0) * 15.0])
    this.camera.target = new Vector3([0, 0, 0.0 * Math.cos(th * 2.0) * 5.0])
    this.camera.up = new Vector3([0, 0, 1])
    this.camera.up.normalize()
    this.camera.near = 0.01
    this.camera.far = 10000.0

    this.T += 0.01
  }

  destroy() {
    const nonStarted = this as View3D<{started: false}>
    nonStarted.deleteGraphNodes()

    if (nonStarted.renderEngine !== undefined) {
      nonStarted.renderEngine.destroy(nonStarted.gl!)
      nonStarted.renderEngine = undefined
    }

    if (nonStarted.grid !== undefined) {
      nonStarted.grid.destroy(nonStarted.gl)
      nonStarted.grid = undefined
    }

    nonStarted.gl = undefined
    return nonStarted
  }

  on_area_inactive() {
    super.on_area_inactive()

    this.deleteGraphNodes()
    this.destroy()
    const nonStarted = this as View3D<{started: false}>
    nonStarted.gl = undefined
  }

  onCameraChange() {
    this.updatePointClouds()
  }

  on_area_active() {
    super.on_area_active()

    this.glInit()

    this.makeGraphNodes()
    this.busSubscribe()
  }

  drawCameraView = function (this: View3D<OPT & {started: true}>) {
    const gl = this.gl

    let camera = this.ctx.camera

    if (camera === undefined) {
      camera = this.camera
    }

    gl.enable(gl.SCISSOR_TEST)
    const pos = new Vector2(this.subViewPortPos)
    const scale = this.subViewPortSize
    const size = new Vector2([scale, scale])

    size[0] /= camera.aspect

    pos.floor()
    size.floor()

    camera.regen_mats()

    gl.scissor(pos[0], pos[1], size[0], size[1])
    gl.clearColor(0, 0, 0, 1.0)
    gl.clearDepth(camera.far)

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)

    try {
      this.drawObjects(camera)
    } catch (error) {
      util.print_stack(error as Error)
      // eslint-disable-next-line no-console
      console.warn('Draw error')
    }
  }

  viewportDraw() {
    if (window.DEBUG?.debugUIUpdatePerf) {
      return
    }

    if (this.flag & View3DFlags.USE_CTX_CAMERA) {
      this.activeCamera = this.ctx.camera || this.camera
    } else {
      this.activeCamera = this.camera
    }

    this.checkCamera()
    //this.overdraw.clear();

    if (!this.gl) {
      this.glInit()
    }

    const startedThis = this as View3D<{started: true}>

    startedThis.push_ctx_active()
    startedThis.viewportDraw_intern()

    if (startedThis.flag & View3DFlags.SHOW_CAMERA_VIEW) {
      startedThis.drawCameraView()
    }

    startedThis.pop_ctx_active()
  }

  resetRender() {
    if (this.renderEngine !== undefined) {
      this.renderEngine.resetRender()
    }
  }

  updatePointClouds() {
    /*
    let scene = this.ctx.scene;

    for (let ob of scene.objects) {
      if (ob.data instanceof PointSet && ob.data.ready) {
        //
      }
    }
    //*/
  }

  onContextLost(e: WebGLContextEvent) {
    this.drawline_mesh?.onContextLost(e)
    this.widget?.onContextLost(e)
    this.grid?.onContextLost(e)
  }

  viewportDraw_intern = function (this: View3D<{started: true}>) {
    if (!this.owning_sarea) {
      return
    }

    if (this.ctx === undefined || this.gl === undefined || this.size === undefined) {
      return
    }

    if (this._graphnode === undefined) {
      this.makeGraphNodes()
    }

    const aspect = this.size[0] / this.size[1]
    this.activeCamera.regen_mats(aspect)
    const dpi = this.canvas.dpi
    const x = this.owning_sarea.pos[0] * dpi
    const y = this.owning_sarea.pos[1] * dpi
    const w = this.owning_sarea.size[0] * dpi
    const h = this.owning_sarea.size[1] * dpi
    this.glPos = new Vector2([~~x, ~~y])
    this.glSize = new Vector2([~~w, ~~h])

    // Outside rendered mode (SHOW_RENDER / ONLY_RENDER) fall through to
    // the smoke-test path — it still encodes grid, widgets, toolmode
    // overlays etc., just without the full renderengine pipeline.
    // Render graph when active:
    //   [NormalPass → AOPass] → BasePass → AccumPass → PassThruPass
    //   → [SharpenPass.x → SharpenPass.y] → OutputPass → canvas swap-chain.
    if (this.flag & (View3DFlags.SHOW_RENDER | View3DFlags.ONLY_RENDER)) {
      const viewport = primeWebGpuViewport(this.canvas)
      if (!viewport) return
      if (this.renderEngine === undefined) {
        this.renderEngine = new RealtimeEngine(this)
      }
      const engine = this.renderEngine as RealtimeEngine
      engine.renderSettings = this.renderSettings
      engine.renderSettings.ao = !!(this.ctx.scene.envlight.flag & EnvLightFlags.USE_AO)
      // Overlay encode: grid + drawDrawLines + drawObjects (non-renderables)
      // + toolmode overlays + widgets, all through the engine's overlay pass.
      // createDrawQueue reads ctx.currentPass (set by the engine's
      // renderStageDesc), so SimpleMesh.draw routes automatically.
      // Overlays encode once per frame (no per-sample jitter), so the
      // jittered projmat from BasePass is ignored here.
      const view3dLike = this as unknown as ViewLike
      const self = this
      engine.encodeOverlaysCB = () => {
        drawGridWebGpu(view3dLike)
        drawDrawLinesWebGpu(view3dLike)
        try {
          self.drawObjects()
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[overlay] drawObjects threw:', err)
        }
        // Toolmode overlays — mesh-edit verts/edges/faces, sculpt brush
        // ring, BVH debug. SimpleMesh.draw inside these routes through
        // the queue adapter while the overlay pass is open.
        const scene = self.ctx?.scene
        if (scene?.toolmode) {
          try {
            scene.toolmode.on_drawstart?.(self)
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[overlay] toolmode.on_drawstart threw:', err)
          }
          try {
            scene.toolmode.on_drawend?.(self)
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[overlay] toolmode.on_drawend threw:', err)
          }
        }
        // Widgets last so transform gizmos overdraw the scene.
        // WidgetMeshShader declares no depth state so it always passes
        // depth, matching the legacy `clear(DEPTH); widgets.draw` ordering.
        try {
          self.widgets?.draw(self, self.gl)
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[overlay] widgets.draw threw:', err)
        }
      }
      engine.render(
        this.activeCamera,
        this.gl,
        this.glPos as unknown as number[],
        this.glSize as unknown as number[],
        this.ctx.scene
      )
      return
    }

    drawViewportWebGpu(this as unknown as ViewLike)
  }

  makeDrawQuad(v1: Vector3, v2: Vector3, v3: Vector3, v4: Vector3, color: Vector4 | number[], useZ = true): DrawQuad {
    //if (typeof color == 'string') {
    //color = css2color(color)
    //}

    //const dq = new DrawQuad(v1, v2, v3, v4, color)
    throw new Error('implement me!')
  }

  removeDrawQuad(quad: DrawQuad) {
    //
  }

  makeDrawText(co: Vector3, text: string, color: Vector4 | number[] = [0, 0, 0, 1], size = 1.0) {
    // XXX implement me!

    this.tempTexts.push({
      co: new Vector3(co),
      text,
      color: new Vector4(color),
      size,
    })
    window.redraw_viewport()

    return this.tempTexts[this.tempTexts.length - 1]
  }

  makeDrawCone(
    p1: Vector3Like | number[],
    p2: Vector3Like | number[],
    radius1: number,
    radius2: number,
    color: number[] | Vector4 = [0, 0, 0, 1],
    count = 64
  ): DrawLine[] {
    p1 = new Vector3(p1)
    p2 = new Vector3(p2)

    const drawlines = [] as DrawLine[]

    let th = -Math.PI
    const dth = (2.0 * Math.PI) / count
    const len = p1.vectorDistance(p2)

    const nor = new Vector3(p2).sub(p1).normalize()
    const mat = new Matrix4().makeNormalMatrix(nor)
    const tmat = new Matrix4()
    tmat.translate(p1[0], p1[1], p1[2])
    mat.preMultiply(tmat)

    for (let i = 0; i < count; i++, th += dth) {
      const a = new Vector3().loadXY(radius1 * Math.cos(th), radius1 * Math.sin(th))
      const b = new Vector3().loadXYZ(radius2 * Math.cos(th), radius2 * Math.sin(th), len)
      a.multVecMatrix(mat)
      b.multVecMatrix(mat)

      if (i > 0) {
        const dl = drawlines.at(-1)!
        drawlines.push(this.makeDrawLine(a, dl.v1, color))
        drawlines.push(this.makeDrawLine(b, dl.v2, color))
      }

      drawlines.push(this.makeDrawLine(a, b, color))
    }
    const dl1 = drawlines.at(-1)!
    const dl2 = drawlines[0]!
    drawlines.push(this.makeDrawLine(dl1.v1, dl2.v1, color))
    drawlines.push(this.makeDrawLine(dl1.v2, dl2.v2, color))

    return drawlines
  }

  makeDrawLine(v1: Vector3, v2: Vector3, color: Vector4 | number[] = [0, 0, 0, 1], useZ = true) {
    if (typeof color == 'string') {
      color = css2color(color)
    }

    const dl = new DrawLine(v1, v2, color)

    this.drawlines.push(dl)
    window.redraw_viewport()

    return dl
  }

  removeDrawLine(dl: DrawLine) {
    if (this.drawlines.includes(dl)) {
      this.drawlines.remove(dl)
    }
  }

  removeDrawText(dt: ITempText) {
    if (this.tempTexts.includes(dt)) {
      this.tempTexts.remove(dt)
    }
  }

  resetDrawLines() {
    this.drawlines.length = 0
    this.tempTexts.length = 0

    if (this.overdraw) {
      this.overdraw.clear()
    }
    window.redraw_viewport()
  }

  drawObjects(camera = this.activeCamera) {
    const scene = this.ctx.scene
    const gl = this.gl
    const program = view3d_shaders.Shaders.BasicLitMesh

    const uniforms = {
      projectionMatrix: camera.rendermat,
      normalMatrix    : camera.normalmat,
      near            : camera.near,
      far             : camera.far,
      aspect          : camera.aspect,
      size            : this.glSize,
      polygonOffset   : 0.0,
      objectMatrix    : new Matrix4(),
      object_id       : 0,
    }

    //const only_render = this.flag & View3DFlags.ONLY_RENDER

    for (const ob of scene.objects.visible) {
      uniforms.objectMatrix = ob.outputs.matrix.getValue()
      uniforms.object_id = ob.lib_id

      if (scene.toolmode) {
        scene.toolmode.view3d = this

        if (this.ctx) {
          scene.toolmode.ctx = this.ctx
        }

        if (scene.toolmode.drawObject(gl!, uniforms, program, ob, ob.data)) {
          continue
        }
      }

      // Skip renderables in SHOW_RENDER mode — the renderengine already
      // drew them. Non-renderables (empties, lights, cameras, helpers)
      // still draw so their icon/frustum geometry shows up over the
      // rendered scene.
      if (this.flag & View3DFlags.SHOW_RENDER && ob.data?.usesMaterial) {
        continue
      }

      uniforms.objectMatrix = ob.outputs.matrix.getValue()
      uniforms.object_id = ob.lib_id

      //did toolmode not draw the object?
      ob.draw(this, gl!, uniforms, program)
    }
  }

  static defineAPI(api: DataAPI) {
    const vstruct = super.defineAPI(api)

    vstruct.float('subViewPortSize', 'subViewPortSize', 'View Size').range(1, 2048)
    vstruct.vec2('subViewPortPos', 'subViewPortPos', 'View Pos').range(1, 2048)

    vstruct.struct('renderSettings', 'render', 'Render Settings', api.mapStruct(RenderSettings))

    function onchange() {
      window.redraw_viewport()
    }

    vstruct.flags('flag', 'flag', View3DFlags, 'View3D Flags').on('change', onchange).icons({
      SHOW_RENDER: Icons.RENDER,
      SHOW_GRID  : Icons.SHOW_GRID_FLOOR,
    })

    vstruct.enum('cameraMode', 'cameraMode', CameraModes, 'Camera Modes').on('change', onchange).icons({
      PERSPECTIVE : Icons.PERSPECTIVE,
      ORTHOGRAPHIC: Icons.ORTHOGRAPHIC,
    })
    return vstruct
  }

  copy() {
    const ret = document.createElement('view3d-editor-x') as View3D

    ret.widgettool = this.widgettool

    ret._select_transparent = this._select_transparent
    ret.camera.load(this.camera)
    ret.drawmode = this.drawmode
    ret.glInit()

    return ret
  }

  loadSTRUCT(reader: StructReader<this>) {
    reader(this)

    this.activeCamera = this.camera
  }

  static define() {
    return {
      has3D   : true,
      tagname : 'view3d-editor-x',
      areaname: 'view3d',
      uiname  : 'Viewport',
      icon    : Icons.EDITOR_VIEW3D,
    }
  }
}
Editor.register(View3D)

let animreq: number | undefined
let resetRender = 0
let drawCount = 1

const f2 = () => {
  const screen = getAppState().screen
  const resetrender = resetRender
  if (window._gl === undefined) {
    return
  }
  const gl = _gl

  resetRender = 0

  //try to calculate fps rate

  let time = util.time_ms()

  for (const sarea of screen.sareas) {
    const sdef = sarea.area!.constructor.define() as IAreaDef & {has3D?: boolean}

    if (sarea.area && sdef.has3D) {
      const area3d = sarea.area! as Area<ViewContext> & {viewportDraw: (gl: WebGL2RenderingContext) => void}
      sarea.area._init()

      if (resetrender && sarea.area instanceof View3D) {
        sarea.area.resetRender()
      }

      area3d.push_ctx_active(true)
      area3d.viewportDraw(gl!)
      area3d.pop_ctx_active(true)
    }
  }

  if (!gl) {
    return
  }

  //wait for gpu
  if (!isWebGPU()) {
    gl.finish()
  }

  //be real sure gpu has finished drawing
  //gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(8*8*4));

  //now get time
  time = util.time_ms() - time
  time = 1000.0 / time

  for (const sarea of screen.sareas) {
    const area = sarea.area

    if (!area) continue

    if (area instanceof View3D) {
      area.fps = time
    }
  }
}

const rcbs = [] as (() => void)[]

const f = () => {
  animreq = undefined

  // do not draw if screen is not listening, happens mostly during file load
  // (note: drawing inside file load can lead to race conditions).
  if (!peekAppState()?.screen?.listening) {
    window.setTimeout(() => window.redraw_viewport(true), 200)
    return
  }

  //forcibly update datagraph
  window.updateDataGraph(true)

  for (let i = 0; i < drawCount; i++) {
    f2()
  }

  for (const cb of rcbs) {
    cb()
  }

  rcbs.length = 0
}

window.redraw_viewport = (ResetRender = true, DrawCount /** @deprecated */ = 1) => {
  resetRender |= ResetRender ? 1 : 0
  drawCount = DrawCount

  if (animreq !== undefined) {
    return
  }
  animreq = requestAnimationFrame(f)
}

window.redraw_viewport_p = (ResetRender = true, DrawCount /** @deprecated */ = 1) => {
  return new Promise((accept, reject) => {
    rcbs.push(accept as () => void)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    window.redraw_viewport(ResetRender, DrawCount)
  })
}
