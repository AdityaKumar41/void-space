import { z } from 'zod';

const key = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const experienceHotspotSchema = z
  .object({
    id: key,
    label: z.string().trim().min(2).max(100),
    meshKey: key.optional(),
    position: z.tuple([
      z.number().finite().min(-1).max(1),
      z.number().finite().min(-1).max(1),
      z.number().finite().min(-1).max(1),
    ]),
  })
  .strict();
const stepBase = {
  id: key,
  title: z.string().trim().min(3).max(160),
  instruction: z.string().trim().min(10).max(1500),
  explanation: z.string().trim().min(5).max(1500),
  weight: z.number().int().min(1).max(100),
};
export const experienceStepSchema = z.discriminatedUnion('kind', [
  z.object({ ...stepBase, kind: z.literal('identify'), targetId: key }).strict(),
  z
    .object({
      ...stepBase,
      kind: z.literal('operate'),
      operation: z.enum(['explode', 'assemble', 'isolate']),
      targetId: key.optional(),
    })
    .strict(),
  z
    .object({
      ...stepBase,
      kind: z.literal('decision'),
      choices: z
        .array(
          z
            .object({
              id: key,
              label: z.string().trim().min(2).max(250),
              feedback: z.string().trim().min(5).max(1000),
            })
            .strict(),
        )
        .min(2)
        .max(6),
      correctChoiceId: key,
      onIncorrect: z.enum(['retry', 'end']).default('retry'),
    })
    .strict(),
]);
export const experienceDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    assetId: z.string().uuid(),
    hotspots: z.array(experienceHotspotSchema).min(1).max(40),
    steps: z.array(experienceStepSchema).min(1).max(30),
    passingScore: z.number().int().min(1).max(100).default(80),
  })
  .strict()
  .superRefine((def, ctx) => {
    for (const field of ['hotspots', 'steps'] as const)
      if (new Set(def[field].map((x) => x.id)).size !== def[field].length)
        ctx.addIssue({ code: 'custom', path: [field], message: 'Identifiers must be unique' });
    for (const [index, step] of def.steps.entries()) {
      if (
        step.kind === 'operate' &&
        step.operation === 'isolate' &&
        (!step.targetId || !def.hotspots.find((h) => h.id === step.targetId)?.meshKey)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index, 'targetId'],
          message: 'Isolation requires a target attached to a model mesh',
        });

      if (
        (step.kind === 'identify' || (step.kind === 'operate' && step.targetId)) &&
        !def.hotspots.some((h) => h.id === step.targetId)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index, 'targetId'],
          message: 'Select an existing scene target',
        });
      if (
        step.kind === 'decision' &&
        (new Set(step.choices.map((c) => c.id)).size !== step.choices.length ||
          !step.choices.some((c) => c.id === step.correctChoiceId))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index, 'choices'],
          message: 'Choices must be unique and include the correct choice',
        });
    }
  });
export type ExperienceDefinition = z.infer<typeof experienceDefinitionSchema>;
export type ExperienceStep = z.infer<typeof experienceStepSchema>;
export type ExperienceHotspot = z.infer<typeof experienceHotspotSchema>;
export const experienceMediaSchema = z.object({
  versionId: z.string().uuid(),
  cid: z.string().min(1).max(120),
  format: z.string().min(1).max(10),
  name: z.string(),
  polycount: z.number().nullable(),
});
export const storedExperienceSchema = z.object({
  definition: experienceDefinitionSchema,
  media: experienceMediaSchema,
});
export type StoredExperience = z.infer<typeof storedExperienceSchema>;
export const startExperienceSchema = z
  .object({
    mode: z.enum(['practice', 'assessment']).default('practice'),
    restart: z.boolean().default(false),
  })
  .strict();
const eventBase = { eventKey: z.string().uuid(), revision: z.number().int().min(0) };
export const experienceActionSchema = z.discriminatedUnion('kind', [
  z.object({ ...eventBase, kind: z.literal('select_target'), targetId: key }).strict(),
  z.object({ ...eventBase, kind: z.literal('choose'), choiceId: key }).strict(),
  z
    .object({
      ...eventBase,
      kind: z.literal('operate'),
      operation: z.enum(['explode', 'assemble', 'isolate']),
      targetId: key.optional(),
    })
    .strict(),
]);
export type ExperienceAction = z.infer<typeof experienceActionSchema>;
export const experienceStateSchema = z.object({
  stepIndex: z.number().int().min(0),
  earned: z.number().nonnegative(),
  mistakes: z.number().int().nonnegative(),
  stepMistakes: z.number().int().nonnegative(),
  status: z.enum(['active', 'completed', 'failed']),
  feedback: z.string(),
  scene: z
    .object({ exploded: z.boolean(), isolatedTargetId: z.string().nullable() })
    .default({ exploded: false, isolatedTargetId: null }),
});
export type ExperienceState = z.infer<typeof experienceStateSchema>;
