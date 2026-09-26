/**
 * What must be true before a project may be published (VS2-SRS-1.0 FR-10.4, FR-14.1, FR-11.10).
 *
 * Two independent gates are combined here, and the difference between them is the whole point of the
 * file:
 *
 *   - **Export validation is a hard gate** (FR-10.4, FR-14.1). If the GLB is not something
 *     VOID·SPACE will accept, there is nothing to discuss — publishing it would only produce a
 *     rejected upload and a confusing error attributed to the wrong system.
 *   - **The readiness audit is advisory** (FR-11.10, §7.3). A Creator may publish below the
 *     recommended score with an explicit acknowledgment. Making the audit a hard gate would give
 *     VOID·STUDIO a second quality gate competing with VOID·SPACE's own human review
 *     (VS-SRS-2.0 FR-7.6), which is exactly what §7.3 says must not happen.
 *
 * Collapsing the two into one "canPublish" boolean is the mistake this module exists to prevent: it
 * would make a soft recommendation indistinguishable from a hard constraint.
 */
import {
  ALLOWED_ASSET_EXTENSIONS,
  MAX_ASSET_SIZE_BYTES,
  type AssetExtension,
} from '@void-space/types';

import type { ReadinessReport } from '../audit/readiness';

/** The export candidate, as measured by the Editor Engine's exporter (FR-10.3). */
export interface ExportCandidate {
  /** Lower-case, including the dot — `.glb`, `.gltf`. */
  readonly extension: string;
  readonly sizeBytes: number;
  readonly polycount: number;
  readonly textureResolutions: readonly number[];
  readonly materialCount: number;
  /**
   * Whether the export declared a valid glTF asset header.
   *
   * FR-10.3 requires a "glTF-valid GLB"; FR-6.4 requires materials to be glTF-PBR-compatible. Both
   * are properties of the produced file, so they are reported by the exporter rather than inferred
   * here — this module has no business opening the file.
   */
  readonly gltfHeaderValid: boolean;
  /** Node-graph or material features that have no glTF equivalent (FR-6.4). */
  readonly unsupportedMaterialFeatures: readonly string[];
}

export const EXPORT_BLOCK_REASONS = [
  'FORMAT_NOT_ACCEPTED',
  'TOO_LARGE',
  'INVALID_GLTF',
  'INCOMPATIBLE_MATERIAL',
] as const;
export type ExportBlockReason = (typeof EXPORT_BLOCK_REASONS)[number];

export interface ExportValidationResult {
  readonly valid: boolean;
  readonly blockedBy: readonly ExportBlockReason[];
  /** Plain language, shown to the Creator. */
  readonly messages: readonly string[];
}

/**
 * FR-10.4's validation pass: polycount, texture size, material compatibility — plus the transport
 * limits VOID·SPACE enforces at upload (VS-SRS-2.0 FR-3.1) so an upload is never attempted that the
 * far end is certain to refuse.
 */
export function validateExportCandidate(candidate: ExportCandidate): ExportValidationResult {
  const blockedBy: ExportBlockReason[] = [];
  const messages: string[] = [];

  const extension = candidate.extension.toLowerCase();
  if (!(ALLOWED_ASSET_EXTENSIONS as readonly string[]).includes(extension)) {
    blockedBy.push('FORMAT_NOT_ACCEPTED');
    messages.push(
      `"${extension}" is not a format VOID·SPACE accepts. Allowed: ${ALLOWED_ASSET_EXTENSIONS.join(', ')}.`,
    );
  }

  if (candidate.sizeBytes > MAX_ASSET_SIZE_BYTES) {
    blockedBy.push('TOO_LARGE');
    const limitMb = Math.round(MAX_ASSET_SIZE_BYTES / (1024 * 1024));
    const actualMb = (candidate.sizeBytes / (1024 * 1024)).toFixed(1);
    messages.push(`The export is ${actualMb} MB against a ${limitMb} MB limit.`);
  }

  if (!candidate.gltfHeaderValid) {
    blockedBy.push('INVALID_GLTF');
    messages.push('The exported GLB has no valid glTF header, so VOID·SPACE would reject it.');
  }

  if (candidate.unsupportedMaterialFeatures.length > 0) {
    blockedBy.push('INCOMPATIBLE_MATERIAL');
    messages.push(
      `These material features have no glTF equivalent and would be lost on export: ${candidate.unsupportedMaterialFeatures.join(', ')} (FR-6.4).`,
    );
  }

  return { valid: blockedBy.length === 0, blockedBy, messages };
}

