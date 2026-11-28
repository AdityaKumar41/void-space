import { z } from 'zod';
import { experienceMediaSchema } from './experience';

const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
const point = z.tuple([
  z.number().finite().min(-1).max(1),
  z.number().finite().min(-1).max(1),
  z.number().finite().min(-1).max(1),
]);
export const learningSourceRefSchema = z
  .object({ sourceId: z.string().uuid(), passageId: id })
  .strict();
export const learningTargetSchema = z
  .object({
    id,
    label: z.string().trim().min(2).max(100),
    explanation: z.string().trim().max(2000).default(''),
    position: point,
    meshKey: id.optional(),
    placement: z.enum(['unplaced', 'suggested', 'confirmed']).optional(),
    sourceRefs: z.array(learningSourceRefSchema).max(10).default([]),
  })
  .strict();
const base = {
  id,
  title: z.string().trim().min(3).max(160),
  instruction: z.string().trim().min(5).max(1500),
  explanation: z.string().trim().min(3).max(2000),
  objectiveId: id,
  weight: z.number().int().min(0).max(100).default(100),
  sourceRefs: z.array(learningSourceRefSchema).max(10).default([]),
};
export const learningStepSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('identify'), targetId: id }).strict(),
  z
    .object({
      ...base,
      kind: z.literal('choice'),
      choices: z
        .array(z.object({ id, label: z.string().min(1).max(300) }).strict())
        .min(2)
        .max(8),
      correctIds: z.array(id).min(1).max(8),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('order'),
      items: z
        .array(z.object({ id, label: z.string().min(1).max(300) }).strict())
        .min(2)
        .max(12),
      correctOrder: z.array(id).min(2).max(12),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('match'),
      left: z
        .array(z.object({ id, label: z.string().min(1).max(300) }).strict())
        .min(2)
        .max(10),
      right: z
        .array(z.object({ id, label: z.string().min(1).max(300) }).strict())
        .min(2)
        .max(10),
      pairs: z.record(id, id),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('operate'),
      operation: z.enum(['explode', 'assemble', 'isolate']),
      targetId: id.optional(),
    })
    .strict(),
  z.object({ ...base, kind: z.literal('reflection'), weight: z.literal(0).default(0) }).strict(),
]);
export const learningActivitySchema = z
  .object({
    schemaVersion: z.literal(2),
    title: z.string().trim().min(3).max(200),
    summary: z.string().trim().min(10).max(3000),
    level: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
    estimatedMinutes: z.number().int().min(1).max(240).default(10),
    objectives: z
      .array(z.object({ id, label: z.string().min(3).max(300) }).strict())
      .min(1)
      .max(20),
    blocks: z
      .array(
        z
          .object({
            id,
            kind: z.enum(['reading', 'visual', 'example', 'practice', 'check']),
            title: z.string().min(1).max(160),
            text: z.string().max(8000),
            sourceRefs: z.array(learningSourceRefSchema).max(10).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    scene: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('none') }).strict(),
      z
        .object({ kind: z.literal('diagram'), imageSourceId: z.string().uuid().optional() })
        .strict(),
      z
        .object({
          kind: z.literal('process'),
          edges: z.array(z.object({ from: id, to: id }).strict()).max(60),
        })
        .strict(),
      z
        .object({
          kind: z.literal('model'),
          builtin: z.literal('geometry').optional(),
          privateModelId: z.string().uuid().optional(),
          assetId: z.string().uuid().optional(),
          media: experienceMediaSchema.optional(),
        })
        .strict(),
    ]),
    targets: z.array(learningTargetSchema).max(40),
    steps: z.array(learningStepSchema).min(1).max(30),
    passingScore: z.number().int().min(1).max(100).default(80),
    reviewed: z.boolean().default(false),
  })
  .strict()
  .superRefine((activity, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    for (const group of [activity.objectives, activity.blocks, activity.targets, activity.steps])
      if (new Set(group.map((x) => x.id)).size !== group.length)
        issue('Identifiers must be unique');
    const targets = new Set(activity.targets.map((x) => x.id)),
      objectives = new Set(activity.objectives.map((x) => x.id));
    for (const step of activity.steps) {
      if (!objectives.has(step.objectiveId)) issue('Task references an unknown objective');
      if (
        (step.kind === 'identify' || (step.kind === 'operate' && step.targetId)) &&
        !targets.has(step.targetId!)
      )
        issue('Task references an unknown target');
      if (step.kind !== 'reflection' && step.weight === 0)
        issue('Scored tasks need a positive weight');
      if (
        step.kind === 'choice' &&
        (new Set(step.choices.map((x) => x.id)).size !== step.choices.length ||
          new Set(step.correctIds).size !== step.correctIds.length ||
          step.correctIds.some((x) => !step.choices.some((c) => c.id === x)))
      )
        issue('Choice answer key is invalid');
      if (
        step.kind === 'order' &&
        (new Set(step.items.map((x) => x.id)).size !== step.items.length ||
          step.correctOrder.length !== step.items.length ||
          new Set(step.correctOrder).size !== step.items.length ||
          step.correctOrder.some((x) => !step.items.some((c) => c.id === x)))
      )
        issue('Ordering answer key is invalid');
      if (
        step.kind === 'match' &&
        (new Set(step.left.map((x) => x.id)).size !== step.left.length ||
          new Set(step.right.map((x) => x.id)).size !== step.right.length ||
          Object.keys(step.pairs).length !== step.left.length ||
          step.left.some((x) => !step.pairs[x.id]) ||
          Object.entries(step.pairs).some(
            ([a, b]) => !step.left.some((x) => x.id === a) || !step.right.some((x) => x.id === b),
          ))
      )
        issue('Matching answer key is invalid');
      if (step.kind === 'operate' && activity.scene.kind !== 'model')
        issue('Mesh operations require a model');
      if (
        step.kind === 'operate' &&
        step.operation === 'isolate' &&
        !activity.targets.some((t) => t.id === step.targetId && t.meshKey)
      )
        issue('Isolation needs a confirmed mesh target');
    }
    if (
      activity.scene.kind === 'model' &&
      !activity.scene.builtin &&
      !activity.scene.privateModelId &&
      (!activity.scene.assetId || !activity.scene.media)
    )
      issue('Choose a reviewed model');
    if (
      activity.scene.kind === 'process' &&
      activity.scene.edges.some((e) => !targets.has(e.from) || !targets.has(e.to))
    )
      issue('Process connection references an unknown target');
    if (['diagram','process'].includes(activity.scene.kind) && !activity.targets.length)
      issue('Visual activities need targets');
  });
export type LearningActivity = z.infer<typeof learningActivitySchema>;
export type LearningStep = z.infer<typeof learningStepSchema>;
export type LearningTarget = z.infer<typeof learningTargetSchema>;
export const learningActionSchema = z
  .object({
    eventKey: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    kind: z.enum(['select_target', 'answer', 'order', 'match', 'operate', 'reflect']),
    targetId: id.optional(),
    ids: z.array(id).max(12).optional(),
    pairs: z.record(id, id).optional(),
    operation: z.enum(['explode', 'assemble', 'isolate']).optional(),
    text: z.string().trim().max(3000).optional(),
  })
  .strict();
export type LearningAction = z.infer<typeof learningActionSchema>;
export const learningProgramUnitSchema = z
  .object({
    id: id.optional(),
    kind: z.enum(['lesson', 'activity', 'quiz']),
    releaseId: z.string().uuid(),
    requirement: z.enum(['complete_practice', 'pass_assessment']).default('pass_assessment'),
  })
  .strict();
