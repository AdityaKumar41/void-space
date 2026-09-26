/**
 * Tests for the Copilot tool catalogue and its validator.
 *
 * The first suite is the important one. FR-11.5 says a Copilot action must never trigger a publish,
 * and "publish is not in the list today" is a much weaker guarantee than "publish cannot be reached".
 * These assert both: the catalogue is closed, and a publish-shaped call is refused *by name* even
 * though it is not in the catalogue.
 */
import { describe, expect, it } from 'vitest';

import {
  STUDIO_TOOLS,
  STUDIO_TOOL_NAMES,
  addPrimitiveSchema,
  setTransformSchema,
} from '../src/copilot/tools';
import { validateToolCall, validateToolCalls, type ValidationContext } from '../src/copilot/validate';

const SCENE: ValidationContext['scene'] = {
  objects: [
    { id: 'obj-table', name: 'Table', type: 'mesh', childCount: 0, materialIds: ['mat-1'] },
    { id: 'obj-group', name: 'Crates', type: 'empty', childCount: 3, materialIds: [] },
  ],
  selection: ['obj-table'],
  unit: 'metre',
};

const CONTEXT: ValidationContext = { scene: SCENE, canEditProject: true };

describe('the tool catalogue', () => {
  it('is closed: every declared name has a definition and no others exist', () => {
    expect(Object.keys(STUDIO_TOOLS).sort()).toEqual([...STUDIO_TOOL_NAMES].sort());
  });

  it('contains nothing that can publish (FR-11.5)', () => {
    // A pattern rather than an exact list, so a future `publishNow` or `autoPublish` also fails here
    // instead of quietly slipping past an equality assertion.
    const publishing = STUDIO_TOOL_NAMES.filter((name) => /publish|submit|licen[cs]e/i.test(name));
    expect(publishing).toEqual([]);
  });

  it('marks generating tools with the flag a TenantAdmin can switch off (FR-18.1)', () => {
    expect(STUDIO_TOOLS.generateMesh.aiFeature).toBe('generativeMesh');
    expect(STUDIO_TOOLS.generateTexture.aiFeature).toBe('generativeTexture');
    // Editing tools must not be behind a flag: §7.5 requires the whole modeling toolset to keep
    // working with every AI feature disabled.
    expect(STUDIO_TOOLS.addPrimitive.aiFeature).toBeUndefined();
    expect(STUDIO_TOOLS.setTransform.aiFeature).toBeUndefined();
  });
});

