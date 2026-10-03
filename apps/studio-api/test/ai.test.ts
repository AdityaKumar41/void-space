import './env';

import {
  InMemoryInvocationSink,
  runCopilot,
  type HttpTransport,
  type TransportRequest,
  type TransportResponse,
} from '@void-space/studio-ai';
import { runReadinessAudit } from '@void-space/studio-ai';
import type { SceneSummary } from '@void-space/studio-engine';
import { describe, expect, it } from 'vitest';

import { resolveTenantAiFeatures, tenantHasAiFeature } from '../src/lib/ai';
import { summarizeInvocation, toolCallRecords } from '../src/modules/copilot';
import { buildTestApp } from './harness';

/**
 * The AI subsystem as this service drives it (§7.1–7.5, FR-11.1–11.5, FR-18.1).
 *
 * Everything here runs with **no network and no database**. The provider is a scripted transport, which
 * is the only way to assert §7.5's controls — a hard timeout and a bounded retry are not behaviours you
 * can verify against a real api.anthropic.com, and a suite that calls one fails when someone else's
 * deploy is slow.
 *
 * The authenticated Copilot routes are not driven over HTTP here, for the reason `harness.ts` records:
 * resolving a session reconciles the §5.1 identity mirror, which is a database write. What is asserted
 * instead is the real code path minus the transport layer — `app.ai.claudeFor(...)` feeding
 * `runCopilot(...)` — plus the rejection each route makes before it would reach a database. The suite
 * that needs rows is `copilot.integration.test.ts`, which is gated on a live database.
 */

/** A canned Anthropic Messages envelope. */
function anthropicReply(
  content: readonly Record<string, unknown>[],
  stopReason: 'tool_use' | 'end_turn',
): TransportResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: {
      id: 'msg_test',
      model: 'claude-sonnet-4-5-20250929',
      content,
      stop_reason: stopReason,
      usage: { input_tokens: 120, output_tokens: 40 },
    },
  };
}

/**
 * A transport that answers from a script and remembers what it was asked.
 *
 * Returning a 500 once the script is exhausted rather than repeating the last entry is deliberate: a
 * loop that unexpectedly iterates one more time should fail loudly instead of producing a second
 * identical answer that hides the extra round trip.
 */
class ScriptedTransport implements HttpTransport {
  readonly requests: TransportRequest[] = [];

  constructor(private readonly script: TransportResponse[]) {}

  async request(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request);
    const next = this.script.shift();
    if (next === undefined) {
      return { status: 500, headers: {}, body: { error: { message: 'script exhausted' } } };
    }
    return next;
  }

  /** The parsed JSON bodies this transport was sent, in order. */
  bodies(): Record<string, unknown>[] {
    return this.requests.map(
      (request) => JSON.parse(request.body ?? '{}') as Record<string, unknown>,
    );
  }
}

const SCENE: SceneSummary = {
  objects: [
    { id: 'obj-crate', name: 'Crate', type: 'mesh', childCount: 0, materialIds: ['mat-1'] },
  ],
  selection: [],
  unit: 'metre',
};

const AI_ENV = { ANTHROPIC_API_KEY: 'sk-ant-scripted' };

describe('FR-18.1 — a tenant’s enabled AI features', () => {
  it('treats an empty flag row as “everything enabled”', () => {
    // `undefined` rather than the full list: `ValidationContext` documents an absent list as "all
    // enabled", so returning a list would freeze today's four features into every stored row.
    expect(resolveTenantAiFeatures({})).toBeUndefined();
    expect(resolveTenantAiFeatures(null)).toBeUndefined();
    expect(resolveTenantAiFeatures('nonsense')).toBeUndefined();
  });

  it('disables only what is explicitly false', () => {
    const enabled = resolveTenantAiFeatures({ copilot: false });

    expect(enabled).toEqual(['readinessAudit', 'generativeMesh', 'generativeTexture']);
    expect(tenantHasAiFeature({ copilot: false }, 'copilot')).toBe(false);
    // A flag this version does not know must not switch off a capability the tenant pays for.
    expect(tenantHasAiFeature({ somethingNew: false }, 'copilot')).toBe(true);
  });

  it('returns an empty list — not undefined — when every feature is off', () => {
    // The distinction is load-bearing: `undefined` means "no restriction", so collapsing these would
    // turn "all AI disabled" into "all AI allowed" at the validator.
    const enabled = resolveTenantAiFeatures({
      copilot: false,
      readinessAudit: false,
      generativeMesh: false,
      generativeTexture: false,
    });

    expect(enabled).toEqual([]);
    expect(tenantHasAiFeature({ copilot: false }, 'copilot')).toBe(false);
  });
});

