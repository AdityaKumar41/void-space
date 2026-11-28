# Void Space audit — 27 November 2026

## Scope

## Findings fixed

| Finding | Change and verification |
| --- | --- |
| Sketchfab search returned text-only cards | Added responsive thumbnail cards, author/license attribution, selected state and accessible “View in 3D” actions. Selecting a card opens one interactive viewer. Images load lazily; missing/broken images get a usable fallback. Desktop/touch regression passed. |
| First provider thumbnail was tiny and blurred | Choose the smallest HTTPS image at least 640 pixels wide, or the largest available image. API regression and live BrowserOS visual inspection passed. |
| A new search could leave an unrelated old model visible | Clear previous results and selection when starting a new search. Empty-result recovery verifies that the old viewer is gone. |
| Database setup granted tenant runtime access to central-admin credential tables and removed required platform privileges | Restore the migration's separation in the repeatable RLS setup: deny tenant/public access to platform grants, MFA/session records and events; permit only the platform role's required operations. Platform events remain append-only. Added a real database regression. No user was granted a role as part of this fix. |
| Grant changes were individually committed during setup | Apply the complete policy/grant update in one transaction so intermediate broad grants and missing platform permissions are never visible to other transactions. Applied successfully, followed by privilege checks. |
| Private library uploads failed because local S3 storage was stopped | Started configured local MinIO; verified private upload/read/checksum and authorized range delivery. Added startup handling for configured loopback MinIO to `pnpm dev`. Remote endpoints are not replaced. |
| Real agent requests failed because Inngest dev runtime was stopped | Restored the persistent local development runtime and added it to configured development startup, with owned-process cleanup. Live lesson and annotation generation then completed. |
| Access-cookie expiry could require another sign-in despite a valid refresh session | The sign-in boundary now attempts verified refresh recovery when entered from the console, or when a stale access cookie remains. Missing/stale-cookie recovery preserves the exact destination. Failed recovery falls back to the normal credential form. Browser regression and live BrowserOS recovery passed. |
| Annotation labels triggered a React nested-root cleanup race | Replaced the pin-specific HTML bridge with a dedicated screen-space label component. It projects pins through the active camera and disposes its isolated DOM root after the current commit. The exact console error was reproduced in a new regression assertion; desktop/touch editor and visual-learning journeys now pass without it. |
| Paused Flux still exposed an enabled retry action in saved history | Disable image retries while generation is unavailable. Kept history readable and manual uploads available. Browser coverage exercises both mocked image recovery and paused controls. |
| Retry action only copied the request into the composer | Renamed it “Edit and retry” and focus the composer, making its review-before-send behavior clear. |
| Source lint contained two invalid empty-object generic arguments | Replaced them with explicit empty Prisma argument records. Type checks pass. |

## Verification

| Check | Result |
| --- | --- |
| Complete API suite | 223 passed across 43 files, including 50-active-learner load checks |
| Complete background-worker suite | 111 passed across 16 files |
| Complete database suite | 59 passed across 6 files |
| Frontend unit suite | 32 passed across 6 files |
| Shared activity/content contracts | 37 passed |
| Shared text-provider regressions | 22 passed |
| Browser journeys | All 38 distinct cases passed across the full run and targeted reruns |
| Type checks | API, worker, web and database passed |
| Source lint: web/API/worker/database | No errors; 14 non-blocking warnings remain |
| Production web build | Passed after the final viewport change |

The first browser run had six failures: five depended on the stopped storage service and one asserted the superseded large composer size. All affected journeys passed after storage restoration and correcting the obsolete assertion. The image recovery test explicitly enables availability in its intercepted fixture instead of depending on the administrator's local Flux setting; no external image generation occurs in that test. Separate missing/stale-session and viewport console-error regressions were run red before their fixes and green afterwards.

The expanded database audit discovers every table with a `tenant_id` column, requiring forced RLS and a policy on each private tenant table. Its explicit public exceptions are marketplace metadata, public lesson metadata, likes and comments. The public lesson exception was checked against the schema and publishing/read paths; it contains discoverable metadata rather than source documents, drafts or answer keys.

Browser coverage includes onboarding, institution administrator/teacher/student access, individual privacy, notifications/settings, history, folders, model-context reload, cancellation, private GLB upload, annotation positions and review, stale proposals, visual learning, quizzes, study/recap, autoplay/manual presentation, fullscreen playground, marketplace demo checkout/download, central-admin MFA, equipment/twin telemetry, and the existing professional asset/IPFS processing path.

## Live BrowserOS checks

- Searched Sketchfab for `heart`, inspected real thumbnail results, and opened the interactive model viewer. No reauthorization or new model download/import was performed.
- Generated a private synthetic 15-minute sphere lesson. Its five sections total 15 minutes and include a quiz and recap. Opened the actual playground and quiz.
- Requested a change scoped to that quiz. The free configured provider returned a proposal; preview showed the requested revised question while leaving the saved draft unchanged.
- Requested a private visual annotation proposal on the existing heart model. The planner and vision step completed and exposed progress/model usage. The proposal required author positioning/review; it was discarded without changing saved annotations (revision 1).
- Confirmed session restoration in the actual browser after observing the expiry failure.

The private synthetic lesson remains available as `Platform audit — sphere lesson` for inspection. Nothing from this live check was published.

## Remaining limits and follow-up

- Flux remains intentionally unavailable, as requested. Its server-side model-loading failure has not been repaired. Image creation and retry stay disabled; manual uploads work.
- Professional asset ingestion/delivery still uses the existing IPFS pipeline. Private learning models/sources use S3-compatible storage. Migrating the professional pipeline completely to S3 remains separate work; the existing path was regression-tested rather than represented as migrated.
- AI facts and exact anatomical pin placement still require author review. A successful generation is not evidence of scientific correctness. Single-mesh models support surface pins but cannot isolate nonexistent separate components.
- Sketchfab search/viewer were checked live; OAuth security and download/import handling were covered by route tests with provider fixtures. A fresh real OAuth authorization and editable import were not repeated in this audit.
- Local Inngest development infrastructure is running. This does not establish a hosted production queue, monitoring, backups, restore drills or deployment readiness.
- Existing non-blocking lint warnings remain (unused bindings and a few broad types). Real payment settlement, external on-chain issuance and public Void Space deployment were not exercised.
- The changes are local workspace changes; this audit did not push or deploy the accumulated branch.
