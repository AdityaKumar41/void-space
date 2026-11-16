import { describe, expect, it } from 'vitest';

import { ValidationError } from '../src/lib/errors';
import { extractDocumentText } from '../src/lib/document-text';
import {
  translateDocumentContent,
  translateLessonContent,
} from '../src/modules/translations/service';

const config = {
  AI_TEXT_BASE_URL: 'https://translator.example/v1',
  AI_TEXT_MODEL: 'translation-test',
  AI_TEXT_PROTOCOL: 'openai' as const,
};

function providerResponse(text: string): typeof fetch {
  return async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      messages: readonly { content: string }[];
    };
    expect(request.messages[0]?.content).toContain('Translate');
    return new Response(
      JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
}

describe('content translation', () => {
  it('translates lessons without changing quiz identifiers or option order', async () => {
    const source = {
      title: 'Lesson title',
      summary: 'A short lesson summary.',
      narration: 'A complete lesson narration with more than twenty characters.',
      outline: ['First study step'],
      questions: [
        {
          id: 'question-1',
          prompt: 'Which option is correct?',
          options: ['First choice', 'Second choice'],
        },
      ],
    };
    const translated = {
      title: 'పాఠం శీర్షిక',
      summary: 'చిన్న పాఠం సారాంశం.',
      narration: 'ఇరవై అక్షరాల కంటే ఎక్కువ ఉన్న పూర్తి పాఠ వివరణ.',
      outline: ['మొదటి అభ్యాస దశ'],
      questions: [
        {
          id: 'question-1',
          prompt: 'ఏ ఎంపిక సరైనది?',
          options: [
            { index: 0, text: 'మొదటి ఎంపిక' },
            { index: 1, text: 'రెండవ ఎంపిక' },
          ],
        },
      ],
    };
    const fetchImpl = providerResponse(JSON.stringify(translated));

    await expect(translateLessonContent(source, 'te', config, fetchImpl)).resolves.toEqual({
      ...translated,
      questions: [
        {
          id: 'question-1',
          prompt: 'ఏ ఎంపిక సరైనది?',
          options: ['మొదటి ఎంపిక', 'రెండవ ఎంపిక'],
        },
      ],
    });
  });

  it('translates document metadata and text while preserving nullable descriptions', async () => {
    const source = { title: 'Safety notes', description: null, text: 'Read this before practice.' };
    const translated = {
      title: 'భద్రతా గమనికలు',
      description: null,
      text: 'అభ్యాసానికి ముందు దీన్ని చదవండి.',
    };

    await expect(
      translateDocumentContent(source, 'te', config, providerResponse(JSON.stringify(translated))),
    ).resolves.toEqual(translated);
  });

  it('rejects a translation that changes the quiz structure', async () => {
    const source = {
      title: 'Lesson title',
      summary: 'A short lesson summary.',
      narration: 'A complete lesson narration with more than twenty characters.',
      outline: ['First study step'],
      questions: [
        { id: 'question-1', prompt: 'Question?', options: ['First choice', 'Second choice'] },
      ],
    };
    const changed = {
      ...source,
      questions: [
        {
          id: 'question-2',
          prompt: 'Question?',
          options: [
            { index: 0, text: 'First choice' },
            { index: 1, text: 'Second choice' },
          ],
        },
      ],
    };

    await expect(
      translateLessonContent(source, 'hi', config, providerResponse(JSON.stringify(changed))),
    ).rejects.toMatchObject({ name: 'TextAiError' });
  });

  it('extracts bounded UTF-8 and RTF text and refuses legacy binary Word files', async () => {
    await expect(extractDocumentText(Buffer.from('  safety notes  '), '.txt')).resolves.toBe(
      'safety notes',
    );
    await expect(extractDocumentText(Buffer.from('{\\rtf1 Safety\\par notes}'), '.rtf')).resolves.toBe(
      'Safety\n notes',
    );
    await expect(extractDocumentText(Buffer.from('legacy'), '.doc')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
