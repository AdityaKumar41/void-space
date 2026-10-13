/**
 * `void-studio` — the full product. What ships and what developers run.
 *
 * A manifest, not a fork: addon set, startup scene, title. Product logic
 * belongs in an addon. See scripts/addon/distribution.ts for the rules.
 */

import {bundled, defineDistribution, external} from '../../scripts/addon/distribution'

import * as litemesh from '@builtin/litemesh'
import litemeshManifest from '../../addons/builtin/litemesh/manifest.json'

export default defineDistribution({
  id   : 'void-studio',
  title: 'VOID·STUDIO',

  addons: [
    bundled(litemeshManifest, litemesh),
    external('leafmesh', {enabled: true}),
    external('uv_editor'),
  ],

  defaultScene: 'litemesh-sphere',
})
