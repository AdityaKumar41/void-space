# Hosting VOID·STUDIO and VOID·SPACE

## Free editor deployment

VOID·STUDIO is published at https://adityakumar41.github.io/void-space/ by
`.github/workflows/deploy-studio.yml`. Pushes to `main` build the full editor,
including sculptcore WebAssembly and its addons. GitHub Pages must use the
GitHub Actions publishing source. The upstream MIT licence ships with the site.

The editor requires a browser with WebGPU. The Pages package includes the
cross-origin isolation service worker needed by its WebAssembly threads. The
first visit reloads once while the service worker takes control. Browser-local
editing, project files, and exports do not require an account or backend.

This deployment does not host VOID·SPACE or its backend. Account sign-in, cloud
projects, provider-backed AI, queued jobs, and publishing need running backend
services. The bridge panel describes this limitation instead of calling a
nonexistent API on github.io. No paid hosting resources were provisioned.

## Connecting a backend later

1. Host the Studio API and worker with their own PostgreSQL, Redis, and IPFS
   storage. Run Studio migrations and RLS setup before starting traffic. Use
   distinct migration, application, and platform database roles.
2. Host VOID·SPACE's Next.js web service, API and worker with its separate
   PostgreSQL, Redis, IPFS, and shared upload staging storage. An API and worker
   on different hosts cannot share a local staging directory: mount shared
   storage or replace staging with object storage before deploying separately.
3. Configure live chain RPC, chain ID and deployed licensing contract; configure
   each external provider needed by the features you intend to offer. Never
   publish development credentials or seed the public demo passwords on a live
   backend.
4. Configure `STUDIO_CORS_ORIGINS` with `https://adityakumar41.github.io` and
   allow the web origins in VOID·SPACE's `CORS_ORIGINS`. The Studio API and
   VOID·SPACE must use the same access-token signing secret for the existing SSO
   integration. Configure the Studio's live VOID·SPACE URL and publish key on
   the server, never in Pages variables or JavaScript.
5. Set the GitHub repository **Actions variable** `VOID_STUDIO_API_URL` to the
   Studio backend HTTPS origin, without `/studio/api/v1`, then rerun the Pages
   workflow. This is a public URL, never a secret. For a same-origin reverse
   proxy, use `node tools/package-site.mjs` without `--pages` and serve the
   `_headers` policies through your host.
6. Set `VOID_STUDIO_URL` on the VOID·SPACE API and
   `NEXT_PUBLIC_STUDIO_URL` during its web build to
   `https://adityakumar41.github.io/void-space`. Keep the repository subpath for
   the editor and `/sso.html` session handoff.

GitHub Pages serves static files and cannot run these backend services. The
current backend uses long-running workers and persistent disks; choosing free
providers requires checking their compute, disk and queue limits and creating
the necessary accounts. A sleeping web service alone is insufficient.

## Verification

Build locally with `pnpm --dir apps/studio-web build:release`, then run
`node apps/studio-web/tools/package-site.mjs --pages`. The package is in
`apps/studio-web/_site`. Production CI starts with a clean build and rejects
source maps. Test the packaged artifact using `node node_modules/@playwright/test/cli.js
test --config playwright.pages.config.ts` from `apps/studio-web` (requires
Chromium installed). Once a backend is connected, verify login, session handoff, project
save/reload, AI jobs, GLB export, publishing, and marketplace retrieval against
that deployment before treating those integrations as live.

Set `STUDIO_E2E_URL=https://adityakumar41.github.io/void-space/` when running
the Pages test configuration to check the public deployment instead.
