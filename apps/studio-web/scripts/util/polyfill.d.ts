import type {AppState} from '../core/appstate'

export interface INumberList {
  [k: number]: number

  length: number

  slice(start: number, end: number): INumberList
}

export declare global {
  function updateDataGraph(immediate?: boolean): void

  /* This goes here for use by STRUCT scripts;
   * it's deliberately wrong to force you to
   * properly import it in other code.*/
  function DataRef(): void

  interface Set {
    map(func: (item: any) => any): any

    filter(func: (item: any) => boolean): any
  }

  /* window.D* debug variables.
   * These are created at the console.
   * only.
   **/
  interface Window {
    D1: number | undefined
    D2: number | undefined
    D3: number | undefined
    D4: number | undefined
    D5: number | undefined
    D6: number | undefined
    DTST2: number | undefined
    _appstate: AppState
    FILE_LOADING: boolean
    /**
     * Alias to the active instance's context; view3d.ts owns it. Under the
     * default WebGPU renderer it is a throwing stub, not a real context.
     */
    _gl: WebGL2RenderingContext | undefined
    /** resetRenderEngine defaults to true */
    redraw_viewport(resetRenderEngine?: boolean, drawCount?: number): void
    /** resetRenderEngine defaults to true */
    redraw_viewport_p(resetRenderEngine?: boolean, drawCount?: number): Promise<void>
    redraw_all(): void
    updateDataGraph(force?: boolean): void
    _genDefaultFile: typeof import('../core/appstate').genDefaultFile
  }

  const DEBUG: any
  const _appstate: AppState

  /**
   * `AppState` reachable as a type without importing `core/appstate` — what
   * lets `core/app_instance.ts` stay import-free (P20 §2.1).
   */
  type AppStateGlobal = AppState

  interface HTMLCanvasElement {
    dpi: number
  }
}
