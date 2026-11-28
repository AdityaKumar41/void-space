# EON-inspired convergence implementation

**Status correction (29 October 2026):** the initial modules below describe API
and persistence behavior. They are not evidence of complete EON-like delivery.
See [the repair audit](./PLATFORM-REPAIR-AUDIT-2026-10-29.md) for verified gaps,
implemented workflow repairs and the remaining product scope. Initial lesson
creation supports a manual template or source-text AI generation, always as an
editable draft. The configured CUTM provider now supports generated guidance
with transcript fallback; see [AI providers](./AI-PROVIDERS.md).

The comparison PDF is available at `docs/VOID-SPACE_Platform_Convergence_Document.pdf`.
This note records what is already operational in VOID-SPACE and what the learning
extension adds, without presenting an EON Reality integration as one exists. All
features are native to VOID-SPACE.

The subsequent [interactive spatial runtime](./SPATIAL-EXPERIENCES.md) adds real
scene target placement, mesh operations, saved task runs and action replay. It
supersedes the initial boolean-checklist simulator delivery described below.

## Existing, operational platform capabilities

- Multi-tenant 3D DAM: upload, versioning, metadata, review, browser preview,
  third-party import, Blender optimisation and Meshy generation.
- Content provenance: IPFS pinning, an on-chain licence registry, audit trail,
  revocation and a public marketplace projection.
- Marketplace: public discovery, licensing information, provenance links, likes
  and comments.
- AI metadata assistance: schema-validated tags, description and quality flags;
  a deterministic fallback keeps ingest operational without an AI provider.
- XR handoff: approved, licensed content is published asynchronously and retains
  its manifest reference.

## Learning loop added in this change

The new flow is deliberately anchored to an approved asset:

```text
Approved asset -> lesson draft -> publish -> guided assessment
                                      -> pass -> verification credential
```

- `POST /api/v1/lessons` creates a no-code lesson only from an approved or
  published asset and its current reviewed version. It produces a narration,
  four-step outline and assessment questions.
- `POST /api/v1/lessons/:id/publish` makes it available to learners.
- `GET /api/v1/lessons` and `GET /api/v1/lessons/:id` provide a safe learner
  representation that never exposes correct answers.
- `POST /api/v1/lessons/:id/attempts` grades answers, stores the attempt,
  computes the Awareness / Practice / Apply / Mastery stage and issues a
  SHA-256 verification credential upon a passing score.
- `POST /api/v1/lessons/:id/mentor` is intentionally scoped to the active
  lesson; it does not search arbitrary tenant content or accept private context.
- `GET /api/v1/credentials/:id` lets the credential holder recover their
  portable proof.
- The console now has a **Lessons** area with guided delivery, assessment and
  mentor interaction.

The learning records, attempts and credentials are tenant-scoped, included in
RLS policy application and auditable through the existing append-only ledger.
`learning:manage` is granted to Creator, Assessor and tenant administrator roles;
learners can complete published lessons with their normal authenticated session.

## Virtual Campus and spatial delivery

- A published lesson can be assembled into an ordered, tenant-scoped course.
  Course release refuses unpublished lessons; enrolment is idempotent; and course
  completion is computed only after the learner has a passing attempt for every
  course lesson. It is never a client-supplied completion toggle.
- Shared spaces persist a versioned world-state document and reference approved
  assets and/or published lessons. A room must be explicitly made live before a
  participant can enter it.
- Presence is a device-neutral pose record refreshed by heartbeat, and expires
  after 90 seconds. Web, mobile, VR and AR clients share this same contract.
  The present polling endpoint is the reliable baseline; its storage/API seam is
  intentionally suitable for a WebSocket fan-out adapter without changing the
  identity or tenancy model.

## IoT and digital twins

- Equipment registration returns a high-entropy one-time secret and persists only
  its SHA-256 hash. Telemetry is accepted only by an authenticated tenant
  operator presenting that device id and secret; the secret is compared in
  constant time.
- Telemetry is immutable, audited and timestamped on receipt. Each linked
  digital twin updates to the normalized latest state, ready for spatial rooms,
  simulators and field-guidance clients to consume.
- Authorized operators can inspect the latest 200 immutable readings per device
  through the telemetry API and Digital Twins console, alongside the current
  normalized twin state.

## Simulator and skills assessment

- A simulator scenario binds to a published lesson and/or a tenant digital twin,
  with a versioned weighted rubric. The release endpoint validates the stored
  rubric again so malformed imported data cannot become learner-visible.
- A learner submits only boolean evidence for the rubric criteria. The API
  ignores unknown criteria, computes weighted score and the 80% pass threshold
  itself, and persists a timestamped immutable attempt. Neither score nor pass
  state is accepted from the client.
