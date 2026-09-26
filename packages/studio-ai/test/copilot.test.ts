/**
 * Tests for the Copilot tool-use loop (§7.2, FR-11.1–11.5).
 *
 * Everything here runs against a scripted transport, which is the point of the seam: the loop's
 * guarantees are about *control flow and validation*, and asserting them against a live model would
 * make them untestable and flaky at once.
 *
 * The groups that matter most:
 *
 *   - **FR-11.5** — a publish attempt must be refused even though the model asked for it.
 *   - **§7.2 grouping** — every command from one instruction shares one undo group, *including across
 *     model round trips*, which is the property a per-iteration group id would silently break.
 *   - **§7.2 transparency** — a refusal reaches the model as a refusal, and the Creator is not told
 *     something was applied when it was only queued.
 */
import { describe, expect, it } from 'vitest';

import { ClaudeClient } from '../src/claude';
import { runCopilot, COPILOT_SYSTEM_PROMPT, type ApplyCommands } from '../src/copilot';
import { DEFAULT_AI_POLICY, InMemoryInvocationSink, type AiPolicy } from '../src/policy';
import type { HttpTransport, TransportRequest, TransportResponse } from '../src/transport';

const POLICY: AiPolicy = { ...DEFAULT_AI_POLICY, timeoutMs: 1_000, backoffBaseMs: 1, maxCopilotIterations: 3 };

const SCENE = {
  objects: [
    { id: 'obj-table', name: 'Table', type: 'mesh' as const, childCount: 0, materialIds: ['mat-1'] },
  ],
  selection: ['obj-table'],
  unit: 'metre' as const,
};

/** An Anthropic-shaped reply carrying tool calls. */
function toolUseReply(calls: readonly { id: string; name: string; input: unknown }[]): unknown {
  return {
    id: 'msg_tool',
    model: 'test-model',
    content: calls.map((call) => ({ type: 'tool_use', ...call })),
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 40 },
  };
}

function endTurnReply(text: string): unknown {
  return {
    id: 'msg_end',
    model: 'test-model',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 50, output_tokens: 20 },
  };
}

function jsonResponse(body: unknown, status = 200): TransportResponse {
  return { status, body, headers: { 'content-type': 'application/json' } };
}

function scripted(answers: readonly TransportResponse[]) {
  const requests: TransportRequest[] = [];
  let index = 0;
  const transport: HttpTransport = {
    async request(request: TransportRequest): Promise<TransportResponse> {
      requests.push(request);
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      return answer ?? jsonResponse({}, 500);
    },
  };
  return { transport, requests, callCount: () => index };
}

function setup(answers: readonly TransportResponse[], policy: AiPolicy = POLICY) {
  const scriptedTransport = scripted(answers);
  const sink = new InMemoryInvocationSink();
  const client = new ClaudeClient({
    apiKey: 'test-key',
    transport: scriptedTransport.transport,
    policy,
    sink,
    sleep: async () => {},
  });
  return { client, ...scriptedTransport, sink };
}

/** Reads the `messages` array of the Nth outbound request, to inspect what the model was told. */
function outboundMessages(request: TransportRequest): readonly unknown[] {
  const body = JSON.parse(request.body ?? '{}') as { messages?: readonly unknown[] };
  return body.messages ?? [];
}

