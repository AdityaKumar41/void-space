# VENDOR — the VOID·STUDIO editor fork

`apps/studio-web/` is **not** first-party code. It is a fork of an upstream project,
vendored so VOID·STUDIO can customise it without waiting on an upstream release
cadence. This file is the provenance record: read it before changing anything here.

## Upstream

| Field | Value |
| --- | --- |
| Project | FaberLeaf — "a Blender-inspired 3D content-creation app framework" |
| Repository | <https://github.com/joeedh/faber-leaf> |
| Forked at | `6cd52c95e2a2717f5bd2995c12a226f797c58508` (`master`, 2026-09-12) |
| Licence | **MIT** — `Copyright (c) 2022 Joseph Eagar`, retained verbatim in [`LICENSE.txt`](./LICENSE.txt) |
| Upstream demo | <https://joeedh.github.io/faber-leaf/> |

### Licence compliance (MIT)

MIT requires that the copyright notice and permission notice accompany all copies or
substantial portions of the software. Two things therefore must not be deleted:

1. `apps/studio-web/LICENSE.txt` — the verbatim upstream licence.
2. This file — so a future reader can tell which code came from upstream.

Third-party components vendored underneath this tree carry their own licences and are
listed below. **Every one of them is permissive** (MIT or Unlicense), so there is no
copyleft obligation anywhere in this subtree, and no source-disclosure requirement
attached to VOID·STUDIO as a whole. Attribution is the only obligation.

## Vendored dependencies

These are declared in the root [`.gitmodules`](../../.gitmodules) and pinned to the
exact commits the vendored upstream tree references. They are *not* on npm under these
names, which is why they are submodules rather than dependencies.

