import type { LearningAction, LearningActivity } from './learning-activity';
import type { ExperienceState } from './experience';
export class ActivityActionError extends Error {}
export function advanceLearningActivity(
  activity: LearningActivity,
  state: ExperienceState,
  action: LearningAction,
  mode: 'practice' | 'assessment',
) {
  const step = activity.steps[state.stepIndex];
  if (!step || state.status !== 'active')
    throw new ActivityActionError('This activity has finished');
  let correct = false;
  const equalSet = (a: string[], b: string[]) =>
    a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));
  if (step.kind === 'identify') {
    if (action.kind !== 'select_target' || !activity.targets.some((t) => t.id === action.targetId))
      throw new ActivityActionError('Select a known component');
    correct = step.targetId === action.targetId;
  } else if (step.kind === 'choice') {
    if (
      action.kind !== 'answer' ||
      !action.ids ||
      action.ids.some((x) => !step.choices.some((c) => c.id === x))
    )
      throw new ActivityActionError('Choose valid answers');
    correct = equalSet(action.ids, step.correctIds);
  } else if (step.kind === 'order') {
    if (
      action.kind !== 'order' ||
      !action.ids ||
      !equalSet(
        action.ids,
        step.items.map((x) => x.id),
      )
    )
      throw new ActivityActionError('Arrange each item exactly once');
    correct = action.ids.every((x, i) => step.correctOrder[i] === x);
  } else if (step.kind === 'match') {
    if (
      action.kind !== 'match' ||
      !action.pairs ||
      Object.keys(action.pairs).length !== step.left.length ||
      Object.entries(action.pairs).some(
        ([a, b]) => !step.left.some((x) => x.id === a) || !step.right.some((x) => x.id === b),
      )
    )
      throw new ActivityActionError('Match each item to a valid option');
    correct = Object.entries(step.pairs).every(([a, b]) => action.pairs![a] === b);
  } else if (step.kind === 'operate') {
    if (action.kind !== 'operate') throw new ActivityActionError('Use a model operation');
    correct =
      step.operation === action.operation && (!step.targetId || step.targetId === action.targetId);
  } else {
    if (mode === 'assessment')
      throw new ActivityActionError('Written reflections are formative; use guided practice');
    if (action.kind !== 'reflect' || !action.text || action.text.length < 3)
      throw new ActivityActionError('Write a short explanation');
    correct = true;
  }
  const next = {
    ...state,
    scene: { ...state.scene },
    feedback: correct
      ? step.explanation
      : 'That does not match the reviewed activity. Revisit the source and try again.',
  };
  if (correct) {
    next.earned +=
      mode === 'practice'
        ? step.weight
        : Math.max(0, step.weight * (1 - state.stepMistakes * 0.25));
    next.stepIndex++;
    next.stepMistakes = 0;
    if (step.kind === 'operate') {
      if (step.operation === 'explode') next.scene.exploded = true;
      if (step.operation === 'assemble') next.scene = { exploded: false, isolatedTargetId: null };
      if (step.operation === 'isolate') next.scene.isolatedTargetId = step.targetId ?? null;
    }
    if (next.stepIndex === activity.steps.length) next.status = 'completed';
  } else {
    next.mistakes++;
    next.stepMistakes++;
  }
  const total = activity.steps.reduce((sum, s) => sum + s.weight, 0),
    score = total ? Math.round((next.earned * 100) / total) : 0;
  return {
    state: next,
    correct,
    score,
    passed: mode === 'assessment' && next.status === 'completed' && score >= activity.passingScore,
    objectiveId: step.objectiveId,
  };
}
