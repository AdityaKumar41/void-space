# Void Space — AI-first learning workspace

This supersedes the Classes / Programs / Teaching navigation proposed earlier. The approved reference is the light AI Manager screenshot supplied by the user on 24 November 2026.

## Required experience

## Verification required

Focused API, worker and browser checks must cover account/tenant privacy, all three audiences, private model upload and label review, agent tool invocation with a local mock provider, generation failure and invalid output, author preview/publish, teacher presentation, learner code/public access, keyboard/touch interactions, reload recovery, PDF/PPTX readability, revocation, and 50 active learners. Run appropriate regression suites and typechecks. Public Void Space deployment, animation and live payments remain excluded.

## Runtime configuration

## Verification record — 24 November 2026

- Production Next.js build passed. API, web, worker, shared types and database TypeScript checks passed before the final formatting pass.
- Full regression suites passed: API 198 tests, web 31, shared contracts 37, worker 77 and database 57. Subsequent focused tests cover the later generation composition/repair changes (14 passing), replacement invitation access, role revocation and model privacy.
- Six production browser journeys passed across desktop and touch: personal agent navigation/folders, private model upload and reviewed labels, legacy 3D/diagram/process practice, educator publication/presentation, lesson-code signup, individual resume, personal PDF download and revoked access. Three additional repeated production mobile checks passed. BrowserOS Neo was used to inspect the redesigned workspace and its layout.
- The 50-learner API scenario passed 250 agent/listing/lesson requests, including idempotent progress submissions. Latest focused local p95: 146 ms; this is a local API measurement, not a public-hosting performance guarantee. Another 250-request scenario covers legacy server-scored activities.
- PDF files were parsed back to text to verify content and omission of unfinished answer keys/private instructor notes. PPTX archives were inspected for editable slides, notes and links. PDF extraction checks include scanned/no-text and invalid input recovery.
- The configured live AI successfully executed a read-only lesson-search tool. Live lesson creation remains unreliable with the existing qwen2.5-coder:32b / mistral:7b endpoint: observed provider timeouts and schema-invalid content even after one correction. Invalid drafts were rejected, never published or given invented answer keys. Deterministic local-provider tests verify actual lesson creation, grounded replies, proposal preservation and valid repair. A reliable model/provider is still required for consistently successful live AI authoring; no new paid provider was enabled.

## UX simplification and provider recheck — 24 November 2026

The newer public reference supersedes the earlier landing design: a white editorial sheet on a black surround, a large three-line headline, an original colourful learning illustration and a functional floating lesson prompt. Prompt and attachment intent survive the sign-in/signup detour. Sign-in now describes learning, starts with empty credentials and exposes account creation; seeded demo accounts are opt-in and hidden in production.

Lessons open as readable, interactive previews. Detailed metadata, sources, setup and publication controls are disclosed on demand. Manual editing remains available. AI revisions remain proposals requiring an explicit apply; preview state resets when the saved revision changes. Model and diagram visuals and Sketchfab references are included in previews. Publication still requires human review of facts, answers, mappings and rights.

Learning tasks now persist actual execution stages in a tenant-protected JSON column, introduced by additive migration `20261124160000_learning_task_progress`. Chat and lesson editors display the same execution timeline. Queued work, real tool stages, completion and terminal failure are distinct. Editor task restoration is scoped by account, workspace and draft; applying or dismissing a proposal clears its persisted task and URL parameter. Retry and terminal-failure tests verify that failures cannot leave a completed-looking result or permanent spinner.

The supplied Qwen configuration was already present; no API key or replacement provider was added. Direct native `/api/generate` probes returned `READY` in 2.44 seconds and a valid 12-token JSON reply in 42.09 seconds. The application's real source/model lesson request timed out (42-second primary allocation, then 18-second configured fallback). A smaller direct three-section request also timed out after 120 seconds. Thus connectivity is verified, but live AI lesson authoring remains unreliable; host latency/capacity needs investigation. The image endpoint was not required for the original SVG illustration and was not exercised. Inngest AgentKit is not installed; existing durable BullMQ jobs provide the execution infrastructure.

Verification in this pass: production build passed; API 198 tests, web 28 tests and worker 82 tests passed, followed by an additional passing worker retry/terminal/recovery case. Ten current browser journeys passed, covering desktop/touch navigation, private GLB library and labels, landing prompt handoff, three learning formats, removed-route recovery, publication/presentation, sharing/revocation, resume/recap/PDF, Sketchfab references, marketplace purchase/download, telemetry and real worker/IPFS model upload. Final browser recovery verification and source typechecks are recorded in the commit validation.

