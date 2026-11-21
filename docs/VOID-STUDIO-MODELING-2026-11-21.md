# Void Studio modeling verification — 21 November 2026

Scope: Object, Edit and Sculpt modeling workflow and its properties interface. Animation, rigging, physics, payments and Void Space hosting are outside this pass.

## Implemented

- Contextual mode chooser and Ctrl-Tab menu use the active object's registered geometry type. LiteMesh offers Object/Edit/Sculpt; LeafMesh offers Object/Edit; cameras, lights and no active object offer Object only. Navigation is no longer advertised as an editing mode. The sidebar chooser and workspace presets use the same policy.
- Tab enters the compatible Edit mode and returns to Object mode. Changing to incompatible object data exits the previous editing mode.
- Edit mode exposes mesh selection and topology menus backed by registered native operations. LiteMesh includes region/individual/wire extrusion, split, inset, vertex bevel, subdivide, loop cut, UV generation and triangulation. LeafMesh uses its own mesh operations. Sculpt has its own actions and existing brush settings.
- Delete respects the editing domain. LeafMesh routes to element deletion. LiteMesh/Sculpt refuse to fall back to deleting entire objects and explain the unavailable operation.
- Properties expose Active Tool, Object, Object Data, Material, Texture, Scene, World, Render and Settings. World and Render contain existing engine settings, rather than empty controls for unsupported features.
- Object naming is editable. Viewport visibility and lock settings are accessible. Object and Object Data show clear empty states after active-object removal. Object Data rebuilds through the editor update lifecycle; the old dynamic update hook left the category blank.
- Compact labels have an explicit line height to prevent clipped descenders. Property categories retain their icon labels as tooltips. Transform values preserve distance/angle/dimensionless units.
- Corrected a GLB import reference to the UV corner layer and copied the BIN payload into a correctly offset ArrayBuffer. Related source typing errors were resolved without modifying the pinned UI submodule.

## Verification

- Studio build and addon duplication guard pass.
- Full Studio source TypeScript check passes.
- Architecture check passes: no error-level violations or budget overruns.
- Three focused unit suites pass: 18 tests covering mode availability, theme and UI overrides.
- All 8 native WebGPU browser tests pass. A further category check confirms the intended active tab after every click. Coverage exercises mode menus, mesh selection, subdivision and topology undo, safe deletion, camera mode filtering, empty selection states, property contexts, label geometry, transform gizmo, Add menu, property widths/units and every property category.
- Whitespace checking respects the repository's existing CRLF source files.

## Remaining limits

This is not full Blender feature parity. The initial pass lacked LiteMesh element deletion. That gap is closed by the browser-only follow-up below; both mesh backends now support element deletion. A full general-purpose modifier stack, separate paint/rigging modes and animation/physics workflows have not been added. Sculpt remains limited to the geometry backend that implements it.

The menus above expose existing tools; this pass does not establish exhaustive numerical correctness of every geometry algorithm or every sculpt brush. Browser tests verify representative geometry changes and undo, rather than every possible mesh topology.

The separate legacy void_space_panel Jest suite cannot currently load its ESM dependency through its CJS test path. That harness issue is outside the modeling suite and prevents a claim that all Studio tests pass.

Changes are local; this report does not establish a new public deployment.

## Viewport follow-up: Blender layout and icon audit

