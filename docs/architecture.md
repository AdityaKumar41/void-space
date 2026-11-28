# Current Void Space architecture

## Product surfaces

Learning consists of the personal agent, reusable sources/model library, lesson editor, annotation editor, immutable lesson releases, study/player/presentation and discovery. Individual, institution-only and public audiences are enforced on the server. The asset workspace remains separate: upload, review, licence/ownership records and marketplace.

## Applications

- `apps/web`: Next.js interface; app-local components and a shared Tailwind preset.
- `apps/api`: Fastify authentication, tenant permissions, private/public content delivery, learning and asset APIs.
- `apps/worker`: BullMQ storage/extraction/export/enrichment/notification jobs and Inngest durable learning-agent execution.

## Shared modules

- `packages/ai`: provider-neutral text generation and validated provider configuration.
- `packages/types`: validated learning, annotation, API and job contracts.
- `packages/storage`: S3-compatible object persistence, immutable checksum checks and streaming downloads/uploads.
- `packages/db`: Prisma, tenant transactions/RLS, learning storage and explicit public listing projections.
- `packages/contracts`: asset ownership/licensing registry; files are stored independently.
- `packages/config`: shared Tailwind preset.

## Storage and access

Private learning objects are under `learning/<workspace>/…`; only owner/release-authorized routes may retrieve them. Asset objects are under `assets/<content-address>`. Uploads are staged, streamed into S3 and recorded atomically with an audit event before staging is removed. API content reads require an explicit public catalog entry or current tenant/asset permission. Lesson visual routes authorize the immutable release before streaming its declared visual. These routes never accept arbitrary bucket/key URLs.

Existing content identifiers, stored lesson definitions and original on-chain references are preserved. Compatibility database names do not imply an IPFS runtime dependency. No Kubo node or public private-bucket gateway is required. Private delivery uses `private, no-store` headers, including the historical URL forwarding route and edge configuration.

## Jobs and learning state

Learning job/task records, agent events and checkpoints preserve conversation progress and retry evidence. Retired jobs can be reconciled through a backed-up, audited maintenance command; history is not deleted. Assessment rules remain server-authoritative. Generated drafts and model annotations require review before publication. AI outages preserve manual authoring and existing content.

## Infrastructure

PostgreSQL supplies tenant-isolated state; Redis supplies job queues; S3/MinIO stores bytes; nginx terminates TLS and forwards to API/web. Inngest is used locally for durable agent execution. A configured Fuji registry is optional for asset licensing and must support the current metadata URI format before publishing is enabled. Retired feature tables and their applied migrations are historical records, not active applications.

## Historical systems

Separate courses/classes, spatial classrooms, standalone simulation authoring, field guides, career credentials, ventures and unused vendor adapters are no longer API or worker entry points. Earlier documents are archived and do not define current setup or scope.
