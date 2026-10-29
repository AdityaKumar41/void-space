import { describe, expect, it } from 'vitest';
import { transcriptReference as answerLessonQuestion } from '../src/modules/learning/mentor';
const context = {
  summary: 'Inspect before use.',
  narration: 'Check the housing for visible damage. Record the inspection.',
  outline: ['Inspect the housing', 'Record findings'],
};
describe('Local lesson guide', () => {
  it('retrieves relevant teaching material instead of echoing the question', () => {
    const result = answerLessonQuestion(context, 'What should I check on the housing?');
    expect(result.mode).toBe('reference');
    expect(result.answer).toContain('Check the housing for visible damage.');
    expect(result.answer).not.toContain('What should I');
  });
  it('states when the released material cannot answer', () => {
    expect(answerLessonQuestion(context, 'Explain quantum entanglement').answer).toContain(
      'does not contain',
    );
  });
  it('does not match generic question words to unrelated lesson text', () => {
    expect(answerLessonQuestion(context, 'What should the temperature be?').answer).toContain(
      'does not contain',
    );
  });
});

import { vi } from 'vitest';
import { answerLessonQuestion as mentor } from '../src/modules/learning/mentor';
describe('Provider-backed lesson mentor',()=>{
  const config={AI_TEXT_BASE_URL:'https://qwen.example/api/generate',AI_TEXT_MODEL:'qwen2.5-coder:32b'};
  it('uses the configured Qwen endpoint and labels the actual generated answer',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValue(Response.json({response:'Check for visible damage on the housing.',done:true,model:'served-qwen'}));
    expect(await mentor(context,'What should I inspect?',config,f)).toMatchObject({mode:'ai',model:'served-qwen'});
    const sent=JSON.parse(String(f.mock.calls[0]![1]!.body));
    const lesson=JSON.parse(sent.prompt.slice('user: '.length)).lesson;
    expect(lesson).toEqual(context);
    expect(sent).not.toHaveProperty('correctOption');
  });
  it('falls back to the local released transcript when all providers fail',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValue(Response.json({error:'model not found'}));
    expect(await mentor(context,'housing',config,f)).toMatchObject({mode:'reference'});
  });
});
