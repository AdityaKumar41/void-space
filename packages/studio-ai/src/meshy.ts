/**
 * Meshy AI — the generative content tools (VS2-SRS-1.0 §7.4, FR-11.6–11.7).
 *
 * §7.4 lists three tools and, for each, a review pattern. The review pattern is the part that matters
 * here: every tool returns *proposals*, and nothing in this module marks generated content as
 * accepted. A generated mesh is inserted as a tagged draft the Creator edits or accepts, and a
 * generated texture set is assigned as a proposed material — mirroring VS-SRS-2.0's
 * suggestion/acceptance flow (FR-7.5), which §7.4 explicitly reuses.
 *
 * Every call goes through the same §7.5 controls as the Copilot: per-tenant rate limit, hard timeout,
 * bounded retry, redaction and invocation logging. That is why this is a class with a shared private
 * `send` rather than a set of free functions — a metered third-party call must not have a path that
 * skips the budget.
 */
import { AiProviderError, classifyStatus, type HttpTransport } from './transport';
import {
  DEFAULT_AI_POLICY,
  NullInvocationSink,
  PROMPT_VERSIONS,
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

export const MESHY_API_BASE = 'https://api.meshy.ai';

/** The two generation endpoints this product uses, by task kind. */
export type MeshyTaskKind = 'text-to-3d' | 'image-to-3d' | 'text-to-texture';

const TASK_PATHS: Readonly<Record<MeshyTaskKind, string>> = {
  'text-to-3d': '/openapi/v2/text-to-3d',
  'image-to-3d': '/openapi/v1/image-to-3d',
  'text-to-texture': '/openapi/v1/text-to-texture',
};

const FEATURE_FOR_KIND: Readonly<Record<MeshyTaskKind, StudioAiFeature>> = {
  'text-to-3d': 'generativeMesh',
  'image-to-3d': 'generativeMesh',
  'text-to-texture': 'generativeTexture',
};

export type MeshyTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

export interface MeshyTask {
  readonly id: string;
  readonly kind: MeshyTaskKind;
  readonly status: MeshyTaskStatus;
  /** 0–100, as the provider reports it. */
  readonly progress: number;
  /** Geometry URL (`glb`/`fbx`/`usdz`) for a mesh task; the texture set for a texture task. */
  readonly resultUrls: Readonly<Record<string, string>>;
  readonly thumbnailUrl: string | null;
  /** Present when `status` is `FAILED`. */
  readonly error: string | null;
}

/** §7.5 requires a hard timeout per call, and generation is long. This is the *call*, not the task. */
const CREATE_TIMEOUT_MULTIPLIER = 2;

export interface MeshyClientOptions {
  readonly apiKey: string;
  readonly transport: HttpTransport;
  readonly policy?: AiPolicy;
  readonly sink?: AiInvocationSink;
  readonly limiter?: TenantRateLimiter;
  readonly baseUrl?: string;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface MeshGenerationRequest {
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly kind: 'text-to-3d' | 'image-to-3d';
  /** Required for `text-to-3d`; omitted for `image-to-3d`. */
  readonly prompt?: string | undefined;
  /** Required for `image-to-3d`: a content reference, never a raw blob (§7.5). */
  readonly imageUrl?: string | undefined;
  /** §7.4's "target use" — the caller passes the tenant's XR budget, not the model. */
  readonly targetPolycount?: number | undefined;
  readonly artStyle?: 'realistic' | 'sculpture' | undefined;
}

export interface TextureGenerationRequest {
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly prompt: string;
  /** The mesh the texture is for. */
  readonly modelUrl: string;
  readonly resolution?: 512 | 1024 | 2048 | 4096 | undefined;
}

/** Maps a provider status string onto the union, defaulting to IN_PROGRESS for anything unknown. */
function parseStatus(value: unknown): MeshyTaskStatus {
  const known: readonly MeshyTaskStatus[] = ['PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELED'];
  return typeof value === 'string' && (known as readonly string[]).includes(value)
    ? (value as MeshyTaskStatus)
    : 'IN_PROGRESS';
}

/** Terminal states. `PENDING` and `IN_PROGRESS` are the ones worth polling. */
function isSettled(status: MeshyTaskStatus): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELED';
}

export class MeshyClient {
  private readonly apiKey: string;
  private readonly transport: HttpTransport;
  private readonly policy: AiPolicy;
  private readonly sink: AiInvocationSink;
  private readonly limiter: TenantRateLimiter;
  private readonly baseUrl: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: MeshyClientOptions) {
    if (!options.apiKey) throw new Error('MeshyClient requires an apiKey');
    this.apiKey = options.apiKey;
    this.transport = options.transport;
    this.policy = options.policy ?? DEFAULT_AI_POLICY;
    this.sink = options.sink ?? new NullInvocationSink();
    this.limiter = options.limiter ?? new TenantRateLimiter(this.policy);
    this.baseUrl = options.baseUrl ?? MESHY_API_BASE;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Submits a text-to-3D or image-to-3D task (§7.4) and returns the provider's task id. */
  async createMeshTask(request: MeshGenerationRequest): Promise<string> {
    if (request.kind === 'text-to-3d' && !request.prompt) {
      throw new AiProviderError('meshy', 'INVALID_REQUEST', 'text-to-3d requires a prompt');
    }
    if (request.kind === 'image-to-3d' && !request.imageUrl) {
      throw new AiProviderError('meshy', 'INVALID_REQUEST', 'image-to-3d requires an imageUrl');
    }

    const payload: Record<string, unknown> = {
      // `preview` then refine is Meshy's own two-stage flow. The Studio submits preview and lets the
      // Creator decide whether the result is worth a refine, because refine is the expensive half.
      mode: 'preview',
      ...(request.prompt === undefined ? {} : { prompt: request.prompt }),
      ...(request.imageUrl === undefined ? {} : { image_url: request.imageUrl }),
      ...(request.artStyle === undefined ? {} : { art_style: request.artStyle }),
      ...(request.targetPolycount === undefined ? {} : { target_polycount: request.targetPolycount }),
    };

    return await this.submit(request.kind, {
      tenantId: request.tenantId,
      userId: request.userId,
      promptVersion: PROMPT_VERSIONS.meshyMesh,
      payload,
      statusMessage: 'Task creation returned no task id',
    });
  }

  /** Submits a text-to-texture task (§7.4, FR-11.7). */
  async createTextureTask(request: TextureGenerationRequest): Promise<string> {
    if (!request.prompt) {
      throw new AiProviderError('meshy', 'INVALID_REQUEST', 'text-to-texture requires a prompt');
    }

    return await this.submit('text-to-texture', {
      tenantId: request.tenantId,
      userId: request.userId,
      promptVersion: PROMPT_VERSIONS.meshyTexture,
      payload: {
        prompt: request.prompt,
        model_url: request.modelUrl,
        ...(request.resolution === undefined ? {} : { resolution: request.resolution }),
      },
      statusMessage: 'Task creation returned no task id',
    });
  }


  /** Reads a task's current state. */
  async getTask(kind: MeshyTaskKind, taskId: string): Promise<MeshyTask> {
    const response = await this.transport.request({
      url: `${this.baseUrl}${TASK_PATHS[kind]}/${encodeURIComponent(taskId)}`,
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${this.apiKey}` },
      // `AbortSignal.timeout` rather than `withTimeout`: a poll has no work to cancel beyond the
      // request itself, and it should not be recorded as an AI invocation.
      signal: AbortSignal.timeout(this.policy.timeoutMs),
    });

    if (response.status < 200 || response.status >= 300) {
      throw new AiProviderError(
        'meshy',
        classifyStatus(response.status),
        `Meshy returned ${response.status}`,
        { status: response.status, details: response.body },
      );
    }

    const body = (response.body ?? {}) as Record<string, unknown>;
    const resultUrls = (body['model_urls'] ?? body['texture_urls'] ?? {}) as Record<string, string>;

    return {
      id: taskId,
      kind,
      status: parseStatus(body['status']),
      progress: typeof body['progress'] === 'number' ? body['progress'] : 0,
      resultUrls,
      thumbnailUrl: typeof body['thumbnail_url'] === 'string' ? body['thumbnail_url'] : null,
      error: typeof body['task_error'] === 'string' ? body['task_error'] : null,
    };
  }

  /**
   * Polls until the task settles, or the budget runs out.
   *
   * Returns the last observed state rather than throwing on timeout, for the same reason
   * `waitForAssetStatus` does in `@void-space/voidspace-client`: "still generating after N minutes" is
   * information a progress panel can show, whereas an exception would be discarded by a UI that has
   * nothing better to display.
   */
  async waitForTask(
    kind: MeshyTaskKind,
    taskId: string,
    options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {},
  ): Promise<MeshyTask> {
    const timeoutMs = options.timeoutMs ?? 5 * 60_000;
    const intervalMs = options.intervalMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;

    let task = await this.getTask(kind, taskId);
    while (!isSettled(task.status) && Date.now() < deadline) {
      await this.sleep(intervalMs);
      task = await this.getTask(kind, taskId);
    }
    return task;
  }

  /** Creates a task and returns its id, with every §7.5 control applied. */
  private async submit(
    kind: MeshyTaskKind,
    input: {
      readonly tenantId: string;
      readonly userId?: string | undefined;
      readonly promptVersion: string;
      readonly payload: Record<string, unknown>;
      readonly statusMessage: string;
    },
  ): Promise<string> {
    const body = await this.send({
      kind,
      tenantId: input.tenantId,
      userId: input.userId,
      promptVersion: input.promptVersion,
      payload: input.payload,
    });

    const id = body['result'] ?? body['id'];
    if (typeof id !== 'string') {
      throw new AiProviderError('meshy', 'MALFORMED_RESPONSE', input.statusMessage, { details: body });
    }
    return id;
  }


  /**
   * The one path a metered Meshy call can take.
   *
   * Feature flag, then rate limit, then redaction, then a timed attempt with bounded retry, then a
   * log entry — the same order, and the same reasoning, as `ClaudeClient.createMessage`. Duplicated
   * rather than shared: the two clients differ in payload and response shape, and an abstraction over
   * "two things that are similar" would be harder to read than either of them.
   */
  private async send(input: {
    readonly kind: MeshyTaskKind;
    readonly tenantId: string;
    readonly userId?: string | undefined;
    readonly promptVersion: string;
    readonly payload: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const feature = FEATURE_FOR_KIND[input.kind];

    if (!isFeatureEnabled(this.policy, feature)) {
      throw new AiProviderError(
        'meshy',
        'INVALID_REQUEST',
        `The "${feature}" AI feature is disabled for this workspace (FR-18.1).`,
      );
    }

    const decision = this.limiter.check(input.tenantId);
    if (!decision.allowed) {
      throw new AiProviderError(
        'meshy',
        'RATE_LIMITED',
        `Too many AI requests for this workspace. Try again in ${Math.ceil(decision.retryAfterMs / 1000)}s.`,
        { status: 429 },
      );
    }

    const { value: safePayload, redacted } = redactForProvider(input.payload);
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();

    // Generation gets more headroom than a poll. Meshy's *submission* is quick, but its first response
    // can wait on queueing, and the same `timeoutMs` that correctly bounds a status read would
    // abandon a legitimate submission on a busy provider. The polling ceiling lives in `waitForTask`,
    // which is where a slow generation is actually absorbed.
    const timeoutMs = this.policy.timeoutMs * CREATE_TIMEOUT_MULTIPLIER;

    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        const response = await withTimeout(timeoutMs, `Meshy ${input.kind} call`, (signal) =>
            this.transport.request({
              url: `${this.baseUrl}${TASK_PATHS[input.kind]}`,
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                accept: 'application/json',
                authorization: `Bearer ${this.apiKey}`,
              },
              body: JSON.stringify(safePayload),
              signal,
            }),
        );

        if (response.status < 200 || response.status >= 300) {
          const body = response.body as { message?: string } | undefined;
          throw new AiProviderError(
            'meshy',
            classifyStatus(response.status),
            body?.message ?? `Meshy returned ${response.status}`,
            { status: response.status, details: response.body },
          );
        }

        this.record(input, startedAt, Date.now() - startedAtMs, true, redacted);
        return (response.body ?? {}) as Record<string, unknown>;
      } catch (err) {
        const failure =
          err instanceof AiProviderError
            ? err
            : new AiProviderError('meshy', 'TRANSPORT', (err as Error).message);

        if (!failure.isRetryable || attempt > this.policy.maxRetries) {
          this.record(input, startedAt, Date.now() - startedAtMs, false, redacted, failure.kind);
          throw failure;
        }

        await this.sleep(
          Math.min(this.policy.backoffBaseMs * 2 ** (attempt - 1), this.policy.maxBackoffMs),
        );
      }
    }
  }

  /** Writes one invocation to the sink (§7.5). Never throws. */
  private record(
    input: {
      readonly tenantId: string;
      readonly userId?: string | undefined;
      readonly kind: MeshyTaskKind;
      readonly promptVersion: string;
    },
    startedAt: string,
    durationMs: number,
    ok: boolean,
    redacted: readonly SensitiveKind[],
    failureKind?: string,
  ): void {
    const entry: AiInvocationLog = {
      tenantId: input.tenantId,
      userId: input.userId,
      feature: FEATURE_FOR_KIND[input.kind],
      provider: 'meshy',
      // Meshy exposes no per-call model choice, so the task kind is the closest thing to a version it
      // has. Recorded rather than left blank, because §7.5 asks for reproducibility and an empty field
      // reproduces nothing.
      model: input.kind,
      promptVersion: input.promptVersion,
      startedAt,
      durationMs,
      ok,
      ...(failureKind === undefined ? {} : { failureKind }),
      redacted,
    };

    try {
      this.sink.record(entry);
    } catch {
      // A sink that throws must not turn a submitted generation into a failed one.
    }
  }
}

