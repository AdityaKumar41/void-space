# Void Space verification — 18 November 2026

Scope: the existing Void Space application, API, workers, database and contracts. This is a local verification and repair pass. Void Studio hosting and deployment are outside this pass. Existing unrelated worktree changes were preserved; nothing was committed, pushed or deployed.

The existing application is workable. A rebuild from zero is not justified by these results. This is **not complete production certification**: external integrations, physical devices and the dependency findings below still require work.

## Verified behavior and layout

The production frontend builds with Next.js 15.5.29, React 19.3.1 and compatible React Three Fiber/Drei versions. The API uses Fastify 5.12.8 and compatible plugins. The browser regression suite caught the old 3D renderer's React incompatibility during this upgrade; the renderer was updated and all four journeys subsequently passed.

| Check                                   | Result                                          |
| --------------------------------------- | ----------------------------------------------- |
| API integration/unit regressions        | 156 passed, 27 files                            |
| Worker tests                            | 64 passed                                       |
| Database/RLS tests                      | 57 passed                                       |
| Shared type/schema tests                | 34 passed                                       |
| Frontend unit tests                     | 24 passed                                       |
| Solidity contract tests                 | 39 passed                                       |
| Total tests above                       | 374 passed                                      |
| Production browser journeys             | 4 passed                                        |
| Core package type checks                | API, web, worker, database, types and UI passed |
| Scoped ESLint and Git whitespace checks | Passed                                          |
| Database migration status               | All 18 migrations applied; no reset or reseed   |

Browser journeys exercised saved lesson authoring and assessment, actual decoded 3D geometry, target placement and published experiences, consequences/resume/replay, spatial room WebSocket snapshots, and public listing → sign-in return → explicitly labelled demo checkout → entitled model download. Payment API regressions additionally cover signed webhooks, replay/idempotency, unpaid-session rejection, amount mismatch, ownership, concurrent confirmations and transaction rollback.

**All 84 responsive route checks passed:** 28 route/role combinations at each of 390 × 844, 768 × 960 and 1440 × 960. They check page overflow, failed requests, HTTP errors, browser exceptions and missing content. Results and screenshots are generated under `.audit/ui/{mobile,tablet,desktop}/`. These checks cover representative widths and workflows; they are not proof of every possible viewport, content size or input combination.

## Repairs made

- Fixed mobile administration overflow, anchored the hidden role label correctly and made auxiliary tables scroll within their panels. Cards can shrink within narrow layouts. The mobile sign-in heading is visible and semantic.
- Removed anonymous session-probe failures, duplicate refresh attempts and stale session data after sign-in, sign-out and tenant switching.
- Missing thumbnail files now show an explicit, briefly cached “Preview pending” image. Other filesystem failures remain errors.
- Removed the unsupported spatial heartbeat field. WebSocket subscriptions are tenant scoped, permission checked and reauthenticated; dead sockets cannot interrupt other subscribers.
- Replaced trusted browser payment claims with server-side Stripe verification and signed webhook fulfillment. Ownership, order transition, entitlement and seller ledger settlement are atomic and idempotent. Unconfigured production payments are disabled; development checkout is clearly labelled as a demo.
- Fixed skill-credential failure bookkeeping and receipt-derived token IDs. Issuance requires the learner's linked wallet. The contract makes matching retries idempotent and rejects changed or revoked evidence. No contract was deployed.
- Corrected WebAR's WebGL2 context, optional overlay, placement behavior and session resource cleanup. Fixed QR/clipboard error handling.
- Updated the UI audit to fail on actual request/layout errors, added feature routes and responsive modes, and repaired stale browser test selectors while retaining behavioral assertions.
- Updated vulnerable frontend/API framework versions and compatible CSS/URI tooling. Restricted access-token verification to HS256. JSON requests are bounded before schema validation: depth 32, 1,000 entries per collection and 10,000 total nodes, alongside HTTP body limits. Regression tests cover rejection and normal learning payloads. Signed payment events are checked after signature verification and JSON decoding.

## Remaining dependency findings

The final production dependency audit still reports **three unique high-severity advisory records reachable through Void Space's dependency graph**. No critical advisory record remains on a Void Space path. The whole workspace audit also includes unchanged Studio packages and must not be presented as clean.

| Dependency         | Remaining finding and disposition                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zod 3.25.76        | [Oversized collection validation can exhaust memory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). The API now rejects excessive JSON complexity before invoking schemas; signed webhook JSON has the same guard. A complete removal of the library advisory requires migrating the shared schema ecosystem to patched Zod 4.6.6 or newer, including shared AI/ABI consumers. The guard mitigates this API path; it does not make the dependency audit clean. |
| deepmerge-ts 7.1.5 | [Recursive object graphs can exhaust the stack](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), through Prisma's configuration tooling. Ordinary JSON cannot represent the cyclic graph required by the advisory. No user-controlled cyclic graph reaches this config path in the audited workflows. Upgrade through a supported Prisma/config dependency update; no major-version override was forced.                                                         |
| picomatch 2/4      | [Repeated extglob patterns can block the event loop](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), through Tailwind/file discovery tooling. The audited build uses repository-controlled glob patterns. The registry advisory reports no patched release; untrusted patterns must not be passed to these tools.                                                                                                                                               |

These exposure notes are source/code-based assessments, not penetration-test results. Do not describe this pass as vulnerability-free.

## Remaining integration and product work

- Real Stripe delivery, account configuration and money movement were not exercised. Seller ledger entries are not external payouts; refunds and chargebacks need their own implemented lifecycle. Fulfillment follows [Stripe's server-side webhook guidance](https://docs.stripe.com/checkout/fulfillment).
- Google and wallet sign-in require real provider/account verification. Local authentication regressions do not establish provider availability.
- Asset-license and skill-credential contracts need deployment, configured addresses, funded issuer access and reconciliation on the intended chain. Local chain reachability is not successful issuance. The current asset-license integration is disabled without a deployed configured contract.
- Live AI/provider availability was not probed by transmitting content during this pass. Configuration and local fallback behavior do not establish provider uptime.
- WebAR placement needs an actual supported mobile device and headset QA where applicable. Desktop browser tests cannot establish tracking, permissions or device interaction quality.
- Spatial WebSocket fan-out is process local. Multi-instance delivery, facilitator controls and deliberate shared object manipulation require further implementation.
- Physical simulation, document-to-curriculum ingestion and full headset interactions remain separate product scope. UI routes alone do not establish those capabilities.

## Repeating the local checks

Use supported Node 24 and the existing running local infrastructure. Restart the local development server after installing these dependency upgrades; a process already running Next 14 will not turn into Next 15 through hot reload. Run API integration fixtures serially (`vitest run --no-file-parallelism`); do not run role-mutating fixtures concurrently with the UI audit. Build with `NEXT_BUILD_DIR=.next-verify` so verification does not overwrite the live development server's output. Start that build on a separate port, then run the existing Playwright suite and `scripts/audit-ui.mjs` with `--mobile`, `--tablet` and desktop defaults against that origin.

Missing published catalogue data is not repaired by inventing permanent listings. The marketplace browser test creates and removes its own isolated projection using a real pinned model.
