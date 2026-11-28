# Deployment verification — 28 November 2026

## Outcome

Production images build and the core journeys passed against an isolated empty database. The real local app remains healthy. Public launch is not yet configured: there is no `.env.production`, public origin/host or registered production OAuth callback in the current installation. The current local Inngest development runtime must not be presented as production infrastructure.

## Issues fixed during final verification

- Added `.dockerignore` for root and nested secrets, uploads, staging directories, backups, checkpoints, Git history and generated development output. Inspected the built API image to confirm these files are absent.
- Updated container images to Node 24 with pinned pnpm 9.15.9. Fixed API upload-directory ownership and reduced unnecessary whole-dependency-tree ownership changes.
- Fixed Next's build-time API rewrite target for container deployments; verified client API forwarding and server-side authenticated pages through the actual production web image.
- Added `docker-compose.production.yml`, an ignored-env template and `pnpm deploy:check`. The production startup runs migrations and RLS before starting API/worker. Only the web loopback port is exposed, for a hosting-provider HTTPS reverse proxy.
- Forwarded OAuth, cookies, CORS, storage, AI and learning-engine settings to the containerized app. Production rejects placeholder/short JWT secrets, insecure cookies, missing S3 and a localhost public origin.
- Added an additive migration installing missing role definitions without demo users/assets. Replaced the local PostgreSQL shell bootstrap with portable SQL role identities that remain NOLOGIN until configured by RLS setup.
- Updated RLS provisioning to preserve passwords from configured runtime database URLs and reject conflicting password settings instead of silently resetting them to defaults.
- Removed the obsolete IPFS Docker image. Preserved rollback data volumes and backups.

## Evidence

| Check                                                            | Result                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| API, worker and web Docker builds                                | Passed                                                              |
| Isolated empty PostgreSQL: all 29 migrations                     | Passed, without demo seed                                           |
| RLS/grants and repeat startup                                    | Passed; 57 tables with RLS enabled                                  |
| Production API and worker startup                                | Passed as non-root users                                            |
| Production web HTTP, API rewrite and authenticated server page   | HTTP 200                                                            |
| Fresh learner signup and session                                 | Passed                                                              |
| Private model S3 upload and byte-identical download              | Passed                                                              |
| Anonymous private-model access                                   | Denied                                                              |
| Manual lesson example, reviewed publication and public discovery | Passed                                                              |
| Source text ingestion                                            | Passed                                                              |
| Production worker PDF and PPTX exports/downloads                 | Completed; file signatures verified                                 |
| BrowserOS neo production login, library and model rendering      | Passed                                                              |
| Browser annotation editor                                        | Opened; camera/shading changes worked                               |
| Browser lesson component exploration and save/resume             | Passed; current section and completion survived reload              |
| Live configured text AI                                          | Synthetic readiness request passed through free OpenRouter          |
| Production configuration tests plus auth/institution regression  | 26 tests passed                                                     |
| Storage authorization and initial production guard tests         | 9 tests passed                                                      |
| Type checks, changed-module lint, frozen lockfile                | Passed                                                              |
| Source reachability                                              | No unreachable web/API/worker source files                          |
| Existing asset migration verification                            | All 12 unique objects covering 14 version references verified in S3 |
| Real local web/API/edge after verification                       | HTTP 200; database and storage up                                   |

The prior retained full API/worker/database/web suites are recorded in `CLEANUP-STATUS.md`; targeted checks were repeated for the deployment changes. The final test-created orphan job was reconciled with backup/audit, preserving its history.

Temporary smoke-test database, Redis, API, worker, web, staging volume, test credentials and four synthetic S3 files were removed. Existing development users, services and objects were left intact. No public deployment, image push or chain transaction occurred.

## Still required on the deployment host

- A chosen host and real HTTPS domain, persistent PostgreSQL/Redis/S3, TLS and backups.
- A private production env file/secrets configuration. Current `.env` is intentionally development configuration and does not pass public-deployment preflight.
- Matching production Google/Sketchfab OAuth callbacks, if those integrations are enabled. Localhost callbacks were not changed in the existing registration.
- Either the tested BullMQ path or a configured production Inngest service with signing/event credentials. The production template defaults to BullMQ.
- A smoke test on the actual deployed domain after these settings are supplied.

Image generation remains disabled as requested. On-chain publishing needs a configured RPC and deployment of the updated registry; it is optional to ordinary learning/library use. Provider availability and every external OAuth account were not certified by synthetic local smoke tests.
