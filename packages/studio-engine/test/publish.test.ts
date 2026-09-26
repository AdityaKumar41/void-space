/**
 * Tests for the readiness audit (§7.3) and the publish gate (FR-14.1, FR-11.10).
 *
 * The gate suite is the one that matters most, because it pins the *asymmetry* the SRS insists on:
 * export validation is a hard gate, the readiness audit is advisory. A future change that turns the
 * audit into a blocker would keep every happy-path test green and still be wrong, so the
 * below-threshold-with-acknowledgment case is asserted explicitly.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_READINESS_CRITERIA,
  RECOMMENDED_READINESS_THRESHOLD,
  evaluateReadiness,
  type SceneMetrics,
} from '../src/audit/readiness';
import {
  evaluatePublishGate,
  validateExportCandidate,
  type ExportCandidate,
} from '../src/publish/gate';

/** A scene that should score perfectly: inside every budget, named, UV'd. */
const CLEAN_METRICS: SceneMetrics = {
  totalPolycount: 12_000,
  objectCount: 4,
  materialCount: 2,
  textureResolutions: [1_024],
  maxHierarchyDepth: 2,
  unnamedObjects: 0,
  meshesWithoutUvs: 0,
};

const CLEAN_EXPORT: ExportCandidate = {
  extension: '.glb',
  sizeBytes: 4 * 1024 * 1024,
  polycount: 12_000,
  textureResolutions: [1_024],
  materialCount: 2,
  gltfHeaderValid: true,
  unsupportedMaterialFeatures: [],
};