Final validation: all 11 current production browser journeys passed in 45.0 seconds. The expanded proposal-recovery browser case also passed: resume a ready proposal after reload, complete the old preview, apply the revision through the API, verify the revised interaction restarts, and verify the saved task clears. Web, worker and database typechecks passed; the production build includes its own web type validation. Source diff checks passed for this change.

### Standards review

Two recovery findings were fixed: UUID activity links redirect to current Lessons, and saved legacy lessons remain importable through the current interface. The focused recheck found no remaining concrete issue. Retry, terminal failure and recovery now have worker and browser coverage.

### Spec review

The saved-lesson import path and stale preview state after AI changes were fixed. A second review verified the fixes, protected visual preview URLs, Sketchfab preview and account/workspace/draft-scoped task recovery. No further actionable P1/P2 issue was found in the reviewed changes. Live Qwen reliability remains explicitly unresolved as described above.

## Model-led learning and navigation audit — 24 November 2026

The model is now visible from the first section of a visual lesson, including introduction and explanations. A companion scene stays available during text and quiz sections without adding graded actions. The current section's server-authoritative activity remains separate: free isolation, separation and reset never manufacture progress. Component inspection sits beside the scene with reviewed explanations and contextual coaching. Quiz coaching remains unavailable until completion. Models without mappings do not invent labels; single-mesh and unmapped targets do not advertise unavailable isolation.

Session steps form a compact strip above the exploration surface. Lessons and examples use lightweight format artwork, duration and component/step counts; listings do not eagerly download models or return full source/answer definitions. Author previews and learner study use the same interaction surface. Existing review, immutable publication, sharing, presentation, resume, recap and exports remain available, with export/sharing controls disclosed deliberately.

Notifications, settings and help now have canonical learning routes and use the learning shell. Their old page implementations are removed and old URLs redirect centrally. Inbox updates have working read/unread actions, loading, empty and failure recovery. Settings starts with profile and workspace; wallet options are secondary. Professional asset workspace and marketplace remain separate functional destinations.

The manual private-model lesson path creates a valid editable exploration immediately without an AI call. Component authoring edits one selected label at a time and supports clicking a model surface to place it. Placement assembles the model and disables separation/isolation until it ends. Default zero-offset labels anchor at the actual mesh centre, and separated labels use world-space displacement. Built-in scene overlays now use a dedicated stable DOM portal; browser tests reproduced and then verified resolution of the previous removeChild/label disappearance failure during section changes.

### Verification

BrowserOS Neo hands-on checks used a fresh individual account: signup, lesson examples, component selection/isolation/reset, notifications, settings, help, progress, discovery, private GLB upload, component explanation editing, surface label placement, reviewed-label persistence, immediate editable model lesson, and source-note creation. Temporary fixture content is removed after verification. Automated desktop/touch tests additionally cover publication/presentation, lesson sharing/revocation, source privacy, learning resume, incorrect/correct interactions, recap/PDF, Sketchfab reference isolation, marketplace checkout/download, telemetry and real worker/IPFS upload.

The API regression suite passed 199 tests across 35 files. Web unit tests passed 30 tests across five files, including mesh-centre and transformed-world-offset label placement. Production build and API/web type validation passed. Exact failing viewer journeys were rerun after fixes; keyboard checks now wait for the actual saved section transition rather than the canvas, which remains visible by design. Final browser totals are recorded with the commit.

### Standards review

Review found an invalid empty-task manual lesson and label displacement while placing on separated parts. Both were fixed; the manual path now has desktop/touch end-to-end coverage, and transforms are disabled during placement.

### Spec review

Review additionally found that annotations without mesh mappings could misleadingly enable isolation. The control now requires a mapped target. No new provider was added. The previously observed Qwen latency/timeouts remain an external limitation; live AI generation is not claimed to be reliable. Animation, live payments and public Void Space deployment remain outside this change.

Final release verification: 14/14 browser journeys passed together in 50.2 seconds on the production build, including read/unread inbox behavior, every learning navigation destination and the no-AI private-model path on desktop and touch. The focused label-overlay reproduction also passed after the explicit portal fix. API 199/199 and web 30/30 tests passed; production build and source typechecks passed. Surface placement now disables component transforms for the whole placement session, closing the review edge case. The manual Neo walkthrough verified label positioning, reviewed persistence and immediate private-model lesson creation. These checks establish the tested paths, not a claim of full Blender functionality or verified anatomy recognition.

## Theme, login and settings verification — 24 November 2026