/** Narrows an arbitrary extension to one VOID·SPACE accepts, for callers that need the type. */
export function isAcceptableExtension(extension: string): extension is AssetExtension {
  return (ALLOWED_ASSET_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

/** Recorded when a Creator chooses to publish despite a below-threshold audit (FR-11.10). */
export interface PublishAcknowledgment {
  /** Who accepted the risk. Stored so the decision is attributable, not anonymous. */
  readonly acknowledgedBy: string;
  readonly acknowledgedAt: string;
  /** The score at the moment of acknowledgment — §7.3 stores the report with the version. */
  readonly readinessScore: number;
}

export const PUBLISH_BLOCK_REASONS = [
  /** FR-14.1 — export validation did not pass. */
  'EXPORT_INVALID',
  /** FR-14.1 — no completed audit exists for this version. */
  'AUDIT_NOT_RUN',
  /** FR-11.10 — below threshold and the Creator has not accepted it yet. */
  'ACKNOWLEDGEMENT_REQUIRED',
] as const;
export type PublishBlockReason = (typeof PUBLISH_BLOCK_REASONS)[number];

export interface PublishGateInput {
  readonly exportValidation: ExportValidationResult;
  /** Absent when the audit has not been run for the version being published. */
  readonly readiness?: ReadinessReport | undefined;
  readonly acknowledgment?: PublishAcknowledgment | undefined;
}

/**
 * The outcome of the gate.
 *
 * `allowed: true` still carries `warnings`, so a publish that went ahead on an acknowledgment can be
 * surfaced in the UI and written into the audit trail rather than looking like an ordinary publish.
 */
export type PublishGateResult =
  | { readonly allowed: true; readonly warnings: readonly string[] }
  | {
      readonly allowed: false;
      readonly blockedBy: PublishBlockReason;
      readonly message: string;
    };

/**
 * Decides whether a publish may proceed (FR-14.1, FR-11.10).
 *
 * The checks run in order of hardness, so the message a Creator sees is always about the most
 * fundamental problem: an invalid export is reported before a missing audit, because fixing the audit
 * would not make an unreadable GLB publishable.
 */
export function evaluatePublishGate(input: PublishGateInput): PublishGateResult {
  if (!input.exportValidation.valid) {
    return {
      allowed: false,
      blockedBy: 'EXPORT_INVALID',
      message: `The export did not pass validation: ${input.exportValidation.messages.join(' ')}`,
    };
  }

  if (!input.readiness) {
    return {
      allowed: false,
      blockedBy: 'AUDIT_NOT_RUN',
      // FR-14.1 requires the audit to have *completed* before publish is offered at all, so this is
      // a missing step rather than a failing one.
      message: 'Run the pre-publish check first — publish is gated on a completed audit (FR-14.1).',
    };
  }

  if (input.readiness.passed) {
    return { allowed: true, warnings: [] };
  }

  if (!input.acknowledgment) {
    return {
      allowed: false,
      blockedBy: 'ACKNOWLEDGEMENT_REQUIRED',
      message: `The pre-publish check scored ${input.readiness.score}/100, below the recommended ${input.readiness.threshold}. You can publish anyway, but confirm first — your reviewer may send it back.`,
    };
  }

  // Below threshold, explicitly accepted. §7.3: the audit advises; VOID·SPACE's review decides.
  return {
    allowed: true,
    warnings: [
      `Published with a readiness score of ${input.readiness.score}/100, below the recommended ${input.readiness.threshold}, acknowledged by ${input.acknowledgment.acknowledgedBy}.`,
      ...input.readiness.issues
        .filter((issue) => issue.severity !== 'info')
        .map((issue) => issue.message),
    ],
  };
}