describe('runCopilot', () => {
  const base = {
    tenantId: 'tenant-1',
    instruction: 'add a crate',
    scene: SCENE,
    canEditProject: true,
  };

  it('validates a proposed call, returns it as applied, and stops on end_turn', async () => {
    const { client } = setup([
      jsonResponse(toolUseReply([{ id: 'c1', name: 'addPrimitive', input: { kind: 'cube' } }])),
      jsonResponse(endTurnReply('Added a cube.')),
    ]);

    const result = await runCopilot(client, base);

    expect(result.stopReason).toBe('end_turn');
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]?.name).toBe('addPrimitive');
    expect(result.rejected).toEqual([]);
    expect(result.modelCalls).toBe(2);
  });

  it('refuses a publish attempt and tells the model why (FR-11.5)', async () => {
    const { client } = setup([
      jsonResponse(toolUseReply([{ id: 'c1', name: 'publish', input: { objectId: 'obj-table' } }])),
      jsonResponse(endTurnReply('I cannot publish for you.')),
    ]);

    const result = await runCopilot(client, { ...base, instruction: 'publish it' });

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('PUBLISH_REQUIRES_HUMAN_ACTION');
  });

  it('groups every command from one instruction into one undo step, across round trips (§7.2)', async () => {
    const { client } = setup([
      jsonResponse(toolUseReply([{ id: 'c1', name: 'addPrimitive', input: { kind: 'cube' } }])),
      jsonResponse(
        toolUseReply([
          {
            id: 'c2',
            name: 'setMaterialProperty',
            input: { objectId: 'obj-table', property: 'metallic', value: 1 },
          },
        ]),
      ),
      jsonResponse(endTurnReply('Done.')),
    ]);

    const result = await runCopilot(client, base);

    expect(result.applied).toHaveLength(2);
    const groups = new Set(result.applied.map((call) => call.groupId));
    // One instruction, two round trips, one undo step. A per-iteration id would give two, and the
    // Creator's single "undo" would reverse only half of what they asked for.
    expect(groups.size).toBe(1);
  });

  it('stops at the iteration bound rather than looping on a model that keeps calling tools', async () => {
    // A model that never finishes. Without the bound this bills indefinitely on one sentence.
    const { client, callCount } = setup([
      jsonResponse(toolUseReply([{ id: 'c1', name: 'addPrimitive', input: { kind: 'cube' } }])),
    ]);

    const result = await runCopilot(client, base);

    expect(result.stopReason).toBe('max_iterations');
    expect(callCount()).toBe(POLICY.maxCopilotIterations);
  });

  it('returns the transcript so far when the provider fails, rather than discarding it', async () => {
    const { client } = setup([
      jsonResponse(toolUseReply([{ id: 'c1', name: 'addPrimitive', input: { kind: 'cube' } }])),
      jsonResponse({ error: { message: 'overloaded' } }, 529),
      jsonResponse({ error: { message: 'overloaded' } }, 529),
      jsonResponse({ error: { message: 'overloaded' } }, 529),
    ]);

    const result = await runCopilot(client, base);

    expect(result.stopReason).toBe('provider_error');
    // The Creator whose second step failed still learns that the first one landed.
    expect(result.applied).toHaveLength(1);
    expect(result.error).toMatch(/overloaded/);
  });

  it('tells the model a call was queued, not applied, when there is no command layer (§7.2)', async () => {
    const { client, requests } = setup([
      jsonResponse(toolUseReply([{ id: 'c1', name: 'addPrimitive', input: { kind: 'cube' } }])),
      jsonResponse(endTurnReply('ok')),
    ]);

    await runCopilot(client, base);

    const serialized = JSON.stringify(outboundMessages(requests[1]!));
    expect(serialized).toContain('not been applied');
    // Asserting the absence of the confident wording too: "Applied" here is how a model starts
    // narrating an edit the command layer has not made.
    expect(serialized).not.toContain('Applied as an undoable command.');
  });
});


