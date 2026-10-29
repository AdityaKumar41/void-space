import { describe, expect, it, vi } from 'vitest';
import { generateText, isTextAiConfigured, textProviders } from '../src/text';
const config = {
  AI_TEXT_BASE_URL: 'https://qwen.example/api/generate',
  AI_TEXT_MODEL: 'qwen2.5-coder:32b',
  AI_TEXT_TIMEOUT_MS: 1000,
};
const request = {
  messages: [
    { role: 'system' as const, content: 'Use the supplied lesson.' },
    { role: 'user' as const, content: 'Explain the housing.' },
  ],
};
const chat = (content = 'A housing protects the components.') =>
  Response.json({
    model: 'served-model',
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 4, completion_tokens: 8 },
  });
describe('Text provider routing', () => {
  it('supports native generate without a fake API key and disables streaming', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ response: 'Inspect the housing.', done: true, model: 'served-qwen' }),
      );
    expect(await generateText(config, request, f)).toMatchObject({
      text: 'Inspect the housing.',
      model: 'served-qwen',
      provider: 'compatible',
    });
    const payload = JSON.parse(String(f.mock.calls[0]![1]!.body));
    expect(payload).toMatchObject({
      stream: false,
      system: 'Use the supplied lesson.',
      prompt: 'user: Explain the housing.',
    });
    expect(f.mock.calls[0]![1]!.headers).not.toHaveProperty('authorization');
  });
  it('normalizes host, v1 base and complete chat endpoint without duplicating path segments', () => {
    for (const base of [
      'https://qwen.example',
      'https://qwen.example/v1',
      'https://qwen.example/v1/chat/completions',
    ])
      expect(textProviders({ ...config, AI_TEXT_BASE_URL: base })[0]!.url).toBe(
        'https://qwen.example/v1/chat/completions',
      );
  });
  it('does not enable OpenRouter without an explicit model and key', () => {
    expect(isTextAiConfigured({ OPENROUTER_API_KEY: 'secret' })).toBe(false);
    expect(isTextAiConfigured({ OPENROUTER_MODEL: 'provider/model' })).toBe(false);
  });
  it('treats HTTP 200 error envelopes and empty compatible answers as failures', async () => {
    await expect(
      generateText(
        config,
        request,
        vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'model not found' })),
      ),
    ).rejects.toThrow('No configured text provider');
    await expect(
      generateText(
        { ...config, AI_TEXT_BASE_URL: 'https://qwen.example/v1' },
        request,
        vi.fn<typeof fetch>().mockResolvedValue(chat('')),
      ),
    ).rejects.toThrow('No configured text provider');
  });
  it('falls back to OpenRouter and never forwards the primary credential', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: 'model not found' }))
      .mockResolvedValueOnce(chat());
    expect(
      await generateText(
        {
          ...config,
          AI_TEXT_API_KEY: 'primary-key',
          OPENROUTER_API_KEY: 'router-key',
          OPENROUTER_MODEL: 'provider/model',
        },
        request,
        f,
      ),
    ).toMatchObject({ provider: 'openrouter', model: 'served-model' });
    expect(f.mock.calls[1]![0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(f.mock.calls[1]![1]!.headers).toMatchObject({ authorization: 'Bearer router-key' });
    expect(JSON.parse(String(f.mock.calls[1]![1]!.body))).toMatchObject({
      model: 'provider/model',
      stream: false,
      messages: request.messages,
    });
  });
  it('falls back when a consumer rejects malformed structured output', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ response: 'not json', done: true }))
      .mockResolvedValueOnce(chat('{"ok":true}'));
    const result = await generateText(
      { ...config, OPENROUTER_API_KEY: 'router-key', OPENROUTER_MODEL: 'provider/model' },
      {
        ...request,
        json: true,
        validate: (text) => {
          JSON.parse(text);
        },
      },
      f,
    );
    expect(result.provider).toBe('openrouter');
  });
  it('does not log sensitive provider error bodies or credentials', async () => {
    const f = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-key and private lesson'));
    try {
      await generateText(config, request, f);
      throw new Error('Expected rejection');
    } catch (e) {
      expect(JSON.stringify(e)).not.toContain('secret-key');
      expect(JSON.stringify(e)).not.toContain('private lesson');
    }
  });
  it('preserves tool calls with validated JSON arguments', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call1',
                  type: 'function',
                  function: { name: 'inspect', arguments: '{"id":"mesh1"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    );
    const result = await generateText(
      { ...config, AI_TEXT_BASE_URL: 'https://qwen.example/v1' },
      {
        ...request,
        tools: [
          {
            type: 'function',
            function: { name: 'inspect', description: 'Inspect', parameters: { type: 'object' } },
          },
        ],
      },
      f,
    );
    expect(result.toolCalls[0]?.function.name).toBe('inspect');
  });
  it('rejects redirects so credentials are not forwarded to another host', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(chat());
    await generateText({ ...config, AI_TEXT_BASE_URL: 'https://qwen.example/v1' }, request, f);
    expect(f.mock.calls[0]![1]!.redirect).toBe('error');
  });
  it('tries a configured fallback model on the same host before OpenRouter', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: 'model not found' }))
      .mockResolvedValueOnce(Response.json({ response: 'OK', done: true, model: 'mistral:7b' }));
    const result = await generateText(
      { ...config, AI_TEXT_FALLBACK_MODEL: 'mistral:7b' },
      request,
      f,
    );
    expect(result.model).toBe('mistral:7b');
    expect(f.mock.calls[1]![0]).toBe('https://qwen.example/api/generate');
    expect(JSON.parse(String(f.mock.calls[1]![1]!.body)).model).toBe('mistral:7b');
  });
});
