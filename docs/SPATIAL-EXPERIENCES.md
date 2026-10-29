# Interactive spatial learning — 29 October 2026

The Simulators area now opens a scene-based learning workspace. Authors select an
approved, pinned model, place targets directly on its surfaces, and arrange
identification, component separation/isolation/reassembly, and decision tasks.
Learners act on that model, receive consequences, resume a saved run, and replay
accepted actions. Earlier boolean-rubric assessments remain visibly labelled as
checklists; they cannot submit evidence for interactive experiences.

The workspace home now presents the learner's next activity first, with Programs,
Lessons, Practice, Spaces and Field guides grouped together. Content operations are
kept separate in the navigation. See [platform next steps](./PLATFORM-NEXT-STEPS.md)
for the remaining product work.

## Try the working experience

Open `http://localhost:3000/console/simulations` in the running local platform,
sign in with the existing Aurora demo creator, and enter **Cordless drill —
component exploration**. Guided practice labels targets; assessment uses numbered
markers and records a separate result. The demo uses the existing simplified
reviewed drill model. Its six tasks cover battery and chuck identification,
component separation, battery isolation, assembly restoration, and a decision
about source discrepancies. It demonstrates model exploration, not mechanical or
electrical training validation.

The additive setup command is `pnpm experience:demo`. It creates this one
experience through normal authenticated APIs, checks the known source geometry,
derives normalized surface anchors from the actual GLB bounds and publishes it.
It returns the existing scenario when rerun. It never resets or reseeds data.
For other assets, place targets visually using **Build an experience**.

## Author and learner behavior

- Source media is pinned to its reviewed version/CID. A draft can be reopened and
  edited. Publication freezes the definition; a changed source requires review.
- Pointer raycasting places targets on real mesh surfaces. Orbiting retains their
  positions. Explosion moves the actual mesh objects, isolation changes mesh
  visibility, and reassembly restores the original transforms. Isolation reframes
  the visible component. Single-mesh models support identification and decisions;
  component separation/isolation require multiple source meshes.
- Practice offers target labels and retries. It never issues passing assessment
  evidence. Assessment hides target-answer hints, uses weighted server scoring,
  applies a 25% task-point correction penalty per wrong attempt, and can end on an
  authored incorrect decision. It supports a linear task sequence with retry/end
  decision consequences, not an arbitrary branching graph.
- Runs snapshot the released definition and media. Reloading resumes the current
  task. Server revision checks prevent stale-tab advancement, event UUIDs make
  retries idempotent, and conflicting reuse of an event UUID is rejected.
- Every accepted task action records its sequence, server time, outcome and scene
  state. Replay reconstructs those component states. This is an action timeline,
  not a video, camera-path recording or continuous motion capture.
- The database transaction creates the completion attempt exactly once alongside
  the final event. Tenant RLS and learner ownership protect runs and replay.
  `void_app` cannot update/delete individual recorded events. Parent deletion can
  remove the associated run history through foreign-key cascades.
- Spaces can launch a published interactive experience in the room, with existing
  participant presence. Each learner's task progress is independent. Shared lesson
  step following remains available for lesson rooms; this is not simultaneous
  co-manipulation of the 3D scene.

## Runtime and deployment

Apply `pnpm db:migrate`, `pnpm db:rls`, and regenerate the Prisma client with
`pnpm db:generate`. Migration `20261029090000_interactive_experiences` adds the
scenario definition, durable runs and append-only action events. No reset is
required. Deploy API and web together with the shared types and generated client.

The runtime endpoints are `POST /api/v1/simulations/:id/runs`,
`GET /api/v1/simulations/:id/runs`, `GET /api/v1/experience-runs/:id`,
`POST /api/v1/experience-runs/:id/events`, and
`GET /api/v1/experience-runs/:id/replay`. The client sends commands and revisions,
never awarded scores. These records establish application task evidence, not
independent proof of physical competence or a tamper-proof browser client.

## Reference and boundaries

The public [EON platform demonstrations](https://eonreality.com/platform-in-action/)
and its linked [EON XR Infinite video](https://www.youtube.com/watch?v=e1c9vY5SQCU)
were inspected using BrowserOS neo. This is public product/marketing evidence;
no authenticated EON application or proprietary implementation was inspected.
The local convergence PDF supplies the platform scope. This native implementation
uses object exploration, guided practice and recorded assessment as its learning
loop; it is not an EON integration or a claim of full feature parity.

Remaining work includes physics/kinematic constraints, freeform object
manipulation, arbitrary branching scenes, voice/avatar collaboration, realtime
co-manipulation, WebAR/headset/device testing, PDF/DOCX ingestion, and issued
on-chain skill credentials. AI text assistance uses the configured CUTM adapter;
the deterministic scene runtime itself does not require an AI service.

## Verification

API tests cover ownership/tenant isolation, draft publication immutability,
forged-score rejection, concurrent idempotent retries, stale revisions, exactly
one completion attempt, practice/assessment separation, mesh-operation states
and room experience bindings. Browser tests exercise real surface placement,
draft save/reopen/publish, object operations, reload/resume, incorrect-decision
consequences and scene-state replay. The local demo was also operated directly
in BrowserOS neo. Temporary screenshots are QA evidence, not production assets.

Final local verification on 29 October: 134 API tests, 34 shared contract tests,
22 web unit tests and all three browser workflows passed. API/web typechecks,
changed runtime/UI ESLint checks and `git diff --check` passed. In BrowserOS neo,
the persisted drill demo completed all six practice tasks and opened its action
replay. Existing data and prior uncommitted work were preserved.
