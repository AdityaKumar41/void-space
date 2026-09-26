/**
 * The pre-publish readiness audit (VS2-SRS-1.0 §7.3, FR-11.10).
 *
 * The audit answers one question before a Creator submits to VOID·SPACE: *is this asset likely to be
 * accepted, and if not, what specifically is wrong?* §7.3 specifies how it works — Claude is sent a
 * structured description of the export-candidate scene (polycount, texture resolutions, material
 * count, naming, hierarchy depth) and returns `{ readiness_score, issues[] }`.
 *
 * The scoring in this file is deliberately **deterministic and local**, and that is a design choice
 * worth stating: the model is asked for judgement, but the *thresholds* are computed here. An asset
 * with 900,000 triangles is over an XR budget whether or not a language model says so, and a score
 * that changes between two identical runs would make §7.3's "stored against the ProjectVersion"
 * meaningless — nobody could tell a real regression from sampling noise. The model's contribution is
 * the issue wording and anything the metrics do not capture; the arithmetic is auditable.
 *
 * Two rules from §7.3 are load-bearing:
 *
 *   - **The audit is advisory, not a gate.** `passed` is a recommendation. A Creator may publish
 *     below threshold with an explicit acknowledgment (`acknowledgeBelowThreshold`), because
 *     VOID·SPACE's own human review is the actual quality gate (VS-SRS-2.0 FR-7.6).
 *   - **The criteria are per-tenant** (FR-18.1), so a workspace can tune the audit to its own XR
 *     performance targets without a code change.
 */

/** §7.3's `issues[].category`. */
export const READINESS_ISSUE_CATEGORIES = [
  'polycount',
  'texture',
  'material',
  'naming',
  'hierarchy',
  'uv',
  'format',
] as const;
export type ReadinessIssueCategory = (typeof READINESS_ISSUE_CATEGORIES)[number];

/** Severity drives both the score penalty and how the issue list is ordered and coloured. */
export const ISSUE_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export interface ReadinessIssue {
  readonly severity: IssueSeverity;
  readonly category: ReadinessIssueCategory;
  readonly message: string;
  /**
   * The object this issue is about, so the panel can offer click-to-locate (§6.1). Absent for a
   * scene-wide issue such as total polycount, which cannot be pinned to one node.
   */
  readonly objectRef?: string | undefined;
}

/**
 * The scene measurements the audit scores.
 *
 * Mirrors §7.3's list exactly. Kept flat and numeric so it can be produced by the Editor Engine,
 * serialized into the Claude prompt, and stored alongside a `ProjectVersion` without change.
 */
export interface SceneMetrics {
  readonly totalPolycount: number;
  readonly objectCount: number;
  readonly materialCount: number;
  /** Every distinct texture resolution in use, in pixels. */
  readonly textureResolutions: readonly number[];
  readonly maxHierarchyDepth: number;
  /** Objects still carrying a default or empty name. */
  readonly unnamedObjects: number;
  /** Meshes lacking a UV set. A mesh without UVs cannot be textured downstream (FR-5.1). */
  readonly meshesWithoutUvs: number;
}

/** FR-18.1 — a TenantAdmin tunes these to the workspace's own XR targets. */
export interface ReadinessCriteria {
  readonly maxPolycount: number;
  readonly maxTextureResolution: number;
  readonly maxMaterialCount: number;
  readonly maxHierarchyDepth: number;
  /** When set, every object must be named. */
  readonly requireObjectNames: boolean;
  /** When set, every mesh must have UVs. */
  readonly requireUvs: boolean;
}

/**
 * Defaults chosen for XR delivery rather than for offline rendering: a mobile-headset budget is far
 * below what a desktop target would allow, and the SRS positions this product as feeding an XR
 * pipeline (§1.1). A tenant with different targets overrides these.
 */
export const DEFAULT_READINESS_CRITERIA: ReadinessCriteria = {
  maxPolycount: 250_000,
  maxTextureResolution: 2_048,
  maxMaterialCount: 12,
  maxHierarchyDepth: 8,
  requireObjectNames: true,
  requireUvs: true,
};

/**
 * The score at or above which the audit recommends publishing.
 *
 * Advisory only. FR-11.10 allows a Creator to publish below it with an explicit acknowledgment, and
 * §7.3 restates why: the audit must not become a second gate competing with VOID·SPACE's review.
 */
export const RECOMMENDED_READINESS_THRESHOLD = 80;

/** Per-issue score penalties. `info` costs nothing — it is context, not a defect. */
const SEVERITY_PENALTY: Readonly<Record<IssueSeverity, number>> = {
  info: 0,
  warning: 8,
  critical: 25,
};

export interface ReadinessReport {
  /** 0–100, clamped. */
  readonly score: number;
  readonly issues: readonly ReadinessIssue[];
  /** Whether the score meets the recommended threshold. Never a publish prohibition. */
  readonly passed: boolean;
  readonly threshold: number;
  /** Echoed back so a stored report can be re-interpreted if the tenant's criteria later change. */
  readonly criteria: ReadinessCriteria;
  readonly metrics: SceneMetrics;
}