describe('evaluateReadiness', () => {
  it('scores a scene inside every budget at 100 and recommends publishing', () => {
    const report = evaluateReadiness(CLEAN_METRICS);
    expect(report.score).toBe(100);
    expect(report.issues).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it('is deterministic, so a stored report can be compared against a re-run (§7.3)', () => {
    const metrics: SceneMetrics = { ...CLEAN_METRICS, totalPolycount: 400_000 };
    expect(evaluateReadiness(metrics)).toEqual(evaluateReadiness(metrics));
  });

  it('escalates from a warning to critical once a budget is more than doubled', () => {
    // Just over: a trim is needed.
    const over = evaluateReadiness({ ...CLEAN_METRICS, totalPolycount: 260_000 });
    expect(over.issues[0]?.severity).toBe('warning');

    // Far over: a different conversation, and the score must say so.
    const far = evaluateReadiness({ ...CLEAN_METRICS, totalPolycount: 900_000 });
    expect(far.issues[0]?.severity).toBe('critical');
    expect(far.score).toBeLessThan(over.score);
  });

  it('treats a mesh without UVs as critical, because it cannot be textured downstream (FR-5.1)', () => {
    const report = evaluateReadiness({ ...CLEAN_METRICS, meshesWithoutUvs: 1 });
    expect(report.issues).toContainEqual(expect.objectContaining({ category: 'uv', severity: 'critical' }));
    expect(report.passed).toBe(false);
  });

  it('refuses to call an empty scene publishable', () => {
    const report = evaluateReadiness({ ...CLEAN_METRICS, objectCount: 0, totalPolycount: 0 });
    expect(report.score).toBe(0);
    expect(report.issues.some((issue) => /empty/i.test(issue.message))).toBe(true);
  });

  it('orders issues worst-first so the panel leads with what blocks a publish', () => {
    const report = evaluateReadiness({
      ...CLEAN_METRICS,
      meshesWithoutUvs: 1, // critical
      unnamedObjects: 2, // warning
    });
    const severities = report.issues.map((issue) => issue.severity);
    expect(severities[0]).toBe('critical');
    expect(severities.indexOf('critical')).toBeLessThan(severities.indexOf('warning'));
  });

  it('honours per-tenant criteria instead of a hard-coded budget (FR-18.1)', () => {
    const strict = { ...DEFAULT_READINESS_CRITERIA, maxPolycount: 5_000 };
    // The same scene passes the default budget and fails a workspace that targets mobile XR.
    expect(evaluateReadiness(CLEAN_METRICS).passed).toBe(true);
    expect(evaluateReadiness(CLEAN_METRICS, strict).passed).toBe(false);
  });
});

describe('validateExportCandidate (FR-10.4)', () => {
  it('passes an export VOID·SPACE will accept', () => {
    expect(validateExportCandidate(CLEAN_EXPORT)).toMatchObject({ valid: true, blockedBy: [] });
  });

  it('blocks a format VOID·SPACE does not take, naming the allowed ones', () => {
    const result = validateExportCandidate({ ...CLEAN_EXPORT, extension: '.usdz' });
    expect(result.blockedBy).toContain('FORMAT_NOT_ACCEPTED');
    // The message has to be actionable, not just a refusal.
    expect(result.messages[0]).toContain('.glb');
  });

  it('blocks an export over the 200 MB ceiling before it is ever uploaded (VS-SRS-2.0 FR-3.1)', () => {
    const result = validateExportCandidate({ ...CLEAN_EXPORT, sizeBytes: 300 * 1024 * 1024 });
    expect(result.blockedBy).toContain('TOO_LARGE');
  });

  it('blocks a GLB without a valid glTF header', () => {
    expect(validateExportCandidate({ ...CLEAN_EXPORT, gltfHeaderValid: false }).blockedBy).toContain(
      'INVALID_GLTF',
    );
  });

  it('blocks material features with no glTF equivalent, and names them (FR-6.4)', () => {
    const result = validateExportCandidate({
      ...CLEAN_EXPORT,
      unsupportedMaterialFeatures: ['Procedural noise', 'Volume absorption'],
    });
    expect(result.blockedBy).toContain('INCOMPATIBLE_MATERIAL');
    expect(result.messages.join(' ')).toContain('Procedural noise');
  });

  it('reports every problem at once rather than one per attempt', () => {
    // A Creator should not fix a size problem only to discover a format problem next.
    const result = validateExportCandidate({ ...CLEAN_EXPORT, extension: '.usdz', sizeBytes: 999e9 });
    expect(result.blockedBy).toEqual(expect.arrayContaining(['FORMAT_NOT_ACCEPTED', 'TOO_LARGE']));
  });
});

describe('evaluatePublishGate', () => {
  const good = evaluateReadiness(CLEAN_METRICS);
  const poor = evaluateReadiness({ ...CLEAN_METRICS, meshesWithoutUvs: 1, totalPolycount: 600_000 });
  const badExport = validateExportCandidate({ ...CLEAN_EXPORT, gltfHeaderValid: false });

  it('allows a publish when the export is valid and the audit passed', () => {
    expect(evaluatePublishGate({ exportValidation: validateExportCandidate(CLEAN_EXPORT), readiness: good })).toEqual(
      { allowed: true, warnings: [] },
    );
  });

  it('blocks on an invalid export before it even looks at the audit', () => {
    const result = evaluatePublishGate({ exportValidation: badExport, readiness: good });
    expect(result).toMatchObject({ allowed: false, blockedBy: 'EXPORT_INVALID' });
  });

  it('blocks when no audit has been run, because FR-14.1 gates publish on a completed one', () => {
    const result = evaluatePublishGate({ exportValidation: validateExportCandidate(CLEAN_EXPORT) });
    expect(result).toMatchObject({ allowed: false, blockedBy: 'AUDIT_NOT_RUN' });
  });

  it('asks for an acknowledgment when the audit is below threshold (FR-11.10)', () => {
    expect(poor.passed).toBe(false);
    const result = evaluatePublishGate({
      exportValidation: validateExportCandidate(CLEAN_EXPORT),
      readiness: poor,
    });
    expect(result).toMatchObject({ allowed: false, blockedBy: 'ACKNOWLEDGEMENT_REQUIRED' });
  });

  it('allows a below-threshold publish once acknowledged, with the findings as warnings', () => {
    const result = evaluatePublishGate({
      exportValidation: validateExportCandidate(CLEAN_EXPORT),
      readiness: poor,
      acknowledgment: {
        acknowledgedBy: 'creator@example.test',
        acknowledgedAt: '2026-09-24T10:00:00.000Z',
        readinessScore: poor.score,
      },
    });

    // The audit is advisory, not a gate — VOID·SPACE's human review is the real one (§7.3).
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain(`${poor.score}/100`);
      // The acknowledgment is attributable, not anonymous.
      expect(result.warnings[0]).toContain('creator@example.test');
    }
  });

  it('never blocks on the audit itself, only on the missing acknowledgment', () => {
    // A score of 0 with an acknowledgment still publishes: that asymmetry is the requirement.
    const worst = evaluateReadiness({
      totalPolycount: 0,
      objectCount: 0,
      materialCount: 0,
      textureResolutions: [],
      maxHierarchyDepth: 0,
      unnamedObjects: 0,
      meshesWithoutUvs: 0,
    });
    const result = evaluatePublishGate({
      exportValidation: validateExportCandidate(CLEAN_EXPORT),
      readiness: worst,
      acknowledgment: {
        acknowledgedBy: 'creator@example.test',
        acknowledgedAt: '2026-09-24T10:00:00.000Z',
        readinessScore: worst.score,
      },
    });
    expect(result.allowed).toBe(true);
  });

  it('uses the recommended threshold as the boundary, not an arbitrary one', () => {
    expect(RECOMMENDED_READINESS_THRESHOLD).toBe(80);
    expect(good.score).toBeGreaterThanOrEqual(RECOMMENDED_READINESS_THRESHOLD);
  });
});

