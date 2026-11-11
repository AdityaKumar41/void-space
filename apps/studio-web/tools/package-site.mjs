import {cp, mkdir, readFile, rm, writeFile, stat} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import Path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const out = Path.join(root, '_site')
const pages = process.argv.includes('--pages')
const api = process.env.VOID_STUDIO_API_URL?.trim() || ''
if (api) {
  const url = new URL(api)
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('VOID_STUDIO_API_URL must be an HTTPS origin without a path or credentials')
  }
}
// Fail before removing the previous site if a clean build is missing.
for (const file of ['build/entry_point.js', 'build/sculptcore-browser.wasm', 'build/sculptcore-browser.js']) {
  await stat(Path.join(root, file))
}
await rm(out, {recursive: true, force: true})
await mkdir(out, {recursive: true})
for (const name of ['build', 'assets', 'resources', 'LICENSE.txt', 'sso.html']) {
  await cp(Path.join(root, name), Path.join(out, name), {recursive: true})
}
// These libraries are deliberately external to the bundle.
for (const file of ['scripts/extern/jszip/jszip.js', 'scripts/extern/Math.js', 'scripts/util/numeric.js']) {
  await mkdir(Path.dirname(Path.join(out, file)), {recursive: true})
  await cp(Path.join(root, file), Path.join(out, file))
}
await writeFile(Path.join(out, 'deployment-config.js'),
  `window.VOID_STUDIO_API_URL = ${JSON.stringify(api)};\nwindow.VOID_STUDIO_STATIC_HOST = ${pages};\n`)
let html = await readFile(Path.join(root, 'index.html'), 'utf8')
let scripts = '<script src="deployment-config.js"></script>'
if (pages) {
  await cp(Path.join(root, 'coi-serviceworker.js'), Path.join(out, 'coi-serviceworker.js'))
  await cp(Path.join(root, 'isolation-bootstrap.js'), Path.join(out, 'isolation-bootstrap.js'))
  scripts += '\n  <script src="isolation-bootstrap.js"></script>'
}
html = html.replace('<head>', `<head>\n  ${scripts}`)
await writeFile(Path.join(out, 'index.html'), html)
await writeFile(Path.join(out, '.nojekyll'), '')
await writeFile(Path.join(out, '_headers'), '/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n  Referrer-Policy: no-referrer\n')
console.log(`Packaged Studio at ${out}; backend ${api || (pages ? 'not configured' : 'same origin')}`)
