# VOID·STUDIO — implementation status

Companion to `docs/VOID-STUDIO_SRS_v1.0.docx` (document code `VS2-SRS-1.0`), the authoritative
specification. This file records **what exists in the repository**, what deliberately does not yet,
and every place the implementation diverges from the SRS. The SRS is normative; where this file and
the SRS disagree, the SRS wins and this file is out of date.

---

## 1. The one architectural decision that differs from the SRS

**The Editor Engine is a fork of FaberLeaf, not a purpose-built engine on Three.js.**

The SRS decided the opposite. Appendix C, _Design Decision Rationale_:

| Decision          | Chosen                           | Alternatives considered                     | SRS rationale                                                                                                   |
| ----------------- | -------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Engine foundation | Custom Editor Engine on Three.js | Adapt an existing open-source web 3D editor | "Full control over the command/undo model and scene-graph shape the Copilot and collaboration depend on (§3.3)" |

That decision was reversed deliberately, on the grounds that a working sculpting/modelling/UV engine
is the single largest piece of the product and the fastest path to a demonstrable editor. The reversal
has consequences that are recorded here rather than discovered later:

| SRS requirement                                                       | Status under the fork                                                                                                                                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2.2, §3.2 — WebGL2 baseline, WebGPU opportunistic                    | **Inverted.** The fork's renderer is WebGPU-only, with no WebGL2 fallback. Browsers without WebGPU cannot run the editor.                                                              |
| §6.2 — "a client device capable of WebGL 2 rendering is required"     | Superseded: WebGPU is now required.                                                                                                                                                    |
| §3.2 — Tailwind + shadcn/ui + Radix from `packages/ui`                | **Not met.** The fork's UI is `path.ux`, its own Blender-style screen/area toolkit. It cannot consume `@void-space/ui`, so the two products do not actually share a component library. |
| §3.4 — Yjs is the source of truth for undo/autosave                   | **Not met.** The fork serializes with `nstructjs`/STRUCT into its own autosave format. Yjs is not yet underneath it.                                                                   |
| §9.1 — `pnpm install` as a one-command bootstrap                      | **Partly met.** The fork is excluded from the root pnpm workspace and needs its own install plus a C++ toolchain. See §3 below.                                                        |
| §3.7 — engine in `packages/studio-engine`, shell in `apps/studio-web` | **Rewritten.** The engine ships inside the fork. `packages/studio-engine` now holds the _integration_ core instead — see §2.                                                           |

None of this is hidden from a reader of the code: `apps/studio-web/VENDOR.md` states the WebGPU and
cross-origin-isolation constraints at the top, and the workspace exclusion is explained inline in
`pnpm-workspace.yaml`.

## 2. How the two platforms are integrated

VOID·STUDIO is presented in the SRS as a second product with its own database (§5). In practice the
governing rule is narrower, and it is the rule the implementation follows:

> **VOID·STUDIO is a local-first authoring client. Nothing a Creator does in it is mirrored into
> VOID·SPACE's database or chain as a matter of course. The only things that cross the boundary are
> identity (inbound) and an explicit Publish (outbound).**

### 2.1 What crosses, and what never does

| Direction           | What                                | Mechanism                                                              | Frequency                      |
| ------------------- | ----------------------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| VOID·SPACE → Studio | Identity: user, tenant, role claims | Signed JWT, §3.5.1                                                     | On sign-in and session refresh |
| Studio → VOID·SPACE | **An explicit Publish**             | `POST /api/v1/assets` (+ `/versions`), §3.5.2                          | Only when a Creator asks       |
| Studio → VOID·SPACE | Publish status / review decision    | Poll of the linked asset, FR-14.3                                      | While a record is in flight    |
| —                   | **Never**                           | Scene documents, meshes, textures, materials, edit history, undo stack | —                              |