Login's onboarding selector overrode its two-column layout, pushing the form below the illustration. The corrected selector restores the desktop split and a compact mobile stack. Settings now has a bounded, padded content area with wrapping profile details. Learning navigation, primary buttons, focus, progress and login share the existing heat-orange accent, neutral surfaces and locally hosted Plus Jakarta Sans. Accidental green/navy theme overrides and tinted format artwork were removed; semantic status colours remain.

Agent conversation URLs preserve model selection. Reopening a saved conversation recovers its model from the authorized saved task context. Provider failure now explains recovery in plain language and links to the selected private model or workspace asset's editable lesson path.

### Verification

BrowserOS Neo was used to inspect login, settings, marketplace and landing, and to upload a private GLB, select it in the agent, choose the suggested exploration prompt and send a real request. The worker read the selected model but the configured Qwen provider returned no valid response. Live AI success remains unresolved; the failed stage and manual recovery are shown rather than fabricated output. The temporary walkthrough account is removed after testing.

The production build passed. All 17 production browser journeys passed together, including desktop/mobile login geometry, settings inset, font/accent checks, lesson primary-button colour and selected-model failure/reload recovery. The saved-history recovery extension was checked again after review. Web unit coverage passed 30 tests. Existing API results from the preceding model-led release remain 199 passing tests; API implementation was unchanged in this pass.

### Standards review

Review caught a remaining navy primary-button override and loss of model context when reopening saved conversations. Both were corrected and covered by browser checks.

### Spec review

Review caught workspace-asset fallback losing its selected asset. Recovery now preserves that asset ID. The actual external AI failure is recorded above; these checks do not establish that every feature or external service is error-free.

## Marketplace and remaining legacy frame — 24 November 2026

### Catalogue and landing checks

The workspace marketplace now has a plain-language introduction, compact category/licence/complexity filters, deliberate empty and retry states, and links to the public marketplace and private library. Public catalogue and listing navigation use the same brand, neutral surfaces and fonts. Landing uses that shared header/footer and a smaller hero so the lesson composer is visible sooner. Public catalogue searches now survive reload using the filter URL already written by the browser. Marketplace cards still avoid eager WebGL loading and checkout/licensing behavior is retained.

### Verification

BrowserOS Neo inspected the exact localhost catalogue, landing, public marketplace and permission-bearing asset library. Removing an unused module exposed a stale Next.js development dependency; restarting only the web frontend cleared it and the exact localhost desktop/touch journeys then passed. The initial broader run against the development API hit HTTP 429 signup protection; regression runs use a separate test API rather than weakening development limits. Production build and web unit tests passed; final browser totals accompany this change.

## Persistent AI work and institution roles — 24 November 2026

### History and live activity checks

Conversation history is visible by default, with separate Conversations and All AI work views. Older conversations and jobs load through cursors. Every saved turn retains its job steps, failure state and result links; current work uses those persisted records rather than an invented animation or hidden model reasoning. Job history also includes generation, revision, extraction, images and exports outside chat. Owner/tenant filters and narrow projections exclude private source bodies, answer definitions, provider credentials and server storage paths. Cache keys include the active account/workspace.

### Institution access checks

The active workspace is resolved by the server. Personal workspaces stay Individual; organization memberships with learning-management permission use the Teacher interface; other institution participants use Student. Teachers see teaching materials rather than personal learning-progress navigation/cards. Students and individual learners retain progress. Institution onboarding explains Student, Teacher and institution setup separately. Existing students/teachers join through an invitation bound to its intended account/email and assigned access; an email domain does not grant teaching or administrative rights.

### Image generation checks

Private Flux illustration jobs use the existing queue, usage limits and source storage. Completed images appear as unreviewed sources with previews; failed jobs remain in history and can be retried. The live host is currently unable to load its Flux checkpoint; see FREE-AI-PROVIDER.md. Mocked success, invalid data, unsupported remote URLs and private recovery paths are tested without pretending the external service succeeded.

Final checks for this pass: the full production browser suite passed 22 journeys; six focused history/model/persona/image journeys passed again after pagination and context restoration changes. The final API suite passed 203 tests across 36 files, including 50-learner load scenarios and history ownership/pagination. Worker tests passed 88 across 14 files; web unit tests passed 30. Production build and API/web/worker type checks passed. A real queued Flux request failed on the configured host, remained visible in private history and stored no image; this limitation is not represented as a successful generation. BrowserOS Neo confirmed the current teacher workspace hides personal progress and shows the visible History/All AI work panel.

A focused retry regression additionally reproduced a stale image-task URL before the fix and passed afterward. Retry now follows the new task across reload. Completed image jobs invalidate the private source listing so newly generated images appear immediately.
