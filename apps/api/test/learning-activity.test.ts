import { describe, it, expect } from 'vitest';
import { learningActivitySchema, type LearningActivity } from '@void-space/types';
import { advanceLearning, publicLearningStep } from '../src/modules/learning-hub/runtime';
import { initialExperienceState } from '../src/modules/experiences/runtime';
const definition = () =>
  learningActivitySchema.parse({
    schemaVersion: 2,
    title: 'Circuit learning',
    summary: 'Explore a source-reviewed circuit diagram.',
    objectives: [{ id: 'o', label: 'Identify a circuit component' }],
    blocks: [{ id: 'b', kind: 'reading', title: 'Read', text: 'Inspect the circuit.' }],
    scene: { kind: 'diagram' },
    targets: [
      { id: 'lamp', label: 'Lamp', position: [0, 0, 0], explanation: 'The lamp is a component.' },
    ],
    steps: [
      {
        id: 's',
        kind: 'choice',
        title: 'Select a component',
        instruction: 'Choose the lamp.',
        explanation: 'The lamp matches the source.',
        objectiveId: 'o',
        choices: [
          { id: 'a', label: 'Wire' },
          { id: 'b', label: 'Lamp' },
        ],
        correctIds: ['b'],
      },
    ],
  });
describe('version two learning activities', () => {
  it('never exposes answer keys and gives no assessed pass for practice', () => {
    const d = definition();
    const step = publicLearningStep(d.steps[0]!, 'assessment');
    expect(step).not.toHaveProperty('correctIds');
    const next = advanceLearning(
      d,
      initialExperienceState(),
      { eventKey: crypto.randomUUID(), revision: 0, kind: 'answer', ids: ['b'] },
      'practice',
    );
    expect(next.state.status).toBe('completed');
    expect(next.passed).toBe(false);
  });
  it('scores server-side and penalizes mistakes', () => {
    const d = definition();
    const wrong = advanceLearning(
      d,
      initialExperienceState(),
      { eventKey: crypto.randomUUID(), revision: 0, kind: 'answer', ids: ['a'] },
      'assessment',
    );
    expect(wrong.state.stepIndex).toBe(0);
    const right = advanceLearning(
      d,
      wrong.state,
      { eventKey: crypto.randomUUID(), revision: 1, kind: 'answer', ids: ['b'] },
      'assessment',
    );
    expect(right.score).toBe(75);
    expect(right.passed).toBe(false);
  });
  it('rejects invalid generated keys instead of choosing the first answer', () => {
    const d = definition();
    (d.steps[0] as any).correctIds = ['missing'];
    expect(learningActivitySchema.safeParse(d).success).toBe(false);
  });
  it('validates ordering and matching and ignores browser score claims', () => {
    const d = definition();
    d.steps = [
      {
        id: 'order',
        title: 'Order items',
        instruction: 'Order the two items.',
        explanation: 'Source sequence.',
        objectiveId: 'o',
        weight: 100,
        sourceRefs: [],
        kind: 'order',
        items: [
          { id: 'a', label: 'First' },
          { id: 'b', label: 'Second' },
        ],
        correctOrder: ['b', 'a'],
      },
    ];
    expect(() =>
      advanceLearning(
        d,
        initialExperienceState(),
        { eventKey: crypto.randomUUID(), revision: 0, kind: 'order', ids: ['a', 'a'] },
        'assessment',
      ),
    ).toThrow();
  });
});