describe('tool schemas', () => {
  it('rejects a coordinate beyond the scene-bounds limit (§7.2)', () => {
    expect(addPrimitiveSchema.safeParse({ kind: 'cube', location: [0, 0, 1_000_000] }).success).toBe(
      false,
    );
  });

  it('accepts a coordinate at the limit and applies the default scale', () => {
    const result = addPrimitiveSchema.safeParse({ kind: 'cube', location: [100_000, 0, 0] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scale).toEqual([1, 1, 1]);
  });

  it('refuses a non-positive scale, which would collapse or invert geometry', () => {
    expect(addPrimitiveSchema.safeParse({ kind: 'cube', scale: [0, 1, 1] }).success).toBe(false);
    expect(addPrimitiveSchema.safeParse({ kind: 'cube', scale: [-2, 1, 1] }).success).toBe(false);
  });

  it('refuses a transform that changes nothing', () => {
    // An empty transform would still push an undo step, so undo would appear to do nothing.
    expect(setTransformSchema.safeParse({ objectId: 'obj-table' }).success).toBe(false);
    expect(setTransformSchema.safeParse({ objectId: 'obj-table', rotate: [0, 90, 0] }).success).toBe(
      true,
    );
  });

  it('defaults `recursive` to false so a subtree is never deleted by implication', () => {
    const parsed = STUDIO_TOOLS.deleteObject.schema.safeParse({ objectId: 'obj-group' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ recursive: false });
  });
});

describe('validation', () => {
  const check = (name: string, input: unknown, context: ValidationContext = CONTEXT) =>
    validateToolCall({ name, input }, context, 'g1');

  it('accepts a well-formed call and stamps the group id used for one-step undo', () => {
    const outcome = check('setTransform', { objectId: 'obj-table', rotate: [0, 90, 0] });
    expect(outcome.status).toBe('accepted');
    if (outcome.status === 'accepted') expect(outcome.groupId).toBe('g1');
  });

  it('refuses a publish attempt by name, with its own reason (FR-11.5)', () => {
    expect(check('publish', { objectId: 'obj-table' })).toMatchObject({
      status: 'rejected',
      reason: 'PUBLISH_REQUIRES_HUMAN_ACTION',
    });
  });

  it('refuses an invented tool rather than ignoring it (FR-11.3)', () => {
    expect(check('runArbitraryScript', { code: 'alert(1)' })).toMatchObject({
      status: 'rejected',
      reason: 'UNKNOWN_TOOL',
    });
  });

  it('reports malformed arguments with the offending field named', () => {
    const outcome = check('setMaterialProperty', {
      objectId: 'obj-table',
      property: 'shininess',
      value: 1,
    });
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toBe('INVALID_ARGUMENTS');
      expect(outcome.message).toContain('property');
    }
  });

  it('refuses every call when the caller may not edit the project', () => {
    expect(
      check('setTransform', { objectId: 'obj-table', scale: [2, 2, 2] }, {
        ...CONTEXT,
        canEditProject: false,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'PERMISSION_DENIED' });
  });

  it('honours a disabled AI feature even though the model proposed the call (FR-18.1)', () => {
    const context: ValidationContext = { ...CONTEXT, enabledAiFeatures: ['copilot'] };
    expect(check('generateMesh', { prompt: 'a wooden crate' }, context)).toMatchObject({
      status: 'rejected',
      reason: 'FEATURE_DISABLED',
    });
    // The editing toolset is never behind a flag, so it keeps working with generation switched off
    // (§7.5, graceful degradation).
    expect(check('setTransform', { objectId: 'obj-table', rotate: [0, 1, 0] }, context).status).toBe(
      'accepted',
    );
  });

  it('refuses an edit naming an object that is not in the scene the model was shown', () => {
    expect(check('setTransform', { objectId: 'obj-ghost', rotate: [0, 1, 0] })).toMatchObject({
      status: 'rejected',
      reason: 'OBJECT_NOT_FOUND',
    });
  });

  it('refuses deleting a parent without saying the children go too (FR-3.1)', () => {
    expect(check('deleteObject', { objectId: 'obj-group' })).toMatchObject({
      status: 'rejected',
      reason: 'OBJECT_HAS_CHILDREN',
    });
    expect(check('deleteObject', { objectId: 'obj-group', recursive: true }).status).toBe('accepted');
  });

  it('refuses a group containing an object that does not exist', () => {
    expect(check('groupObjects', { objectIds: ['obj-table', 'obj-ghost'] })).toMatchObject({
      status: 'rejected',
      reason: 'OBJECT_NOT_FOUND',
    });
  });
});

describe('batch validation', () => {
  it('gives every accepted call in one instruction the same group id, so undo is one step (§7.2)', () => {
    const outcomes = validateToolCalls(
      [
        { name: 'addPrimitive', input: { kind: 'cube', location: [1, 1, 1] } },
        {
          name: 'setMaterialProperty',
          input: { objectId: 'obj-table', property: 'metallic', value: 1 },
        },
      ],
      CONTEXT,
    );

    const groupIds = outcomes
      .filter((outcome) => outcome.status === 'accepted')
      .map((outcome) => (outcome.status === 'accepted' ? outcome.groupId : null));
    expect(groupIds).toHaveLength(2);
    expect(new Set(groupIds).size).toBe(1);
  });

  it('applies the valid calls even when one in the batch is refused', () => {
    const outcomes = validateToolCalls(
      [
        { name: 'setTransform', input: { objectId: 'obj-table', rotate: [0, 45, 0] } },
        { name: 'setTransform', input: { objectId: 'obj-ghost', rotate: [0, 45, 0] } },
      ],
      CONTEXT,
    );

    // The good call still lands: discarding the whole instruction would be the silent skip FR-11.3
    // forbids, just at a coarser granularity.
    expect(outcomes[0]?.status).toBe('accepted');
    expect(outcomes[1]?.status).toBe('rejected');
  });
});

