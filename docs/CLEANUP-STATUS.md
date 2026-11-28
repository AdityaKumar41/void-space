# Void Space cleanup and storage migration

Completed locally on 28 November 2026. This describes source changes and the local development installation, not a public deployment.

## Storage cutover

- Copied all 12 unique asset objects referenced by 14 existing asset versions from Kubo to the configured private S3/MinIO bucket. Downloaded and independently checksum-verified every destination object. A second verification-only run found no missing objects.
- Preserved existing content identifiers, saved lesson references and original ownership/provenance records. New uploads use SHA-256 content identifiers and the `asset-store` queue.
- Replaced Kubo upload and licence-metadata persistence with immutable S3 objects. Large uploads stream from staging rather than buffering the whole file.
- Added one authorized asset gateway. Private assets require current workspace/asset permissions; public assets require an explicit public listing. Published lesson visuals authorize the release before streaming its declared model. Private models cannot be substituted through a mixed media/private-model definition.
- Preserved historical `/ipfs/:address` URLs through authorized forwarding. These do not contact IPFS. Previews and thumbnails check access and use private, non-shared caching, including at the edge. Public content remains public when an unrelated session has expired.
- Fixed API/worker staging paths to resolve from one repository root. The worker uses the database's staged path, validates its location and removes it only after storage and database writes succeed.
- Removed IPFS from runtime configuration, health requirements, Compose dependencies and nginx caching. Removed its local container after verifying the S3 cutover.

## Retired application systems

Removed API registrations and obsolete implementations for separate campus courses/programs/classes/assignments, old lesson CRUD/assessment/generation/progress, standalone simulation/experience authoring, spatial rooms/presence, field guides, careers/skill credentials and ventures.

Current lesson plans, reusable annotations, source ingestion, task polling, mentor assistance, interactive activity scoring, institution memberships and permissions remain. The retained digital-twin asset picker has its own small route module.

Removed unused Poly Pizza, Meshy, token-based Sketchfab and Blender-optimization adapters. Current Sketchfab OAuth, model search/preview and private imports remain. Removed EON, Blender and skill-credential workers and dispatch paths. Removed the unused skill-credential contract. Historical queue names remain readable in job history; only current queues are created/consumed.

Removed the old tools DTOs, old lesson/simulator/class schemas and unused job payload contracts. Retained only the media/progress contracts used by current lessons and the actual IoT contracts. Replaced old course/field-guide/credential analytics with aggregate current shared-lesson activity. Private lesson plans and private study are excluded from institution reports.

Obsolete feature tests were retired with their implementations. Current source/runtime, authorization and regression coverage remains, with new real S3 ingestion, access, range, takedown, retry and private-analytics tests.

## Dependency, service and documentation cleanup

- Removed the unreachable web files and unused UI/helper exports recorded in the initial audit.
- Removed the duplicate UI workspace and its Docker, Tailwind and Next references; app-local components remain authoritative.
- Removed unused web dependencies (`next-themes`, `qrcode`, `@types/qrcode`, `react-hook-form`, `zustand`, direct `zod`, `tailwindcss-animate`, `@void-space/ui`), unused configuration/database dependencies and the unused API websocket dependency/types.
- Installed the frozen lockfile offline with the existing pinned pnpm store. Removed dependency links are absent from the installed workspaces. Shared transitive dependencies and package-manager download caches were not mistaken for unused direct packages.
- Removed obsolete QA build caches (approximately 2.12 GiB during the first cleanup).
- Removed retired IPFS/Studio containers, preserving their data volumes as rollback archives. Stopped the duplicate project Inngest process; retained the configured persistent runtime. The optional local chain is no longer started by default and its unused container was removed. Other projects' services were left untouched.
- Updated native-development edge upstreams and container-stack overrides. The local nginx edge, web, API, worker and object store were restarted/verified after migration.
- Archived superseded product plans, architecture exports, old requirements and audits under `docs/archive`. Root README and `docs/architecture.md` describe the current system.

## Database maintenance

Created a private database dump before maintenance and private JSON backups before job reconciliation, under ignored `.audit/backups/` with owner-only permissions.

Reconciled 26 stale/retired queued or active job records, preserving their payloads and history. Each status repair has an audit entry. Redis jobs actively executing would have been skipped; none of the repaired records were active there. Removed the unused AI feature-flags column through a new applied migration and regenerated Prisma. Applied migration history was preserved.

Historical learning tables/records, original content identifiers and on-chain references remain archival data. They are not mounted features, and are not deleted merely because their old UI was retired. Original storage volumes, database backups and agent checkpoints are intentionally retained for recovery.

## Verification

- Full retained API suite: 171 tests passed.
- Full retained worker suite: 98 tests passed, including real S3 ingestion and idempotent retry.
- Database suite: 59 tests passed, including RLS isolation and append-only audit protection.
- Shared contracts/types: 35 tests passed; web unit tests: 30 passed; storage checks: 2 passed.
- Web production build and web/API/worker/database/storage TypeScript checks passed. Changed runtime modules pass ESLint.
- Source import graphs report no unreachable files in web, API or worker.
- BrowserOS neo rendered the existing scanned heart after IPFS shutdown. Private/cross-workspace access, byte ranges and immediate public takedown are separately covered by API tests.
- Local API health reports PostgreSQL and object storage up, with chain licensing explicitly disabled; web and nginx health endpoints return HTTP 200.

## Intentional limits

No public Void Space deployment or new on-chain transaction was performed. A configured Fuji RPC and an updated registry deployment are required before enabling S3-backed chain publishing; existing immutable contracts cannot acquire the new HTTPS metadata behavior through a source edit. Manual/library/lesson workflows do not require that service. Image generation remains disabled as requested; existing AI providers and manual authoring remain.

The existing Inngest/OpenTelemetry peer-range warnings remain upstream dependency compatibility notices. No package versions were upgraded merely to suppress them. No claim is made that every external provider or publicly deployed installation was exercised by this local cleanup.

## Final deployment pass

See [deployment verification](DEPLOYMENT-VERIFICATION.md) for the production image builds, fresh-database startup, browser checks and remaining host-specific configuration. The IPFS image has now been removed. One additional test-created orphan job was reconciled after the final tests; history was retained.
