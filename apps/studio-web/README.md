# VOID·STUDIO — the editor

The browser-based 3D creation environment for VOID·SPACE: model, texture, light and rig an asset, then
publish it straight into the marketplace's review and licensing pipeline without leaving the browser.

Part of the **VOID·SPACE monorepo**. The rest of the product lives one level up:

| Sibling | What it is |
| --- | --- |
| `apps/web`, `apps/api`, `apps/worker` | VOID·SPACE — the marketplace this publishes into |
| `apps/studio-api` | The Studio's control plane behind `/studio/api/v1` — sessions, the project index, the publish handoff |
| `packages/voidspace-client` | The typed SDK this editor's backend uses to reach VOID·SPACE's `/api/v1` |
| `packages/studio-engine` | The Copilot tool catalogue, the command contract, the publish gate |
| `packages/studio-ai` | The Claude Copilot loop, the readiness audit, the Meshy generative tools |
| `packages/studio-db` | The Studio's own database, RLS policies and tenant-scoped client |

Read [`VENDOR.md`](./VENDOR.md) before changing anything here. This directory is a **vendored fork of
[FaberLeaf](https://github.com/joeedh/faber-leaf)** (MIT), and that file records the upstream commit,
the licences, every deliberate deviation, and the two constraints the renderer imposes on the product.

## Why this directory looks different from its siblings

It is upstream's project structure, not ours: `path.ux` instead of React, its own esbuild pipeline, its
own nested pnpm workspace. Three consequences worth knowing before you are surprised by them:

- **It is not a member of the root pnpm workspace.** Its own `pnpm-workspace.yaml` resolves
  `nstructjs` from a submodule, and it pulls the NW.js desktop shell — see the comment in the root
  `pnpm-workspace.yaml` for the full reasoning. It keeps its own lockfile.
- **The root tooling does not reach into it.** `eslint.config.mjs` ignores it and `.prettierignore`
  excludes it, because this code is formatted and linted against upstream's config, not ours. Its own
  gates still run: `pnpm --dir apps/studio-web lint`.
- **Nothing here is `@void-space`-scoped.** Its packages are `@void-studio/*`, after the rename.

## Working on it

```sh
pnpm studio:fork:install    # its own dependency graph
pnpm studio:fork:setup      # emsdk + cmake + ninja + wgpu-native; needs a clang/cl.exe toolchain
pnpm studio:fork:dev        # serve it
```

`studio:fork:setup` compiles `sculptcore` (C++20) to WebAssembly. It is the one step that needs a
native toolchain, and it is only needed for the browser build — the NW.js N-API addon path can be
skipped.

Those scripts live in the **root** `package.json`, next to `studio:dev:up` and `studio:test`, so every
VOID·STUDIO command is in one place rather than split between two files.

## What we added

| Path | What it is |
| --- | --- |
| `scripts/voidspace/theme.ts` | The VOID·SPACE palette, derived onto path.ux's theme. Wired at boot in `scripts/mount.ts`. |
| `scripts/voidspace/ui_polish.ts` | The two widget fixes a theme record cannot express. Same boot point as the theme. |
| `scripts/voidspace/bridge_panel.ts` | The VOID·SPACE panel: where a publish goes, and what the destination already holds. Mounted by `scripts/entry_point.js` — it is shell chrome, so it is the *shell* that mounts it and not `mountVoidStudio`. Its tests are `tests/unit/void_space_panel.test.ts`. |
| `assets/brand/` | The cube mark, favicons, and the self-hosted fonts. Replaced upstream's logo set. |
| `VENDOR.md` | Provenance and deviations. |

The panel talks to `apps/studio-api` and nothing else: it holds no credential, and it never contacts
VOID·SPACE directly, because the API is the single permitted crossing (§5.3). Without the API running
it renders "offline" rather than failing — which is what lets the editor boot with or without its
backend.

The publish handoff — exporting a GLB, running the readiness audit, posting to
`/projects/:id/publish` — is still to come, as is the Copilot panel. See
[`docs/VOID-STUDIO.md`](../../docs/VOID-STUDIO.md) §5 for the current status and what is outstanding.
