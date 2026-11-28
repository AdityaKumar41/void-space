# Void Space

Void Space combines an AI-assisted learning workspace with a separate asset workspace.

- **Learning:** ask the lesson agent, attach sources or models, build and edit lesson plans, annotate models, review drafts, publish to a chosen audience, study and present.
- **Library:** private models and reusable annotations, including attributed Sketchfab imports.
- **Asset workspace:** upload, review, manage ownership/licences and list approved assets in the marketplace.
- **Administration:** individual and institution onboarding, institution membership/roles, and a separate central administration console.

## Local setup

Use Node 20–24, Docker and the pnpm version pinned in `package.json`.

```sh
corepack pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev:up
```

Configure private S3-compatible storage before uploading or seeding. For local MinIO:

```sh
pnpm --filter @void-space/db exec tsx ../../scripts/configure-local-storage.mts
docker compose -f docker-compose.storage.yml up -d
pnpm --filter @void-space/db exec tsx ../../scripts/setup-private-storage.mts
pnpm db:seed
pnpm dev
```

`configure-local-storage.mts` creates ignored local credentials and refuses to overwrite an existing S3 configuration. Existing installations should keep their current settings. For containerized API/worker access to local MinIO, set `S3_CONTAINER_ENDPOINT=http://host.docker.internal:9000`. AWS deployments can leave the endpoint unset.

Web: `http://localhost:3000`. API: `http://localhost:4000/api/v1`. The edge serves `https://localhost` when its development certificate is installed.

The development launcher starts/reuses the configured learning runtime and local object storage. AI provider configuration is optional for manual authoring; see [AI providers](docs/AI-PROVIDERS.md). Image generation remains disabled until its provider is available.

## Storage

Asset and private learning bytes use S3-compatible storage. Object keys and credentials stay server-side. Private learning sources have owner-scoped delivery; asset content checks workspace permissions or an explicit public listing before streaming. Byte ranges are supported. Private responses are not cached publicly.

Historical `ipfsCid`, `ipfsMetadataCid`, `pinStatus` and `ipfs_pin` database names remain compatibility fields for stored records. They no longer select an IPFS backend. New asset identifiers are SHA-256 digests; existing identifiers are preserved. New work uses the `asset-store` queue. Historical `/ipfs/:address` URLs forward to the authorized object gateway.

To migrate another installation, keep its old gateway available until verification succeeds:

```sh
pnpm storage:migrate-assets -- --apply
pnpm storage:migrate-assets
```

The migrator defaults to verification only. It copies and verifies bytes without deleting originals. Set `LEGACY_ASSET_GATEWAY_URL` for a non-default legacy gateway. Keep the database backup and original volume until retention/rollback requirements are satisfied.

## Background work

Active queues: learning, asset storage, AI metadata enrichment, chain licensing and notifications. Inngest supplies durable agent execution; BullMQ supplies extraction, file/export and asset jobs. They are distinct responsibilities.

Legacy standalone classes/programs/simulations, spatial rooms, field guides, careers/credential minting, ventures, EON publishing, Blender optimization, Poly Pizza, Meshy and the older Sketchfab token adapter have been retired. Existing historical database records are preserved; those APIs and workers are not mounted. Current lessons, interactive activity scoring, institution access and Sketchfab OAuth remain.

## Ownership contracts

Asset ownership contracts remain separate from file storage. The registry source supports HTTPS metadata URLs while preserving historical CID behavior. Previously deployed registries are immutable: deploy the updated contract before enabling S3-backed on-chain publishing on another installation. No Fuji RPC is currently configured locally, so real chain publishing remains unavailable until configured; storage cleanup does not pretend to mint a licence.

## Maintenance and verification

```sh
pnpm maintenance:jobs                  # dry-run
pnpm maintenance:jobs -- --apply        # backup + audit + repair; preserves history
pnpm --filter @void-space/api test
pnpm --filter @void-space/worker test
pnpm --filter @void-space/web test
pnpm --filter @void-space/web build
```

Maintenance scripts operate from the repository root internally. Keep source documents, database records, object-store volumes and agent checkpoints out of generic cache cleanup.

See [current architecture](docs/architecture.md), [cleanup status](docs/CLEANUP-STATUS.md), [annotation workspace](docs/ANNOTATION-WORKSPACE.md) and [Sketchfab setup](docs/SKETCHFAB-OAUTH-REGISTRATION.md). Earlier plans and audits are under [the historical archive](docs/archive/README.md).

## Public deployment

Use the [deployment guide](docs/DEPLOYMENT.md) and `docker-compose.production.yml` for production. Prepare the ignored `.env.production`, then run `pnpm deploy:check`. The development Compose file is for local work. The production startup applies migrations and RLS before the API starts, without creating demo accounts.
