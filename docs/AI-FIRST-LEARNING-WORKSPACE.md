# Void Space — AI-first learning workspace

This supersedes the Classes / Programs / Teaching navigation proposed earlier. The approved reference is the light AI Manager screenshot supplied by the user on 24 November 2026.

## Required experience

- The authenticated default is Ask AI: a personal learning agent, saved conversations, conversation search and folders, a large composer, source attachments, model selection and lesson settings.
- Match the reference's light inset frame, pale sidebar, thin icons, spacious main area, breadcrumb, heading/actions, centered greeting and rounded composer. Keep existing marketplace behavior and Studio unchanged.
- Sidebar: Overview (Ask AI, My lessons, Library), Learning tools (Discover lessons, My progress, My sources), Manage (Institution, Settings), Marketplace at the bottom.
- Individuals and institutions choose their workspace during onboarding. Individuals can create an institution later without merging accounts based on email text.
- A private 3D library is usable by individual learners. Private GLB files must not be pinned to public IPFS or become marketplace listings. Only deliberately shared lesson visuals may be accessed by that lesson's audience.
- The agent must actually invoke bounded internal tools to create a lesson draft, propose a revision, find owned lessons/models, or propose model labels. No arbitrary code execution, automatic purchases, publishing, or permission changes.
- The same timed lesson supports reading, interactive 3D/diagrams/processes, inline practice and quizzes, presentation, resume, personal recap, PDF and editable PPTX.
- Model components can be labeled, located, selected and explained. Agent proposals based on names are unverified. Unknown anatomy must stay unidentified; authors review mappings and facts. Do not pretend a single-mesh model has separable parts.
- Draft and published lifecycle is distinct from audience: Private, Institution-only, Public to everyone. Both individual authors and institutions may publish globally after explicit review. Institution-only publication requires educator permission; access requires actual workspace membership. Original source documents and individual answers remain private.
- Public lesson discovery is an allow-listed metadata projection, independent of the asset marketplace. Anonymous readers can view public lesson content; authenticated learners can practise and save individual progress.
- Released content is immutable. Visibility may be changed independently. Link access can be revoked. Scoring is server-authoritative and duplicate/stale events cannot create progress.
- Preserve stored learning content and original activity/attempt semantics. Remove obsolete learning screens; redirect their URLs and provide saved-lesson import into the current workspace. Do not promote Classes, Programs or separate Teaching/Practice areas.

## Verification required

Focused API, worker and browser checks must cover account/tenant privacy, all three audiences, private model upload and label review, agent tool invocation with a local mock provider, generation failure and invalid output, author preview/publish, teacher presentation, learner code/public access, keyboard/touch interactions, reload recovery, PDF/PPTX readability, revocation, and 50 active learners. Run appropriate regression suites and typechecks. Public Void Space deployment, animation and live payments remain excluded.

## Runtime configuration

- API and worker must use the same `STAGING_DIR` filesystem/mount. Relative paths are resolved from the repository root for private learning files. Original notes/PDFs/models never enter the public asset gateway. Existing API-local private source paths remain readable through a narrowly constrained compatibility helper.
- `LEARNING_TEACHER_DAILY_JOBS=30`, `LEARNING_LEARNER_DAILY_JOBS=10`; at most three pending jobs per account. `WORKER_CONCURRENCY_LEARNING=2` defaults to two and is capped at four.
- `LEARNING_GENERATION_TIMEOUT_MS=90000` bounds lesson drafting, including at most one validated repair of invalid output. It does not extend HTTP request handling: the browser polls a private job. `LEARNING_GENERATION_MODEL` may select another model on the already-configured provider; it never enables an implicit paid provider.
- A compact content contract is compiled into trusted viewer bindings, stable component references and explicit validated quiz keys. Section scheduling is deterministic. Unknown citations and invalid keys fail; the first answer is never substituted.
- Private library accepts self-contained GLB 2.0, at most 50 MB/model, two million triangles, 500 meshes, 20 models and 200 MB/account. Remote model textures/buffers are refused. Labels derived from mesh names remain unverified until confirmed. Uploaded PNG/JPEG/WebP export visuals are decoded with a pixel bound and converted to PNG for PDF/PPTX compatibility.
- Public lesson content is deliberately readable without sign-in. Individual practice and resume require authentication. Changing a release back to Private removes its discovery projection; existing public grants do not become private invitations. Institution-only content requires membership, including when a code is supplied.
- No public Void Space deployment is part of this work. Local production verification uses separate ports and build output; the existing Studio deployment is unchanged.

## Verification record — 24 November 2026

- Production Next.js build passed. API, web, worker, shared types and database TypeScript checks passed before the final formatting pass.
- Full regression suites passed: API 198 tests, web 31, shared contracts 37, worker 77 and database 57. Subsequent focused tests cover the later generation composition/repair changes (14 passing), replacement invitation access, role revocation and model privacy.
- Six production browser journeys passed across desktop and touch: personal agent navigation/folders, private model upload and reviewed labels, legacy 3D/diagram/process practice, educator publication/presentation, lesson-code signup, individual resume, personal PDF download and revoked access. Three additional repeated production mobile checks passed. BrowserOS Neo was used to inspect the redesigned workspace and its layout.
- The 50-learner API scenario passed 250 agent/listing/lesson requests, including idempotent progress submissions. Latest focused local p95: 146 ms; this is a local API measurement, not a public-hosting performance guarantee. Another 250-request scenario covers legacy server-scored activities.
- PDF files were parsed back to text to verify content and omission of unfinished answer keys/private instructor notes. PPTX archives were inspected for editable slides, notes and links. PDF extraction checks include scanned/no-text and invalid input recovery.
- The configured live AI successfully executed a read-only lesson-search tool. Live lesson creation remains unreliable with the existing qwen2.5-coder:32b / mistral:7b endpoint: observed provider timeouts and schema-invalid content even after one correction. Invalid drafts were rejected, never published or given invented answer keys. Deterministic local-provider tests verify actual lesson creation, grounded replies, proposal preservation and valid repair. A reliable model/provider is still required for consistently successful live AI authoring; no new paid provider was enabled.

## UX simplification and provider recheck — 24 November 2026

The newer public reference supersedes the earlier landing design: a white editorial sheet on a black surround, a large three-line headline, an original colourful learning illustration and a functional floating lesson prompt. Prompt and attachment intent survive the sign-in/signup detour. Sign-in now describes learning, starts with empty credentials and exposes account creation; seeded demo accounts are opt-in and hidden in production.

Obsolete Classes, Programs, standalone Practice, Spaces, Field guides, Career, Ventures and old lesson/activity authoring screens and their unused UI helpers were removed. Central redirects recover their named routes and UUID activity links. Their database records, original scoring semantics and APIs remain intact. A compact saved-lesson import converts existing material into a current draft without reviving the old interface. Marketplace and Studio behavior remain unchanged.

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