describe('runCopilot with a command layer', () => {
  const base = {
    tenantId: 'tenant-1',
    instruction: 'add a crate and make it metallic',
    scene: SCENE,
    canEditProject: true,
  };

  it('hands the new object id back to the model so a later call can reference it', async () => {
    const seen: string[][] = [];
    const applyCommands: ApplyCommands = async (accepted) => {
      seen.push(accepted.map((call) => call.name));
      return accepted.map((call) => ({
        callId: call.id,
        ok: true,
        createdObjectIds: call.name === 'addPrimitive' ? ['obj-new-crate'] : [],
      }));
    };

    const { client, requests } = setup([
      jsonResponse(toolUseReply([{ id: 'c1', name: 'addPrimitive', input: { kind: 'cube' } }])),
      jsonResponse(
        toolUseReply([
          {
            id: 'c2',
            name: 'setMaterialProperty',
            input: { objectId: 'obj-table', property: 'roughness', value: 1 },
          },
        ]),
      ),
      jsonResponse(endTurnReply('ok')),
    ]);

    const result = await runCopilot(client, { ...base, applyCommands });

    expect(seen).toEqual([['addPrimitive'], ['setMaterialProperty']]);
    // The id must reach the model, or "make it metallic" can never resolve to the crate just created.
    expect(JSON.stringify(outboundMessages(requests[1]!))).toContain('obj-new-crate');
    expect(result.applied).toHaveLength(2);
  });

  it('reports a failed command to the model as a failure', async () => {
    const applyCommands: ApplyCommands = async (accepted) =>
      accepted.map((call) => ({ callId: call.id, ok: false, error: 'the mesh has no UV set' }));

    const { client, requests } = setup([
      jsonResponse(toolUseReply([{ id: 'c1', name: 'addPrimitive', input: { kind: 'cube' } }])),
      jsonResponse(endTurnReply('ok')),
    ]);

    await runCopilot(client, { ...base, applyCommands });

    expect(JSON.stringify(outboundMessages(requests[1]!))).toContain('the mesh has no UV set');
  });

  it('survives the command layer throwing, and reports every accepted call as failed', async () => {
    const applyCommands: ApplyCommands = async () => {
      throw new Error('the editor disconnected');
    };

    const { client, requests } = setup([
      jsonResponse(toolUseReply([{ id: 'c1', name: 'addPrimitive', input: { kind: 'cube' } }])),
      jsonResponse(endTurnReply('ok')),
    ]);

    const result = await runCopilot(client, { ...base, applyCommands });

    expect(result.applied).toHaveLength(1);
    // Reporting the failure rather than losing the call: a model that is told nothing landed can retry.
    expect(JSON.stringify(outboundMessages(requests[1]!))).toContain('the editor disconnected');
  });
});

describe('the §7.5 controls reach the Copilot', () => {
  const base = {
    tenantId: 'tenant-1',
    instruction: 'add a crate',
    scene: SCENE,
    canEditProject: true,
  };

  it('records model and prompt version on every invocation', async () => {
    const { client, sink } = setup([
      jsonResponse(toolUseReply([{ id: 'c1', name: 'addPrimitive', input: { kind: 'cube' } }])),
      jsonResponse(endTurnReply('ok')),
    ]);

    await runCopilot(client, base);

    expect(sink.entries).toHaveLength(2);
    for (const entry of sink.entries) {
      expect(entry.model).toBe('test-model');
      expect(entry.promptVersion).toBe('copilot.system.v1');
      expect(entry.provider).toBe('anthropic');
      expect(entry.feature).toBe('copilot');
    }
    expect(sink.entries[0]?.usage?.inputTokens).toBe(100);
  });

  it('refuses to call the model at all when the Copilot is switched off (FR-18.1)', async () => {
    const { client, callCount } = setup(
      [jsonResponse(endTurnReply('ok'))],
      { ...POLICY, enabledFeatures: ['generativeMesh'] },
    );

    const result = await runCopilot(client, base);

    // A disabled feature must not spend budget, and must be reported rather than silently no-op.
    expect(callCount()).toBe(0);
    expect(result.stopReason).toBe('provider_error');
    expect(result.error).toMatch(/disabled/);
  });

  it('retries a rate-limited call and then succeeds', async () => {
    const { client, callCount } = setup([
      jsonResponse({ error: { message: 'slow down' } }, 429),
      jsonResponse(endTurnReply('ok')),
    ]);

    const result = await runCopilot(client, base);

    expect(result.stopReason).toBe('end_turn');
    expect(callCount()).toBe(2);
  });
});

describe('the system prompt', () => {
  it('states that publishing is out of scope, so the model does not promise it', () => {
    expect(COPILOT_SYSTEM_PROMPT).toMatch(/cannot publish/i);
  });

  it('forbids scripts — the instruction the closed tool set enforces (§7.2)', () => {
    expect(COPILOT_SYSTEM_PROMPT).toMatch(/only the provided tools/i);
    expect(COPILOT_SYSTEM_PROMPT).toMatch(/never describe a script/i);
  });
});

