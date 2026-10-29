# Platform repair audit — 29 October 2026

**AI follow-up:** the user subsequently authorized the CUTM text-generation host
and optional OpenRouter fallback. [AI-PROVIDERS.md](./AI-PROVIDERS.md) records
implemented mentor, source-text lesson generation, enrichment and Studio support,
the live verification, and the requested Qwen model's remote unavailability.
Earlier local-guide-only findings below describe the initial repair baseline.
PDF/DOCX extraction remains incomplete; pasted source-text generation now works.

This audit supersedes the earlier assumption that adding persisted API modules
made the EON-inspired product experience complete. It preserves the existing
uncommitted implementation and the original convergence PDF.

## Scope and reference evidence

The controlling reference is `VOID-SPACE_Platform_Convergence_Document.pdf`,
particularly B.2 and B.8–B.9. It calls for a DAM-first product with no-code asset
lessons, SOP/document-driven outlines and quizzes, lightweight assessment,
portable credentials, provenance and optional browser AR delivery. It explicitly
skips several full EON product lines. Existing Career, Ventures and other extra
modules have been preserved, not treated as required EON parity.

Public product references checked on 29 October 2026:

- https://eonreality.com/learn/ — object/place-based exploration and teaching.
- https://eonreality.com/train/ — task, decision and team practice.
- https://eonreality.com/ — the public product map and connected learning journey.

REA controlled browser observation opened the actual public homepage and waited
for its main heading. Evidence:
`ev_bdaa65549765e57c3d884596a7fcd201e3b419f108ef54ed5c5251ba9959c324`.
It observed the public product descriptions; it did not inspect EON's signed-in
application, proprietary implementation or private APIs. Public marketing claims
are not proof of those internals. No proprietary EON code has been copied.

REA also drove local login and lesson-studio navigation. Evidence:
`ev_48e128aac8ca8c7ba6775c17f0b0bd4b7a05077dd3ed787dc38e53744c1e64e5`.
All declared actions completed and no page errors were captured in that window.

## Confirmed failures repaired

1. **Lost authoring drafts.** Creation stored a draft but list/detail exposed only
   published lessons, and the UI immediately published the generated template.
   Authors now recover drafts, edit real content/questions and release explicitly.
   Learner projections exclude answer keys and pre-assessment explanations.
2. **Generic lesson content presented as finished training.** The initial template
   is now identified as a template. Authors edit title, summary, narration, ordered
   steps, questions, options, correct answers, explanations and passing threshold.
   This is manual no-code authoring, not document-to-curriculum AI generation.
3. **No model in an asset-based lesson.** Delivery now includes the lesson's saved
   asset version and renders its CID with the existing interactive 3D viewer.
   Browser speech synthesis reads the transcript where supported. Missing previews
   show an explicit state while leaving the transcript usable.
4. **Credential evidence could change retrospectively.** Published lessons reject
   content edits. Publishing validates the full assessment, unique question ids,
   option indices and current approved asset version. Revisions require a new draft.
5. **Rounded correct-answer count.** A two-of-three result returned 2.01 because
   count was reconstructed from a rounded percentage. Counts now use the exact
   number of correct responses.
6. **Spaces were presence-only popups.** Joining now opens a lesson workspace with
   the saved 3D asset, transcript, individual assessment, roster and facilitator
   step sharing. Asset-only rooms also render their referenced model. Shared state
   is polled every three seconds; this is not a WebSocket avatar simulation.
7. **False zero occupancy.** Room list queries now include unexpired participants.
8. **Learner presence rejected.** Viewers had `spatial:join` but the generic write
   guard rejected heartbeat. The participation permission now permits self-presence
   writes while management/asset/admin writes retain their existing protections.
9. **Ghost participants after leave.** Explicit leave immediately removes the
   caller's row. A disconnected browser still expires through the 90-second TTL.
   Facilitators can archive/end a session, clear presence and reject new heartbeats.
10. **Mentor echoed every question.** The local guide retrieves relevant released
    transcript passages and explicitly says when the lesson cannot answer. It is
    labelled as a transcript reference and does not transmit material externally.
11. **Campus stopped at enrollment.** Programs now link to actual lesson delivery
    and display the caller's passed-lesson progress and enrollment state.