describe('§7.5 — the invocation log a message row stores', () => {
  const entry = (overrides: Partial<Record<string, unknown>>) => ({
    tenantId: '11111111-1111-4111-8111-111111111111',
    feature: 'copilot' as const,
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    promptVersion: 'copilot.system.v1',
    startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 100,
    ok: true,
    redacted: [] as string[],
    ...overrides,
  });

  it('reports nothing at all when no model call was made', () => {
    // The metrics-only audit path produces an empty log, and a row of zeroes would claim a call that
    // never happened. Nulls are the honest shape.
    expect(summarizeInvocation([])).toEqual({
      provider: null,
      model: null,
      promptVersion: null,
      durationMs: null,
      ok: null,
      failureKind: null,
      usage: null,
      redacted: [],
    });
  });

  it('sums cost across a multi-round-trip instruction', () => {
    const summary = summarizeInvocation([
      entry({ usage: { inputTokens: 100, outputTokens: 40 }, durationMs: 250 }) as never,
      entry({ usage: { inputTokens: 300, outputTokens: 10 }, durationMs: 500 }) as never,
    ]);

    // Summed rather than last-wins: the stored cost describes the instruction, not its final hop.
    expect(summary.usage).toEqual({ inputTokens: 400, outputTokens: 50 });
    expect(summary.durationMs).toBe(750);
    expect(summary.ok).toBe(true);
  });

  it('records a partial failure rather than rounding it up to success', () => {
    const summary = summarizeInvocation([
      entry({}) as never,
      entry({ ok: false, failureKind: 'RATE_LIMITED' }) as never,
    ]);

    expect(summary.ok).toBe(false);
    expect(summary.failureKind).toBe('RATE_LIMITED');
  });

  it('surfaces a model that changed mid-instruction instead of attributing it to the first', () => {
    const summary = summarizeInvocation([
      entry({ model: 'claude-sonnet-4-5-20250929' }) as never,
      entry({ model: 'claude-haiku-4-5-20251001' }) as never,
    ]);

    expect(summary.model).toBe('claude-sonnet-4-5-20250929, claude-haiku-4-5-20251001');
  });
});

describe('FR-11.3 — the stored tool-call record', () => {
  it('keeps refusals alongside the calls that were accepted', () => {
    const records = toolCallRecords([
      {
        iteration: 1,
        assistantText: ['I cannot publish that, but I can add the crate.'],
        proposed: [
          { id: 'call_pub', name: 'publish', input: { projectId: 'p' } },
          { id: 'call_add', name: 'addPrimitive', input: { kind: 'cube' } },
        ],
        outcomes: [
          {
            status: 'rejected',
            id: 'call_pub',
            name: 'publish',
            reason: 'PUBLISH_REQUIRES_HUMAN_ACTION',
            message: 'Publishing always needs an explicit action from you (FR-11.5).',
          },
          {
            status: 'accepted',
            id: 'call_add',
            name: 'addPrimitive',
            input: { kind: 'cube' },
            groupId: 'cg-1',
          },
        ],
      },
    ]);

    expect(records).toHaveLength(2);
    // The refusal is *stored*, because §7.2 requires it to be explained — and an explanation that is
    // not persisted cannot be shown after a reload.
    expect(records[0]).toMatchObject({
      name: 'publish',
      status: 'rejected',
      reason: 'PUBLISH_REQUIRES_HUMAN_ACTION',
      // The arguments survive only on the proposal, so they are paired back in from there.
      input: { projectId: 'p' },
    });
    expect(records[1]).toMatchObject({ status: 'accepted', groupId: 'cg-1' });
  });
});

