//override default undo implementation in Path.ux's toolop class
import {ToolOp, BoolProperty, UndoFlags} from '../path.ux/scripts/pathux.js'
import * as cconst from './const.js'
import * as platform from './platform.js'
import {exportSTLMesh} from '../util/stlformat.js'
import {formatForFilename, listImportFormats, getFileFormat, listExportFormats} from './file_formats.js'
import {genDefaultFile} from './gen_default_file.js'
import {getAppState} from './app_instance.js'
import addonManager from '../addon/addon.js'

// AppImportOBJOp moved to scripts/mesh/import_obj_op.js so core stops
// importing from mesh. The class is registered there via ToolOp.register.

ToolOp.prototype.calcUndoMem = function (ctx) {
  if (this.undoPre !== ToolOp.prototype.undoPre) {
    console.warn('ToolOp.prototype.calcUndoMem: implemet me!', this)
    return 0
  }

  return this._undo?.byteLength ?? 0
}

ToolOp.prototype.undoPre = function (ctx) {
  this._undo = ctx.state.createUndoFile()
}

ToolOp.prototype.undo = function (ctx) {
  console.log('loading undo file 1')
  ctx.state.loadUndoFile(this._undo)

  window.redraw_viewport()
}

ToolOp.prototype.execPost = function (ctx) {
  window.redraw_viewport()
}
export class FileSaveOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Save',
      toolpath: 'app.save',
      inputs: {
        forceDialog  : new BoolProperty(true),
        saveToolStack: new BoolProperty(false),
      },
      undoflag: UndoFlags.NO_UNDO,
    }
  }

  exec(ctx) {
    console.log('File save')

    let needDialog = this.inputs.forceDialog.getValue()
    needDialog = needDialog || !getAppState().saveHandle

    let args = {save_toolstack: this.inputs.saveToolStack.getValue()}

    if (!needDialog) {
      let data = new DataView(getAppState().createFile(args))

      platform.platform
        .writeFile(data, getAppState().saveHandle, 'application/x-octet-stream')
        .then(() => {
          getAppState().autosave?.onProjectSaved()
          ctx.message('File saved')
        })
        .catch((err) => {
          console.error(err.stack)
          console.error(err.message)
          ctx.error('Save Error')
        })
      return
    }

    let savefunc = () => getAppState().createFile(args)

    platform.platform
      .showSaveDialog('Save File', savefunc, {
        filters: [
          {
            defaultPath: 'unnamed.' + cconst.FILE_EXT,
            name       : 'Project Files',
            extensions : [cconst.FILE_EXT],
          },
        ],
      })
      .then((saveHandle) => {
        if (saveHandle) {
          getAppState().saveHandle = saveHandle
        }
        getAppState().autosave?.onProjectSaved()
        ctx.message('File saved')
      })
      .catch((err) => {
        if (err?.name === 'AbortError') {
          return
        }
        console.warn('Save dialog error:', err)
      })
    //saveFile(getAppState().createFile(), "unnamed."+cconst.FILE_EXT, ["."+cconst.FILE_EXT]);
  }
}

ToolOp.register(FileSaveOp)

export class FileOpenOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Open',
      toolpath: 'app.open',
      inputs: {
        //forceDialog: new BoolProperty(true)
      },
      undoflag: UndoFlags.NO_UNDO,
    }
  }

  exec(ctx) {
    console.log('File load')

    platform.platform
      .showOpenDialog('Open File', {
        filters: [
          {
            name      : 'Project Files',
            extensions: [cconst.FILE_EXT],
          },
        ],
      })
      .then((paths) => {
        console.log('paths', paths)
        if (!paths || paths.length === 0) {
          return
        }

        return platform.platform.readFile(paths[0], 'application/x-octet-stream')
      })
      .then((data) => {
        if (!data) return
        console.log('got data!', data)
        getAppState().saveHandle = undefined
        getAppState().loadFileAsync(data, {reset_toolstack: true, load_screen: true, reset_context: true})
      })
      .catch((err) => {
        if (err?.name === 'AbortError') {
          return
        }
        console.warn('Open dialog error:', err)
      })

    //loadFile(undefined, ["."+cconst.FILE_EXT]).then((filedata) => {
    //getAppState().loadFile(filedata);
    //});
  }
}

ToolOp.register(FileOpenOp)

