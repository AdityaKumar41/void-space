/**
 * The cost and safety controls every AI call passes through (VS2-SRS-1.0 §7.5).
 *
 * §7.5 is four rules, and all four are implemented here rather than at each call site, because a
 * control that has to be remembered is a control that will be forgotten on the next endpoint:
 *
 *   1. **"Every AI call runs as a job with a per-tenant rate limit and a hard timeout, so a runaway
 *      or slow request cannot block the editor or another tenant's usage."** See `TenantRateLimiter`
 *      and `withTimeout`.
 *   2. **"A TenantAdmin can disable any individual AI feature tenant-wide (FR-18.1), and the entire
 *      modeling/editing toolset functions with all AI features disabled."** See `STUDIO_AI_FEATURES`
 *      and `isFeatureEnabled`. Nothing in `@void-space/studio-engine` sits behind a flag — only the
 *      four entries below do — which is what makes the second half of that sentence true.
 *   3. **"Prompts sent to Claude or Meshy MUST NOT include end-user credentials, tokens, or PII
 *      beyond what is strictly necessary."** See `redactForProvider`.
 *   4. **"All AI request/response pairs are logged with model/prompt-template version."** See
 *      `AiInvocationLog`. `PROMPT_VERSIONS` is the template half; the model half is per-call.
 */

/**
 * The AI capabilities a tenant can switch on or off (FR-18.1).
 *
 * Imported and re-exported rather than redeclared: this was two unions with one name, and the type
 * error that produced is the reason it is now one. See the note on `STUDIO_AI_FEATURES` in
 * `@void-space/studio-engine`.
 */
import { STUDIO_AI_FEATURES, type StudioAiFeature } from '@void-space/studio-engine';

export { STUDIO_AI_FEATURES, type StudioAiFeature };

/** Labels for the admin console, kept beside the union so a new feature cannot ship unlabelled. */
export const STUDIO_AI_FEATURE_LABELS: Readonly<Record<StudioAiFeature, string>> = {
  copilot: 'Copilot (natural-language scene editing)',
  readinessAudit: 'Pre-publish readiness audit',
  generativeMesh: 'Generative mesh (text/image to 3D)',
  generativeTexture: 'Generative texture',
};

/**
 * Prompt-template versions (§7.5's "prompt-template version").
 *
 * Bumped whenever the *wording* of a prompt changes, because that is what makes a stored
 * `CopilotMessage` reproducible: two identical instructions against an identical scene can produce
 * different tool calls, and without this there is no way to tell a model change from a prompt change.
 */
export const PROMPT_VERSIONS = {
  copilotSystem: 'copilot.system.v1',
  copilotRepair: 'copilot.repair.v1',
  audit: 'audit.readiness.v1',
  meshyMesh: 'meshy.mesh.v1',
  meshyTexture: 'meshy.texture.v1',
} as const;

export interface AiPolicy {
  readonly enabledFeatures: readonly StudioAiFeature[];
  /** Window limit per tenant, per feature-independent call. */
  readonly maxRequestsPerWindow: number;
  readonly windowMs: number;
  /** Hard ceiling on a single provider call. §7.5's "hard timeout". */
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** Backoff base; the delay for attempt n is `baseMs * 2^n`, capped by `maxBackoffMs`. */
  readonly backoffBaseMs: number;
  readonly maxBackoffMs: number;
  /**
   * How many times the Copilot may call the model within one instruction (§7.2's tool-use loop).
   *
   * Bounded because a model that keeps requesting a tool without finishing would otherwise bill
   * indefinitely on one sentence. The loop is our code, so this is our responsibility to bound.
   */
  readonly maxCopilotIterations: number;
}

/**
 * Defaults sized for an interactive editor.
 *
 * The timeout is 60 s rather than something tighter because §7.2 asks the model to reason over a
 * scene summary and emit several tool calls; a 10 s ceiling would time out on exactly the
 * multi-object instructions the feature exists for. The rate limit is per minute and deliberately
 * generous — it exists to contain a runaway loop, not to ration a Creator's normal use.
 */
