/**
 * @void-space/studio-engine — VOID·STUDIO's framework-agnostic authoring core
 * (VS2-SRS-1.0 §3.3, §3.7).
 *
 * §3.7 requires this package to have **no dependency on Next.js or Fastify**, and it holds: the only
 * imports are `zod` and `@void-space/types`. That is what lets the Editor Engine, the Studio API and
 * the BullMQ workers share one definition of the Copilot's tools, the audit's scoring and the publish
 * gate, instead of each keeping its own copy that drifts.
 */
export * from './copilot';
export * from './audit';
export * from './publish';
