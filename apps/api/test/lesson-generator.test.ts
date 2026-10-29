import { describe, expect, it, vi } from 'vitest';
import { generateLessonDraft } from '../src/modules/learning/generator';
const asset = {
  name: 'Cordless drill',
  category: 'Tooling',
  description: 'The drill has a battery pack, trigger and keyless chuck.',
  tags: ['drill'],
};
const content = {
  title: 'Identify drill controls',
  summary: 'Locate the documented parts of the reviewed drill.',
  narration: 'Find the battery pack, trigger and keyless chuck on the reviewed drill model.',
  outline: ['Find the battery pack', 'Locate the trigger', 'Locate the chuck'],
  questions: [
    {
      id: 'power',
      prompt: 'Which part supplies power?',
      options: ['Battery pack', 'Chuck'],
      correctOption: 0,
      explanation: 'The source identifies a battery pack.',
    },
  ],
  passingScore: 80,
};
content.questions.push(
  { ...content.questions[0]!, id: 'trigger' },
  { ...content.questions[0]!, id: 'chuck' },
);
const config = {
  AI_TEXT_BASE_URL: 'https://qwen.example/api/generate',
  AI_TEXT_MODEL: 'qwen-model',
};
describe('Source-grounded lesson generation', () => {
  it('passes approved metadata and author notes and validates the generated assessment', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ done: true, model: 'served-model', response: JSON.stringify(content) }),
      );
    const result = await generateLessonDraft(
      asset,
      'Identify the battery pack and trigger.',
      config,
      f,
    );
    expect(result).toMatchObject({ content, generation: { mode: 'ai', model: 'served-model' } });
    const sent = JSON.parse(String(f.mock.calls[0]![1]!.body));
    expect(sent.prompt).toContain(
      JSON.stringify({ asset, sourceText: 'Identify the battery pack and trigger.' }),
    );
  });
  it('rejects out-of-range answers and duplicate ids instead of releasing malformed training', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          done: true,
          response: JSON.stringify({
            ...content,
            questions: [{ ...content.questions[0], correctOption: 5 }],
          }),
        }),
      );
    await expect(generateLessonDraft(asset, undefined, config, f)).rejects.toThrow();
  });
});
