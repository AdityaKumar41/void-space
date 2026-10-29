import type { ExperienceDefinition } from '@void-space/types';
export const definition: ExperienceDefinition = {
  schemaVersion: 1,
  assetId: '00000000-0000-4000-8000-000000000001',
  passingScore: 80,
  hotspots: [
    { id: 'housing', label: 'Housing', position: [0, 0, 0] },
    { id: 'battery', label: 'Battery', position: [0, -0.3, 0] },
  ],
  steps: [
    {
      id: 'identify',
      kind: 'identify',
      targetId: 'housing',
      title: 'Locate the housing',
      instruction: 'Select the housing directly in the 3D scene.',
      explanation: 'The housing surrounds the internal components.',
      weight: 50,
    },
    {
      id: 'decide',
      kind: 'decision',
      title: 'Respond to damage',
      instruction: 'A crack is reported on the housing. Choose the next action.',
      explanation: 'Report the damaged equipment.',
      weight: 50,
      correctChoiceId: 'report',
      onIncorrect: 'end',
      choices: [
        {
          id: 'report',
          label: 'Report the damage',
          feedback: 'The damage is reported for review.',
        },
        {
          id: 'continue',
          label: 'Ignore the damage',
          feedback: 'The defect remains unresolved. This attempt has ended.',
        },
      ],
    },
  ],
};
