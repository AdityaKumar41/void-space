# Platform next steps

The current product now has a usable learning loop: reviewed 3D asset, lesson,
interactive practice, field procedure, shared space, saved learner progress and
server-recorded assessment evidence. The public EON product catalogue was used as
an interaction reference only; this remains a native VOID·SPACE implementation.

The remaining work is real product scope, not UI polish:

1. **Physical simulation.** Add per-asset constraints, kinematics and authored
   failure states. The current scene can identify, separate, isolate and restore
   mesh components, but does not claim to simulate mechanics, electricity or
   safety-critical equipment behavior.
2. **Collaborative spatial sessions.** Replace polling with realtime fan-out,
   add facilitator controls and allow deliberate shared object manipulation.
   Existing room presence and individual experience progress are working.
3. **AR and headset delivery.** Add capability checks, hit testing, placement,
   interaction mapping and device QA. The browser viewer is not WebAR.
4. **Document-to-curriculum ingestion.** Extract supported SOP/PDF content,
   require author review and preserve source citations. AI use must retain the
   configured provider and payload controls.
5. **Independent credentials.** Current credentials verify application evidence.
   Add a credential contract and issuance/reconciliation service before calling
   them on-chain credentials.
6. **Payments and analytics.** Add order/entitlement settlement and evidence-based
   cohort analytics before presenting marketplace or completion metrics as commercial
   production features.

The priority is intentionally sequenced: physical practice and collaborative
delivery precede new categories of content. Each item needs its own acceptance
tests and should be released only when its real behavior is available to learners.