export class LoadLastAutosaveOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Load Last Autosave',
      toolpath: 'app.load_last_autosave',
      inputs  : {},
      undoflag: UndoFlags.NO_UNDO,
    }
  }

  exec(ctx) {
    const mgr = getAppState().autosave
    if (!mgr) {
      console.warn('autosave manager not ready')
      return
    }
    mgr.loadLatest().then((ok) => {
      if (ok) {
        window.redraw_viewport(true)
      }
    })
  }
}
ToolOp.register(LoadLastAutosaveOp)

export class FileNewOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'New',
      toolpath: 'app.new',
      inputs: {
        //forceDialog: new BoolProperty(true)
      },
      undoflag: UndoFlags.NO_UNDO,
    }
  }

  exec(ctx) {
    console.log('File new')
    if (confirm('Make new file?')) {
      //paranoia check, clear this here
      getAppState().saveHandle = undefined

      genDefaultFile(getAppState(), false)
    }
  }
}
ToolOp.register(FileNewOp)

function triggerBrowserDownload(filename, data, mimeType) {
  let blob
  if (typeof data === 'string') {
    blob = new Blob([data], {type: mimeType || 'text/plain;charset=utf-8'})
  } else if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
    blob = new Blob([data], {type: mimeType || 'application/octet-stream'})
  } else {
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function exportWithFormat(ctx, formatId, defaultFilename, dialogTitle, mimeType) {
  let fmt = getFileFormat(formatId)
  if (!fmt && typeof addonManager !== 'undefined') {
    if (!addonManager.isEnabled('leafmesh')) {
      try {
        addonManager.enable('leafmesh')
      } catch {}
      fmt = getFileFormat(formatId)
    }
  }

  if (!fmt || typeof fmt.exportToBytes !== 'function') {
    try {
      const addonUrl = new URL('./build/addons/leafmesh/src/main.js', document.baseURI).href
      const leafmeshMod = await import(/* @vite-ignore */ addonUrl)
      if (formatId === 'glb' || formatId === 'gltf') fmt = leafmeshMod?.LEAFMESH_GLB_FORMAT
      else if (formatId === 'obj') fmt = leafmeshMod?.LEAFMESH_OBJ_FORMAT
      else if (formatId === 'stl') fmt = leafmeshMod?.LEAFMESH_STL_FORMAT
      else if (formatId === 'ply') fmt = leafmeshMod?.LEAFMESH_PLY_FORMAT
    } catch (e) {
      console.warn('Fallback dynamic import failed for exporter:', e)
    }
  }

  if (!fmt || typeof fmt.exportToBytes !== 'function') {
    ctx.error?.(`No exporter registered for format: ${formatId}`)
    return
  }

  const ob = ctx.scene?.objects?.active || ctx.object
  const baseName = (ob?.name || 'model').replace(/[^a-zA-Z0-9_\-]/g, '_')
  const ext = fmt.extensions[0] || `.${formatId}`
  const filename = `${baseName}${ext}`

  const data = fmt.exportToBytes(ctx)
  if (!data || (data instanceof Uint8Array && data.length === 0) || (typeof data === 'string' && data.length === 0)) {
    ctx.warning?.(`Scene has no geometry to export as ${fmt.uiName}`)
    return
  }

  const savefunc = () => data

  if (platform.platform && typeof platform.platform.showSaveDialog === 'function') {
    platform.platform
      .showSaveDialog(dialogTitle || `Export ${fmt.uiName}`, savefunc, {
        filters: [
          {
            defaultPath: filename,
            name       : `${fmt.uiName} Files`,
            extensions : fmt.extensions.map((e) => e.replace(/^\./, '')),
          },
        ],
      })
      .then((saveHandle) => {
        if (saveHandle) {
          getAppState().saveHandle = saveHandle
        }
        ctx.message?.(`Exported ${filename}`)
      })
      .catch((err) => {
        if (err?.name === 'AbortError') {
          return
        }
        triggerBrowserDownload(filename, data, mimeType)
        ctx.message?.(`Exported ${filename}`)
      })
  } else {
    triggerBrowserDownload(filename, data, mimeType)
    ctx.message?.(`Exported ${filename}`)
  }
}

export class FileExportGLBOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Export glTF 2.0 (.glb)',
      toolpath: 'app.export_glb',
      inputs  : {},
      undoflag: UndoFlags.NO_UNDO,
    }
  }

  exec(ctx) {
    exportWithFormat(ctx, 'glb', 'model.glb', 'Export glTF 2.0 Binary', 'model/gltf-binary')
  }
}

ToolOp.register(FileExportGLBOp)

