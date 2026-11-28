# Learning AI audit — 25 November 2026

## Scope and method

Used BrowserOS Neo on the running local platform with synthetic geometry prompts, a private synthetic cube, and synthetic notes containing a unique marker (ORBIT-742). No real learner documents were submitted, no lesson was published, no paid provider was enabled, and provider credentials were not exposed. Deterministic tests supplement live-provider runs; they are not evidence of guaranteed provider availability.

## Live browser observations

| Scenario | Observed result |
|---|---|
| Ordinary explanation | Correct three-point cube/sphere comparison, with saved execution stages and actual provider usage |
| Source-grounded answer | Correctly retrieved ORBIT-742 and eight vertices; said density was not given; displayed the exact source passage |
| Stop and reload | Cancelled generation remained cancelled after reload; inputs and history survived |
| Combined lesson and annotations | Initial 15-minute lesson was created, but the coordinator omitted annotation work. This exposed a real completeness gap |
| Visual annotation request | Returned four proposals; preview/apply worked after a UI fix. One proposal incorrectly treated the classroom code as a model component; not scientifically reliable |
| Durable replay | Completed run retained a working tool step. Reproduced and fixed with a checkpoint-replay regression |
| Model selection | Removing the model left a stale URL that reselected it on reload. Reproduced and fixed |
| Full lesson retest | Free provider exhausted bounded retries on invalid output; no successful completion is claimed |
| Focused recap edit | Initial whole-document edit failed. The new focused-section path returned a valid proposal using the existing self-hosted Mistral fallback, preserving other sections and 15-minute timing |
| Recap content quality | Proposal included an irrelevant medical-information revision suggestion derived from a negative source statement. Left unapplied; valid structure does not establish teaching quality |
| Flux illustration | Real configured endpoint failed; error and retry/history recovery remained usable |

## Implemented fixes

- Explicit model selection/removal is reflected in the URL. A deliberately empty selection overrides old task context after reload.
- Assistant responses use an inert renderer for paragraphs, headings, lists, emphasis and code. HTML and scripts are escaped. Valid attached source IDs render as source titles; the source panel retains exact passages.
- Usage metadata explicitly allows only provider, model and input/output token counts. API history, task responses and event replay also filter historical records containing full responses/tool arguments.
- Durable action completion is recorded outside cached callbacks, so checkpoint replay cannot leave completed tools showing as working.
- New model lessons with missing component explanations get one bounded annotation step when an inspectable private model is available. The network still has at most two actions and six specialist invocations. Empty label results are rejected. Proposals remain unreviewed.
- Annotation instructions exclude classroom codes, document metadata and learning objectives from physical model components and permit fewer components when evidence is limited. This is an instruction improvement, not a scientific validation guarantee.
- Proposal preview exits the current-draft annotation editor and shows proposed content in the stage. Applying remains explicit.
- Focused section editing accepts a small `{section: ...}` response. Trusted code preserves other sections and lesson headers; ID, kind, timing, citations, model references and answer keys remain validated. Existing full-document responses retain compatibility and unrelated-change checks.
- Long-running steps explain that requests are saved and can be revisited. Cancelled activity has a stopped indicator rather than a spinning or failed step.

## Verification

- Full API suite: **213 passed**.
- Full worker suite before the final focused-edit addition: **106 passed**; final affected worker suites: **28 passed**, including focused section composition, real task generation, checkpoint replay, invalid output, linked annotations, cancellation and exports.
- Web unit suite: **32 passed**, including inert response rendering and readable source references.
- Browser regression journeys: **9 passed** across history/persona navigation, model selection/reload, failure/manual recovery, proposal preview, fullscreen desktop/touch, image history/retry and desktop/touch agent/library workflows.
- Final production web build, API/worker/web type checks and targeted frontend lint passed.

An API module filename collision introduced during the audit was immediately restored and corrected by placing telemetry filtering in a separate module. API type checks, health through the actual browser, and the complete API suite subsequently passed. Existing program-progress logic was retained.

## Remaining external and content limits

Free-model output quality and latency vary. Full lesson generation failed on a later live attempt despite an earlier success. Flux remains unavailable on the configured server. Neither is reported as resolved. Generated component identities and recap facts require author review; the audit found real semantic mistakes even when JSON and citations validated.

A comparison with another currently listed free model was prepared but did not execute: automatic approval review could not complete because the review service hit its usage limit. No alternative model configuration was installed. The currently configured providers and free-only policy remain unchanged.

The runtime remains local Inngest development infrastructure. This audit does not establish production deployment, scientific certification or enterprise operational readiness.

## Annotation failure recovery — 26 November follow-up

The reported failed annotation run was reproduced at its vision checkpoint. The provider returned HTTP 200 with an eight-character invalid JSON response and reasoning tokens. Direct OpenRouter-compatible vision configuration bypassed the named provider's reasoning and free-routing controls. Direct OpenRouter endpoints now receive those controls, and annotation vision explicitly disables reasoning. A live replay then returned a validated annotation proposal; a separate BrowserOS Neo run also completed a private proposal without saving or publishing changes to the user's model.

Structured requests can opt into one schema-repair attempt within the original deadline. Provider errors are classified into safe recovery messages. Durable terminal failure handling preserves the specific reason, marks outstanding progress failed and leaves completed/cancelled tasks alone. The editor keeps its canvas mounted while loading a proposal and avoids duplicate pending-proposal notices.

Live synthetic checks passed for a timed lesson with quizzes, lesson revision and source-grounded coaching. Final provider tests: 22 passed. Desktop/touch annotation editor journeys: 2 passed; composer desktop/touch and model-reload recovery: 3 passed. Earlier combined browser execution hit local server timeouts; isolated annotation reruns passed. API, worker and web type checks, targeted lint and the production web build passed during this follow-up. These are scoped checks, not certification of every platform feature or factual accuracy of generated annotations.

Flux's configured server returned HTTP 500 while loading FLUX.1-schnell. At the user's request image generation is paused locally using `AI_IMAGE_ENABLED=false`: the API rejects image jobs/retries, the worker guards queued execution, and the UI explains that images are unavailable. Manual source upload remains available. The integration is retained for later re-enabling after the model host is repaired.
