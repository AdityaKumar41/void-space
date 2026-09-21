# VOID·SPACE

**AI-enhanced, multi-tenant 3D Digital Asset Management & XR publishing platform** — with
decentralized storage (IPFS) and on-chain licensing (ERC-721 on a local Anvil chain).

Implementation of **VS-SRS-2.0** (`docs/VOID-SPACE_SRS_v2.0_Production.docx`). The whole system —
web app, API, workers, database, cache, IPFS node and blockchain — runs locally from a single
`docker compose` stack with **no cloud dependency, no faucet and no paid RPC provider**.

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript | Server components call the API; the browser only ever reaches nginx |
| 3D | Three.js via React Three Fiber + drei | glTF/GLB thumbnails and full viewer |
| UI | Tailwind CSS + shadcn/ui conventions (Radix), `@void-space/ui` | Shared component library with a shared Tailwind preset |
| Client data | TanStack Query (server cache) + Zustand (local UI state) | |
| API | Fastify 4 + TypeScript, JSON-Schema-first, OpenAPI 3.1 | Single source of truth for authz, tenancy and business rules |
| Data | PostgreSQL 16 + Prisma 6 | Shared schema multi-tenancy with **native Row-Level Security** |
| Queue | Redis 7 + BullMQ | `ai-enrichment`, `ipfs-pin`, `blender-optimize`, `chain-license`, `xr-publish`, `notify` |
| Storage | IPFS (Kubo), cached by nginx | Content-addressed CIDs recorded per asset version |
| Chain | Anvil (Foundry) + Solidity ^0.8.24 | `AssetLicenseRegistry.sol` (ERC-721 licence per asset) |
| Edge | nginx (TLS, rate limiting, IPFS gateway cache) | Only service exposed to the host |
| Monorepo | pnpm workspaces + Turborepo | Shared types prevent FE/BE contract drift |

## Repository layout

```
void-space/
├─ apps/
│  ├─ web/        Next.js UI (Creator / Assessor / Admin)
│  ├─ api/        Fastify REST API  →  /api/v1
│  └─ worker/     BullMQ processors (AI, IPFS, Blender, chain, XR, notify)
├─ packages/
│  ├─ db/         Prisma schema, migrations, RLS policies, seed, tenant context
│  ├─ contracts/  Foundry: AssetLicenseRegistry.sol + tests + deploy scripts
│  ├─ types/      Shared DTOs, Zod schemas, RBAC matrix, queue contracts, generated ABI
│  ├─ ui/         Shared shadcn/ui-based components
│  └─ config/     Shared Tailwind preset and ESLint baseline
├─ docker/        Dockerfiles, nginx templates, IPFS entrypoint, cert script
├─ docs/          SRS + generated data-model / design notes
├─ scripts/       dev-up.sh, dev-down.sh
└─ docker-compose.yml
```

**Package strategy:** internal packages (`types`, `ui`, `db`) export TypeScript **source** and are
consumed directly (`transpilePackages` in Next, `tsx` in the API/worker). This removes a build step
from the inner dev loop while keeping one source of truth for every shared contract. `db` runs
`prisma generate` as its build step; `contracts` is built by Foundry.

## Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- Node.js 20 LTS (`.nvmrc` pins it; Node 20–24 works locally) and pnpm 9 (`corepack enable`)
- *Optional:* a native Foundry install (`forge`, `anvil`, `cast`) — `pnpm dev:up` prefers it and
  falls back to the containerized toolchain

## Quick start

```bash
pnpm install          # install workspace dependencies
pnpm dev:up           # start postgres, redis, ipfs, anvil, nginx + migrate + RLS + deploy contract
pnpm db:seed          # demo tenants, users, assets in every lifecycle state
pnpm dev              # api + worker + web in watch mode
```

Then open **https://localhost** (self-signed dev certificate — `pnpm certs` regenerates it; if you
have `mkcert`, the certificate is trusted automatically).

Demo credentials (created by `pnpm db:seed`, password `VoidSpace!2026`):

