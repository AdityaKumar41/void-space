import { advanceLearningActivity, ActivityActionError } from '@void-space/types';
import type {
  LearningAction,
  LearningActivity,
  LearningStep,
  ExperienceState,
} from '@void-space/types';
import { ValidationError } from '../../lib/errors';
export function publicLearningStep(step: LearningStep, mode: 'practice' | 'assessment') {
  const { explanation, sourceRefs, ...common } = step;
  const copy: Record<string, unknown> = { ...common };
  for (const key of ['correctIds', 'correctOrder', 'pairs', 'targetId']) delete copy[key];
  if (mode === 'practice') {
    copy.sourceRefs = sourceRefs;
    if ('targetId' in step) copy.hintTargetId = step.targetId;
  }
  if (step.kind === 'order') copy.items = [...step.items].sort((a, b) => a.id.localeCompare(b.id));
  return copy;
}
export function advanceLearning(activity:LearningActivity,state:ExperienceState,action:LearningAction,mode:'practice'|'assessment') {
  try {return advanceLearningActivity(activity,state,action,mode);} catch(e) {if(e instanceof ActivityActionError)throw new ValidationError(e.message);throw e;}
}
