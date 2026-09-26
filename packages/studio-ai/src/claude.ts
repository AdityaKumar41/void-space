/**
 * The Claude Messages client (VS2-SRS-1.0 §7.2, §7.5).
 *
 * One method, `createMessage`, wraps every provider call in the four §7.5 controls — rate limit,
 * hard timeout, bounded retry, redaction and invocation logging — so that no caller can perform an
 * AI call that skips them. That is the point of a client rather than a helper: the controls are
 * structural, not conventional.
 *
 * The Messages endpoint is used directly rather than through an SDK. See `transport.ts` for why.
 */
import {
  AiProviderError,
  classifyStatus,
  type HttpTransport,
  type TransportResponse,
} from './transport';
import {
  DEFAULT_AI_POLICY,
  NullInvocationSink,
  TenantRateLimiter,
  isFeatureEnabled,
  redactForProvider,
  withTimeout,
  type AiInvocationLog,
  type AiInvocationSink,
  type AiPolicy,
  type SensitiveKind,
  type StudioAiFeature,
} from './policy';

export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * The model, pinned to a dated snapshot.
 *
 * A floating alias would mean the Copilot's behaviour changes without a commit, which makes §7.5's
 * reproducibility guarantee hollow: a stored `CopilotMessage` would not be replayable, because the
 * model behind the name moved.
 */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';

/** Request/response shapes, limited to the parts this product uses. */
export type ClaudeContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | {
      readonly type: 'tool_result';
      readonly tool_use_id: string;
      readonly content: string;
      readonly is_error?: boolean;
    };

export interface ClaudeMessage {
  readonly role: 'user' | 'assistant';
  readonly content: readonly ClaudeContentBlock[];
}

export type ClaudeStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';

export interface ClaudeToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