| Email | Role | Tenant |
|---|---|---|
| `admin@aurora.dev` | TenantAdmin | Aurora Industrial Training |
| `creator@aurora.dev` | Creator | Aurora |
| `assessor@aurora.dev` | Assessor | Aurora |
| `developer@aurora.dev` | Developer | Aurora |
| `viewer@aurora.dev` | Viewer | Aurora |
| `admin@northwind.dev` | TenantAdmin | Northwind Safety XR |
| `priya@void-space.dev` | Creator in Aurora, Assessor in Northwind | both |
| `superadmin@void-space.dev` | SuperAdmin | platform |

## Services and ports

| Service | Container | Host port | Notes |
|---|---|---|---|
| nginx (edge) | `void-space-nginx-1` | 80, 443 | TLS termination, rate limit, IPFS gateway cache |
| web | run natively by `pnpm dev` | 3000 | Reachable as `http://localhost:3000` |
| api | run natively by `pnpm dev` | 4000 | `GET /api/v1/health` |
| worker | run natively by `pnpm dev` | — | BullMQ processors |
| postgres | `…-postgres-1` | 5432 | dev only |
| redis | `…-redis-1` | 6379 | dev only |
| ipfs (Kubo) | `…-ipfs-1` | 5001 (API), 8080 (gateway) | dev only; browsers use nginx `/ipfs/<cid>` |
| anvil | `…-anvil-1` | 8545 | local EVM chain |

Everything is on a private Docker network; only nginx is exposed by default (§2.5).

Containerized alternative to `pnpm dev`:

```bash
docker compose --profile app up -d          # api + worker + web in containers
docker compose --profile blender up -d      # headless Blender runner (heavy image, on demand)
```

## Common tasks

| Command | What it does |
|---|---|
| `pnpm dev:up` | Start infra + edge, apply migrations and RLS, deploy the licence contract |
| `pnpm dev` | api + worker + web in watch mode (Turborepo) |
| `pnpm dev:down` | Stop containers, keep data volumes (`--volumes` for a clean slate) |
| `pnpm db:migrate` | Apply pending Prisma migrations (as the schema-owner role) |
| `pnpm db:rls` | Re-apply RLS policies + grants (idempotent; run after every migration) |
| `pnpm db:seed` | Seed demo tenants/users/assets and print an API key once |
| `pnpm db:reset` | Drop and recreate the schema (`--volumes` not required) |
| `pnpm db:studio` | Prisma Studio against the local database |
| `pnpm contracts:test` | Foundry test suite for `AssetLicenseRegistry.sol` |
| `pnpm contracts:abi` | Regenerate `packages/types/src/contracts/abi.generated.ts` from the compiled ABI |
| `pnpm contracts:deploy` | Deploy (or redeploy) the contract to Anvil and publish its address |
| `pnpm typecheck` | `tsc --noEmit` across every workspace package |
| `pnpm test` | Vitest suites (data layer today; more layers as they land) |
| `pnpm lint` / `pnpm format` | ESLint 9 flat config / Prettier |

## Security model

Tenant isolation is enforced **twice** (defence in depth, §3.5, NFR-SEC.5):

1. **Application layer** — a Fastify `preHandler` checks the caller's permission for the route
   against the §3.6 role matrix, and every repository call happens inside `withTenant(...)`.
2. **Database layer** — PostgreSQL Row-Level Security policies on all 16 tenant-scoped tables
   compare `tenant_id` with the transaction-local `app.current_tenant_id` setting. `FORCE ROW
   LEVEL SECURITY` means even the table owner is subject to the policy.

Three database roles keep the blast radius small:

| Role | Used by | Privileges |
|---|---|---|
| `<POSTGRES_USER>` (owner) | migrations, RLS apply, `db:reset` | DDL only |
| `void_app` | api + worker runtime | Full CRUD on tenant-scoped tables, **subject to RLS**; no `UPDATE`/`DELETE` on `audit_logs` (append-only, FR-13.3) |
| `void_platform` | identity resolution at login, workspace switching, SuperAdmin tenant admin | Privileges only on `tenants`, `roles`, `users`, `user_roles`, `wallets`, `invites` — **none** on asset, review, licence, job, notification or audit data |