12. **Prior learning ignored on enrollment.** Enrollment now checks existing passing
    evidence, completes an already-satisfied program and avoids duplicate enrollment
    and completion audit events on sequential retries.

## Remaining product work, in dependency order

| Priority | Capability                                       | Current evidence / remaining acceptance criterion                                                                                                                                                                                                 |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Document/SOP ingestion and curriculum generation | No document-to-lesson ingestion path exists. Add supported document extraction, asset grounding, schema-validated generation, author review and failure recovery. External AI transmission requires explicit approval of payload and destination. |
| P1       | Asset-specific guided interactions               | Delivered in the spatial experience workspace: surface target authoring, component selection, mesh operations and action evidence. Physics and freeform manipulation remain.                                                                      |
| P1       | Situation/simulation practice                    | Spatial experiences now have saved task states, retry/end decision consequences, server-scored actions and scene-state replay. Arbitrary branching and physical simulation remain. Earlier checkbox records remain labelled as checklists.        |
| P1       | Field procedures                                 | Existing packet persistence/evidence works. Console authoring is limited, QR/deep-link delivery and practical multi-step mobile execution need completion.                                                                                        |
| P1       | Spatial collaboration                            | Shared step polling and presence work. Participant pose is a stationary browser presence marker, not tracked 6DoF. Multi-object scene editing, moderation, co-manipulation, voice and realtime fan-out remain.                                    |
| P1       | Progress recovery                                | Assessment records persist; unfinished lesson answers/reading state do not yet resume across browsers. Add explicit learner progress with version-bound semantics.                                                                                |
| P2       | Browser AR                                       | Existing 3D preview is not WebAR. Implement capability checks, hit testing, placement, interaction and real-device QA.                                                                                                                            |
| P2       | On-chain skill credentials                       | Current verification hashes are database-issued records, not minted blockchain credentials. Add a credential contract and reconciliation/issuance worker with real chain checks.                                                                  |
| P2       | Commercial marketplace                           | Existing discovery/licensing is not completed payment/royalty settlement. Add entitlement/order ledger, processor adapter, royalty accounting and reconciliation.                                                                                 |
| P2       | Analytics                                        | Add course/assessment cohort analytics and provenance/credential issuance status grounded in real records.                                                                                                                                        |
| P2       | Creation-tool handoff                            | Complete Blender export presets and an actual versioned Unity project/template/import workflow as required by B.8.                                                                                                                                |
| Optional | Mobile/headset delivery                          | The PDF makes native clients optional. Current device-neutral schemas do not establish tested iOS/Android/headset applications.                                                                                                                   |
| Optional | Career, Ventures, always-on worlds               | Outside the PDF's required scope; preserve existing work but do not expand it ahead of the core learning loop.                                                                                                                                    |

## Verification and operation

Use the already configured local stack; do not reset or reseed the user's data.
The lesson/room repairs reuse existing tenant-protected models. The subsequent
[interactive spatial runtime](./SPATIAL-EXPERIENCES.md) adds migration
`20261029090000_interactive_experiences`, run/event RLS and runtime audit actions.
Apply migrations and RLS without resetting data.

- Original baseline: API integration suite, 17 files / 110 tests passed.
- Repair verification: API 19 files / 118 tests passed; shared contracts 34 tests
  passed; web unit tests 22 tests passed; all 22 workspace typechecks passed.
- Chrome workflow passed with no captured page errors: draft editing, explicit
  release, saved model decoding, live room delivery and immediate leave.
- Regression tests first reproduced missing draft editing, room occupancy and
  immediate leave; a separate regression reproduced prior-learning enrollment
  returning `active` instead of `completed`.
- API regression suite: `pnpm --filter @void-space/api test`.
- Browser workflow: `pnpm --filter @void-space/web test:e2e` (local seeded stack,
  Chrome installed). Creates one identified lesson/room and deletes only those
  fixtures using the normal RLS-protected database role.
- Type checks: `pnpm typecheck`.
- Shared contracts: `pnpm --filter @void-space/types test`.

Browser verification screenshots are written to `/tmp/void-learning-player.png`
and `/tmp/void-learning-room.png`. These are temporary QA outputs, not product
assets. Use the command results from the current run as the verification record;
do not carry older counts forward as proof for new changes.
