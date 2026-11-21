import {buildStudioIconSvg} from './voidspace/studio_icons.js'
import cconst2 from './path.ux/scripts/config/const.js'
import {default as config, loadConfigLocal} from './config/config.js'
import {IconManager, setBaseUnit, setIconManager, setMetric, UIBase} from './path.ux/scripts/pathux.js'
import {resolvePath} from './config.js'
import {_setUIBase} from './framework_api.js'

_setUIBase(UIBase)

export var iconmanager

/**
 * @param {string|undefined} iconSheetUrl explicit sheet URL; when omitted the
 *        host document's `#iconsheet` is used, then a prefix-resolved default.
 *        The NW.js shell needs the markup: its window.html sits one directory
 *        down, so resolvePath() would aim at `nwjs/assets/`.
 */
export async function setupIconsSvg(iconSheetUrl) {
  const existingSheet = document.querySelector('#iconsheet')
  let iconsheet

  if (iconSheetUrl !== undefined) {
    iconsheet = document.createElement('img')
    iconsheet.src = iconSheetUrl
  } else if (existingSheet instanceof HTMLImageElement) {
    iconsheet = existingSheet
  } else {
    iconsheet = document.createElement('img')
    iconsheet.src = resolvePath('assets/iconsheet.svg')
  }

  // Resolve and decode the sheet before any widgets paint their first frame.
  // Explicit host-provided sheets retain their artwork.
  if (iconSheetUrl === undefined) {
    try {
      const response = await fetch(iconsheet.src)
      if (!response.ok) throw new Error(`Icon sheet: ${response.status}`)
      const source = buildStudioIconSvg(await response.text())
      const image = new Image()
      image.src = URL.createObjectURL(new Blob([source], {type: 'image/svg+xml'}))
      await image.decode()
      iconsheet = image
    } catch (error) {
      console.warn('Using the original editor icons', error)
      await iconsheet.decode()
    }
  } else {
    await iconsheet.decode()
  }

  iconmanager = new IconManager(
    [iconsheet, iconsheet, iconsheet, iconsheet],
    [
      [32, 18],
      [32, 20],
      [32, 38],
      [32, 55],
    ],
    16
  )

  setIconManager(iconmanager, {
    SMALL : 0,
    LARGE : 1,
    XLARGE: 2,
  })

  window.updateIconDPI = () => {
    //do nothing.
  }
}

/**
 * Process-wide path.ux setup: constants, units and the icon manager. path.ux
 * holds these as module globals, so this runs once per page, not per mounted
 * app instance.
 *
 * @param {{iconSheetUrl?: string}} options
 */
export async function setupPathux(options = {}) {
  await loadConfigLocal()

  config.pathuxConfig.DEBUG = config.DEBUG || {}
  cconst2.loadConstants(config.pathuxConfig)
  window.DEBUG = cconst2.DEBUG

  setBaseUnit('meter')
  setMetric(true)

  await setupIconsSvg(options.iconSheetUrl)
}