Reference: [Blender's official 3D Viewport introduction](https://docs.blender.org/manual/en/latest/editors/3dview/introduction.html), inspected in BrowserOS on 21 November 2026. The viewport uses mode/menu controls on the left, a separate tool rail, display controls on the right and an optional sidebar.

Changes in this follow-up:

- A single 30px viewport header replaces the editor-switcher row and duplicated transform controls. The toolbar remains available on the left. Scrolling the header scrolls its controls without zooming the scene; scrolling other UI panels also leaves the scene alone.
- Added camera-axis, zoom, frame-selected and projection buttons. They operate on the real viewport camera. Labels track the current projection and active object.
- Neutral gray surface shading replaces the purple selection tint. The background, unit grid, initial three-quarter camera and six-face startup cube provide a more familiar modeling view. Existing saved scenes keep their data.
- The icon atlas uses readable vector glyphs for the main editor controls while retaining the original sculpt artwork and host-provided sheets. Icon decoding finishes before widget creation.
- Removed numeric reverse-enum shading entries that generated blank duplicate icon controls. Explicitly mapped Sculpt Mask and Feature Overlay icons. The browser audit finds no undefined/negative icon identifiers among visible viewport icon buttons in Object, Edit and Sculpt modes.
- Both LiteMesh and LeafMesh now honor viewport wire shading in their actual rendering paths. LiteMesh previously continued drawing its solid surface. LeafMesh now submits its cached mesh-edge geometry as lines.
- WebGPU initialization no longer falls through into a nonexistent WebGL context while waiting for the GPU device. The camera-view toggle also avoids calling the WebGL preview path on WebGPU.
- Outliner rows use compact mesh/light/camera, visibility, selection-lock and delete glyphs with accessible names. Selection and object actions remain available through menus and shortcuts.

Verification after these changes: **12 browser tests passed; 18 focused unit tests passed; build, source type check, architecture and whitespace checks passed.** Browser coverage now includes real wireframe dispatch on both mesh backends, all visible viewport icon mappings in three modes, navigation, numeric move/rotate/scale with undo, mesh region/individual/edge extrusion, split, inset, vertex bevel, subdivision and triangulation, cancellation/undo, properties, Add menu and gizmo construction. Renderer console errors are checked in the new viewport tests. Optional Void Space service network failures are outside those viewport assertions.

The editor was visually inspected in BrowserOS with a working WebGPU device. Headless Chromium screenshots on this machine did not reliably include the GPU canvas, so they are not used as visual evidence. No pixel-perfect comparison or universal tool/brush certification is claimed. At that checkpoint, loop-cut placement, brush variations, texture/UV authoring and interchange round trips still needed broader coverage. The subsequent browser-only follow-up below adds those checks and closes the element-delete gap.

## Browser-only workflow follow-up

User constraint: Studio remains entirely browser-based; it does not require a local Blender installation or a hosted Blender process.

Implemented and verified:

- Added native, undoable LiteMesh vertex/edge/face deletion, plus faces-only deletion. The C++ mesh log owns each delete transaction, cascade events and active-element changes. Cleanup removes newly orphaned geometry associated with the selection, rather than unrelated loose geometry. Delete/X use the active mesh domain; Mesh menu actions also allow explicit domains. The scene object remains intact when its geometry becomes empty.
- Rebuilt the browser and Node WebAssembly targets and regenerated the affected MeshLog TypeScript binding from native reflection. The engine edits live inside the `sculptcore` submodule. A release must include that engine revision and rebuilt WebAssembly; frontend JavaScript alone is insufficient for the new operation. Nothing has been published from this worktree.
- Confirmed loop-cut placement under the pointer and topology undo.
- Added a standard file-input import fallback for browsers without `showOpenFilePicker`. It reads the selected file bytes through the same format registry as the native picker, handles cancellation, and reports import errors visibly.
- LiteMesh triangle extraction now preserves UV seams by exporting independent corner vertices where required. GLB writes those UVs for both single-object and merged scene exports. OBJ writers now emit texture-coordinate records and face references for LiteMesh and LeafMesh.
- GLB, OBJ, STL and PLY geometry round trips pass in the real editor. GLB and OBJ checks verify generated UV layers survive; the OBJ check includes an additional export from the imported LeafMesh. STL is tested for geometry, as that format does not carry UV maps.
- Browser sculpt checks exercise forward/inverted displacement, mask gating, color paint and mirrored strokes, and check for non-finite geometry.
- Real project serialization/reload preserves object naming, triangle geometry and generated UV coordinates.

Validation: 24 combined browser checks passed. Following the OBJ UV fix, the affected GLB/OBJ browser checks passed again. Ten focused unit suites pass (135 tests). Full Studio source type checking, the architecture check and whitespace checks pass. The native browser and Node engine builds succeed.

Current boundary: this is a verified modeling workflow improvement, not complete Blender parity. A general modifier stack, rigging, animation and physics remain substantial unimplemented feature sets. The sculpt checks cover named behaviors rather than every brush/input combination. FBX, external-resource glTF, all texture/material combinations, concave polygon interchange and full rendering parity are not comprehensively certified. The separate legacy panel Jest suite still has its ESM/CJS harness limitation; no claim is made that every Studio test passes.

## Modifiers, FK rigging, animation and box physics

The browser editor now has working initial workflows in the four areas previously listed as missing. The four new Properties categories have explicit icon identifiers and ordinary labeled controls.

- **Modifiers:** an ordered, non-destructive stack of Twist, Taper and Bend deformations, with amount, local axis, enable/disable, reorder, remove and apply controls. The original vertex positions are saved in the project. Both LiteMesh and LeafMesh can supply deformation coordinates through a host-level provider contract. Live deformation locks mesh editing to Object Mode; apply the stack and unbind the rig before editing topology. The initial authoring limit is 100,000 vertices and 32 modifiers per object.
- **Rigging:** bind an automatic two- or three-bone vertical FK chain, edit each bone’s XYZ rotation, reset the pose and unbind while keeping the posed geometry. Automatic nearest-two-bone weights normalize to one. Bone lines and joints appear over the selected mesh in the viewport. Pose keys interpolate with transform keys.
- **Animation:** insert/delete location, Euler rotation, scale and FK pose keys; choose linear or constant interpolation. Scene time evaluates these tracks against real object inputs and mesh coordinates. The Animation workspace has transport, scrubbing and key diamonds. Only its first timeline advances playback, and leaving it stops playback. Keys and interpolation are project data and operations use the editor’s undo system.
- **Physics:** assign active/passive box bodies and mass, restitution and friction. A fixed-step translational AABB solver handles gravity and box contacts and bakes the scene range into editable transform keys. A passive mesh can serve as a floor. Baking supports up to 64 bodies and 1,000 frames, rejects invalid body inputs, and replaces keys inside the bake range. Undo restores the prior keys. There is no implicit floor.

The native engine adds a bulk vertex-coordinate setter for LiteMesh deformation, with regenerated Mesh TypeScript bindings and rebuilt browser/Node WebAssembly. A distributable release must carry the engine changes as well as the editor changes. This worktree has not been published.

These are initial browser implementations, not Blender feature parity. There is no general topology-changing modifier system, arbitrary armature editing, weight painting, IK, constraints, graph/dope-sheet editor, animation interchange, angular rigid-body dynamics, continuous collision detection, cloth or soft-body simulation in this pass. Euler interpolation does not implement quaternion rotation or Blender F-curves. Exported mesh formats contain the evaluated geometry; native project files preserve the workflow settings and keys. Fast/small objects can tunnel through thin colliders in the discrete box solver. Existing import, sculpt and renderer limitations above still apply.

Verification follow-up found and fixed two integration gaps: the new workflow widget needed an explicit registration import to survive bundling, and async data-only project loading detached the retained editor screen. The loader now keeps that screen attached until a successful replacement. The browser test clicks the new controls, edits modifier/pose inputs, reloads the project and verifies that Physics controls remain usable afterward. Interpolation changes now evaluate the current frame immediately.

Validation: 30 distinct focused browser checks pass across the regression and final affected-suite runs (24 existing modeling/viewport/UI checks and six new workflow checks). The final combined workflow/Properties run passes all 12 cases. Eleven focused unit suites pass all 142 tests. Source type checking, architecture budgets, whitespace checks and the frontend/addon build pass. Browser and Node native builds succeed, and all four copied engine artifacts match the rebuilt outputs. This does not change the separate legacy ESM/CJS panel test limitation recorded above.

Visual verification: BrowserOS shows the cube, ground grid and modifier controls, and clicking Add Bend visibly deforms the cube. Headless Chromium screenshots in this environment can omit the GPU canvas even when submitted texture pixels are opaque and rendered. The workflow reload test therefore includes a direct GPU texture readback assertion. No experimental canvas stacking or background changes were retained.

## Viewport interaction reliability follow-up

Scope: existing modeling tools, their pointer/keyboard interactions and the Void Space routes that open or display 3D content. Animation is future scope for this request; no animation implementation was added in this follow-up.

Reproduced failures and fixes:

- Object picking previously used proximity to the object origin and bounding-box corners. Most of a large visible face could therefore miss. Object Mode now tries surface-ray picking first and retains proximity picking for smaller/non-surface targets.
- Transform handles remained active with no selection because their validation method was disconnected from the widget lifecycle. Validation now runs when a widget is offered, when the mode updates and during hit testing. Stale handles cannot intercept the next selection click.
- Mesh Edit Mode gizmos were explicitly configured to transform whole objects. The editing modes now declare their transform domain, and Move/Rotate/Scale gizmos and keyboard tools use that domain. Selected mesh coordinates move while the object's placement stays intact.
- Both geometry backends applied world-axis transforms directly to local vertex coordinates and returned local selection bounds. Transform snapshots now retain the object's matrix and inverse, convert coordinates through world space, and return world-space bounds/centres. Non-invertible object scales produce a warning rather than invalid coordinates.
- Command was counted twice by the keyboard matcher (`meta` and `command`), preventing Mac shortcuts from matching. It is now one canonical modifier, with the legacy alias normalized. Studio binds Command-Z and Command-Shift-Z in addition to Control shortcuts.
- Moving across unchanged empty viewport space requested a full redraw for every pointer event. The highlight path now requests rendering only when the highlight changes. The regression previously measured 12 requests for 12 moves and now requires fewer than five; this is a render-request measurement, not a universal FPS claim.
- Delete previously fell back to the active object even after the user cleared the selection. It now affects selected objects only. Outliner delete buttons explicitly select their target first and retain their behavior.

The new pointer suite exercises actual mouse/keyboard events, including clicking a visible face, dragging the rendered move handle, camera orbit/zoom, Edit Mode geometry moves, transforms on rotated objects in both backends, and empty-selection deletion. It closes a gap in the earlier checks, which often exercised operators directly. The numeric transform test also waits for transform-modal readiness before entering an axis/value.

BrowserOS verification: blank-space deselection and face selection work; dragging the red move handle changes object location and Command-Z restores it; Edit Mode G/X/1 changes vertices while leaving object location unchanged. Void Space sign-in, Studio launch, joining/leaving a shared lesson and dragging its 3D model were explored. The two existing experience tests and the learning/shared-room test pass against the local platform.

The keyboard matcher fix lives in the nested path.ux/path-controller submodule. A release must include that change alongside the Studio source. Changes remain local and have not been published. These checks cover the named workflows and do not establish full Blender parity or exhaustive correctness on every mesh topology.

Validation for this follow-up: 38 distinct Studio browser cases pass across the full regression and final affected-suite runs. The final affected run passed all 24 cases, including the eight new pointer/keyboard cases. All three Void Space experience/learning browser cases passed. Twelve focused unit suites passed 144 tests. Studio source types, the UI library and example types, architecture budgets and whitespace checks pass. The frontend/addon build succeeds. One initial numeric-input run failed, while three isolated repeats passed. Its readiness checks now wait for an active object, an idle toolstack and transform-modal startup; the final affected suite passes. This is verification of the named modeling and delivery workflows, not certification of every platform feature or a public deployment.


## Publishing the verified modeling release

The release pins the native engine and keyboard fixes to published commits in the owner's sculptcore, path.ux and path-controller forks, so a clean recursive checkout can reproduce the editor. Validation uses an isolated checkout rather than the original workspace's separate, unfinished structured-scene AI changes. Those unrelated edits remain local.

The Pages regression configuration now covers modeling, pointer interactions, settings, theme, Properties, icons and local import/export/save/load. All navigation is relative to the deployed project path. The Pages isolation worker revalidates same-origin requests because fixed loader/engine URLs must not retain an older release in the browser HTTP cache. Its two Node regression checks first reproduced the missing revalidation and now pass; the deployment workflow runs them before packaging. External credentialless requests retain their existing cache policy.

The first packaged run passed 32 of 34 checks; the Edit Mode handle and empty-selection Delete checks failed intermittently. The handle test now clears selection before using the toggling A shortcut, waits for queued selection operations, and asserts movable vertices before dragging. Pointer setup waits for the active object and idle toolstack. Empty selection is checked against the full scene selection rather than the editable subset. Five repeated handle checks passed; one paired Delete run still failed, followed by ten standalone event-instrumented Delete passes. No diagnostic logging is retained. This history is recorded rather than representing every run as successful.

The final combined packaged-site run passes all 42 cases in 3.6 minutes, including both previously intermittent cases. The isolated source check passes with `tsgo --noEmit --allowImportingTsExtensions`, and the 12 focused Studio unit suites pass 144 tests. Release bundles contain no source-map files or inline source maps. These results verify the named workflows; they do not establish exhaustive Blender parity or rule out all timing issues on every browser/device.