The last row is the one worth stating plainly, because it is the difference between an authoring tool
and a SaaS. Opening the editor, modelling for two hours, and closing it uploads nothing. The document
lives in the browser and on the Studio's own local IPFS node (§3.6); the meshes are content-addressed
locally, which is what makes §3.6's deduplication work without a server.

Consequences that are enforced in code rather than by convention:

- `Project.storageMode` defaults to `local` (`packages/studio-db`). `cloud` is an **opt-in per
  project**, so a Creator who never asks for sync never uploads a document — and it is their decision
  to make, not a platform-wide setting someone else chooses for them.
- `Scene`, `SceneObject`, `ProjectVersion` and the asset tables are therefore the _optional cloud-sync
  surface_, not a system of record. They sit empty for a `local` project, which is a supported state.
- `PublishRecord.projectVersionId` is nullable for the same reason, and the FR-14.1/§7.3 gate evidence
  (readiness score, report, export validation) is recorded **on the publish record itself**. Without
  that, the publish gate would only work for Creators who had opted into cloud storage — making
  local-first a second-class path through the very check meant to protect quality.
- The Studio stores the **SHA-256 of the bytes it submitted**, not the bytes. The GLB goes to
  VOID·SPACE, which pins it on its own node (§3.5.2); the Studio keeps the fingerprint, which is what
  makes "was the thing I reviewed the thing I published?" answerable.

### 2.2 The Studio database is a control plane

