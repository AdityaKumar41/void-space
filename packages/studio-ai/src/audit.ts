/**
 * The pre-publish readiness audit (VS2-SRS-1.0 §7.3).
 *
 * §7.3 specifies the shape: a structured description of the export-candidate scene goes to Claude,
 * which returns `{ readiness_score, issues[] }`. This module does that, with **one deliberate
 * deviation**, documented here because it is a real divergence and not an implementation detail:
 *
 * **The score is computed locally, not taken from the model.** §7.3's arithmetic is reproducible and
 * auditable — 900,000 triangles is over an XR budget whether or not a language model agrees — and
 * §7.3 also requires the report to be stored against the `ProjectVersion` so a later reviewer can see
 * what the score was at submission time. A score that varies between two identical runs makes that
 * stored value uninterpretable: nobody could tell a real regression from sampling noise.
 *
 * So the division of labour is: the model contributes *judgement* — the issues metrics cannot see,
 * and the wording a Creator can act on — while the numbers stay deterministic. `evaluateReadiness`
 * remains the authority on the score, and the model's issues are merged into its report.
 *
 * The audit stays **advisory** (§7.3, FR-11.10). Nothing here blocks a publish; the gate in
 * `@void-space/studio-engine` is what decides, and it allows a below-threshold publish once
 * acknowledged.
 */
import {
  ISSUE_SEVERITIES,
  READINESS_ISSUE_CATEGORIES,
  evaluateReadiness,
  type ReadinessCriteria,
  type ReadinessIssue,
  type ReadinessReport,
  type SceneMetrics,
} from '@void-space/studio-engine';
import { z } from 'zod';

import type { ClaudeClient } from './claude';
import { PROMPT_VERSIONS } from './policy';

/**
 * The prompt.
 *
 * It states outright that the score is not being asked for, rather than asking and discarding it. A
 * model told to produce a number it then sees ignored will reason as though the number mattered; a
 * model told plainly that its job is the issue list produces a better one.
 */
export const AUDIT_PROMPT = `You review a 3D asset's export-readiness for a multi-tenant XR asset marketplace.

You are given measurements, not the model itself. Identify problems the measurements imply, plus any
that a reviewer would raise — naming, hierarchy, material validity, texture usage.

You are NOT being asked to score the asset. The editor computes the score from the measurements
deterministically; a number from you would be discarded, so do not produce one.

Reply with JSON only, no prose around it:

{
  "narrative": "two sentences a Creator can act on",
  "issues": [
    { "severity": "critical" | "warning" | "info",
      "category": "polycount" | "texture" | "material" | "naming" | "hierarchy" | "uv" | "format",
      "message": "what is wrong and what to do about it",
      "objectRef": "an object id, only when the issue is about one object" }
  ]
}

Aim for at most six issues: the ones that would actually get the asset sent back.`;

/** The model's reply, validated before anything in it is trusted. */
const modelAuditSchema = z.object({
  narrative: z.string().min(1).max(2_000),
  issues: z
    .array(
      z.object({
        severity: z.enum(ISSUE_SEVERITIES),
        category: z.enum(READINESS_ISSUE_CATEGORIES),
        message: z.string().min(1).max(600),
        objectRef: z.string().min(1).max(128).optional(),
      }),
    )
    // Capped rather than unbounded: an issue list nobody will read is a list nobody will fix, and the
    // prompt asks for six. The cap is generous so a genuinely bad asset is still fully reported.
    .max(40)
    .default([]),
});
export type ModelAuditPayload = z.infer<typeof modelAuditSchema>;

export interface ReadinessAuditInput {
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly metrics: SceneMetrics;
  readonly criteria?: ReadinessCriteria | undefined;
  readonly threshold?: number | undefined;
  /**
   * Skip the model call and return the deterministic report alone.
   *
   * Exists for the case §7.5 anticipates: a tenant with every AI feature disabled still has to be able
   * to publish, and FR-11.10 makes the audit a prerequisite for that. A local-only audit is how the
   * gate keeps working with the AI subsystem switched off.
   */
  readonly metricsOnly?: boolean | undefined;
}

