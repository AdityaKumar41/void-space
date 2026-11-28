import { z } from 'zod';

// Shared scene media and progress state used by the current lesson runtime.
export const experienceMediaSchema = z.object({
  versionId: z.string().uuid(),
  cid: z.string().min(1).max(120),
  format: z.string().min(1).max(10),
  name: z.string(),
  polycount: z.number().nullable(),
});
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
