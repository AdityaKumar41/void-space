import { expect, it } from 'vitest';
import { safeLearningEvent, safeLearningProgress } from '../src/modules/learning-hub/telemetry';
it('excludes old provider responses and tool arguments from progress and replay', () => {
  const usage = {
    provider: 'test',
    model: 'test-model',
    inputTokens: 5,
    outputTokens: 10,
    text: 'private generated content',
    toolCalls: [{ arguments: 'private arguments' }],
  };
  const progress = safeLearningProgress([
    {
      id: 'usage-coordinator',
      label: 'Model usage',
      status: 'complete',
      usage,
      arbitrary: 'untrusted',
    },
  ]);
  expect(progress[0]!.usage).toEqual({
    provider: 'test',
    model: 'test-model',
    inputTokens: 5,
    outputTokens: 10,
  });
  expect(progress[0]).not.toHaveProperty('arbitrary');
  expect(safeLearningEvent({ type: 'usage', stage: 'coordinator', ...usage })).toEqual({
    type: 'usage',
    stage: 'coordinator',
    provider: 'test',
    model: 'test-model',
    inputTokens: 5,
    outputTokens: 10,
  });
  expect(safeLearningEvent({ type: 'cancelled' })).toEqual({ type: 'cancelled' });
});