describe('the Copilot loop over a scripted provider (§7.1–7.3, FR-11.5)', () => {
  const TENANT = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';

  it('refuses a publish the model attempts, and keeps the valid calls in the same batch', async () => {
    const transport = new ScriptedTransport([
      anthropicReply(
        [
          { type: 'text', text: 'I will publish that for you.' },
          { type: 'tool_use', id: 'call_pub', name: 'publish', input: { projectId: 'p' } },
          {
            type: 'tool_use',
            id: 'call_add',
            name: 'addPrimitive',
            input: { kind: 'cube', name: 'Crate' },
          },
        ],
        'tool_use',
      ),
      anthropicReply([{ type: 'text', text: 'Added a crate.' }], 'end_turn'),
    ]);

    const built = await buildTestApp(AI_ENV, { transport });
    const sink = new InMemoryInvocationSink();

    const run = await runCopilot(built.ai.claudeFor(sink), {
      tenantId: TENANT,
      userId: USER,
      instruction: 'publish this and add a crate',
      scene: SCENE,
      canEditProject: true,
    });

    const refusal = run.rejected.find((call) => call.name === 'publish');
    expect(refusal?.reason).toBe('PUBLISH_REQUIRES_HUMAN_ACTION');
    // A refusal carries a sentence for the Creator, not a stack trace or a Zod dump.
    expect(refusal?.message).toContain('explicit action');

    // The valid call in the same batch still landed. Discarding the whole batch because one call was
    // refused would lose the part of the instruction that was perfectly actionable.
    expect(run.applied.map((call) => call.name)).toEqual(['addPrimitive']);
    // §7.2 — one group id, so the instruction undoes as one action rather than one per round trip.
    expect(run.applied[0]?.groupId).toMatch(/^cg-/);
    expect(run.stopReason).toBe('end_turn');

    // §7.5 — every request/response pair is logged with its model and prompt-template version.
    expect(sink.entries).toHaveLength(2);
    expect(sink.entries[0]?.provider).toBe('anthropic');
    expect(sink.entries[0]?.promptVersion).toBe('copilot.system.v1');
    expect(sink.entries.every((entry) => entry.ok)).toBe(true);
    expect(sink.entries[0]?.usage).toEqual({ inputTokens: 120, outputTokens: 40 });
  });

  it('refuses a feature-gated tool when the tenant has that feature off (FR-18.1)', async () => {
    const transport = new ScriptedTransport([
      anthropicReply(
        [
          {
            type: 'tool_use',
            id: 'call_gen',
            name: 'generateMesh',
            input: { prompt: 'a rusty cargo crate' },
          },
        ],
        'tool_use',
      ),
      anthropicReply([{ type: 'text', text: 'I could not generate that.' }], 'end_turn'),
    ]);

    const built = await buildTestApp(AI_ENV, { transport });
    const sink = new InMemoryInvocationSink();

    const run = await runCopilot(built.ai.claudeFor(sink), {
      tenantId: TENANT,
      userId: USER,
      instruction: 'generate a rusty cargo crate',
      scene: SCENE,
      canEditProject: true,
      // What `resolveTenantAiFeatures` produced from a row with `generativeMesh: false`.
      enabledAiFeatures: resolveTenantAiFeatures({
        copilot: true,
        readinessAudit: true,
        generativeMesh: false,
        generativeTexture: true,
      }),
    });

    // Refused at the validator, not merely hidden in the UI — §7.5's point is that hiding a button
    // stops a person clicking it and does nothing about the model proposing it.
    const refusal = run.rejected.find((call) => call.name === 'generateMesh');
    expect(refusal?.reason).toBe('FEATURE_DISABLED');
    expect(run.applied).toHaveLength(0);
  });

  it('tells the model it must not publish, rather than relying on it not trying', async () => {
    const transport = new ScriptedTransport([
      anthropicReply([{ type: 'text', text: 'Nothing to do.' }], 'end_turn'),
    ]);

    const built = await buildTestApp(AI_ENV, { transport });

    // The prompt is only observable after a call, so the instruction has to actually run — asserting on
    // an empty transport would assert on nothing.
    await runCopilot(built.ai.claudeFor(new InMemoryInvocationSink()), {
      tenantId: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      instruction: 'publish this asset',
      scene: SCENE,
      canEditProject: true,
    });

    const system = (transport.bodies()[0]?.['system'] as string) ?? '';

    // The catalogue being closed is the enforcement; this instruction is what stops the model spending
    // a turn discovering that.
    expect(system).toContain('Use only the provided tools');
    expect(system).toContain('You cannot publish');
  });
});

