# Platform foundations — implementation status

## Implemented locally

- Explicit global PlatformAdmin / PlatformModerator grants, independent of workspace membership. Central administration requires an authenticator or single-use recovery code; sessions expire after 15 minutes and recheck account and grant status. Normal sign-out revokes the presented central session.
- Metadata-only central overview, account access management, account and workspace suspension, and append-only global audit events. The final global administrator cannot be removed. No private lesson or document viewer is exposed in this console.
- The existing account `adityamoharana80@gmail.com` received the first explicit PlatformAdmin grant. Its owner must enroll their own authenticator at `/console/platform`.
- Searchable, cursor-paginated model selection across private models and approved workspace assets, with authorized selected-item lookup. Listings do not download model geometry.
- Private learning models, source documents, captures, generated images and newly created exports use configured S3-compatible storage. Local MinIO runs on loopback with a persistent Docker volume. Legacy filesystem reads remain supported.
- Eleven existing LearningSource files were copied, read back, checksum verified and repointed to local S3. Original files were retained for recovery. Completed historical exports were not migrated.
- Sketchfab read-only OAuth was verified live. A downloadable CC Attribution model was imported into the private library and opened natively. Author, license, original model reference and AI-use permission are retained. No public listing was created.

## Local operation

Use Node 24 and the repository's pnpm version. Secrets belong only in ignored environment files.

```sh
# Only on a fresh local setup; refuses to replace an existing storage configuration.
pnpm --filter @void-space/api exec tsx ../../scripts/configure-local-storage.mts
docker compose -f docker-compose.storage.yml up -d --build
pnpm --filter @void-space/api exec tsx ../../scripts/setup-private-storage.mts

# Defaults to a read-only migration report. Apply retains originals.
pnpm --filter @void-space/api exec tsx ../../scripts/migrate-learning-storage.mts
pnpm --filter @void-space/api exec tsx ../../scripts/migrate-learning-storage.mts --apply
```

Restart API and worker after changing their environment configuration. Stopping and restarting the MinIO container preserves its data volume; do not remove the volume to perform a restart.

## Still required by the wider agreed plan

- Canonical user/institution asset ownership for new uploads; existing private files must not transfer ownership implicitly.
- Professional asset ingestion and delivery through private S3, replacing the remaining IPFS-dependent pipeline.
- Institution review followed by platform approval for new marketplace publications; preserve existing legacy publications.
- Approval-bound on-chain identity and managed institution wallets using local Anvil first.
- Explicit audited support grants for private content access, quotas and moderation workflows.
- Server-persisted Sketchfab credentials with refresh and revocation handling. Current tokens remain encrypted in HttpOnly session cookies and require reconnection after expiry.
- Annotation camera views, captions, rehearsal and a separate presenter notes window.
- Full 50-active-learner workload verification. Current concurrency evidence covers 50 simultaneous model listing requests, not complete learning sessions.

This is a verified local foundation, not completion or certification of the broader enterprise release. No Void Space public deployment was performed.
