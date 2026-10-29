import { describe, expect, it } from 'vitest';
import {
  advanceExperience,
  initialExperienceState,
  publicExperienceStep,
} from '../src/modules/experiences/runtime';
import { experienceDefinitionSchema } from '@void-space/types';
import { definition } from './experience-fixture';

const action = (targetId: string) => ({
  eventKey: '00000000-0000-4000-8000-000000000002',
  revision: 0,
  kind: 'select_target' as const,
  targetId,
});
describe('Interactive experience engine', () => {
  it('does not advance for wrong scene targets and scores only accepted actions', () => {
    const wrong = advanceExperience(
      definition,
      initialExperienceState(),
      action('battery'),
      'assessment',
    );
    expect(wrong.state).toMatchObject({ stepIndex: 0, mistakes: 1 });
    const correct = advanceExperience(definition, wrong.state, action('housing'), 'assessment');
    expect(correct.state).toMatchObject({ stepIndex: 1, earned: 37.5 });
  });
  it('ends an assessment on a defined failure consequence', () => {
    const first = advanceExperience(
      definition,
      initialExperienceState(),
      action('housing'),
      'assessment',
    );
    const result = advanceExperience(
      definition,
      first.state,
      { eventKey: action('housing').eventKey, revision: 1, kind: 'choose', choiceId: 'continue' },
      'assessment',
    );
    expect(result.state.status).toBe('failed');
    expect(result.passed).toBe(false);
  });
  it('allows coached retry in practice without issuing passing assessment evidence', () => {
    const first = advanceExperience(
      definition,
      initialExperienceState(),
      action('housing'),
      'practice',
    );
    const wrong = advanceExperience(
      definition,
      first.state,
      { eventKey: action('housing').eventKey, revision: 1, kind: 'choose', choiceId: 'continue' },
      'practice',
    );
    expect(wrong.state.status).toBe('active');
    const result = advanceExperience(
      definition,
      wrong.state,
      { eventKey: action('housing').eventKey, revision: 2, kind: 'choose', choiceId: 'report' },
      'practice',
    );
    expect(result.state.status).toBe('completed');
    expect(result.passed).toBe(false);
  });
  it('rejects unknown interactions and does not disclose assessment answers', () => {
    expect(() =>
      advanceExperience(definition, initialExperienceState(), action('forged'), 'assessment'),
    ).toThrow();
    expect(publicExperienceStep(definition.steps[0]!, 'assessment')).not.toHaveProperty(
      'hintTargetId',
    );
    expect(publicExperienceStep(definition.steps[1]!, 'assessment')).not.toHaveProperty(
      'correctChoiceId',
    );
  });
  it('records real scene operations, rejects out-of-phase actions and restores assembly', () => {
    const operate = {
      ...definition,
      hotspots: [{ ...definition.hotspots[0]!, meshKey: 'mesh-0' }],
      steps: [
        {
          id: 'explode',
          kind: 'operate' as const,
          operation: 'explode' as const,
          title: 'Explore parts',
          instruction: 'Separate the mesh components.',
          explanation: 'The component layout is visible.',
          weight: 50,
        },
        {
          id: 'isolate',
          kind: 'operate' as const,
          operation: 'isolate' as const,
          targetId: 'housing',
          title: 'Inspect housing',
          instruction: 'Isolate the housing component.',
          explanation: 'Only the housing remains visible.',
          weight: 50,
        },
        {
          id: 'assemble',
          kind: 'operate' as const,
          operation: 'assemble' as const,
          title: 'Restore assembly',
          instruction: 'Restore the assembled object.',
          explanation: 'The original assembly is restored.',
          weight: 50,
        },
      ],
    };
    expect(() =>
      advanceExperience(operate, initialExperienceState(), action('housing'), 'assessment'),
    ).toThrow();
    const event = { eventKey: action('housing').eventKey, revision: 0, kind: 'operate' as const };
    const separated = advanceExperience(
      operate,
      initialExperienceState(),
      { ...event, operation: 'explode' },
      'assessment',
    );
    expect(separated.state.scene.exploded).toBe(true);
    const isolated = advanceExperience(
      operate,
      separated.state,
      { ...event, operation: 'isolate', targetId: 'housing' },
      'assessment',
    );
    expect(isolated.state.scene.isolatedTargetId).toBe('housing');
    const restored = advanceExperience(
      operate,
      isolated.state,
      { ...event, operation: 'assemble' },
      'assessment',
    );
    expect(restored.state.scene).toEqual({ exploded: false, isolatedTargetId: null });
    expect(restored.passed).toBe(true);
    expect(
      experienceDefinitionSchema.safeParse({
        ...operate,
        steps: [{ ...operate.steps[1], targetId: undefined }],
      }).success,
    ).toBe(false);
  });
  it('validates scene references before publication', () => {
    expect(experienceDefinitionSchema.safeParse({ ...definition, hotspots: [] }).success).toBe(
      false,
    );
  });
});
