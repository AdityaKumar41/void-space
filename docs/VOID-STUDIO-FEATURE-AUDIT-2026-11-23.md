# Void Studio feature audit — 23 November 2026

Scope: the browser-based Studio and its existing modeling features. Void Space hosting, live payments and new animation work are excluded. Separate unfinished structured-scene AI edits remain outside this release.

## Reproduced issues and repairs

- Object selection undo recorded array keys instead of scene objects, looked up numeric library IDs as strings, and mutated its saved active-object IDs during undo. It now restores the actual selection and retains reusable IDs across repeated undo/redo.
- Object visibility, selection locking and Outliner rename bypassed the toolstack. These edits now use registered operations, including viewport H/Alt+H and the corresponding menus. Undo/redo and the autosave dirty counter see the changes.
- Whole-document undo replaced scene/library data, but the context locker skipped the default property codecs. Redo consequently inserted primitives into a detached scene. The locker now honors the provided codecs; ID-backed context properties resolve the current document after reload.
- Search menus had no initial keyboard selection, treated punctuation as a regular expression, and registered keyboard capture twice when enabled automatically. Filtering now selects a visible result, searches literal labels, and closing the menu releases its single capture. This restores viewport shortcuts after Shift+A → search → Enter.
- Outliner selection rebuilt row DOM during the first click, preventing double-click rename. Selection-only updates now preserve row nodes and update their styles; document replacement, naming and restriction changes still rebuild the list.
- Menu activation allowed its trailing mouse release to finish the transform it had just launched. The menu consumes that release before installing a modal tool, including other listeners on the same capture target.
- Cancelling a modal child of an extrusion macro left the preceding topology operation applied. Child cancellation now reaches the macro and reverses completed steps, without undoing steps that have not started.
- Help → Manual opened `/docs`, which drops the GitHub Pages project prefix and returns a 404. It now opens a packaged, deployment-relative modeling guide.

The shared context and menu repairs are published in the owned path-controller and path.ux forks and pinned by the root repository. They are ordinary source fixes; no local browser patches or generated engine replacements are required.

## Coverage

The Pages regression configuration includes the previous 44 cases and 26 added cases:

| Area | Checks |
| --- | --- |
| Add menu | All 16 entries, searchable keyboard activation, nonempty finite mesh geometry for mesh primitives, undo and redo |
| Selection | Exact membership restored through repeated undo/redo |
| Visibility | H/Alt+H, undo/redo and autosave dirty tracking |
| Outliner | Hide, lock, rename and undo |
| LeafMesh | Mesh-menu extrusion, inset, subdivision and element deletion on a selected cube face, with undo |
| Help | Real popup opens the packaged manual at the correct deployment path |
| Macro cancellation | Escape restores the original topology of a LeafMesh extrusion |
| Search focus | A completed Add search leaves viewport undo/redo shortcuts usable |
| Existing regression | Object/Edit/Sculpt modes, pointer picking, gizmo drag, keyboard transforms, camera navigation, shading, icons, Properties categories/settings, LiteMesh topology tools/deletion, sculpt displacement/masking/paint/mirroring, GLB/OBJ/STL/PLY round trips, native project reload and existing object workflows |

BrowserOS exploration independently reproduced the original selection/visibility/redo/search failures. After repair, keyboard Add with a punctuation-bearing name works, Command-Z removes the new primitive, Command-Shift-Z recreates it, and H followed by Command-Z restores visibility. The old public Manual link was observed returning a GitHub Pages 404; the repaired local popup opens the guide.

## Verification status

The final combined packaged-site run passes all **70 browser cases together in 6.0 minutes**. Public deployment verification follows publication of this release.

Studio source TypeScript passes. The 12 focused Studio suites pass 144 tests; the affected UI-library/context/menu/macro suites pass 66 tests. Library and example TypeScript checks pass. The architecture layer gate passes at 370 circular warnings against its existing budget of 373. The separate cycle gate still reports its existing host/submodule cycle-budget violations; these changes add no runtime import edges. Whitespace checking respects the existing CRLF selection source.

Earlier audit runs intentionally reproduced selection undo, dirty tracking, detached-scene redo and search-focus failures. Some temporary Python static-server runs also failed before editor startup with a module-fetch error in the isolation worker. Verification uses a concurrent static server for the same packaged bytes; those failed runs are not counted as successful feature checks.

## Boundaries

These checks establish the named workflows on supported WebGPU Chromium. They do not certify every possible topology, brush setting, hardware/browser combination or all of Blender. Server-dependent AI/collaboration services cannot operate on static GitHub Pages without a configured backend. Animation remains outside new implementation scope. Existing renderer/import/modifier limitations in the modeling report still apply.
