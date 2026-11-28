# Void Space learning experience

## Product direction

Void Space turns an idea, source material or a 3D model into an interactive lesson. A learner should understand what the product does, choose a useful starting point, explore the material and keep a recap. An educator uses the same material to prepare, review and present. Individual and institutional permissions remain server-controlled.

This redesign uses the established light theme, orange accent, Plus Jakarta Sans, and existing React/Tailwind stack. Visual work is grouped around the learning journey rather than adding dashboard metrics or another set of authoring pages.

## Reference study

- [Gamma agent creation](https://help.gamma.app/en/articles/15002203-how-do-i-create-with-agent-in-gamma): conversational creation with a brief, outline and editable result. Used as a reference for prompt-led entry and explicit progression into the lesson.
- [Spline getting started](https://docs.spline.design/): a visual editor with contextual tools. Used as a reference for canvas priority and keeping properties beside the visual.
- [Edtech SaaS LMS Dashboard by Design Monks](https://dribbble.com/shots/27638179-Edtech-SaaS-LMS-Dashboard): inspected the visual presentation, navigation hierarchy and grouped learning actions. Schedules, rankings and analytics were not added because they do not serve the current product scope.
- The user's supplied light AI-manager and landing-page references remain the visual starting point. No third-party logos, templates or copyrighted illustrations were copied into the product.

## Implemented journey

1. **Public entry:** plain learning proposition, example lesson prompt and direct onboarding handoff; individual/institution choices remain available.
2. **Ask AI:** a prompt-led starting screen explains the result. The decorative speaker is removed. Sources, model and duration remain attached to the request. Saved conversations and AI work open in a dedicated native dialog with Escape dismissal and focus return. The empty state keeps the composer visible without a secondary promotional section. Ongoing conversations retain saved execution and result links.
3. **Lesson shelf:** one primary create action, search/filter controls, clear empty-result recovery, visual covers, and distinct personal/teaching copy. Returning users see saved work above the introductory banner; new accounts retain the guided introduction. Saved lessons and supplied examples retain their existing routes.
4. **Library:** a gallery that does not stretch a single item across the page; honest single-mesh counts; usable preview fallback; direct model discovery; back-to-gallery navigation. The selected model has contextual exploration/annotation controls.
5. **Sources:** a searchable saved-material list, a separate Add material panel, recognisable input methods and a direct “Use selected sources with AI” handoff. Raw documents remain private; the server still checks source ownership before generation.
6. **Playground:** a full-window stage, contextual inspector where width permits, section-type markers in the fixed timeline, and the existing Create/Study/Present modes. Small screens stack the inspector and retain touch/keyboard access.
7. **Shared frame:** compact navigation, readable type scale and consistent page headings. Removed duplicate in-page navigation and the sidebar's redundant AI upsell. Collapsed navigation retains accessible labels and tooltips.

Format illustrations are lightweight code-native artwork, not claims that a generated cube is a thumbnail of an anatomy model. Real thumbnails are shown when available and usable. No 3D asset is eagerly downloaded for a listing.

## Verification

BrowserOS Neo was used to inspect Gamma, the design reference, the actual app, desktop pages and mobile-emulated layouts. Verified the landing, prompt entry, lesson shelf, private library and actual interactive lesson stage.

Fourteen affected desktop/touch browser journeys passed: landing and signup prompt handoff, marketplace theme, notifications/settings navigation, personal agent/library, visual examples, lesson sharing/study/recap, full-window playground and login/settings layouts. The final source handoff checks also passed on desktop and touch. One desktop folder test was interrupted by development hot reload while code was changing; its isolated desktop/touch rerun passed without concurrent edits.

The 32 web unit tests, targeted lint, TypeScript checks and production web build passed. This is a UI/UX delivery; it does not change AI-provider reliability, enable public Void Space hosting, or certify generated scientific content. The limitations recorded in AI-HARNESS-AUDIT.md still apply.


## Follow-up screen repairs — 26 November 2026

Ask AI now uses a stable conversation layout, explicit Send text and labelled mobile actions. History no longer squeezes the conversation or sits below the starting screen. Folder creation has a cancel action. Sources separates adding material from saved sources, provides search and readable readiness states, and keeps selection intact for the AI handoff. Institution lessons and invitations use a responsive two-column layout with a bounded invitation form. Settings and Help use the shared page frame; personal workspace copy differs from institution membership copy. The sidebar distinguishes administrators from teachers and avoids showing Individual while access is still loading. Library listings show saved captures or a clearly labelled model placeholder, and the opened model explains rotation, zoom and pins.

The follow-up verification covers 19 distinct desktop/keyboard/touch browser journeys across agent history, image failure recovery, sources/model annotations, institution roles, login/settings, navigation, public entry, marketplace theme, lesson sharing/study/recap and full-screen playground. BrowserOS Neo was also used to inspect the actual running app's desktop/mobile screens and native History dialog. AI regression fixtures exercise saved task/results UI; these checks do not establish live provider reliability. Web unit tests (32), targeted ESLint, TypeScript and the production build were also checked. No deployment is part of this UI pass.

## Annotation and presentation workflow — 26 November 2026

The initial Ask AI composer retains its roomy size. Saved conversations use a 64px input that can still be resized; its focus treatment is neutral grey instead of orange, with a visible container focus indicator.

Lesson annotations have an optional AI brief, a model/inspector layout on wide screens, actual decoded mesh choices, surface picking, last-surface-placement undo and numeric normalized X/Y/Z coordinates. Confirmation requires an actual decoded model part. Coordinates describe model space rather than physical measurements. AI annotation instructions request location, function, connections and educational relevance, cite supplied sources and preserve uncertainty. This changes the generation brief; it does not certify live model outputs as scientifically accurate.

Presentation defaults to manual advance with Previous/Next and arrow keys. Autoplay uses authored section durations, advances sections, highlights available annotations in explanatory/exploration/practice sections and stops at the end. Timer pause/resume preserves remaining time. Read aloud is opt-in, follows section text/automatic component focus, pauses with autoplay and cancels on navigation/unmount. It uses browser speech synthesis, not a new paid provider. Backgrounding pauses playback. Native fullscreen is requested on Start autoplay when supported; if rejected, the presentation fills the window and explains the fallback. Presenter tools reveal the outline, source details, speaker notes, answer keys and exports; these remain hidden from the default presentation.

Verification: 10 affected desktop/touch/keyboard browser journeys passed. Additional desktop/touch tests verify a solid model's surface placement, undo, exact coordinate save/reload, and timed playback/annotation focus/narration lifecycle without sending assessment events. The 10 annotation/composition worker tests, web/worker TypeScript checks, targeted ESLint and production web build passed. BrowserOS Neo verified the real annotation editor and manual/automatic presentation controls. Its live speech engine reported active speaking with available voices; audible output quality was not measured. Native fullscreen was rejected for the background automation tab, and the window-filling fallback was verified. Speech lifecycle tests use a deterministic speech stub; live AI output quality was not retested in this UI pass.
