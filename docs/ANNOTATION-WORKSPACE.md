# Model learning and annotation workspace

Library is a collection, not a split file browser. Opening a model replaces the collection with that model's study view. Back to library returns to the collection. Study mode supports selecting numbered pins and reading their explanations without creating a lesson.

The annotation workspace fills the window. The Three.js viewport provides standard camera angles, perspective/orthographic projection, framing, shading and inspection helpers. Annotation details remain separate from the scene. Authors can place a pin on an actual surface or adjust normalized X/Y/Z coordinates. Numbered markers keep geometry readable. Unsupported separate-part operations remain unavailable on single-mesh assets.

An AI panel stays beside the model. Requests use the existing authenticated learning-agent API and background harness. Prepared views, saved annotation state, the selected annotation and model revision provide context. The interface shows actual persisted job progress. AI returns a draft proposal; authors may change its text and precise placement, discard it, or save a new revision. Stale proposals cannot silently replace newer model revisions. Existing reviewed annotations remain reusable when creating lessons.

The main Ask AI page opens this workspace for a private-model annotation request, preserving its conversation and running job. Desktop and touch verification covers browsing, study, camera controls, manual placement, AI proposal review, stale revisions and recovery.

## Implemented controls and verification

- Camera: seven standard angles, framing, perspective/orthographic projection, shading and optional grid, axes and bounds.
- Pins: surface picking, normalized coordinates, an XYZ translation handle, undo/redo and revision-checked saving. Transform helpers live outside the model hierarchy so they cannot corrupt camera bounds. Keyboard coordinates remain available on touch devices and for precise adjustment.
- AI: authenticated model-scoped conversation, real job progress, cancellation, source/model context, optional selected-annotation scope and editable private proposals. Targeted requests preserve unrelated saved annotations in trusted code. Retrying a failed network submission retains its idempotency key.
- A proposal from an older revision leaves the latest saved annotations intact. A proposal arriving during manual editing waits for the author to resolve those changes.
- Existing reviewed annotations can be studied directly and reused in manually authored or AI-composed lessons. The model is still private; this change does not introduce public publishing.

The automated browser journeys use isolated accounts and synthetic models. They cover desktop and touch layouts, standalone study, precise pin movement and undo, editable AI proposals, save/reload, lesson reuse, automatic workspace opening from Ask AI, and stale-result recovery. The AI UI tests use deterministic completed jobs; worker tests independently exercise tool routing against a synthetic provider.

The authorized live heart-model job completed with one private proposal and no error. Its text and pin location remain unreviewed; the test did not apply or publish it. A subsequent BrowserOS check was blocked by an automatic approval-review usage limit, so final live browser inspection could not continue in that session.
