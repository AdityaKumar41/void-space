/**
 * The AI subsystem as this service uses it (VS2-SRS-1.0 §7.5, FR-18.1).
 *
 * `@void-space/studio-ai` is where the provider controls live and it deliberately knows nothing about
 * this service. This module is the seam: it turns configuration into a client, enforces the two gates
 * that are *not* the package's business (is a provider configured at all, and may this tenant use this
 * feature), and holds the two pieces of state that have to outlive a single request.
 *
 * Three decisions here are load-bearing, and each one is a mistake that would look like it worked:
 *
 *   1. **The rate limiter is per process, not per request.** §7.5's limit exists so one tenant's
 *      runaway loop cannot block another tenant's usage. A limiter constructed per request holds an
 *      empty window every time, so it would allow everything and still read as a configured control in
 *      a review — the worst kind of control, because it looks like protection.
 *
 *   2. **The invocation sink is per request.** §7.5 requires every request/response pair to be logged
 *      with its model and prompt-template version, and those columns live on the `CopilotMessage` row
 *      the call produced. A process-wide sink could not attribute an entry to a message, so the sink
 *      collects into memory and the route writes the entries onto the row it just created.
 *
 *   3. **No provider is a supported state, not an error.** §7.5 requires the whole editing toolset to
 *      work with every AI feature disabled, and FR-11.10 makes a completed audit a prerequisite for
 *      publishing. So `configured: false` degrades the audit to its deterministic measurements — which
 *      are what the score is computed from anyway — and refuses only the Copilot, in a sentence that
 *      names the variable to set.
 */
import {
  ClaudeClient,
  DEFAULT_AI_POLICY,
  FetchTransport,
  InMemoryInvocationSink,
  TenantRateLimiter,
  type AiPolicy,
  type HttpTransport,
} from '@void-space/studio-ai';
import { STUDIO_AI_FEATURES, type StudioAiFeature } from '@void-space/studio-engine';

import type { StudioApiEnv } from '../env';
import { UnavailableError } from './errors';

/**
 * The AI features a tenant may use, from its `aiFeatureFlags` row (FR-18.1).
 *
 * Only an explicit `false` disables a feature. That direction is deliberate: a flag this version does
 * not recognise, or a row written by a future version, must not silently switch off a capability the
 * tenant is paying for. The failure mode of a new feature being accidentally enabled is a tenant using
 * something; the failure mode of the opposite is a support ticket about a missing button.
 *
 * Returns `undefined` when nothing is disabled — the shape `ValidationContext` documents for "all
 * enabled". Returning the full list instead would behave identically today and break the day a fifth
 * feature ships without being added to every stored row.
 */
export function resolveTenantAiFeatures(flags: unknown): readonly StudioAiFeature[] | undefined {
  if (flags === null || typeof flags !== 'object' || Array.isArray(flags)) return undefined;

  const record = flags as Record<string, unknown>;
  const disabled = STUDIO_AI_FEATURES.filter((feature) => record[feature] === false);

  if (disabled.length === 0) return undefined;

  // An empty array is meaningful and must not collapse to `undefined`: every feature is off, so the
  // validator has to refuse feature-gated tools rather than read "no list" as "no restriction".
  return STUDIO_AI_FEATURES.filter((feature) => !disabled.includes(feature));
}

/** True when this tenant may use the feature (FR-18.1). */
export function tenantHasAiFeature(flags: unknown, feature: StudioAiFeature): boolean {
  const enabled = resolveTenantAiFeatures(flags);
  return enabled === undefined || enabled.includes(feature);
}

export interface StudioAi {
  /** Whether a provider credential is present. False is a supported deployment. */
  readonly configured: boolean;
  readonly model: string;
  /**
   * Builds a client whose §7.5 log goes to `sink`.
   *
   * Throws when no provider is configured, so a caller cannot obtain a client that would fail on its
   * first call with a provider error — the deployment gap is reported as a deployment gap.
   */
  claudeFor(sink: InMemoryInvocationSink): ClaudeClient;
  /** The refusal for a request when no provider is configured. */
  requireConfigured(feature: StudioAiFeature): void;
}

export interface StudioAiOptions {
  /** Injected so a suite can drive the real routes with no network. */
  readonly transport?: HttpTransport;
}

export function buildStudioAi(env: StudioApiEnv, options: StudioAiOptions = {}): StudioAi {
  const apiKey = env.ANTHROPIC_API_KEY;
  const configured = typeof apiKey === 'string' && apiKey.length > 0;
  const transport = options.transport ?? new FetchTransport();

  const policy: AiPolicy = {
    ...DEFAULT_AI_POLICY,
    timeoutMs: env.ANTHROPIC_TIMEOUT_MS,
    maxRequestsPerWindow: env.STUDIO_AI_RATE_LIMIT_PER_MINUTE,
    // Minutes, because the setting is expressed per minute. Held here rather than exposed as a second
    // environment variable: a window and a per-minute count can disagree, and then the configured
    // limit is not the limit anyone believes they set.
    windowMs: 60_000,
  };

  // One limiter for the process — see decision 1 in the file header.
  const limiter = new TenantRateLimiter(policy);

  return {
    configured,
    model: env.ANTHROPIC_MODEL,

    requireConfigured(feature: StudioAiFeature): void {
      if (configured) return;
      throw new UnavailableError(
        `The ${feature} feature needs an AI provider, and this Studio has none configured. ` +
          'Set ANTHROPIC_API_KEY to enable it. Everything else in the editor works without one — ' +
          'the pre-publish check still runs on its own measurements, and publishing is unaffected.',
        'AI_NOT_CONFIGURED',
        { missing: 'ANTHROPIC_API_KEY', feature },
      );
    },

    claudeFor(sink: InMemoryInvocationSink): ClaudeClient {
      if (!configured) {
        throw new UnavailableError(
          'No AI provider is configured, so no model call can be made.',
          'AI_NOT_CONFIGURED',
          { missing: 'ANTHROPIC_API_KEY' },
        );
      }

      return new ClaudeClient({
        apiKey: apiKey as string,
        transport,
        model: env.ANTHROPIC_MODEL,
        policy,
        sink,
        limiter,
      });
    },
  };
}
