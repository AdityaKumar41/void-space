import { z } from 'zod';
import { experienceDefinitionSchema } from './experience';

export const lessonQuestionSchema = z
  .object({
    id: z.string().min(1).max(60),
    prompt: z.string().min(1).max(800),
    options: z.array(z.string().min(1).max(300)).min(2).max(6),
    correctOption: z.number().int().min(0).max(5),
    explanation: z.string().min(1).max(1200),
  })
  .refine((question) => question.correctOption < question.options.length, {
    message: 'The correct answer must refer to an available option',
    path: ['correctOption'],
  });

export const lessonContentSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    summary: z.string().trim().min(10).max(2000),
    narration: z.string().trim().min(20).max(8000),
    outline: z.array(z.string().trim().min(3).max(1000)).min(1).max(30),
    questions: z.array(lessonQuestionSchema).min(1).max(30),
    passingScore: z.number().int().min(1).max(100),
  })
  .refine(
    (value) =>
      new Set(value.questions.map((question) => question.id)).size === value.questions.length,
    {
      message: 'Question identifiers must be unique',
      path: ['questions'],
    },
  );
export type LessonContent = z.infer<typeof lessonContentSchema>;

export const createLessonSchema = z.object({
  generateWithAi: z.boolean().default(false),
  sourceText: z.string().trim().min(20).max(20000).optional(),
  assetId: z.string().uuid(),
  title: z.string().min(3).max(200).optional(),
  passingScore: z.number().int().min(1).max(100).default(80),
});
export type CreateLessonInput = z.infer<typeof createLessonSchema>;

export const submitLessonAttemptSchema = z.object({
  answers: z.record(z.string(), z.number().int().min(0).max(5)),
});
export type SubmitLessonAttemptInput = z.infer<typeof submitLessonAttemptSchema>;

export const mentorQuestionSchema = z.object({
  question: z.string().trim().min(2).max(1000),
});
export type MentorQuestionInput = z.infer<typeof mentorQuestionSchema>;

const courseSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by hyphens');

export const createCourseSchema = z.object({
  title: z.string().trim().min(3).max(200),
  slug: courseSlugSchema,
  description: z.string().trim().min(20).max(4000),
  lessonIds: z.array(z.string().uuid()).min(1).max(100),
});
export type CreateCourseInput = z.infer<typeof createCourseSchema>;

const poseSchema = z
  .object({
    position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    rotation: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
      .optional(),
    device: z.enum(['web', 'mobile', 'vr', 'ar']).optional(),
  })
  .strict();

export const createSpatialRoomSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    experienceId: z.string().uuid().optional(),
    lessonId: z.string().uuid().optional(),
    assetId: z.string().uuid().optional(),
    worldState: z.record(z.unknown()).default({}),
  })
  .refine((value) => Boolean(value.lessonId || value.assetId || value.experienceId), {
    message: 'A spatial room requires a lesson, interactive experience or approved asset',
  });
export type CreateSpatialRoomInput = z.infer<typeof createSpatialRoomSchema>;

export const spatialHeartbeatSchema = z.object({ pose: poseSchema.optional() });
export const spatialWorldStateSchema = z.object({ worldState: z.record(z.unknown()) });

export const registerIoTDeviceSchema = z.object({
  label: z.string().trim().min(3).max(160),
  metadata: z.record(z.unknown()).optional(),
});
export const createDigitalTwinSchema = z.object({
  deviceId: z.string().uuid(),
  assetId: z.string().uuid().optional(),
  label: z.string().trim().min(3).max(160),
  state: z.record(z.unknown()).default({}),
});
export const deviceTelemetrySchema = z.object({
  payload: z.record(z.unknown()),
  eventAt: z.string().datetime().optional(),
});

export const scenarioRubricItemSchema = z.object({
  id: z.string().trim().min(1).max(60),
  label: z.string().trim().min(3).max(300),
  weight: z.number().int().min(1).max(100),
});
export const createScenarioSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(20).max(4000),
    lessonId: z.string().uuid().optional(),
    twinId: z.string().uuid().optional(),
    experience: experienceDefinitionSchema.optional(),
    rubric: z.array(scenarioRubricItemSchema).max(30).default([]),
  })
  .refine((value) => Boolean(value.lessonId || value.twinId || value.experience), {
    message: 'A simulator requires a published lesson, digital twin, or interactive experience',
  })
  .refine((value) => new Set(value.rubric.map((item) => item.id)).size === value.rubric.length, {
    message: 'Rubric item identifiers must be unique',
    path: ['rubric'],
  })
  .refine((value) => Boolean(value.experience) || value.rubric.length > 0, {
    message: 'Provide an interactive experience or scoring rubric',
  });
export type CreateScenarioInput = z.infer<typeof createScenarioSchema>;

export const submitScenarioAttemptSchema = z.object({
  evidence: z.record(z.string(), z.boolean()),
});
export type SubmitScenarioAttemptInput = z.infer<typeof submitScenarioAttemptSchema>;

export const fieldGuideStepSchema = z.object({
  id: z.string().trim().min(1).max(60),
  instruction: z.string().trim().min(3).max(1000),
  safetyNote: z.string().trim().min(3).max(1000).optional(),
  assetId: z.string().uuid().optional(),
});
export const createFieldGuideSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(20).max(4000),
    lessonId: z.string().uuid().optional(),
    assetId: z.string().uuid().optional(),
    steps: z.array(fieldGuideStepSchema).min(1).max(100),
  })
  .refine((value) => Boolean(value.lessonId || value.assetId), {
    message: 'A field guide requires a published lesson or approved asset',
  })
  .refine((value) => new Set(value.steps.map((step) => step.id)).size === value.steps.length, {
    message: 'Field guide step identifiers must be unique',
    path: ['steps'],
  });
export const completeFieldGuideSchema = z.object({
  completedStepIds: z.array(z.string().trim().min(1).max(60)).min(1).max(100),
  device: z.enum(['web', 'mobile', 'ar', 'vr']).optional(),
});

export const venturePlanSchema = z.object({
  title: z.string().trim().min(3).max(200),
  problem: z.string().trim().min(10).max(4000),
  customer: z.string().trim().min(3).max(2000),
  solution: z.string().trim().min(10).max(4000),
  nextMilestone: z.string().trim().min(3).max(1000),
});

export type LessonQuestion = z.infer<typeof lessonQuestionSchema>;

export interface LessonView {
  readonly id: string;
  readonly assetId: string;
  readonly title: string;
  readonly summary: string;
  readonly narration: string;
  readonly outline: readonly string[];
  readonly questions: readonly Omit<LessonQuestion, 'correctOption' | 'explanation'>[];
  readonly passingScore: number;
  readonly isPublished: boolean;
}
