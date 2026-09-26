/**
 * @void-space/studio-ai — VOID·STUDIO's AI subsystem (VS2-SRS-1.0 §7).
 *
 * Three capabilities, all of them `AI proposes, the command system applies` (§7.1):
 *
 *   - **Copilot** — `runCopilot` runs the Claude tool-use loop over the closed editor tool catalogue
 *     (§7.2), validating every call (FR-11.3) and never touching the scene document itself.
 *   - **Readiness audit** — `runReadinessAudit` scores an export candidate before publish (§7.3).
 *   - **Generative tools** — `MeshyClient` for text/image-to-3D and text-to-texture (§7.4).
 *
 * Every provider call goes through `ClaudeClient` or `MeshyClient`, which are the only places the
 * §7.5 controls — per-tenant rate limit, hard timeout, redaction, invocation logging — are applied.
 * That is why no module here exposes a way to reach a provider directly.
 */
export * from './policy';
export * from './transport';
export * from './claude';
export * from './copilot';
export * from './audit';
export * from './meshy';