export interface ClaudeMessageResponse {
  readonly id: string;
  readonly model: string;
  readonly content: readonly ClaudeContentBlock[];
  readonly stopReason: ClaudeStopReason | null;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

export interface ClaudeMessageRequest {
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly feature: StudioAiFeature;
  readonly promptVersion: string;
  readonly system: string;
  readonly messages: readonly ClaudeMessage[];
  readonly tools?: readonly ClaudeToolDefinition[] | undefined;
  readonly maxTokens: number;
  readonly temperature?: number | undefined;
}

export interface ClaudeClientOptions {
  readonly apiKey: string;
  readonly transport: HttpTransport;
  readonly model?: string;
  readonly policy?: AiPolicy;
  readonly sink?: AiInvocationSink;
  readonly limiter?: TenantRateLimiter;
  readonly baseUrl?: string;
  /** Injected for deterministic retry tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Narrows an unknown content array to blocks we can act on, rejecting anything else. */
function parseContent(value: unknown): readonly ClaudeContentBlock[] {
  if (!Array.isArray(value)) {
    throw new AiProviderError('anthropic', 'MALFORMED_RESPONSE', '`content` was not an array');
  }

  const blocks: ClaudeContentBlock[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') continue;
    const block = raw as Record<string, unknown>;
    const type = block['type'];

    if (type === 'text' && typeof block['text'] === 'string') {
      blocks.push({ type: 'text', text: block['text'] });
    } else if (type === 'tool_use' && typeof block['name'] === 'string') {
      blocks.push({
        type: 'tool_use',
        id: typeof block['id'] === 'string' ? block['id'] : `call_${blocks.length}`,
        name: block['name'],
        input: block['input'],
      });
    }
    // Any other block type is skipped rather than fatal. Anthropic adds block kinds over time
    // (thinking, citations); failing the whole instruction because the provider is newer than this
    // client would be a worse outcome than ignoring a block nothing here consumes.
  }

  return blocks;
}

export class ClaudeClient {
  private readonly apiKey: string;
  private readonly transport: HttpTransport;
  private readonly model: string;
  private readonly policy: AiPolicy;
  private readonly sink: AiInvocationSink;
  private readonly limiter: TenantRateLimiter;
  private readonly baseUrl: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ClaudeClientOptions) {
    if (!options.apiKey) throw new Error('ClaudeClient requires an apiKey');
    this.apiKey = options.apiKey;
    this.transport = options.transport;
    this.model = options.model ?? DEFAULT_CLAUDE_MODEL;
    this.policy = options.policy ?? DEFAULT_AI_POLICY;
    this.sink = options.sink ?? new NullInvocationSink();
    this.limiter = options.limiter ?? new TenantRateLimiter(this.policy);
    this.baseUrl = options.baseUrl ?? ANTHROPIC_API_URL;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * The iteration ceiling the Copilot loop should use (§7.2, §7.5).
   *
   * Exposed so the configured policy actually governs the loop. Without it the loop had to reach for
   * the package default and a caller who tightened `maxCopilotIterations` on this client silently got
   * the looser one — a cost control that does nothing is worse than no control, because it looks like
   * one.
   */
  get copilotIterationLimit(): number {
    return this.policy.maxCopilotIterations;
  }

  /**
   * One Messages call, with every §7.5 control applied.
   *
   * Order matters and is deliberate: the feature check comes first (a disabled feature should not
   * consume rate-limit budget), then the rate limit, then the loop that owns the timeout, retry and
   * logging. Checking the rate limit before the feature flag would let a tenant's disabled features
   * exhaust the budget for its enabled ones.
   */
  async createMessage(request: ClaudeMessageRequest): Promise<ClaudeMessageResponse> {
    if (!isFeatureEnabled(this.policy, request.feature)) {
      throw new AiProviderError(
        'anthropic',
        'INVALID_REQUEST',
        `The "${request.feature}" AI feature is disabled for this workspace (FR-18.1).`,
      );
    }

    const decision = this.limiter.check(request.tenantId);
    if (!decision.allowed) {
      throw new AiProviderError(
        'anthropic',
        'RATE_LIMITED',
        `Too many AI requests for this workspace. Try again in ${Math.ceil(decision.retryAfterMs / 1000)}s.`,
        { status: 429 },
      );
    }

    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    let redacted: readonly SensitiveKind[] = [];
    let attempt = 0;

    // Retry loop. `maxRetries` is a count of *additional* attempts, so 2 means at most 3 calls.
    for (;;) {
      attempt += 1;
      try {
        const response = await this.attempt(request, (kinds) => {
          redacted = kinds;
        });
        this.record({
          request,
          startedAt,
          durationMs: Date.now() - startedAtMs,
          ok: true,
          redacted,
          usage: response.usage,
          // The model that *answered*, not the one requested. A provider can route to a different
          // snapshot than the alias resolved to, and §7.5's reproducibility guarantee is about what
          // actually produced the response.
          model: response.model,
        });
        return response;
      } catch (err) {
        const failure =
          err instanceof AiProviderError
            ? err
            : new AiProviderError('anthropic', 'TRANSPORT', (err as Error).message);

        const canRetry = failure.isRetryable && attempt <= this.policy.maxRetries;
        if (!canRetry) {
          this.record({
            request,
            startedAt,
            durationMs: Date.now() - startedAtMs,
            ok: false,
            redacted,
            failureKind: failure.kind,
          });
          throw failure;
        }

        // Exponential backoff, capped. A provider that is rate limiting us should be given more room
        // on each attempt; an uncapped doubling would exceed the job's own timeout on attempt four.
        const delay = Math.min(this.policy.backoffBaseMs * 2 ** (attempt - 1), this.policy.maxBackoffMs);
        await this.sleep(delay);
      }
    }
  }


  /**
   * A single attempt, including redaction and the hard timeout.
   *
   * Separate from `createMessage` so the retry loop above reads as a retry loop. The abort signal is
   * created inside `withTimeout` and passed all the way into the transport, which is what makes the
   * timeout cancel the actual request rather than merely stop waiting for it.
   */
  private async attempt(
    request: ClaudeMessageRequest,
    onRedacted: (kinds: readonly SensitiveKind[]) => void,
  ): Promise<ClaudeMessageResponse> {
    const payload = {
      model: this.model,
      max_tokens: request.maxTokens,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      system: request.system,
      messages: request.messages,
      ...(request.tools === undefined ? {} : { tools: request.tools }),
    };

    // Redaction runs on the whole outgoing payload, not just the instruction, because the scene
    // summary carries Creator-authored object names and the tool results carry model output that may
    // echo them back (§7.5).
    const { value: safePayload, redacted } = redactForProvider(payload);
    onRedacted(redacted);

    const response = await withTimeout(
      this.policy.timeoutMs,
      `Claude ${request.feature} call`,
      (signal) =>
        this.transport.request({
          url: this.baseUrl,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(safePayload),
          signal,
        }),
    );

    return this.parseResponse(response);
  }

  /** Validates the envelope, then maps it onto the narrower shape the rest of the package uses. */
  private parseResponse(response: TransportResponse): ClaudeMessageResponse {
    if (response.status < 200 || response.status >= 300) {
      const body = response.body as { error?: { message?: string } } | undefined;
      throw new AiProviderError(
        'anthropic',
        classifyStatus(response.status),
        body?.error?.message ?? `Claude returned ${response.status}`,
        { status: response.status, details: response.body },
      );
    }

    const body = response.body as Record<string, unknown> | undefined;
    if (body === undefined || typeof body !== 'object') {
      throw new AiProviderError('anthropic', 'MALFORMED_RESPONSE', 'Response body was not an object');
    }

    const usage = (body['usage'] ?? {}) as Record<string, unknown>;
    const stopReason = body['stop_reason'];

    return {
      id: typeof body['id'] === 'string' ? body['id'] : 'unknown',
      model: typeof body['model'] === 'string' ? body['model'] : this.model,
      content: parseContent(body['content']),
      stopReason: typeof stopReason === 'string' ? (stopReason as ClaudeStopReason) : null,
      usage: {
        inputTokens: typeof usage['input_tokens'] === 'number' ? usage['input_tokens'] : 0,
        outputTokens: typeof usage['output_tokens'] === 'number' ? usage['output_tokens'] : 0,
      },
    };
  }

  /** Writes one invocation to the sink (§7.5). Never throws: logging must not fail the work. */
  private record(input: {
    readonly request: ClaudeMessageRequest;
    readonly startedAt: string;
    readonly durationMs: number;
    readonly ok: boolean;
    readonly redacted: readonly SensitiveKind[];
    readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number };
    readonly failureKind?: string;
    /** The model the provider reported. Falls back to the configured one when the call failed. */
    readonly model?: string;
  }): void {
    const entry: AiInvocationLog = {
      tenantId: input.request.tenantId,
      userId: input.request.userId,
      feature: input.request.feature,
      provider: 'anthropic',
      model: input.model ?? this.model,
      promptVersion: input.request.promptVersion,
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      ok: input.ok,
      ...(input.failureKind === undefined ? {} : { failureKind: input.failureKind }),
      ...(input.usage === undefined ? {} : { usage: input.usage }),
      redacted: input.redacted,
    };

    try {
      this.sink.record(entry);
    } catch {
      // A sink that throws — a full disk, a closed connection — must not turn a successful Copilot
      // instruction into a failure. The work is the tool calls; the log describes it.
    }
  }
}

