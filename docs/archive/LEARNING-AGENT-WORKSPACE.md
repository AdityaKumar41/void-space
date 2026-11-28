# Void Space learning workspace

## Local development

Use Node 24 and the existing database/Redis setup. Apply the additive migration with `pnpm db:migrate` and regenerate Prisma with `pnpm db:generate` after pulling these changes.

Set these values in the ignored repository-root `.env`:

```dotenv
LEARNING_AGENT_ENGINE=inngest
INNGEST_DEV=1
INNGEST_BASE_URL=http://127.0.0.1:8288
LEARNING_HARNESS_PORT=4030
```

Run `pnpm learning:dev` in one terminal and the normal `pnpm dev` in another. The Inngest dashboard is local at `http://127.0.0.1:8288`; its worker endpoint is `http://127.0.0.1:4030/api/inngest`. Development checkpoints persist in the ignored `.inngest` directory. No hosted Inngest account is required. Existing BullMQ learning tasks drain through their original processor.

`LEARNING_AGENT_ENGINE=bullmq` retains the queue execution path, including the bounded AgentKit workflow, without durable Inngest checkpoints. New agent runs record their engine when created. Disabling the Inngest worker does not silently reroute an existing durable run to another engine.

The development server is for local development. A production rollout requires signing/event keys, a persistent authenticated Inngest deployment and operational review; this change does not publicly deploy Void Space.

## Agent behavior

AgentKit routes source preparation, coordination, permitted learning tools and deterministic output review. Specialists delegate generation to the existing provider adapter so its configured fallback, validation, free-model policy and credentials stay centralized. There are at most two requested authoring actions per turn and six specialist invocations, four durable runs globally, and one per owner. Inngest retries are bounded and runs have a ten-minute deadline.

The queue record acts as the dispatch record: database creation of the task and queue mirror is transactional; delivery uses the task ID as the Inngest event ID. Queue retries can safely redeliver the same event. Coordinator and authoring outputs have durable checkpoints. The final transaction checks cancellation and task completion before saving a lesson or appending an assistant result. Existing published releases are never edited by an agent.

The UI displays saved execution stages, actual successful provider usage and result links. `/learning/agent/runs/:id/events` supports ordered JSON replay and authenticated SSE, with polling recovery. Cancellation stops subsequent work and prevents late artifact commits; an already-started provider request can finish before the next cancellation check. Successful results, errors and cancellation survive reload. Private drafts require review before publication.

## Sources

Sources support batches of up to 20 public links or files; a reusable collection contains up to 20 sources. File requests are limited to 10 MB each. Extraction runs in the worker, with 50-page PDF / 50-slide presentation and 100,000-character bounds. DOCX/PPTX archive expansion is bounded. PDF page and PowerPoint slide references are retained; DOCX extraction does not reconstruct physical pagination. Scanned PDFs still require a text layer.

URL imports pin a validated public DNS address for each redirect, block private/local addresses and credentials, and bound downloads and timeouts. They do not use browser cookies or execute page JavaScript. Protected, dynamic-only and unsupported sources return recoverable errors. Videos remain links authored into lesson text rather than transcript imports.

Original files remain in tenant-private storage. Active document content is served as a sandboxed download, never executable same-origin HTML. Source collections and citations are owner-checked independently of tenant membership.

## Visual annotations

The library lists models without loading 3D geometry. Opening a model enables orbiting, mesh-aware controls, surface-pin placement and an annotation inspector. A single mesh can contain multiple pins; it does not acquire imaginary separable components. Changes are revision-checked and saved in annotation history. Refreshing data cannot replace unsaved edits. Previous revisions can be loaded as a new draft.

Annotations support names, explanations, function, relationships and private source citations. Reviewed mappings can be used in a lesson; unreviewed proposals are not promoted to reviewed teaching material. Existing lessons retain their saved mappings.

“Prepare views & annotate with AI” captures six bounded model views and sampled surface anchors. Visual proposals require an explicitly configured compatible vision model:

```dotenv
AI_VISION_BASE_URL=
AI_VISION_MODEL=
AI_VISION_API_KEY=
```

Keep credentials server-side. OpenRouter vision models must be free when the free-only setting is enabled. Selected uploaded reference images may accompany model views; unreviewed generated images are excluded as reference evidence. Unsupported vision falls back to cautious name-based proposals and manual pinning. Vision proposals identify approximate image positions; trusted code snaps nearby proposals to measured surfaces. Identities and positions require author review. This is not automatic semantic mesh segmentation or verified anatomical identification.

Flux remains an optional illustration provider using its existing configuration and failure recovery. It is distinct from image understanding.

## Verification

- API tests cover private collections, ownership, stale revisions, citations, event replay and cancellation.
- Worker tests cover bounded linked drafts, invalid actions, source extraction, unsafe URL rejection, visual anchoring and cancellation fences.
- Provider tests verify multimodal payloads and reject image inputs on text-only routes.
- Browser tests cover desktop/touch authoring, history/recovery, onboarding, role navigation, current theme, lessons, Sketchfab and marketplace regression behavior.
- The pilot load test covers 50 learners; it measures local API behavior, not guaranteed third-party model latency.

For browser QA, `apps/api/test/serve.ts` honors explicit `NODE_ENV=test` and `API_PORT` overrides. Use a separate API port (4001), `API_INTERNAL_URL=http://127.0.0.1:4001`, `NEXT_BUILD_DIR=.next-qa`, web port 3001 and `E2E_BASE_URL=http://localhost:3001`. This avoids exhausting normal development signup limits or overwriting the running web server's build output.
