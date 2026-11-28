# Lesson-first learning workflow

The lesson is the working document. Its timed sections contain explanations, model annotations, exploration, questions and recap. Ask AI creates or revises that document; the library and sources supply reusable materials.

## This delivery

1. Generate a complete private lesson from a prompt, model and optional sources. Include component explanations in the lesson draft, with positions explicitly awaiting author placement when visual evidence is absent.
2. In the lesson, select **Model annotations** to create, edit and place pins directly on the visual. Keep these mappings specific to this lesson rather than changing a shared library asset.
3. Use **Suggest annotations with AI** to inspect prepared model views and propose descriptions and surface positions. Display uncertainty; authors confirm mappings before publication. Support both workspace assets and private models.
4. Offer focused AI actions for explanations, quizzes, annotations and recap. Revisions remain proposals with a preview, apply and undo. Keep the model/version, other sections and timing stable for a section-only change.
5. Keep progress, failures, source references and saved results visible. Resume a lesson/conversation after reload. Study, present, share and export from the same lesson workflow.

## User acceptance

- New author can create a model lesson, inspect its component explanations, ask for visual annotations, review the proposed pins and place/edit a pin without visiting the library.
- New learner can orbit/select components, read explanations, answer an inline quiz and view a recap; reload restores progress.
- No generic single mesh is claimed to contain independently separable organs. Unplaced AI labels are shown as draft components, not fabricated locations on geometry.
- Shared publication rejects unresolved AI mapping proposals. Private drafts remain editable and usable for review.
- AI unavailable, invalid citations, stale drafts and provider failure produce a retry path without losing material.

## Follow-up opportunities

After this workflow is verified, add reusable lesson templates, adaptive hints from missed objectives, flashcards from the recap and reviewed multilingual variants. These should extend the lesson document rather than add competing authoring dashboards. Automatic scientific identification and semantic mesh segmentation require separate validation; view-based suggestions do not provide either.

## Verification — 25 November 2026

Implemented lesson-owned annotation editing and visual AI proposals for workspace/private models, component explanations during lesson generation, contextual lesson chat, focused revision actions and in-place proposal preview. Existing model pins survive content revisions. Combined lesson/annotation requests put the proposals inside the lesson.

Verified in BrowserOS Neo against the local app:

- Existing heart lesson: opened the actual single-mesh model; reproduced invalid AI output; the bounded correction path then returned four annotation proposals. Component selection and proposal explanations were available. The existing draft and published release were left unchanged.
- Synthetic model: uploaded a private GLB, created a manual lesson and generated visual annotation proposals inside it. The live provider returned a valid result. Manual editing and placement controls were exercised; durable save/reload and keyboard positioning were additionally verified by the desktop/touch regression tests.
- A synthetic image readiness check succeeded independently; a successful provider ping alone does not verify full lesson generation.

Automated coverage: 207 API tests, 104 worker tests, 30 web unit tests; 23 browser journeys checked, with focused reruns after resolving touch navigation/readiness and annotation-label issues. The production build and TypeScript checks passed. The mocked-provider regression reproduces an invalid response and verifies exactly one correction attempt. The 50-learner local API tests measured p95 of 94 ms for listings/runs and 83 ms for agent/lesson data; these do not measure external model latency.

Known limits: free-model capacity and latency vary. The annotation workflow uses at most one recovery attempt per execution; failed visual inference may produce clearly described text-only, unplaced proposals. Images and names do not establish scientific identity. Single-mesh models cannot separate internal organs without suitable geometry. Flux illustration generation remains unavailable on the configured external server. No production deployment or scientific certification is claimed.

## Playground interaction design

Authoring now opens a dedicated lesson playground with three explicit modes: **Create**, **Study** and **Present**. Create keeps the current lesson in a central scrollable stage, a horizontal section timeline below it, and a persistent assistant beside it. Mobile has explicit Lesson/Assistant panel buttons rather than placing the assistant beneath the whole lesson.

AI activity, errors and proposals stay inside the assistant column. Completion never switches sections or replaces the saved draft automatically. Users deliberately preview a proposal in the existing stage, then apply or discard it; this avoids duplicate WebGL viewers and preserves the current editing position. New requests reset proposal-preview mode. Publishing lives under Review & share, and existing released versions remain accessible there.

Study uses individual saved progress. Present opens the owner’s presentation view with a section timer and next/previous controls. Both use the same lesson material while keeping authoring controls out of the viewing surface. Owners can return directly to Create; this owner-only link does not expose a draft to other learners.

Verification for this redesign: seven existing desktop/touch lesson journeys passed, two new playground journeys verify stable stage geometry across AI completion, a single model canvas, proposal preview/apply and Create–Study–Present transitions. The release API regression checks and production build passed. BrowserOS Neo was used to inspect the actual layout and open the presentation view with synthetic lesson material; no new private-content AI request was required for these UX checks.

## Fullscreen and institution access hardening — 25 November 2026

The authenticated draft and lesson routes now fill the application viewport. They use a dedicated shell without the dashboard header or sidebar. Create, Study and Present share a single playground stylesheet; the superseded session-grid and session-steps styles were removed. The stage and assistant scroll independently, while the section timeline remains visible. Recap and export controls live inside the stage so an expanded recap cannot push navigation outside the viewport. Native browser fullscreen is optional and has a clear unsupported/error state.

### Access model

| Workspace/persona | Available flow | Access boundary |
|---|---|---|
| Individual | Personal lessons, private sources/library, study progress; create a separate institution or accept an invitation | Creating or entering an institution does not move private material |
| Institution student | Institution lessons, individual progress, own private learning material | Cannot invite members, change roles or administer the institution |
| Institution teacher | Authoring and teaching-material navigation; institution lesson access | No student-progress navigation or member administration; cannot read another learner’s private sources |
| Institution administrator | Teacher tools plus invitations, role changes, removal and pending-invitation revocation | Server permission checks and tenant isolation; changes revoke affected sessions |

An email match alone does not link accounts or disclose other workspaces in the picker. Workspace switching requires verified ownership. The institution view shows the actual permission-derived role, with dedicated member controls instead of routing administrators to the old asset dashboard.

Invitation consumption and revocation lock and revalidate the invitation before mutation. Removed members can receive a new invitation. Role, suspension and removal mutations serialize per institution before checking the last-administrator invariant. A regression test reproduced two simultaneous administrator demotions leaving no administrator; the fixed implementation accepts one and rejects the other.

Verification: the full API suite passes 212 tests. Desktop/touch journeys cover the personal agent/library, institution invitations, teacher/student navigation, private-source isolation, role changes, session invalidation, member removal, invitation revocation, lesson study/sharing and the fullscreen playground. Focused reruns cover recap, exports and a stable viewport after AI proposals. API type checking, targeted frontend lint and the production web build pass. BrowserOS Neo confirmed the actual full-window lesson stage and native fullscreen enter/exit using synthetic material.

These are local release checks, not a production enterprise certification. Void Space is still not publicly deployed, and the current local Inngest dev runtime remains a development service. Production hosting, durable job operation, operational monitoring and backup/restore verification remain deployment work. The previously recorded external AI/Flux and scientific-annotation limitations still apply.