It holds only what has to be shared to make the above work: the identity mirror (§5.1's Tenant/User),
a thin project index, publish lineage, asynchronous jobs, and the Copilot audit trail. It is not a
mirror of the scene.

### 2.3 The auth layer

Grounded in what VOID·SPACE actually exposes today, which turned out to constrain one choice:

**Sign-in (FR-1.1–1.5) — partly implemented, and the gap is named here rather than left in §5.** What
exists: `apps/studio-api` verifies a VOID·SPACE-issued access token presented as `Authorization:
Bearer`, mirrors Tenant/User into its own database on every session (§5.1), and re-derives the
permission set from `roles`. VOID·SPACE remains the only place a credential exists — the Studio stores
no password and no VOID·SPACE session, and mints no token of its own. What does not exist: FR-1.1's
_redirect_. There is no Studio login page and no Studio session cookie; `VOID_SPACE_AUTHORIZE_URL` and
`STUDIO_SESSION_COOKIE_DOMAIN` are declared for that flow and are read by nothing (recorded in §5). A
Creator signs in through VOID·SPACE's own UI and the browser presents that token, which is why the
editor's VOID·SPACE panel can only _report_ a link it reads anonymously (see §4) rather than acting on
a Creator's behalf.

**Verification — shared signing key, with a known cost.** §3.5.1 permits either shared signing-key
verification or a JWKS-style public-key endpoint. VOID·SPACE signs with a **symmetric HS256 secret**
(`JWT_ACCESS_SECRET` via `@fastify/jwt`) and exposes no JWKS endpoint, so only the first option is
available without changing VOID·SPACE. It is what the Studio uses.

That choice has a real cost worth naming rather than glossing: **a shared HS256 secret means the
Studio can mint VOID·SPACE tokens.** Holding both sides in one monorepo and one team makes that
acceptable as an interim; it is not the right end state. The target is an **asymmetric keypair** —
VOID·SPACE signs with the private key, the Studio verifies with the public one — which removes the
forgery capability and gives key rotation somewhere to go. That needs a small VOID·SPACE-side addition
(a public-key/JWKS endpoint), so it is an upgrade path with a prerequisite rather than a config flag.

**Authorization — no second role system, and no trust in the token's permissions.** §3.5.1 requires
the Studio to reuse VS-SRS-2.0 §3.6's role names and semantics exactly. It does, and it goes one step
further, mirroring VOID·SPACE's own plugin rule: a token's `perms` are treated as **advisory**. The
Studio re-derives the permission set from `roles` against the single authoritative `ROLE_PERMISSIONS`
matrix in `@void-space/types`. A stale or over-broad token therefore cannot widen access, and FR-1.3's
"never cache a stale role across a VOID·SPACE-side change" holds even for a token issued before the
change.

**The publish credential.** Publishing uses a **tenant-level Developer API key** (VS-SRS-2.0 FR-12.3),
held server-side and exchanged for a short-lived bearer at `POST /api/v1/auth/token` (`amr: 'apikey'`)
per §3.5.2. It never reaches the browser: a tenant credential in a client would be readable by every
Creator in that tenant, which is a wider blast radius than the asset upload it authorises.

### 2.4 What follows for the AI subsystem

`packages/studio-ai`'s provider clients need `ANTHROPIC_API_KEY` / `MESHY_API_KEY`, which are secrets
and therefore server-side. So Copilot and generative calls are the one case where authoring work leaves
the machine _before_ publish — and only as the prompt and the returned primitive, never the document.
The response comes back as **proposed tool calls**, which the editor applies to its local document
(§7.1: "AI proposes, the command system applies"). The scene itself is never uploaded to a model.

**How that reaches the wire today.** The Copilot is served by `apps/studio-api`, which owns the
credential and the conversation while the editor owns the scene and the commands. So a
`POST /copilot/sessions/:id/messages` runs the tool-use loop and returns the _validated calls_; it
applies nothing. The editor applies them as ordinary undoable Commands and reports the resulting command
ids back through `.../applied`, which is FR-11.4's link from a model decision to the step that reverses
it. Two consequences follow honestly from that split rather than being hidden:

- **A multi-step instruction needs more than one request.** "Add a crate and make **it** metallic"
  cannot resolve "it" server-side, because the crate's id only exists once the editor has run the first
  command. `runCopilot` accepts an `applyCommands` callback for exactly this, and the route deliberately
  does not supply one (§2.2: this service stores no scene). The editor's panel is what closes the loop.
- **No provider is a supported deployment.** §7.5 requires the whole editing toolset to work with every
  AI feature off, and FR-11.10 makes a completed audit a prerequisite for publishing. So a Studio with
  no `ANTHROPIC_API_KEY` answers the Copilot with a 503 that names the variable, and runs the
  pre-publish check on its own measurements — which are what the score is computed from anyway. The
  response says which of those paths it took (`modelSkippedBecause`), so a report with no narrative is
  explained rather than looking like a model call that broke.

## 3. Two further deviations worth naming

**The readiness score is computed locally, not by the model.** §7.3 has Claude return
`{ readiness_score, issues[] }`. `packages/studio-ai` asks the model for the issues and the narrative
and computes the score from the measurements itself, because §7.3 also requires the report to be stored
against the `ProjectVersion` — and a score that varies between two identical runs makes that stored
value uninterpretable. The model contributes judgement; the arithmetic stays auditable.

**The project file format keeps its upstream extension.** `FILE_EXT` (`wproj`) and `FILE_MAGIC`
(`WPRJ`) in `apps/studio-web/scripts/core/const.ts` were deliberately **not** renamed, and the file says
why: those values appear inside every saved project, so changing them orphans existing files. They are
format identity rather than branding, and renaming them needs a format-version bump and a migration —
a bigger change than a rebrand, and not one the SRS asks for. The _storage namespace_ (`APP_KEY_NAME`)
**was** renamed, because the migration for that is already written and now carries `faber-leaf`
profiles forward.

## 4. What exists

| Path                                                | SRS reference                   | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/studio-web/`                                  | §3.7, §9.2                      | **Vendored fork** of FaberLeaf at `6cd52c9`, with its four dependencies pinned as git submodules. Not a workspace member.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/voidspace-client/`                        | §3.5.2, §3.7                    | **Complete.** Typed SDK for VOID·SPACE's `/api/v1`: token exchange, multipart upload with fields-before-file ordering, asset detail, version replacement, library listing, anonymous catalogue browse, status polling — plus the §9.1 mock. 22 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/studio-engine/`                           | §3.3, §3.7, §7                  | **Complete** for the modules it covers: the Copilot tool catalogue (§7.2) and its Claude-ready JSON Schema derivation, the tool-call validator (FR-11.3), the readiness audit scoring (§7.3, FR-11.10), export validation (FR-10.4) and the publish gate (FR-14.1). 39 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `packages/studio-ai/`                               | §7                              | **Complete** for the Copilot and audit: the Claude Messages client, the tool-use loop (§7.2) with one undo group per instruction, the readiness audit (§7.3), the Meshy generative client (§7.4) and the §7.5 controls (per-tenant rate limit, hard timeout, redaction, invocation logging). 34 tests. No provider call in it can skip those controls.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/studio-web/` — identity                       | §1.1                            | **Renamed.** `faber-leaf` → `void-studio` throughout the product-owned tree, including `APP_KEY_NAME` with the migration chain extended to carry profiles forward, the `mountVoidStudio` embedding API, distribution names and package names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/studio-web/` — theme                          | §3.2                            | **VOID·SPACE palette applied** to the shell (`index.html` tokens + self-hosted Plus Jakarta Sans / JetBrains Mono) and to the editor's own UI (`scripts/voidspace/theme.ts`, wired at boot). The properties panel's own surfaces — section headers, checkboxes, drop-downs, buttons, area seams and scrollbars — are themed too, since path.ux paints those from literals and per-class records that a `base`-only theme never reaches; two widget defects a theme record cannot express are patched in `scripts/voidspace/ui_polish.ts` at the same point (`Check.setCSS`'s hardcoded font, `PanelFrame.init`'s `width: 100%` on a bordered content box).                                                                                                                                            |
| `docker-compose.studio.yml`                         | §9.2                            | **Data tier, edge, and studio-api under the `app` profile.** `studio-postgres` (5433), `studio-redis` (6380), `studio-ipfs` (5002/8081), `studio-nginx` (8443), and `studio-api` — profile-gated so the documented `studio:dev:up` still brings up only the data tier and the edge. Verified with `docker compose config` on both the default and the `app` profile.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `docker/studio/nginx.conf`                          | §9.2                            | **Complete** for the edge's job, including the COOP/COEP headers the fork requires. Verified with `nginx -t` **and by starting the container**, which is the check that mattered: a static `upstream` block made nginx hard-fail at config load when the app-tier containers were absent, so `studio:dev:up` produced a crash loop with the edge down — `/healthz` included. Every upstream is now resolved per request through a variable, which is what makes the documented 502 the actual behaviour. A nested `add_header` also silently dropped all three isolation headers from `/healthz` and `/ipfs/` (nginx's inheritance there is all-or-nothing), and both locations now set them explicitly.                                                                                              |
| `packages/studio-db`                                | §5                              | **Schema, RLS and tenant-scoped client.** All 16 of §5.1's entities as Prisma models in VOID·STUDIO's own database (5433), with its own roles (`voidstudio_app`, `voidstudio_platform`), a catalogue-driven RLS audit and a cross-tenant isolation suite. 22 tests. See §2 for what the database is and is not responsible for.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/studio-api`                                   | §6.4, §3.5.1, §3.5.2            | **The control plane behind `/studio/api/v1`.** Federated session verification with the identity mirror (§3.5.1), the project index (FR-2.x), the publish handoff in §3.5.2's exact order — validate the export (FR-10.4), evaluate the gate (FR-14.1), require the tenant credential, upload, record (FR-14.3) — and the bridge surface the editor renders. Three things are deliberate: the route prefix is **not** `/api/v1` (a shared prefix is how two products end up proxying each other's routes), the tenant credential never reaches the browser, and the gateway's mode is explicit configuration rather than an inference from "is a URL set" (§9.1). 60 tests with no database and no VOID·SPACE, plus a 10-case suite that runs against a migrated database when `STUDIO_INTEGRATION=1`. |
| `apps/studio-api` — AI surface                      | §7.1–7.5, FR-11.1–11.5, FR-18.1 | **The Copilot and the pre-publish check, reachable at last.** `POST /copilot/sessions`, the transcript read, `POST .../messages` (which runs the tool-use loop and persists the §5 `CopilotSession`/`CopilotMessage` rows, including §7.5's model and prompt-template version), `POST .../applied` (FR-11.4's link to the undoable commands) and `POST /projects/:id/audit` (§7.3, stored against the `ProjectVersion`). Three refusals happen before any model call, because the cheapest refusal is the one never sent: permission (`asset:upload-own`), the tenant's FR-18.1 flag, and a missing provider. The service never applies a command — §7.1's premise is that the editor's command system does.                                                                                          |
| `docker/studio-api.Dockerfile`                      | §9.2                            | **The app tier's first image.** Under the `app` profile, so `studio:dev:up` still brings up only the data tier and the edge. Its own Dockerfile rather than a reuse of `docker/api.Dockerfile`: the two services share no workspace package, so one image would put VOID·SPACE's dependencies in a VOID·STUDIO process (§3.1). Reaching a _live_ VOID·SPACE from inside the container needs one documented extra step, because the two products are separate Compose projects on separate networks; `VOIDSPACE_CLIENT_MODE=mock` needs none.                                                                                                                                                                                                                                                          |
| `apps/studio-web/scripts/voidspace/bridge_panel.ts` | §3.5.2, FR-14.3, FR-15.2        | **The editor's half of the link, mounted.** A Creator sees where a publish goes and what the destination already holds: the API's mode and origin, the published-asset count and categories, and the newest asset's licence / token / transaction / IPFS trail with a link to follow. It polls at the cadence the API reports (FR-14.3), keeps polling while the API is unreachable so starting it needs no reload, and renders that state rather than throwing — which is what lets the shell mount it unconditionally. Mounted by `scripts/entry_point.js` and not by `mountVoidStudio`, because it is shell chrome: an embedder mounting a second instance must not inherit a floating card it never asked for. It holds no credential and contacts the Studio API only. 7 tests.                  |
| `packages/types`                                    | §3.7 "extended, not forked"     | **Extended** with one value: `SOURCE_TOOLS` now includes `'VOID·STUDIO'`, so a publish records its real provenance rather than `Other` (FR-14.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## 5. What does not exist yet

Listed plainly, because §10.1's phasing makes these deliverables rather than options. Each entry says
what _is_ there, so the gap is measurable rather than vague.

- **`apps/studio-worker`** (§3.1, §7.5). BullMQ consumers for Copilot orchestration, generative jobs,
  CSG offload, export/convert, autosave snapshots and the publish handoff. Not started — and the reason
  the publish path is synchronous today: `POST /projects/:id/publish` does its work inline, which is
  correct at one Creator and wrong at a hundred. It is also why **the generative tools cannot run**:
  `generateMesh` and `generateTexture` are in the Copilot's catalogue and correctly feature-gated
  (FR-18.1), but §7.4's Meshy path needs a queue to be a job on, so `MESHY_API_KEY` is deliberately
  _not_ in `.env.example` — a key read by nothing is the kind of setting that gets mistaken for a
  working feature. `packages/studio-ai`'s `MeshyClient` is written and tested; only its caller is missing.
- **The publish handoff from inside the editor.** The panel in `scripts/voidspace/bridge_panel.ts`
  is a _status_ surface: it reports where a publish would go, and reads the API anonymously. Nothing in
  the fork yet exports a GLB, runs the pre-publish check, or posts to `/projects/:id/publish`, and the
  Copilot chat panel is unwritten. The server side of all four now exists and is covered by an
  integration suite (below), so what remains is editor work — which needs the fork's exporter and the
  sculptcore toolchain to be verifiable at all. This is the largest remaining piece.
- **The editor sending its session.** `apps/studio-api` verifies and mirrors a VOID·SPACE token
  (§3.5.1), and every mutating route requires one — including the whole AI surface. But the editor does
  not attach the token to its own API calls yet, which is why the panel reads only the two anonymous
  routes. FR-1.1's _redirect_ is likewise unimplemented: there is no Studio login page, so a Creator
  signs in through VOID·SPACE and the token has to be carried across.
- **Configuration that is declared but read by nothing.** `VOID_SPACE_AUTHORIZE_URL` and
  `STUDIO_SESSION_COOKIE_DOMAIN` exist in `.env.example` for FR-1.1's redirect and the Studio session
  cookie that flow would mint; `STUDIO_SESSION_TTL` is validated in `apps/studio-api/src/env.ts` and
  then never used. They are named here rather than deleted, because each one is a decision someone has
  to make deliberately (implement the flow, or remove the key), and a silently inert setting is the
  kind of thing that gets mistaken for a working feature. `.env.example` says the same at the keys
  themselves. Everything else in that file is read by code — the AI keys added for §7 included.
- **Containerization of the rest of the app tier** (§9.2). `studio-api` now has an image
  (`docker/studio-api.Dockerfile`, under the `app` profile), and `studio-web.Dockerfile` and
  `studio-worker.Dockerfile` do not exist. `studio-web` is the hard one: the fork needs the sculptcore
  toolchain in the image, so the editor runs natively until that exists.
- **FR-18.1 has no admin console.** The flags are _enforced_ — read per request from
  `Tenant.aiFeatureFlags`, never cached, and refused at the validator as well as the route — but the
  only way to set one today is SQL. FR-18.1 is a TenantAdmin surface, and it arrives with the admin work.
- **The editor's own routes are not exercised from the browser.** The fork's jest suites cover the panel
  and the document-scope gate, and the API's integration suite covers the server, but nothing runs the
  two together: a browser test that boots the editor _with the API up_, asserts the panel renders
  "linked" rather than "offline", and follows a publish through to the transcript. Every layer is tested;
  the seam between them is not.

## 6. Getting it running

VOID·SPACE itself is unchanged:

```sh
pnpm install && pnpm dev:up && pnpm dev
```

The Studio data tier:

```sh
pnpm studio:dev:up          # postgres 5433, redis 6380, ipfs 5002, nginx 8443
curl -k https://localhost:8443/healthz
pnpm studio:dev:down
```

The Studio database — first run, and after any schema change:

```sh
pnpm studio:db:migrate      # apply migrations (schema owner)
pnpm studio:db:rls          # create the runtime roles + apply RLS policies
```

`studio:db:rls` is not optional and not a one-off: the blanket `GRANT` in `rls.sql` covers _all_
tables so a new one is protected by default, which means it must be re-run after every migration that
adds a table. The script exits non-zero if any application table ends up enabled-but-unforced or
without a policy, so skipping it fails loudly rather than silently widening access.

The Studio API — one command, and the only thing it needs running is the data tier above:

```sh
pnpm studio:dev            # apps/studio-api in watch mode on :4100
curl -s http://localhost:4100/studio/api/v1/health
```

`VOIDSPACE_CLIENT_MODE=mock` makes even that unnecessary: the §9.1 simulator covers the whole
publish/review lifecycle, so the API starts, browses and publishes with no VOID·SPACE and no
credential. `studio:dev` currently filters to `studio-api` alone; it grows to include
`studio-worker` when that app exists, which is the same moment turbo's filter list can name it.

The Studio libraries and apps:

```sh
pnpm studio:typecheck && pnpm studio:test
```

That runs with **no database and no network**, which is §9.1's point: everything except the
authenticated routes is exercisable from a clean checkout. The authenticated routes — the identity
mirror, RLS, and the writes that record a Copilot turn or a publish — need the data tier from above, and
are gated so a machine without one does not silently appear to pass:

```sh
STUDIO_INTEGRATION=1 pnpm --filter @void-space/studio-api test
```

The gate is an explicit flag rather than "does the database answer?" on purpose: a suite that degrades
to skipped when a connection fails reads as passing in CI. Its URLs come from this repository's `.env`,
so it tests the configuration the product actually runs with. The AI provider stays scripted even
there — the database is what is under test, and a suite that calls api.anthropic.com costs money and
fails when someone else's deploy is slow.

The containerized alternative to `pnpm studio:dev` (add `--profile app`; the default `studio:dev:up`
above deliberately brings up only the data tier and the edge):

```sh
docker compose -f docker-compose.studio.yml --profile app up -d --build studio-api
```

The editor fork — a separate install, and the one step here that needs a native toolchain:

```sh
pnpm studio:fork:install
pnpm studio:fork:setup      # emsdk + cmake + ninja + wgpu-native
pnpm studio:fork:dev
```

## 7. Constraints worth knowing before building on this

1. **VOID·STUDIO is local-first.** Nothing a Creator does is mirrored into a server database or a
   chain unless they explicitly publish; `Project.storageMode` defaults to `local`. Any feature added
   on top of this must ask what it needs from the server rather than assume the document is there —
   code that reads `Scene`/`ProjectVersion` for a `local` project will find nothing, by design (§2.1).
2. **The fork is WebGPU-only.** There is no WebGL2 fallback, so the browser-support story needs a
   deliberate answer rather than an assumption.
3. **Cross-origin isolation is required** (COOP/COEP). That constrains how the editor can be embedded
   or placed behind a proxy alongside other origins. The headers are set per location in
   `docker/studio/nginx.conf` because nginx's `add_header` inheritance is all-or-nothing — adding a
   location with its own `add_header` silently drops them unless it restates them.
4. **The fork is outside the pnpm workspace**, so `turbo` does not orchestrate it and a root
   `pnpm install` will not install its dependencies. This is intentional — see `pnpm-workspace.yaml`.
5. **`packages/voidspace-client` is the only permitted crossing** into VOID·SPACE (§5.3). Adding a
   second path to VOID·SPACE's data would break the product boundary the SRS is built around.
6. **`packages/studio-engine` must not gain a Next.js or Fastify dependency** (§3.7). The API, the
   workers and the editor all import it; a framework import in this package would couple them.
7. **The fork's jest run needs Node 23.** Under Node 24 it fails to start; the fork is outside the
   workspace, so its `test` script is the only thing that has to be pointed at the right runtime.
   Two harness quirks are already handled in `tests/jest.config.ts` and are worth not undoing: the
   `.js`-ESM module resolver, and a mapping for `scripts/util/vectormath.js` — that barrel is ESM in a
   `.js` file, and jest would otherwise fail any suite that reaches it before a test runs.
8. **The federated JWT is verified with a shared HS256 secret, which is the interim not the target.**
   VOID·SPACE signs symmetrically and exposes no public key, so §3.5.1's second option (a JWKS-style
   endpoint) does not exist yet. The cost is real and worth stating in one line: _a shared secret lets
   VOID·STUDIO mint VOID·SPACE tokens._ Acceptable while both products are one team in one repository;
   the fix is an asymmetric keypair plus a public-key endpoint on the VOID·SPACE side (§2.3).
9. **A token's `perms` claim is advisory and must never be trusted for an authorization decision.**
   VOID·SPACE already enforces this for itself (`plugins/auth.ts`), and the Studio must match: derive
   the permission set from `roles` against the single `ROLE_PERMISSIONS` matrix in `@void-space/types`.
   Reading permissions off the token is easier and is the bug that makes a role change take effect only
   when the token expires (FR-1.3).