describe('a deployment with no AI provider (§7.5, FR-11.10)', () => {
  it('refuses a Copilot request with a message naming the setting to add', async () => {
    // No ANTHROPIC_API_KEY. That is a supported deployment, not a misconfiguration.
    const built = await buildTestApp({ ANTHROPIC_API_KEY: undefined });

    expect(built.ai.configured).toBe(false);

    let thrown: unknown;
    try {
      built.ai.requireConfigured('copilot');
    } catch (error) {
      thrown = error;
    }

    const error = thrown as { statusCode: number; code: string; expose: boolean; message: string };
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('AI_NOT_CONFIGURED');
    // Exposed, so the error handler does not replace it with the generic 5xx sentence. That is the
    // entire value of this error: it names the variable to set.
    expect(error.expose).toBe(true);
    expect(error.message).toContain('ANTHROPIC_API_KEY');
    // And it says what still works, because the honest answer is "almost everything".
    expect(error.message).toContain('publishing is unaffected');
  });

  it('will not hand out a client that is certain to fail', async () => {
    const built = await buildTestApp({ ANTHROPIC_API_KEY: undefined });

    expect(() => built.ai.claudeFor(new InMemoryInvocationSink())).toThrowError(
      /No AI provider is configured/,
    );
  });

  it('still runs the whole pre-publish check on its own measurements (FR-11.10)', async () => {
    await buildTestApp({ ANTHROPIC_API_KEY: undefined });

    // The audit is a prerequisite for publishing, so it has to survive §7.5's kill switch. This is the
    // path the route takes when there is no provider: `runReadinessAudit(undefined, ...)`.
    const result = await runReadinessAudit(undefined, {
      tenantId: '11111111-1111-4111-8111-111111111111',
      metrics: {
        totalPolycount: 900_000,
        objectCount: 3,
        materialCount: 4,
        textureResolutions: [4_096],
        maxHierarchyDepth: 2,
        unnamedObjects: 0,
        meshesWithoutUvs: 0,
      },
      metricsOnly: true,
    });

    expect(result.usedModel).toBe(false);
    expect(result.modelCalls).toBe(0);
    // The score is still computed, which is the point: it comes from the measurements.
    expect(result.report.score).toBeLessThan(100);
    expect(result.report.issues.some((issue) => issue.category === 'polycount')).toBe(true);
    expect(result.narrative).toContain('no AI review was run');
  });

  it('reports its own AI status on the public root, so a silent button has an explanation', async () => {
    const built = await buildTestApp({ ANTHROPIC_API_KEY: undefined });
    const response = await built.app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.json().ai).toEqual({ configured: false, model: null });

    await built.app.close();
  });

  it('names the pinned model by default, and honours an explicit override', async () => {
    /*
     * Two facts, asserted separately because the environment can move one of them.
     *
     * The *default* must be a dated snapshot: a floating alias would let the Copilot's behaviour change
     * without a commit, which is what makes a stored `CopilotMessage` unreplayable. The *override* must
     * still work, because a deployment may need a different snapshot.
     *
     * Worth knowing when reading a failure here: this reads the real environment, so a machine whose
     * `.env` sets a floating alias is asserting against that. Deleting the key is what makes the first
     * half a statement about the default rather than about the developer's shell.
     */
    const pinned = await buildTestApp(
      { ...AI_ENV, ANTHROPIC_MODEL: undefined },
      { transport: new ScriptedTransport([]) },
    );
    const defaultResponse = await pinned.app.inject({ method: 'GET', url: '/' });
    expect(defaultResponse.json().ai).toEqual({
      configured: true,
      model: 'claude-sonnet-4-5-20250929',
    });
    await pinned.app.close();

    const overridden = await buildTestApp(
      { ...AI_ENV, ANTHROPIC_MODEL: 'claude-haiku-4-5-20251001' },
      { transport: new ScriptedTransport([]) },
    );
    const overrideResponse = await overridden.app.inject({ method: 'GET', url: '/' });
    expect(overrideResponse.json().ai).toEqual({
      configured: true,
      model: 'claude-haiku-4-5-20251001',
    });
    await overridden.app.close();
  });
});

describe('the AI route surface is registered and protected (FR-1.2, §6.4)', () => {
  const UUID = '33333333-3333-4333-8333-333333333333';

  /*
   * A 401 rather than a 404 is the assertion that matters: it proves the route exists under
   * `/studio/api/v1` *and* that it is behind the session check. A prefix typo or a missing auth call
   * would fail one of those, and both mistakes look identical from outside — "the button does nothing".
   */
  const protectedRoutes = [
    { method: 'POST' as const, url: '/studio/api/v1/copilot/sessions', payload: {} },
    { method: 'GET' as const, url: `/studio/api/v1/copilot/sessions/${UUID}` },
    {
      method: 'POST' as const,
      url: `/studio/api/v1/copilot/sessions/${UUID}/messages`,
      payload: {},
    },
    {
      method: 'POST' as const,
      url: `/studio/api/v1/copilot/sessions/${UUID}/messages/${UUID}/applied`,
      payload: { appliedCommandIds: [] },
    },
    { method: 'POST' as const, url: `/studio/api/v1/projects/${UUID}/audit`, payload: {} },
  ];

  it.each(protectedRoutes)('refuses $method $url with no VOID·SPACE session', async (route) => {
    const built = await buildTestApp(AI_ENV);
    const response = await built.app.inject(route);

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');

    await built.app.close();
  });

  it('rejects a malformed id before reaching the database or a provider', async () => {
    const built = await buildTestApp(AI_ENV);
    const response = await built.app.inject({
      method: 'GET',
      url: '/studio/api/v1/copilot/sessions/not-a-uuid',
      headers: { authorization: 'Bearer not.a.real.token' },
    });

    // Unauthenticated first — the session check is not something a malformed path can bypass.
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');

    await built.app.close();
  });
});
