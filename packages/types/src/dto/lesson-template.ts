import type { LessonPlan, LessonPlanRequest } from './lesson-plan';
import type { LearningActivity } from './learning-activity';
/** An editable structure, explicitly not a substitute for generated subject expertise. */
export function lessonTemplate(input: LessonPlanRequest, activity?: LearningActivity): LessonPlan {
  const check: LearningActivity = {
    schemaVersion: 2,
    title: 'Check your approach',
    summary: 'Check how to handle an unsupported claim while studying.',
    level: 'beginner',
    estimatedMinutes: 1,
    objectives: [{ id: 'evidence', label: 'Recognize when to consult reviewed sources' }],
    blocks: [
      {
        id: 'context',
        kind: 'reading',
        title: 'Use evidence',
        text: 'When material does not support an answer, consult reviewed sources or ask the author.',
        sourceRefs: [],
      },
    ],
    scene: { kind: 'none' },
    targets: [],
    steps: [
      {
        id: 'evidence_check',
        kind: 'choice',
        title: 'When evidence is missing',
        instruction: 'What should you do when the lesson material does not support an answer?',
        explanation: 'Consult reviewed sources or ask the author instead of guessing.',
        objectiveId: 'evidence',
        weight: 100,
        sourceRefs: [],
        choices: [
          { id: 'consult', label: 'Consult reviewed sources or ask the author' },
          { id: 'guess', label: 'Treat a plausible guess as a verified fact' },
        ],
        correctIds: ['consult'],
      },
    ],
    passingScore: 80,
    reviewed: false,
  };
  const kinds = ['introduction', 'explanation', 'exploration', 'quiz', 'recap'] as const;
  const durations = Array.from(
    { length: 5 },
    (_, i) => Math.floor(input.durationMinutes / 5) + (i < input.durationMinutes % 5 ? 1 : 0),
  );
  return {
    schemaVersion: 1,
    title: input.topic,
    summary: `A ${input.durationMinutes}-minute lesson about ${input.topic}. Review and complete this draft before sharing.`,
    audience: input.audience,
    subject: '',
    durationMinutes: input.durationMinutes,
    objectives: [`Explain the key ideas in ${input.topic}`],
    sourceIds: input.sourceIds,
    attribution: '',
    ...(input.sketchfabUrl ? { sketchfabUrl: input.sketchfabUrl } : {}),
    sections: kinds.map((kind, i) => ({
      id: `section_${i + 1}`,
      kind,
      title: [
        'Start with a question',
        'Build understanding',
        'Explore and practise',
        'Check understanding',
        'Recap and next steps',
      ][i]!,
      minutes: durations[i]!,
      body: [
        `Introduce ${input.topic} and discuss what learners already know.`,
        `Add reviewed explanations of ${input.topic}, with examples and references.`,
        `Explore the selected visual. Compare its components and explain your observations.`,
        `Complete the inline knowledge check, then discuss the explanation.`,
        `Summarize the objectives, revisit difficult ideas and identify what to study next.`,
      ][i]!,
      notes: '',
      sourceRefs: [],
      ...(kind === 'exploration' && activity ? { activity } : {}),
      ...(kind === 'quiz' ? { activity: check } : {}),
    })),
  };
}