export class FileExportOBJOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Export Wavefront (.obj)',
      toolpath: 'app.export_obj',
      inputs  : {},
      undoflag: UndoFlags.NO_UNDO,
    }
  }

  exec(ctx) {
    exportWithFormat(ctx, 'obj', 'model.obj', 'Export Wavefront OBJ', 'text/plain')
  }
}

ToolOp.register(FileExportOBJOp)

export class FileExportPLYOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Export Stanford (.ply)',
      toolpath: 'app.export_ply',
      inputs  : {},
      undoflag: UndoFlags.NO_UNDO,
    }
  }

  exec(ctx) {
    exportWithFormat(ctx, 'ply', 'model.ply', 'Export Stanford PLY', 'text/plain')
  }
}

ToolOp.register(FileExportPLYOp)

export class FileExportSTL extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Export STL',
      toolpath: 'app.export_stl',
      inputs: {
        forceDialog  : new BoolProperty(true),
        saveToolStack: new BoolProperty(false),
      },
      undoflag: UndoFlags.NO_UNDO,
    }
  }

  exec(ctx) {
    const fmt = getFileFormat('stl')
    let stlData = fmt?.exportToBytes?.(ctx)
    if (!stlData || (stlData instanceof Uint8Array && stlData.length === 0)) {
      let list = new Set(ctx.selectedTriangleSourceObjects).map((f) => f.data)
      if (list.size > 0) {
        stlData = exportSTLMesh(list)
      }
    }

    if (!stlData || (stlData instanceof Uint8Array && stlData.length === 0) || (stlData instanceof ArrayBuffer && stlData.byteLength === 0)) {
      ctx.warning?.('No geometry to export as STL')
      return
    }

    const ob = ctx.scene?.objects?.active || ctx.object
    const filename = `${(ob?.name || 'model').replace(/[^a-zA-Z0-9_\-]/g, '_')}.stl`

    const savefunc = () => stlData

    platform.platform
      .showSaveDialog('Export STL', savefunc, {
        filters: [
          {
            defaultPath: filename,
            name       : 'STL Files',
            extensions : ['stl'],
          },
        ],
      })
      .then((saveHandle) => {
        if (saveHandle) {
          getAppState().saveHandle = saveHandle
        }
        ctx.message?.(`Exported ${filename}`)
      })
      .catch((err) => {
        if (err?.name === 'AbortError') {
          return
        }
        triggerBrowserDownload(filename, stlData, 'application/sla')
        ctx.message?.(`Exported ${filename}`)
      })
  }
}

ToolOp.register(FileExportSTL)

// AppImportOBJOp moved to scripts/mesh/import_obj_op.js (mesh-specific feature
// that was coupling core to mesh — see plan §3 / §12). The class is still
// exported globally via its ToolOp.register call there.

export class FileImportOp extends ToolOp {
  static tooldef() {
    return {
      uiname  : 'Import File',
      toolpath: 'app.import_file',
      inputs  : {},
    }
  }

  exec(ctx) {
    if (typeof addonManager !== 'undefined' && !addonManager.isEnabled('leafmesh')) {
      addonManager.enable('leafmesh')
    }
    // The dialog is built from whatever is registered right now, so an addon
    // contributing a format is the only thing that makes its extension
    // reachable — core knows no format names.
    const formats = listImportFormats()
    if (formats.length === 0) {
      ctx.error('No import formats are registered')
      return
    }

    const filters = formats.map((fmt) => ({
      name      : fmt.uiName,
      extensions: fmt.extensions.map((ext) => (ext.startsWith('.') ? ext.slice(1) : ext)),
    }))

    let filename = ''

    platform.platform
      .showOpenDialog('Import File', {filters})
      .then((paths) => {
        if (!paths || paths.length === 0) {
          return undefined
        }

        filename = paths[0].filename ?? String(paths[0])
        return platform.platform.readFile(paths[0], 'application/x-octet-stream')
      })
      .then((data) => {
        if (!data) {
          return
        }

        const fmt = formatForFilename(filename)
        if (fmt === undefined) {
          ctx.error?.(`No importer for ${filename}`)
          return
        }

        fmt.importFromBytes(ctx, new Uint8Array(data), filename)
        window.redraw_viewport()
      })
      .catch((err) => {
        if (err?.name === 'AbortError') {
          return
        }
        console.warn('Import dialog error:', err)
      })
  }
}

ToolOp.register(FileImportOp)