export interface ReadinessAuditResult {
  /** The authoritative report: deterministic score, with the model's issues merged in. */
  readonly report: ReadinessReport;
  /** The model's own summary, or a local fallback when no model call was made. */
  readonly narrative: string;
  /** Only the issues that came from the model, so a caller can label their provenance. */
  readonly modelIssues: readonly ReadinessIssue[];
  readonly usedModel: boolean;
  readonly modelCalls: number;
}

/**
 * Pulls a JSON object out of a model reply.
 *
 * Models wrap JSON in prose or a ```json fence often enough that rejecting the whole answer over it
 * would make the audit fail on otherwise-perfect output. The first `{` to the last `}` is the
 * narrowest rule that handles a fence, a preamble, or both, without pretending to parse arbitrary
 * text.
 */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return undefined;

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** A summary for the no-model path and for when the model returns unparseable output. */
function fallbackNarrative(metrics: SceneMetrics): string {
  return `${metrics.objectCount} object(s), ${metrics.totalPolycount.toLocaleString('en-US')} triangles, ${metrics.materialCount} material(s). Scored from measurements alone — no AI review was run.`;
}

/**
 * Runs the audit (§7.3).
 *
 * The model call is best-effort and its failure is swallowed into a metrics-only report. That is a
 * considered trade: FR-11.10 makes a *completed* audit a prerequisite for publishing, and the
 * measurements alone are a complete audit — they are what the score is computed from. Failing the
 * whole audit because a provider was unreachable would block a Creator from publishing for a reason
 * that has nothing to do with their asset.
 */
export async function runReadinessAudit(
  client: ClaudeClient,
  input: ReadinessAuditInput,
): Promise<ReadinessAuditResult> {
  const report = evaluateReadiness(input.metrics, input.criteria, input.threshold);

  if (input.metricsOnly) {
    return {
      report,
      narrative: fallbackNarrative(input.metrics),
      modelIssues: [],
      usedModel: false,
      modelCalls: 0,
    };
  }

  let modelIssues: readonly ReadinessIssue[] = [];
  let narrative = fallbackNarrative(input.metrics);
  let usedModel = false;

  try {
    const response = await client.createMessage({
      tenantId: input.tenantId,
      userId: input.userId,
      feature: 'readinessAudit',
      promptVersion: PROMPT_VERSIONS.audit,
      system: AUDIT_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { metrics: input.metrics, localFindings: report.issues.map((issue) => issue.message) },
                null,
                2,
              ),
            },
          ],
        },
      ],
      maxTokens: 1_200,
      // Near-zero temperature: a review is a judgement about a fixed set of measurements, so run-to-run
      // variation is noise a Creator would read as the audit being unreliable.
      temperature: 0,
    });

    const text = response.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    const parsed = modelAuditSchema.safeParse(extractJsonObject(text));
    if (parsed.success) {
      usedModel = true;
      narrative = parsed.data.narrative;
      modelIssues = parsed.data.issues;
    }
    // A parse failure leaves `usedModel` false and the deterministic report intact. Deliberately not
    // thrown: see the doc comment above.
  } catch {
    // Same reasoning — a provider outage degrades the audit, it does not fail it.
  }

  if (!usedModel) {
    return { report, narrative, modelIssues: [], usedModel: false, modelCalls: 1 };
  }

  return {
    report: { ...report, issues: mergeIssues(report.issues, modelIssues) },
    narrative,
    modelIssues,
    usedModel: true,
    modelCalls: 1,
  };
}

/**
 * Merges the model's findings into the deterministic ones.
 *
 * De-duplicated on `category` + a normalised message, because the model is explicitly told about the
 * local findings and will often restate them. Showing a Creator the same problem twice teaches them
 * the audit is noisy, which is how a real warning gets ignored.
 */
function mergeIssues(
  local: readonly ReadinessIssue[],
  fromModel: readonly ReadinessIssue[],
): readonly ReadinessIssue[] {
  const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const seen = new Set(local.map((issue) => `${issue.category}:${normalise(issue.message)}`));
  const merged = [...local];

  for (const issue of fromModel) {
    const key = `${issue.category}:${normalise(issue.message)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(issue);
  }

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return merged.sort((left, right) => rank[left.severity] - rank[right.severity]);
}