/**
 * Grades a measured value against a limit.
 *
 * The two-step shape is the point: being *over* a budget is a warning, while being more than twice
 * over is critical. That distinction is what makes the score useful — a scene at 1.1× the polycount
 * budget needs a trim, and one at 5× needs a different conversation. A single threshold would report
 * both as "too many triangles" and leave the Creator to work out which situation they are in.
 */
function grade(value: number, limit: number): IssueSeverity | null {
  if (value > limit * 2) return 'critical';
  if (value > limit) return 'warning';
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Order issues worst-first so the panel's default order is the order that matters. */
const SEVERITY_RANK: Readonly<Record<IssueSeverity, number>> = { critical: 0, warning: 1, info: 2 };

/**
 * Scores a scene and lists what is wrong with it (§7.3).
 *
 * Pure and deterministic: the same metrics and criteria always produce the same report, which is what
 * allows a stored report to be compared against a fresh one after a fix (UC-S04's "score 62 → fix →
 * score 91" flow).
 */
export function evaluateReadiness(
  metrics: SceneMetrics,
  criteria: ReadinessCriteria = DEFAULT_READINESS_CRITERIA,
  threshold: number = RECOMMENDED_READINESS_THRESHOLD,
): ReadinessReport {
  const issues: ReadinessIssue[] = [];

  /**
   * An empty scene is not a scene with one problem — it is the absence of an asset, so it returns 0
   * outright rather than being scored on the penalty scale.
   *
   * Scoring it the ordinary way produced a misleading 75/100 (a single critical issue costs 25),
   * which reads as "nearly publishable" for a project with nothing in it. A score is a claim about
   * how close something is to being shippable, and "empty" is not close.
   */
  if (metrics.objectCount === 0) {
    return {
      score: 0,
      issues: [
        {
          severity: 'critical',
          category: 'hierarchy',
          message: 'The scene is empty, so there is nothing to publish.',
        },
      ],
      passed: false,
      threshold,
      criteria,
      metrics,
    };
  }

  const polySeverity = grade(metrics.totalPolycount, criteria.maxPolycount);
  if (polySeverity) {
    issues.push({
      severity: polySeverity,
      category: 'polycount',
      message: `The scene is ${metrics.totalPolycount.toLocaleString('en-US')} triangles against a budget of ${criteria.maxPolycount.toLocaleString('en-US')}. Decimating the densest meshes is usually the fastest fix.`,
    });
  }

  const oversizedTextures = metrics.textureResolutions.filter(
    (resolution) => resolution > criteria.maxTextureResolution,
  );
  if (oversizedTextures.length > 0) {
    const largest = Math.max(...oversizedTextures);
    issues.push({
      severity: grade(largest, criteria.maxTextureResolution) ?? 'warning',
      category: 'texture',
      message: `${oversizedTextures.length} texture(s) exceed ${criteria.maxTextureResolution}px, the largest being ${largest}px. Large textures dominate download time in a headset.`,
    });
  }

  const materialSeverity = grade(metrics.materialCount, criteria.maxMaterialCount);
  if (materialSeverity) {
    issues.push({
      severity: materialSeverity,
      category: 'material',
      message: `The scene uses ${metrics.materialCount} materials against a budget of ${criteria.maxMaterialCount}. Each distinct material is a separate draw call.`,
    });
  }

  const depthSeverity = grade(metrics.maxHierarchyDepth, criteria.maxHierarchyDepth);
  if (depthSeverity) {
    issues.push({
      severity: depthSeverity,
      category: 'hierarchy',
      message: `The deepest object sits ${metrics.maxHierarchyDepth} levels down, beyond the ${criteria.maxHierarchyDepth}-level guidance. Deep hierarchies cost more to traverse than they convey.`,
    });
  }

  if (criteria.requireObjectNames && metrics.unnamedObjects > 0) {
    issues.push({
      severity: 'warning',
      category: 'naming',
      message: `${metrics.unnamedObjects} object(s) still have a default name. A reviewer cannot tell what they are looking at.`,
    });
  }

  if (criteria.requireUvs && metrics.meshesWithoutUvs > 0) {
    issues.push({
      severity: 'critical',
      category: 'uv',
      message: `${metrics.meshesWithoutUvs} mesh(es) have no UV set, so they cannot be textured downstream (FR-5.1).`,
    });
  }

  const penalty = issues.reduce((total, issue) => total + SEVERITY_PENALTY[issue.severity], 0);
  const score = clamp(100 - penalty, 0, 100);

  return {
    score,
    issues: [...issues].sort(
      (left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity],
    ),
    passed: score >= threshold,
    threshold,
    criteria,
    metrics,
  };
}