export const DEFAULT_AI_POLICY: AiPolicy = {
  enabledFeatures: STUDIO_AI_FEATURES,
  maxRequestsPerWindow: 30,
  windowMs: 60_000,
  timeoutMs: 60_000,
  maxRetries: 2,
  backoffBaseMs: 400,
  maxBackoffMs: 5_000,
  maxCopilotIterations: 6,
};

export function isFeatureEnabled(policy: AiPolicy, feature: StudioAiFeature): boolean {
  return policy.enabledFeatures.includes(feature);
}

export type RateLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterMs: number };

/**
 * A per-tenant sliding-window limiter.
 *
 * Per **tenant**, not per user, and not global: §7.5's stated purpose is that one tenant's runaway
 * request "cannot block … another tenant's usage", which a global limiter would fail to deliver — a
 * single tenant looping would consume everyone's budget.
 *
 * The clock is injected so the window can be tested without waiting a real minute.
 */
export class TenantRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly policy: AiPolicy;
  private readonly now: () => number;

  constructor(policy: AiPolicy = DEFAULT_AI_POLICY, now: () => number = Date.now) {
    this.policy = policy;
    this.now = now;
  }

  check(tenantId: string): RateLimitDecision {
    const current = this.now();
    const windowStart = current - this.policy.windowMs;
    const recent = (this.hits.get(tenantId) ?? []).filter((at) => at > windowStart);

    if (recent.length >= this.policy.maxRequestsPerWindow) {
      // The oldest hit in the window is the one that frees a slot, so that is when to try again.
      const oldest = recent[0] ?? current;
      this.hits.set(tenantId, recent);
      return { allowed: false, retryAfterMs: Math.max(0, oldest + this.policy.windowMs - current) };
    }

    recent.push(current);
    this.hits.set(tenantId, recent);
    return { allowed: true };
  }

  /** Recorded hits for a tenant — a test seam and a debugging aid, not a production query. */
  inspect(tenantId: string): readonly number[] {
    return [...(this.hits.get(tenantId) ?? [])];
  }
}

/** Raised when a provider call exceeds its policy ceiling. Distinct so a caller can tell it apart. */
export class AiTimeoutError extends Error {
  constructor(what: string, timeoutMs: number) {
    super(`${what} did not complete within ${timeoutMs}ms`);
    this.name = 'AiTimeoutError';
  }
}

/**
 * Runs `work` under a **hard** timeout.
 *
 * §7.5 says "a hard timeout", and the distinction from a soft one is what this implementation is
 * about. A version that only aborts the signal and awaits `work` relies on the work cooperating:
 * a provider client that ignores the signal — or a promise that simply never settles — hangs the job
 * rather than failing it, which is the opposite of a ceiling. So the work is *raced* against the
 * abort, guaranteeing a rejection even when the work never notices.
 *
 * The signal is still created here and handed down, because cancelling the promise without cancelling
 * the request leaves an open socket and a provider still generating (and billing for) a completion
 * nobody will read. The race is the guarantee; the signal is the courtesy.
 */
