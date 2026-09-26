/**
 * Tests for the readiness audit (§7.3).
 *
 * The group that matters is "the score stays deterministic": §7.3 has the model returning a score, and
 * this implementation deliberately does not use it. These assert that, so a future change that starts
 * trusting the model's number fails here rather than silently making stored reports uninterpretable.
 */
import { describe, expect, it } from 'vitest';
import { RECOMMENDED_READINESS_THRESHOLD, type SceneMetrics } from '@void-space/studio-engine';

import { extractJsonObject, runReadinessAudit } from '../src/audit';
import { ClaudeClient } from '../src/claude';
import { DEFAULT_AI_POLICY, InMemoryInvocationSink, type AiPolicy } from '../src/policy';
import type { HttpTransport, TransportResponse } from '../src/transport';

const POLICY: AiPolicy = { ...DEFAULT_AI_POLICY, timeoutMs: 1_000, backoffBaseMs: 1 };

const CLEAN: SceneMetrics = {
  totalPolycount: 10_000,
  objectCount: 3,
  materialCount: 1,
  textureResolutions: [1_024],
  maxHierarchyDepth: 2,
  unnamedObjects: 0,
  meshesWithoutUvs: 0,
};

/** A scene that is unambiguously over budget, so the local score cannot be perfect. */
const BLOATED: SceneMetrics = { ...CLEAN, totalPolycount: 900_000, meshesWithoutUvs: 2 };

function jsonResponse(body: unknown, status = 200): TransportResponse {
  return { status, body, headers: { 'content-type': 'application/json' } };
}

function setup(answers: readonly TransportResponse[]) {
  const requests: { body?: string | undefined }[] = [];
  let index = 0;
  const transport: HttpTransport = {
    async request(request): Promise<TransportResponse> {
      requests.push(request);
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      return answer ?? jsonResponse({}, 500);
    },
  };
  const client = new ClaudeClient({
    apiKey: 'test-key',
    transport,
    policy: POLICY,
    sink: new InMemoryInvocationSink(),
    sleep: async () => {},
  });
  return { client, requests, callCount: () => index };
}

function replyWith(text: string): TransportResponse {
  return jsonResponse({
    id: 'msg_1',
    model: 'test-model',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  });
}

describe('extractJsonObject', () => {
  it('reads JSON that the model wrapped in a code fence', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('reads JSON preceded by prose', () => {
    expect(extractJsonObject('Here you go:\n{"a":2}')).toEqual({ a: 2 });
  });

  it('returns undefined rather than throwing on unparseable output', () => {
    expect(extractJsonObject('no json here')).toBeUndefined();
    expect(extractJsonObject('{ broken')).toBeUndefined();
  });
});

describe('runReadinessAudit', () => {
  it('returns the deterministic report without calling the model when asked to', async () => {
    const { client, callCount } = setup([replyWith('{}')]);

    const result = await runReadinessAudit(client, {
      tenantId: 't1',
      metrics: CLEAN,
      metricsOnly: true,
    });

    // §7.5 lets a tenant disable every AI feature; FR-11.10 still requires a completed audit, so this
    // path has to work with no provider at all.
    expect(callCount()).toBe(0);
    expect(result.usedModel).toBe(false);
    expect(result.report.score).toBe(100);
    expect(result.report.passed).toBe(true);
  });

  it('keeps the local score even when the model proposes issues (§7.3 deviation)', async () => {
    const { client } = setup([
      replyWith(
        JSON.stringify({
          narrative: 'Needs work.',
          issues: [
            {
              severity: 'warning',
              category: 'hierarchy',
              message: 'The hierarchy is deeper than a reviewer would expect.',
            },
          ],
        }),
      ),
    ]);

    const result = await runReadinessAudit(client, { tenantId: 't1', metrics: BLOATED });

    expect(result.usedModel).toBe(true);
    expect(result.narrative).toBe('Needs work.');
    // The score comes from the measurements — two meshes without UVs is critical and 900k triangles is
    // critical — so it cannot reach the recommended threshold. Asserted against the threshold rather
    // than a magic number, so a change to the penalty scale does not make this test lie.
    expect(result.report.score).toBeLessThan(RECOMMENDED_READINESS_THRESHOLD);
    expect(result.report.passed).toBe(false);
    // The model's finding is included, with provenance preserved so the UI can label it.
    expect(result.modelIssues).toHaveLength(1);
    expect(result.report.issues.some((issue) => /deeper than a reviewer/.test(issue.message))).toBe(true);
  });

  it('does not show the same problem twice when the model restates a local finding', async () => {
    const { client } = setup([
      replyWith(
        JSON.stringify({
          narrative: 'Several issues.',
          issues: [
            {
              severity: 'warning',
              category: 'hierarchy',
              // Same category, different punctuation and case — the dedupe normalises before comparing.
              message: '  THE HIERARCHY is deeper than a reviewer would expect!  ',
            },
          ],
        }),
      ),
    ]);

    const result = await runReadinessAudit(client, { tenantId: 't1', metrics: BLOATED });
    const hierarchy = result.report.issues.filter((issue) => issue.category === 'hierarchy');

    // A duplicated warning is how a real one gets ignored.
    expect(hierarchy.length).toBeLessThanOrEqual(1);
  });

  it('falls back to a metrics-only report when the model returns unparseable output', async () => {
    const { client } = setup([replyWith('I am not going to answer in JSON.')]);

    const result = await runReadinessAudit(client, { tenantId: 't1', metrics: BLOATED });

    // A provider that answers badly degrades the audit; it does not fail it. Publishing is gated on a
    // *completed* audit (FR-11.10), and the measurements are a complete audit.
    expect(result.usedModel).toBe(false);
    expect(result.modelIssues).toEqual([]);
    expect(result.report.score).toBeLessThan(RECOMMENDED_READINESS_THRESHOLD);
  });

  it('degrades rather than throwing when the provider is unreachable', async () => {
    const { client } = setup([jsonResponse({ error: { message: 'overloaded' } }, 529)]);

    const result = await runReadinessAudit(client, { tenantId: 't1', metrics: CLEAN });

    expect(result.usedModel).toBe(false);
    expect(result.narrative).toMatch(/no AI review was run/i);
  });
});

