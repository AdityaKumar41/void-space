import {defineConfig} from '@playwright/test'
import base from './playwright.config'

const remote = process.env.STUDIO_E2E_URL

// Exercise the actual Pages artifact, including service-worker isolation,
// instead of the development server's response headers and source files.
export default defineConfig({
  ...base,
  testMatch: ['**/void_studio_boot.e2e.ts', '**/void_studio_pages.e2e.ts'],
  webServer: remote ? undefined : {
    command: 'python3 -m http.server 5099 --bind 127.0.0.1 --directory _site',
    url: 'http://127.0.0.1:5099',
    reuseExistingServer: false,
  },
  use: {...base.use, baseURL: remote || 'http://127.0.0.1:5099'},
})