export async function withTimeout<T>(
  timeoutMs: number,
  what: string,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new AiTimeoutError(what, timeoutMs)),
          { once: true },
        );
      }),
    ]);
  } catch (err) {
    // A client that *does* observe the signal surfaces an abort as a DOMException named 'AbortError'.
    // Translating it here means callers never have to distinguish "the provider refused" from "we gave
    // up waiting" — the two arrive as the same error type.
    if ((err as Error)?.name === 'AbortError') throw new AiTimeoutError(what, timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** The classes of value that must never leave for a provider (§7.5). */
export const SENSITIVE_KINDS = ['bearerToken', 'apiKey', 'jwt', 'email', 'connectionString'] as const;
export type SensitiveKind = (typeof SENSITIVE_KINDS)[number];

/**
 * The patterns, ordered most-specific first.
 *
 * `jwt` before `apiKey` matters: a JWT is `xxx.yyy.zzz` and an API-key pattern that matched on
 * `[A-Za-z0-9_-]{20,}` alone would consume the first segment of a JWT and leave the rest in the
 * prompt. Ordering is the fix, not a longer single expression.
 */
const REDACTION_PATTERNS: readonly { readonly kind: SensitiveKind; readonly pattern: RegExp }[] = [
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { kind: 'bearerToken', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi },
  { kind: 'apiKey', pattern: /\b(?:sk|vs|pk|api)[_-][A-Za-z0-9]{12,}\b/gi },
  // Connection strings carry a password in the authority section.
  { kind: 'connectionString', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@/gi },
  { kind: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
];

export interface RedactionResult {
  /** The value with every match replaced by `[redacted:<kind>]`. */
  readonly value: unknown;
  /** Which kinds were actually found — empty means the payload was clean. */
  readonly redacted: readonly SensitiveKind[];
}

/**
 * Recursively replaces credential-shaped and PII-bearing substrings.
 *
 * Redacts rather than rejects, and that is a deliberate choice: a scene summary containing an object
 * a Creator named after their email is not an attack, and throwing would make the Copilot refuse a
 * legitimate instruction for a reason the Creator cannot see or fix. The replacement is *labelled*
 * (`[redacted:email]`) so the model understands something was removed rather than reasoning about an
 * empty string.
 *
 * It does **not** replace the caller's own legitimate content. A `TENANT_SUSPECTED` naming rule
 * would remove words the Creator typed; these patterns only match values that could not be prose.
 */
export function redactForProvider(value: unknown, found = new Set<SensitiveKind>()): RedactionResult {
  if (typeof value === 'string') {
    let out = value;
    for (const { kind, pattern } of REDACTION_PATTERNS) {
      if (pattern.test(out)) {
        found.add(kind);
        // `lastIndex` is stateful on a /g regex; resetting before every use is what keeps a shared
        // module-level pattern from skipping matches on alternating calls.
        pattern.lastIndex = 0;
        out = out.replace(pattern, `[redacted:${kind}]`);
      }
      pattern.lastIndex = 0;
    }
    return { value: out, redacted: [...found] };
  }

  if (Array.isArray(value)) {
    const mapped = value.map((entry) => redactForProvider(entry, found).value);
    return { value: mapped, redacted: [...found] };
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactForProvider(entry, found).value;
    }
    return { value: out, redacted: [...found] };
  }

  return { value, redacted: [...found] };
}

/**
 * One logged AI exchange (§7.5).
 *
 * Carries both versions §7.5 names — `model` and `promptVersion` — because a stored message is only
 * reproducible if you can tell which of the two changed since it was written.
 */
export interface AiInvocationLog {
  readonly tenantId: string;
  readonly userId?: string;
  readonly feature: StudioAiFeature;
  readonly provider: 'anthropic' | 'meshy';
  readonly model: string;
  readonly promptVersion: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly ok: boolean;
  readonly failureKind?: string;
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number };
  /** Non-empty when redaction altered the outgoing payload. */
  readonly redacted: readonly SensitiveKind[];
}

/**
 * Where invocation logs go.
 *
 * An interface rather than a `console.log` so the API can write `CopilotMessage` rows (§5) and a test
 * can assert on what would have been recorded. §7.5 makes this a requirement, so it is a parameter
 * rather than a side effect buried in the client.
 */
export interface AiInvocationSink {
  record(entry: AiInvocationLog): void;
}

/** Discards logs. The honest default for a pure unit test; never the default in a deployed service. */
export class NullInvocationSink implements AiInvocationSink {
  record(): void {
    // Intentionally empty — see the doc comment. A deployed Studio must pass a real sink.
  }
}

/** Collects logs in memory. For tests, and for a caller that wants to flush them itself. */
export class InMemoryInvocationSink implements AiInvocationSink {
  readonly entries: AiInvocationLog[] = [];

  record(entry: AiInvocationLog): void {
    this.entries.push(entry);
  }
}