Additional guarantees worth knowing:

- `withTenant()` uses `set_config('app.current_tenant_id', …, is_local => true)` inside an
  interactive transaction, so the tenant never leaks to another request that borrows the same
  pooled connection.
- A tenant-scoped query issued **outside** `withTenant()` fails loudly (the policy cannot resolve
  the session variable) instead of silently returning cross-tenant rows.
- API startup calls `assertRlsEnforced()` and refuses to boot if the runtime connection is a
  superuser or has `BYPASSRLS` — a mis-set `DATABASE_URL` cannot silently disable isolation.
- Passwords are bcrypt (cost 12, NFR-SEC.1); API keys are salted scrypt hashes shown once
  (NFR-SEC.7); JWT access tokens are ≤15 min and delivered as httpOnly cookies (FR-2.3).

## Testing

```bash
pnpm --filter @void-space/contracts test    # 35 Foundry tests: minting, role gate, revocation, ERC-721
pnpm --filter @void-space/db test           # 22 Vitest tests against dockerized Postgres
```

The data-layer suite is the security regression net: cross-tenant read/update/delete attempts,
`WITH CHECK` rejection of smuggled tenant ids, fail-closed behaviour without a tenant context,
context leakage across pooled connections, an automated RLS schema audit, the platform role's
privilege envelope, and database-level append-only enforcement of the audit log.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `DATABASE_URL is not set` | `cp .env.example .env` (or run `pnpm dev:up`, which does it) |
| `refusing to start: role … bypassRls=true` | `DATABASE_URL` points at the owner role; use the `void_app` URL from `.env.example` |
| `relation "…" does not exist` | `pnpm db:migrate` then `pnpm db:rls` |
| `permission denied for table …` | RLS grants are stale — re-run `pnpm db:rls` |
| `invalid input syntax for type uuid: ""` | A tenant-scoped query ran outside `withTenant(...)`; that is the RLS net working |
| `nginx` container restarting in a loop | The dev certificate is missing — run `pnpm certs` (or `pnpm dev:up`, which generates it first) |
| `x-cache-status: MISS` on every `/ipfs/<cid>` read | Kubo is redirecting to subdomain-style gateway URLs; the committed `docker/scripts/ipfs-entrypoint.sh` disables that (`UseSubdomains: false`) — recreate the ipfs container |
| Compose says `no such service: …` for a profiled service | Pass the profiles: `docker compose --profile infra --profile edge …` |
| `CONTRACT_ADDRESS` empty | `pnpm dev:up`, or `pnpm contracts:deploy` + restart api/worker |
| Port 443/5432 in use | Stop the conflicting service or change the port in `.env` |
| Anvil state lost after restart | Expected — the chain is ephemeral by default (§3.9.1); enable the commented volume in `docker-compose.yml` |

## Implementation status

| Phase | Scope | State |
|---|---|---|
| 0 | Monorepo, Docker stack, nginx edge, dev scripts, app skeletons | ✅ |
| 1 | `AssetLicenseRegistry.sol`, deploy flow, generated ABI | ✅ |
| 2 | Prisma schema, RLS policies, tenant context, seed, isolation tests | ✅ |
| 3 | API core: auth (password/SSO/SIWE), RBAC, tenancy, audit | ⏳ next |
| 4 | Assets, versions, streamed uploads, job infrastructure | ⏳ |
| 5 | Workers for all six queues | ⏳ |
| 6–14 | IPFS lifecycle, review workflow, licensing/publishing, full UI, integrations, developer API, admin consoles, E2E | ⏳ |

See `docs/VS-SDD-2.0-data-model.md` for the entity model, the gap-fills this implementation had to
add (and why), and the deviations from the SRS text.

