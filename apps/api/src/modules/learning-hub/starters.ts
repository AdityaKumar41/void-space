import { learningActivitySchema, type LearningActivity } from '@void-space/types';
const common = {
  schemaVersion: 2 as const,
  level: 'beginner' as const,
  estimatedMinutes: 8,
  passingScore: 80,
  reviewed: true,
};
const base = (id: string, title: string, instruction: string, explanation: string) => ({
  id,
  title,
  instruction,
  explanation,
  objectiveId: 'understand',
  weight: 100,
  sourceRefs: [],
});
const samples: Record<string, unknown> = {
  geometry: {
    ...common,
    title: 'Explore three geometric components',
    summary:
      'Inspect a box, sphere and cylinder in 3D. Identify parts and compare their visible features.',
    objectives: [
      { id: 'understand', label: 'Identify a box, sphere and cylinder from their visible forms' },
    ],
    blocks: [
      {
        id: 'read',
        kind: 'reading',
        title: 'Three forms',
        text: 'A box has flat rectangular faces. A sphere has a curved surface. A cylinder has two circular end faces and a curved side. Inspect each component, then practise identifying it.',
      },
      {
        id: 'look',
        kind: 'visual',
        title: 'Inspect the components',
        text: 'Select a component to read its explanation. Use the component list with a keyboard or touch.',
      },
    ],
    scene: { kind: 'model', builtin: 'geometry' },
    targets: [
      {
        id: 'box',
        label: 'Box',
        meshKey: 'box',
        position: [-0.6, 0, 0],
        explanation: 'This component is a box with flat rectangular faces.',
      },
      {
        id: 'sphere',
        label: 'Sphere',
        meshKey: 'sphere',
        position: [0, 0, 0],
        explanation: 'This component is a sphere with a curved surface.',
      },
      {
        id: 'cylinder',
        label: 'Cylinder',
        meshKey: 'cylinder',
        position: [0.6, 0, 0],
        explanation: 'This cylinder has circular ends and a curved side.',
      },
    ],
    steps: [
      {
        ...base(
          'identify',
          'Find the sphere',
          'Select the component with a curved surface in every direction.',
          'The sphere has a curved surface in every direction.',
        ),
        kind: 'identify',
        targetId: 'sphere',
      },
      {
        ...base(
          'isolate',
          'Inspect one component',
          'Select the box and isolate it.',
          'Isolation helps inspect one part without changing the model.',
        ),
        kind: 'operate',
        operation: 'isolate',
        targetId: 'box',
      },
      {
        ...base(
          'restore',
          'Restore the arrangement',
          'Reassemble the model to show all components.',
          'The original component arrangement is restored.',
        ),
        kind: 'operate',
        operation: 'assemble',
      },
    ],
  },
  diagram: {
    ...common,
    title: 'Read a simple circuit diagram',
    summary: 'Explore the roles of a supply, switch and lamp in a labelled circuit diagram.',
    objectives: [{ id: 'understand', label: 'Match circuit components to their described roles' }],
    blocks: [
      {
        id: 'read',
        kind: 'reading',
        title: 'Read the diagram',
        text: 'A supply provides electrical energy. A switch opens or closes a path. A lamp converts electrical energy into light. This activity labels components; it does not simulate a powered circuit.',
      },
      {
        id: 'example',
        kind: 'example',
        title: 'A useful question',
        text: 'To identify the switch, look for the component described as opening or closing a path.',
      },
    ],
    scene: { kind: 'diagram' },
    targets: [
      {
        id: 'supply',
        label: 'Supply',
        position: [-0.6, 0, 0],
        explanation: 'The supply provides electrical energy.',
      },
      {
        id: 'switch',
        label: 'Switch',
        position: [0, 0, 0],
        explanation: 'A switch opens or closes a path.',
      },
      {
        id: 'lamp',
        label: 'Lamp',
        position: [0.6, 0, 0],
        explanation: 'A lamp converts electrical energy into light.',
      },
    ],
    steps: [
      {
        ...base(
          'find',
          'Locate the switch',
          'Select the component that opens or closes a path.',
          'The switch controls whether the path is open or closed.',
        ),
        kind: 'identify',
        targetId: 'switch',
      },
      {
        ...base(
          'match',
          'Match component roles',
          'Match each component to its described role.',
          'These pairs match the supplied reading.',
        ),
        kind: 'match',
        left: [
          { id: 'supply', label: 'Supply' },
          { id: 'lamp', label: 'Lamp' },
        ],
        right: [
          { id: 'energy', label: 'Provides electrical energy' },
          { id: 'light', label: 'Produces light' },
        ],
        pairs: { supply: 'energy', lamp: 'light' },
      },
    ],
  },
  process: {
    ...common,
    title: 'From source notes to a reviewed lesson',
    summary:
      'Arrange the stages of creating a learning activity and decide when it is ready to share.',
    objectives: [{ id: 'understand', label: 'Sequence source collection, review and publication' }],
    blocks: [
      {
        id: 'read',
        kind: 'reading',
        title: 'A reviewed learning workflow',
        text: 'First collect source notes. Next draft the activity and review its facts, targets and answers. Finally publish the reviewed activity. Generating a draft with AI does not replace review.',
      },
    ],
    scene: {
      kind: 'process',
      edges: [
        { from: 'collect', to: 'review' },
        { from: 'review', to: 'publish' },
      ],
    },
    targets: [
      {
        id: 'collect',
        label: 'Collect sources',
        position: [-0.6, 0, 0],
        explanation: 'Collect the source material before writing the activity.',
      },
      {
        id: 'review',
        label: 'Review the draft',
        position: [0, 0, 0],
        explanation: 'Check facts, answers and visual targets before publication.',
      },
      {
        id: 'publish',
        label: 'Publish',
        position: [0.6, 0, 0],
        explanation: 'Publish only after review so learners receive the checked version.',
      },
    ],
    steps: [
      {
        ...base(
          'sequence',
          'Arrange the workflow',
          'Put the three stages into their correct order.',
          'Collect sources, review the draft, then publish.',
        ),
        kind: 'order',
        items: [
          { id: 'collect', label: 'Collect sources' },
          { id: 'review', label: 'Review draft' },
          { id: 'publish', label: 'Publish' },
        ],
        correctOrder: ['collect', 'review', 'publish'],
      },
      {
        ...base(
          'decision',
          'Choose the next action',
          'An AI draft contains an unverified answer. What should happen before sharing it?',
          'Review and correct the answer before publishing.',
        ),
        kind: 'choice',
        choices: [
          { id: 'publish', label: 'Publish immediately' },
          { id: 'review', label: 'Review and correct the answer' },
        ],
        correctIds: ['review'],
      },
    ],
  },
};
export const starterCatalog = Object.entries(samples).map(([id, raw]) => {
  const a = learningActivitySchema.parse(raw);
  return {
    id,
    title: a.title,
    summary: a.summary,
    kind: a.scene.kind,
    level: a.level,
    estimatedMinutes: a.estimatedMinutes,
    objectives: a.objectives,
  };
});
export function starterActivity(id: string): LearningActivity | null {
  return samples[id] ? learningActivitySchema.parse(samples[id]) : null;
}
