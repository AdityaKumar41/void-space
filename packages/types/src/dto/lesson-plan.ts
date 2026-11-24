import { z } from 'zod';
import { learningActivitySchema, learningSourceRefSchema } from './learning-activity';
const key = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const lessonPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().trim().min(3).max(200),
    summary: z.string().trim().min(10).max(2000),
    audience: z.string().trim().min(3).max(200),
    subject: z.string().trim().max(100).default(''),
    durationMinutes: z.number().int().min(5).max(180),
    objectives: z.array(z.string().trim().min(3).max(300)).min(1).max(12),
    sourceIds: z.array(z.string().uuid()).max(5).default([]),
    privateModelId: z.string().uuid().optional(),
    assetId: z.string().uuid().optional(),
    assetVersionId: z.string().uuid().optional(),
    sketchfabUrl: z
      .string()
      .url()
      .max(1000)
      .regex(/^https:\/\/(www\.)?sketchfab\.com\/3d-models\/[a-zA-Z0-9_-]+\/?$/)
      .optional(),
    attribution: z.string().max(1500).default(''),
    sections: z
      .array(
        z
          .object({
            id: key,
            kind: z.enum([
              'introduction',
              'explanation',
              'exploration',
              'practice',
              'quiz',
              'recap',
            ]),
            title: z.string().trim().min(3).max(160),
            minutes: z.number().int().min(1).max(180),
            body: z.string().trim().min(10).max(8000),
            notes: z.string().max(4000).default(''),
            sourceRefs: z.array(learningSourceRefSchema).max(10).default([]),
            activity: learningActivitySchema.optional(),
          })
          .strict(),
      )
      .min(3)
      .max(24),
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (p.privateModelId && p.assetId) issue('Choose one primary model for the lesson');
    if (new Set(p.sections.map((s) => s.id)).size !== p.sections.length)
      issue('Section IDs must be unique');
    if (p.sections.reduce((n, s) => n + s.minutes, 0) !== p.durationMinutes)
      issue('Section timings must add up to the lesson duration');
    if (!p.sections.some((s) => s.kind === 'introduction') || p.sections.at(-1)?.kind !== 'recap')
      issue('Include an introduction and finish with a recap');
    if (!p.sections.some((s) => s.kind === 'quiz' && s.activity))
      issue('Include at least one inline quiz');
    for (const s of p.sections) {
      if (['practice', 'quiz'].includes(s.kind) && !s.activity)
        issue('Practice and quiz sections require an activity');
      if (s.kind === 'quiz' && s.activity?.steps.some((q) => q.kind === 'reflection'))
        issue('Use reflections in practice, not scored quiz sections');
    }
    if (Boolean(p.assetId) !== Boolean(p.assetVersionId))
      issue('Pin both the asset and its reviewed version');
  });
export type LessonPlan = z.infer<typeof lessonPlanSchema>;
export const lessonPlanRequestSchema = z
  .object({
    topic: z.string().trim().min(3).max(200),
    audience: z.string().trim().min(3).max(200),
    durationMinutes: z.number().int().min(5).max(180),
    instructions: z.string().max(3000).default(''),
    sourceIds: z.array(z.string().uuid()).max(5).default([]),
    privateModelId: z.string().uuid().optional(),
    assetId: z.string().uuid().optional(),
    sketchfabUrl: lessonPlanSchema.innerType().shape.sketchfabUrl,
  })
  .strict();
export type LessonPlanRequest = z.infer<typeof lessonPlanRequestSchema>;
export const lessonReviewSchema = z
  .object({
    facts: z.literal(true),
    answers: z.literal(true),
    mappings: z.literal(true),
    rights: z.literal(true),
  })
  .strict();
export const initialLessonActivityState = () => ({
  stepIndex: 0,
  earned: 0,
  mistakes: 0,
  stepMistakes: 0,
  status: 'active' as const,
  feedback: '',
  scene: { exploded: false, isolatedTargetId: null },
});
/** A learner never receives instructor notes, grading keys or hidden component mappings. */
export function learnerLessonPlan(plan: LessonPlan) {
  return {
    ...plan,
    sections: plan.sections.map(({ notes, activity, ...s }) => ({
      ...s,
      ...(activity
        ? {
            activity: {
              ...activity,
              steps: activity.steps.map((step) => {
                const safe: Record<string, unknown> = { ...step };
                for (const k of ['correctIds', 'correctOrder', 'pairs', 'targetId', 'explanation'])
                  delete safe[k];
                if (step.kind === 'order')
                  safe.items = [...step.items].sort((a, b) => a.id.localeCompare(b.id));
                return safe;
              }),
            },
          }
        : {}),
    })),
  };
}
