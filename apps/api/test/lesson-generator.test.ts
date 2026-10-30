import { describe, expect, it, vi } from 'vitest';
import {
  coerceQuestions,
  generateLessonDraft,
  generateQuestionsFromNotes,
  questionsFromNotes,
} from '../src/modules/learning/generator';
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
  it('keeps usable quiz rows when the model wraps them in prose and names the answer', async () => {
    const messy = `Here is the quiz:\n\`\`\`json\n${JSON.stringify({
      questions: [
        {
          prompt: 'Which chamber pumps blood to the body?',
          options: ['Left ventricle', 'Right atrium', 'A valve'],
          correctOption: 'Left ventricle',
          explanation: 'The notes name the left ventricle as the chamber that pumps to the body.',
        },
        { prompt: 'Too thin', options: ['only one'] },
      ],
    })}\n\`\`\``;
    const questions = coerceQuestions(messy);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ correctOption: 0, options: ['Left ventricle', 'Right atrium', 'A valve'] });
    const f = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ done: true, model: 'mistral:7b', response: messy }),
    );
    const result = await generateQuestionsFromNotes(
      { title: 'Heart anatomy', notes: 'The left ventricle pumps blood to the body.' },
      config,
      f,
    );
    expect(result.generation).toMatchObject({ mode: 'ai', model: 'mistral:7b' });
    expect(result.questions[0]?.options[0]).toBe('Left ventricle');
    expect(result.questions[0]?.correctOption).toBe(0);
  });
  it('builds fill-in questions from the lesson notes', () => {
    const questions = questionsFromNotes(
      'The right atrium receives blood from the body. The left ventricle pumps blood to the body through the aorta.',
    );
    expect(questions.length).toBeGreaterThan(0);
    expect(questions[0]?.prompt.startsWith('Fill the blank:')).toBe(true);
    expect(questions[0]?.options[0]?.length).toBeGreaterThan(4);
    expect(questions[0]?.options[1]).not.toBe(questions[0]?.options[0]);
    expect(questions[0]?.correctOption).toBe(0);
  });
});