| Path | Upstream | Pinned commit | Licence |
| --- | --- | --- | --- |
| `scripts/path.ux` | [joeedh/path.ux](https://github.com/joeedh/path.ux) | `1d7438b33ae23ef1ed4dd3b5ef6aa9cebb374c2f` | MIT |
| `scripts/mathl` | [joeedh/mathl](https://github.com/joeedh/mathl) | `423648631ef1225667bcc16155096b8a418340a6` | MIT |
| `sculptcore` | [joeedh/sculptcore](https://github.com/joeedh/sculptcore) | `536fafa949594839b567f51d495cc58e5328b88c` | MIT |
| `vendor/nstructjs` | [joeedh/STRUCT](https://github.com/joeedh/STRUCT) | `4d3fbc1a7c6a3c927ecb1eb18bf27bf98dc03d12` | Unlicense |

`vendor/nstructjs` is a fork of STRUCT carrying host hooks on the
`webgl-app-framework-patches` branch (see `vendor/README.md`). Pin the commit, not the
branch name.

Fetch them after cloning:

```sh
git submodule update --init --depth 1
```

## Deliberate deviations from upstream

This fork is not a pristine copy. These are the intentional differences, so a future
`git diff` against upstream is readable:

| Change | Reason |
| --- | --- |
| `examples/` omitted, except one file (~180 MB) | Crash-reproduction and sculpt-test `.wproj` documents. Binary fixtures for upstream's own bug reports, not source, and nothing in the app loads them — `tools/serv.js` mentions `/examples/` only in a comment about percent-decoding. **Consequence:** the debugging scripts in `tools/repro/` hard-code paths like `/examples/ts2.wproj` and will now fail. They are one-off tools for upstream's own bugs; re-fetch the fixtures from upstream if you need one. **One exception is kept:** `examples/sculpt test.wproj`, because `tests/e2e/load_wproj.e2e.ts` loads it by URL — our suite, not upstream's, and the fixture has to exist for it to run. The other `.wproj` still on disk is ignored rather than tracked (see the row below). |
| `documentation/haikus/` omitted (~23 MB) | Six commit-story `.mp4` files. Marketing artefacts for upstream's development log. |
| `archive/` omitted (~12 MB) | Superseded source kept for reference. Only comments named it, and the `git show <sha>:archive/…` instructions those comments give cannot work here anyway — `.git/` was not vendored, so the commit hashes resolve to nothing. Dead weight rather than a reference. |
| `.git/` omitted | Upstream history is ~144 MB. Re-add it as a remote if you need `git log` archaeology: `git remote add faber-leaf https://github.com/joeedh/faber-leaf.git`. |
| `.claude/`, `.windsurf/`, `.agents/`, `.claudeignore`, `CLAUDE.md` | The upstream author's AI-editor configuration and their AI guide. Not this project's tooling. **Consequence:** four source comments still point at `CLAUDE.md` for its "Debug context API" guide; the guide is in the upstream repo. |
| `ImmediateTODOs.md` | The upstream author's personal task list. Worth knowing: **sixteen** source comments cite it by item number (`ImmediateTODOs #4`, `#28`, `#10` …). Those citations are now bare references with nothing to resolve against. Kept the code, dropped the list, because the list is someone else's backlog and this fork is not going to work through it. |
| `Readme.MD`, `image.png` | Upstream's README (FaberLeaf wordmark, upstream demo link) and its screenshot. Replaced by `README.md`, which describes this directory as a monorepo member. The screenshot was unreferenced — the `image.png` strings elsewhere are `image/png` MIME types. |
| `.github/`, `.vscode/`, `githooks/` | Upstream's CI, editor settings and git hooks. A nested `.github/` is inert (GitHub reads only the root one), the hooks were never installed, and the editor settings are the author's preferences. |
| `typos.toml`, `skills-lock.json`, `make_zip.py`, `coi-serviceworker.js` | Upstream tooling with no role here. `coi-serviceworker.js` faked cross-origin isolation for the static gh-pages demo; we send real COOP/COEP headers from `docker/studio/nginx.conf`, so it is not needed — but a plain static server without those headers will not give the editor a `SharedArrayBuffer`. |
| `.gitignore` removed, rules moved to the root | A second ignore file inside a subdirectory is a second answer to "what is tracked", and the two drift. Its still-relevant rules now live in the root `.gitignore` under a `VOID·STUDIO` heading. |
| Generated and code-unread upstream files are not tracked | `tsconfig.paths.json` and `scripts/data_api/generated/` are written by `pnpm gen:paths`, which `typecheck` runs before compiling. `examples/brush_asymmetric_toolstack.wproj` (23 MB, one of the files the addon authors), `assets/{fbxtest,widgetshapes}.blend`, `assets/test.fbx` and `resources/models/stanford_bunny_reduced.*` are read by no code path — each name was searched for across `scripts/`, `tests/`, `tools/`, `addons/` and `distributions/` before being listed. All are ignored in the root `.gitignore`, with the reasoning inline so the claim can be re-checked. Two things that look the same and are deliberately **tracked**: `assets/iconsheet*.{svg,png}` (generated by `tools/iconsheet.mjs`, but `index.html` fetches them at runtime and nothing in the build regenerates them) and `examples/sculpt test.wproj` (loaded by `tests/e2e/load_wproj.e2e.ts` — the single exception to the `examples/` omission recorded above, and the reason that row now says "omitted except"). |
| `assets/logo/` removed (~3.5 MB) | FaberLeaf's logos, favicons and an unused Manrope font that nothing referenced. Replaced by `assets/brand/` — the VOID·SPACE cube mark copied from `apps/web/src/components/ui/icons.tsx`, so the Studio and the marketplace show the same object. |
| `distributions/faber-leaf{,-core}` → `distributions/void-studio{,-core}` | The distribution id is the product name, and it reaches the window title and the bundle filename. |
| `scripts/voidspace/` added | Our directory, as §3.7 intends. Holds the VOID·SPACE theme (`theme.ts`), the two widget patches a theme record cannot express (`ui_polish.ts`), and the VOID·SPACE panel (`bridge_panel.ts`) — mounted by `scripts/entry_point.js` rather than by `mountVoidStudio`, because it is shell chrome and an embedder must not inherit it. The publish handoff from inside the editor is still to come. |
| Identity renamed in the product-owned tree | `APP_KEY_NAME` is now `void-studio`, `mountFaberLeaf` is `mountVoidStudio`, and `@faber-leaf/*` package names are `@void-studio/*`. **Not** inside the four submodules: they are pinned third-party code, and editing them would break the recorded SHA. |

### What was deliberately kept

Two files look like they belong on the list above and do not:

- **`.editorconfig`, `.prettierrc`, `.prettierignore`, `.gitattributes`, `eslint.config.js`,
  `.commentlintrc.jsonc`, `.dependency-cruiser.cjs`** — the fork's own style and lint configuration.
  Kept so the root tooling leaves this tree alone (see the exclusions in the root `eslint.config.mjs`
  and `.prettierignore`). Without them, one `pnpm format` would rewrite all ~400 files into this
  repo's style and make the upstream diff unreadable.
- **`documentation/`** — upstream's design notes, and unlike `archive/` these are *live* references:
  a dozen source comments cite `documentation/geometry-contract.md` and `documentation/debugSurface.md`
  as the specification for the geometry contract and the debug surface. Deleting it would make real
  documentation unreachable, not just tidy a directory.

## Building this fork

It does **not** participate in the root pnpm workspace — see the comment in
[`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) for why. It keeps its own lockfile.
Drive it through the root scripts so the invocation stays in one place:

```sh
pnpm studio:fork:install    # its own dependency graph, including NW.js
pnpm studio:fork:setup      # one-time: emsdk + cmake + ninja + wgpu-native (needs a clang/cl.exe host toolchain)
pnpm studio:fork:build      # bundles the editor
pnpm studio:fork:dev        # serves it locally
```

`studio:fork:setup` compiles `sculptcore` (C++20) to WebAssembly and to an N-API addon.
It is the one step here that needs a native toolchain, and it is only required for the
browser build — the Node/NW.js addon path can be skipped.

## How VOID·SPACE integrates

Everything VOID·SPACE-specific is additive and lives behind a boundary, so upstream's
files stay mergeable:

| Concern | Where it lives |
| --- | --- |
| Federated sign-in against VOID·SPACE (SRS §3.5.1, FR-1.x) | `src/voidspace/` |
| Publish handoff + status strip (SRS §3.5.2, FR-14.x) | `src/voidspace/` |
| AI Copilot panel and tool bridge (SRS §4.11, §7) | `src/voidspace/` |
| Contract types shared with the Studio API | `@void-space/studio-engine` |

Upstream renderer constraints that VOID·STUDIO inherits and must design around, both
recorded here rather than discovered later:

- **The renderer is WebGPU-only.** There is no WebGL2 fallback. Browsers without WebGPU
  cannot run the editor at all, and the SRS (§3.2) specifies WebGL2 as the baseline with
  WebGPU as an opportunistic path — the inverse of what this fork provides.
- **It expects cross-origin isolation.** `coi-serviceworker.js` is shipped to enable
  `SharedArrayBuffer`. Any deployment must send COOP/COEP headers, which constrains how
  this app can be embedded or reverse-proxied alongside VOID·SPACE's own routes.

## Keeping the fork current

```sh
git remote add faber-leaf https://github.com/joeedh/faber-leaf.git
git fetch faber-leaf master
git diff --stat faber-leaf/master..HEAD -- apps/studio-web   # what we changed
```

Because the deviations above are directory deletions plus additive `src/voidspace/`,
upstream changes outside those paths should apply cleanly.
