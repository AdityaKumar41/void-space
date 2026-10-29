# VOID·SPACE platform — resume and remaining work

Last updated: 2026-10-29 (Asia/Kolkata)

## Current repair status — read this first

Read [the 29 October repair audit](./PLATFORM-REPAIR-AUDIT-2026-10-29.md).
The older “completed slices” inventory below describes persistence and API seams,
not completed EON-style user experiences. The latest repair adds reviewed lesson
authoring, saved-version 3D delivery, local transcript guidance, usable learning
rooms, presence/leave/session-end behavior and campus progress/recognition of
prior passing evidence. PDF/DOCX ingestion and bulk curriculum generation, physics simulations,
WebAR, full realtime collaboration and on-chain skill issuance remain incomplete.
The user subsequently authorized the CUTM AI host and OpenRouter fallback. See [AI provider setup](./AI-PROVIDERS.md): the mentor and source-text lesson generation now use the shared adapter, with local fallback. Requested Qwen is unavailable remotely; same-host Mistral was live-verified.
The original dirty worktree is preserved. The subsequent interactive spatial runtime requires additive migration `20261029090000_interactive_experiences` and RLS application. See [spatial experiences](./SPATIAL-EXPERIENCES.md) for the implemented scene workflow, demo and remaining limits.

This is the handoff file for the next human or agent session. It is deliberately
specific about what is implemented, what has been verified locally, and what
cannot be truthfully called operational without external configuration.

## Resume from here

1. Read [EON-CONVERGENCE-IMPLEMENTATION.md](./EON-CONVERGENCE-IMPLEMENTATION.md)
   and this file before changing scope.
2. Inspect the dirty worktree with `git status --short`; these platform changes
   have not been committed and must be preserved.
3. Start local infrastructure with `pnpm dev:up`. Preserve existing data; do not reset or reseed. Apply migrations/RLS as below. Use `pnpm experience:demo` to add the spatial example.
4. Run `pnpm --filter @void-space/api test`, `pnpm --filter @void-space/types test`,
   and `pnpm typecheck` before and after changes.
5. Apply new migrations with `pnpm db:migrate` followed by `pnpm db:rls`.

Suggested skills for a future agent: `implement` for vertical slices, `tdd` for
new routes/workers, `pdf` when revisiting the comparison source, `handoff` when
passing work again, and `review` before merging.

## Completed native platform slices

These slices have persistence, tenant isolation, API routes, audit events,
console delivery where applicable, and focused live-stack coverage:

- DAM asset ingestion, review, provenance, IPFS/chain licensing, public
  marketplace and developer APIs (pre-existing foundation).
- Genesis Trainer-style approved-asset lessons, learner assessment, mentor
  interaction and portable verification credentials.
- Virtual Campus course assembly, enrollment and evidence-derived completion.
- Shared spatial rooms, durable world state and heartbeat-backed participant
  presence.
- IoT device registration, one-time secret hashing, immutable signed telemetry,
  digital twins and operator telemetry history.
- Genesis Simulator scenarios, weighted server-derived scoring and immutable
  assessment attempts.
- Field IQ guidance packets, mobile/AR-capable step contracts and complete-step
  field-run evidence.
- Career Compass profile and role paths derived from verified learning,
  simulator and field evidence only.
- Venture Builder creator-owned tenant plan workspaces.

Relevant new migrations are ordered from
`20261021090000_learning_platform` through
`20261021150000_venture_builder` in `packages/db/prisma/migrations/`.

## Verification already performed

- Prisma client generation completed after the current schema changes.
- The local PostgreSQL stack applied all migrations through Venture Builder.
- `pnpm db:rls` reported 34 protected tenant tables after the final migration.
- Latest rerun: `pnpm db:migrate` found 12 migrations and no pending changes;
  `pnpm db:rls` succeeded, with RLS enabled on 34 of 39 inspected tables.
- Shared types, API and web typechecks have passed after the added slices.
- Focused integration tests passed for simulator, Field IQ, Career Compass,
  Venture Builder and IoT telemetry history.
- Final API regression run: `pnpm --filter @void-space/api test` passed all 16
  files and 108 tests against the local stack, including Career, Field IQ, IoT,
  simulator and Venture Builder integration tests.
- Final shared contract run: `pnpm --filter @void-space/types test` passed all
  34 tests.
- Final monorepo `pnpm typecheck` passed all 22 workspace tasks.
- `git diff --check` passed with no whitespace errors.
- Startup regression check: `pnpm --filter @void-space/api test` passed all 17
  files and 110 tests; the web API client regression suite passed 2 tests.
- Local smoke check: API and web-proxied health endpoints, VOID·STUDIO API
  health, both web roots, and the HTTPS VOID·SPACE edge returned HTTP 200.

## Startup incident fixed (2026-10-21)

The native `pnpm dev` path previously failed when `.env` had no Fuji RPC: the
API rejected its environment, the worker exited, and nginx used container-only
`api`/`web` upstream names while only host-native services were running. This
led to refused port 4000 connections and a browser JSON parse error on nginx's
plain-text error response. Local development now defaults to Anvil, leaves
Fuji-only licensing jobs pending without consuming them when the Fuji contract
is not configured, formats non-JSON HTTP failures as readable API errors,
checks configured host ports, and reconciles both edge proxies for native services.

## Remaining work and external blockers

The comparison document’s remaining product capabilities must not be marked
complete until these conditions are met:

| Area                               | Remaining implementation / verification                                                  | Blocking dependency                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Native mobile and headset clients  | Signed iOS, Android and headset applications; offline sync and device QA                 | Apple, Google and headset developer accounts, signing certificates and target hardware |
| Avatar/voice mentoring (Brainy)    | Provider adapter, moderation, consent, retention rules, avatar UI and failure mode tests | Selected voice/avatar provider credentials and commercial/privacy approval             |
| Enterprise SSO and proctoring      | SAML/OIDC tenant configuration, proctor evidence capture and policy controls             | Customer identity-provider metadata and proctoring provider/service decision           |
| Realtime multiplayer               | WebSocket/WebRTC fan-out, room moderation and scale/load testing                         | Hosted realtime service or production Redis/pubsub topology and deployment target      |
| Payments, royalties and settlement | Checkout, order/entitlement ledger, royalty payout adapter and reconciliation tests      | Payment processor account, payout/KYC approval and chain deployment policy             |
| On-chain credentials               | Credential contract, mint worker and explorer/reconciliation verification                | Funded signer, chain RPC and deployment approval                                       |
| AI Fluency catalog                 | Curated curriculum content, learning objectives and release/assessment review            | Product/content-owner approval of curriculum and source material                       |
| Marketplace commercial release     | Production chain/IPFS/payment configuration and legal terms                              | Production keys, legal/financial approval and deployment environment                   |

## Guardrails for the next agent

- Do not overwrite or delete the untracked source PDF:
  `docs/VOID-SPACE_Platform_Convergence_Document.pdf`.
- Do not claim provider-backed functionality is operational while only a local
  persistence seam exists.
- Keep all tenant-owned models in `packages/db/prisma/sql/rls.sql`, add an
  audit action, and test authorization/tenant isolation for every new vertical
  slice.
- Preserve server-derived scoring/completion; clients may submit evidence, not
  authority-bearing scores or completion flags.
