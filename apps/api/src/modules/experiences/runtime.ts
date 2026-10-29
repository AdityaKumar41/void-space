import type { ExperienceAction, ExperienceDefinition, ExperienceState } from '@void-space/types';
import { ConflictError, ValidationError } from '../../lib/errors';

export const initialExperienceState = (): ExperienceState => ({
  stepIndex: 0,
  earned: 0,
  mistakes: 0,
  stepMistakes: 0,
  status: 'active',
  feedback: '',
  scene: { exploded: false, isolatedTargetId: null },
});
/** Only accepted scene actions drive progress. A browser never submits scores or success flags. */
export function advanceExperience(
  def: ExperienceDefinition,
  state: ExperienceState,
  action: ExperienceAction,
  mode: 'practice' | 'assessment',
) {
  if (state.status !== 'active')
    throw new ConflictError('This run has finished. Start a new attempt.');
  const step = def.steps[state.stepIndex];
  if (!step) throw new ConflictError('The run no longer has an active task');
  let correct = false;
  let feedback = step.explanation;
  if (step.kind === 'identify') {
    if (action.kind !== 'select_target')
      throw new ValidationError('Select a target in the 3D scene for this task');
    if (!def.hotspots.some((h) => h.id === action.targetId))
      throw new ValidationError('Unknown scene target');
    correct = action.targetId === step.targetId;
    if (!correct) feedback = 'That is a different component. Inspect the scene and try again.';
  } else if (step.kind === 'operate') {
    if (action.kind !== 'operate')
      throw new ValidationError('Operate the scene control for this task');
    if (action.targetId && !def.hotspots.some((h) => h.id === action.targetId))
      throw new ValidationError('Unknown scene target');
    correct =
      action.operation === step.operation && (!step.targetId || action.targetId === step.targetId);
    if (!correct) feedback = 'This task needs a different scene operation. Review the instruction.';
  } else {
    if (action.kind !== 'choose')
      throw new ValidationError('Choose an action for the current situation');
    const choice = step.choices.find((c) => c.id === action.choiceId);
    if (!choice) throw new ValidationError('Unknown action for this situation');
    correct = choice.id === step.correctChoiceId;
    feedback = choice.feedback;
  }
  const next: ExperienceState = { ...state, scene: { ...state.scene }, feedback };
  if (correct && action.kind === 'operate') {
    if (action.operation === 'explode') next.scene.exploded = true;
    if (action.operation === 'assemble') {
      next.scene.exploded = false;
      next.scene.isolatedTargetId = null;
    }
    if (action.operation === 'isolate') next.scene.isolatedTargetId = action.targetId ?? null;
  }
  if (correct) {
    next.earned +=
      mode === 'practice'
        ? step.weight
        : Math.max(0, step.weight * (1 - state.stepMistakes * 0.25));
    next.stepIndex += 1;
    next.stepMistakes = 0;
    if (next.stepIndex === def.steps.length) next.status = 'completed';
  } else {
    next.mistakes += 1;
    next.stepMistakes += 1;
    if (step.kind === 'decision' && step.onIncorrect === 'end' && mode === 'assessment')
      next.status = 'failed';
  }
  const possible = def.steps.reduce((sum, s) => sum + s.weight, 0);
  return {
    state: next,
    correct,
    score: Math.round((100 * next.earned) / possible),
    passed:
      mode === 'assessment' &&
      next.status === 'completed' &&
      Math.round((100 * next.earned) / possible) >= def.passingScore,
  };
}
export function publicExperienceStep(
  step: ExperienceDefinition['steps'][number],
  mode: 'practice' | 'assessment',
) {
  if (step.kind === 'operate')
    return {
      id: step.id,
      title: step.title,
      instruction: step.instruction,
      kind: step.kind,
      operation: step.operation,
      ...(mode === 'practice' ? { hintTargetId: step.targetId } : {}),
    };
  if (step.kind === 'identify')
    return {
      id: step.id,
      title: step.title,
      instruction: step.instruction,
      kind: step.kind,
      ...(mode === 'practice' ? { hintTargetId: step.targetId } : {}),
    };
  return {
    id: step.id,
    title: step.title,
    instruction: step.instruction,
    kind: step.kind,
    choices: step.choices.map(({ id, label }) => ({ id, label })),
  };
}
