import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../../coi-serviceworker.js', import.meta.url), 'utf8')

function worker() {
  const handlers = new Map(), requests = []
  const self = {
    location: new URL('https://example.test/void-space/coi-serviceworker.js'),
    addEventListener: (name, handler) => handlers.set(name, handler),
  }
  vm.runInNewContext(source, {
    self, Request, Response, Headers, URL, console,
    fetch: async request => {
      requests.push(request)
      return new Response('current release', {headers: {'Content-Type': 'application/wasm'}})
    },
  })
  return {
    requests,
    async fetch(request) {
      let response
      handlers.get('fetch')({request, respondWith: value => {response = value}})
      return response
    },
    credentialless() {handlers.get('message')({data: {type: 'coepCredentialless', value: true}})},
  }
}

test('Pages revalidates stable engine URLs when an older release is in the HTTP cache', async () => {
  const sw = worker()
  for (const name of ['entry_point.js', 'sculptcore-browser.js', 'sculptcore-browser.wasm']) {
    const response = await sw.fetch(new Request(`https://example.test/void-space/build/${name}`))
    assert.equal(sw.requests.at(-1).cache, 'no-cache')
    assert.equal(await response.text(), 'current release')
    assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin')
    assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp')
  }
})

test('external credentialless requests preserve their cache policy and omit credentials', async () => {
  const sw = worker()
  sw.credentialless()
  const response = await sw.fetch(new Request('https://cdn.example/font.woff2', {
    mode: 'no-cors', credentials: 'include', cache: 'force-cache',
  }))
  assert.equal(sw.requests[0].credentials, 'omit')
  assert.equal(sw.requests[0].cache, 'force-cache')
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'credentialless')
})