- Scenario creation, publication and completed assessments write separate audit
  actions. The console provides rubric editing, release, guided evidence capture
  and a verified result view.

## Field IQ guidance

- A field guide is a tenant-scoped, publishable packet bound to a published
  lesson and/or approved asset. Its steps can carry approved asset references
  and safety notes for QR-launched mobile, AR or headset clients.
- Completion accepts only the identifiers of every released step. The API
  rejects partial, duplicate or unknown steps; records a server timestamp and
  device class; and emits an append-only audit event. This keeps offline client
  sync evidence verifiable when it is submitted.
- The console exposes the learner delivery flow. Authors use the API to create
  and publish reviewed packets; published packets are then available to all
  authenticated field users in the tenant.

## Career Compass

- `GET /api/v1/career/profile` derives a tenant-scoped learner profile from
  verified lesson credentials, passed simulator attempts and completed field
  guidance runs. It does not accept a self-reported skill list.
- Role-path recommendations explain the specific category of evidence behind
  each recommendation, and the console exposes both the evidence and paths to
  the learner.

## Venture Builder

- Venture plans are tenant-scoped, creator-owned workspaces with structured
  problem, customer, solution and next-milestone fields. Only the plan creator
  can update it; plan lifecycle actions are appended to the audit ledger.
- The console provides creation and plan review, while the API keeps the
  structured record available to future mentor, funding and portfolio adapters.

## Full-convergence commitment

This is now the implementation target for the platform, not a list of optional
ideas. The following capabilities are all in scope and will each receive a
production data model, permissions, API, interface, audit events, observability,
and automated acceptance coverage:

| Platform capability                            | Native VOID·SPACE implementation                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| No-code XR authoring                           | Versioned experiences, scene/step authoring, asset placement and published delivery manifests.                              |
| Shared spatial rooms and persistent worlds     | Realtime room/session service, presence, roles, durable world state and moderation.                                         |
| AI generation and Genesis Trainer              | Source-to-curriculum pipeline for lesson, narration, assessment, media plan and experience draft.                           |
| Simulator and Assess IQ                        | Stateful scenarios, scoring rubrics, attempt evidence, review/proctor signals and verifiable credentials.                   |
| AI Mentor and Brainy avatar                    | Scoped retrieval, conversational session history, avatar/voice provider abstraction, moderation and explicit degraded mode. |
| Field IQ                                       | Device-ready step packets, offline sync, QR/WebAR launch and device/session telemetry.                                      |
| Career Compass, Venture Builder and AI Fluency | Skill graph, learner portfolio, role/path recommendations, business-plan workspace and structured AI competency tracks.     |
| Virtual Campus and Enterprise Hub              | Course catalog, enrolment/cohorts, white-label tenant settings, SSO, compliance and organization analytics.                 |
| Consumer delivery                              | Responsive web/PWA first, followed by signed iOS/Android and headset delivery clients sharing one API contract.             |
| Marketplace and royalties                      | Asset/lesson/experience listings, orders, entitlement ledger, royalty splits and on-chain settlement adapter.               |
| IoT and digital twins                          | Registered device connections, signed telemetry ingest, scenario bindings, alert rules and replay.                          |

The credential table has a stable verification hash so an on-chain credential-mint
worker can be added without changing the learner-facing identifier; it is not
falsely described as on-chain until that contract and worker are deployed.

## Current verification boundary

The following native vertical slices have migrations, RLS inclusion, permission
checks, audited APIs, console delivery and live-stack integration coverage:

- asset-to-lesson generation, assessment and portable credentials;
- ordered campus curricula and evidence-derived completion;
- spatial rooms/presence, IoT devices and digital twins;
- simulator scenarios with server-derived rubric scoring;
- Field IQ packets and complete-step field evidence;
- Career Compass profiles derived from verified evidence; and
- Venture Builder creator-owned plan workspaces.

The remaining product integrations—native headset/mobile packaging, avatar/voice
providers, external SSO/proctoring integrations, payment settlement and realtime
fan-out—are not represented as completed merely because their persistence seams
exist. They require provider credentials, deployment configuration and the
corresponding end-client delivery before they can be declared operational.

## Apply and verify

Run this after starting the local stack:

```bash
pnpm db:migrate
pnpm db:rls
pnpm --filter @void-space/api test
pnpm --filter @void-space/web typecheck
```

The migrations are ordered from `20261021090000_learning_platform` through
`20261021130000_simulation_assessment`. Together they create the learning,
campus, spatial presence, IoT/digital-twin and simulator assessment records with
foreign keys, indexes and tenant-isolation policy coverage.
