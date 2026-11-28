import { describe, expect, it, vi } from 'vitest';
import { generateText, isTextAiConfigured, textProviders, textAiEnvSchema } from '../src/text';
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
  it('rejects a paid direct OpenRouter fallback under free-only configuration', () => {
    expect(() =>
      textProviders({
        AI_TEXT_BASE_URL: 'https://openrouter.ai/api/v1',
        AI_TEXT_MODEL: 'openrouter/free',
        AI_TEXT_FALLBACK_MODEL: 'provider/paid-model',
        OPENROUTER_FREE_ONLY: true,
      }),
    ).toThrow('free fallback model');
  });
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

describe('Explicit free OpenRouter deployment', () => {
  it('prefers the configured router without waiting for the unavailable local host', () => {
    expect(
      textProviders({
        ...config,
        OPENROUTER_API_KEY: 'router-key',
        OPENROUTER_MODEL: 'openrouter/free',
        OPENROUTER_PREFERRED: true,
      })[0],
    ).toMatchObject({ name: 'openrouter', model: 'openrouter/free' });
  });
  it('refuses paid model selection when free-only is enabled', () => {
    expect(() =>
      textProviders({
        OPENROUTER_API_KEY: 'router-key',
        OPENROUTER_MODEL: 'paid/model',
        OPENROUTER_FREE_ONLY: true,
      }),
    ).toThrow('free');
  });
  it('sends a zero-price ceiling only to the free router', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(chat('{"ready":true}'));
    await generateText(
      {
        OPENROUTER_API_KEY: 'router-key',
        OPENROUTER_MODEL: 'openrouter/free',
        OPENROUTER_FREE_ONLY: true,
      },
      { ...request, json: true },
      f,
    );
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toMatchObject({
      provider: { max_price: { prompt: 0, completion: 0, request: 0 } },
      model: 'openrouter/free',
    });
  });
});

it('parses free-only booleans without treating false as true', () => {
  const parsed = textAiEnvSchema.parse({
    OPENROUTER_PREFERRED: 'false',
    OPENROUTER_FREE_ONLY: 'true',
  });
  expect(parsed.OPENROUTER_PREFERRED).toBe(false);
  expect(parsed.OPENROUTER_FREE_ONLY).toBe(true);
  expect(() => textAiEnvSchema.parse({ OPENROUTER_FREE_ONLY: 'yes' })).toThrow();
});

it('can disable optional OpenRouter reasoning without changing compatible requests', async () => {
  const f = vi.fn<typeof fetch>().mockResolvedValue(chat());
  await generateText(
    {
      OPENROUTER_API_KEY: 'router-key',
      OPENROUTER_MODEL: 'inclusionai/ling-3.2-flash:free',
      OPENROUTER_DISABLE_REASONING: true,
    },
    request,
    f,
  );
  expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toHaveProperty('reasoning.enabled', false);
});

it('rejects reasoning-only output instead of treating it as a completed lesson', async () => {
  const f = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      choices: [
        { message: { content: null, reasoning: 'internal reasoning' }, finish_reason: 'length' },
      ],
    }),
  );
  await expect(
    generateText(
      { OPENROUTER_API_KEY: 'router-key', OPENROUTER_MODEL: 'openrouter/free' },
      { ...request, json: true },
      f,
    ),
  ).rejects.toThrow('No configured text provider');
});

describe('explicit multimodal learning calls', () => {
  it('attaches images only to the last user message on compatible providers', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(chat('The synthetic image shows a cube.'));
    await generateText(
      {
        AI_TEXT_BASE_URL: 'https://vision.example/v1',
        AI_TEXT_MODEL: 'vision-test',
        AI_TEXT_PROTOCOL: 'openai',
      },
      { ...request, images: ['data:image/jpeg;base64,/9j/'] },
      f,
    );
    const payload = JSON.parse(String(f.mock.calls[0]![1]!.body));
    expect(payload.messages[0].content).toBe('Use the supplied lesson.');
    expect(payload.messages[1].content).toEqual([
      { type: 'text', text: 'Explain the housing.' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/' } },
    ]);
  });
  it('does not send images to a text-only Ollama route or accept remote image URLs', async () => {
    const f = vi.fn<typeof fetch>();
    await expect(
      generateText(config, { ...request, images: ['data:image/jpeg;base64,/9j/'] }, f),
    ).rejects.toThrow('valid response');
    await expect(
      generateText(
        { AI_TEXT_BASE_URL: 'https://vision.example/v1', AI_TEXT_MODEL: 'vision-test' },
        { ...request, images: ['http://private.example/image'] },
        f,
      ),
    ).rejects.toThrow('valid response');
    expect(f).not.toHaveBeenCalled();
  });
});

it('applies OpenRouter free-only and reasoning controls to a directly configured vision endpoint', async () => {
  const f = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    return chat(payload.reasoning?.enabled === false ? '{"labels":[{"id":"surface"}]}' : '{"":""}');
  });
  const result = await generateText(
    {
      AI_TEXT_BASE_URL: 'https://openrouter.ai/api/v1',
      AI_TEXT_MODEL: 'nvidia/nemotron-3.5-super-vl:free',
      AI_TEXT_PROTOCOL: 'openai',
      AI_TEXT_API_KEY: 'private-test-key',
      OPENROUTER_FREE_ONLY: true,
      OPENROUTER_DISABLE_REASONING: true,
    },
    {
      ...request,
      images: ['data:image/png;base64,YQ=='],
      json: true,
      validate: (text) => {
        if (!Array.isArray(JSON.parse(text).labels)) throw new Error('Expected annotation labels');
      },
    },
    f,
  );
  expect(JSON.parse(result.text).labels).toHaveLength(1);
  expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toMatchObject({
    reasoning: { enabled: false },
    provider: { max_price: { prompt: 0, completion: 0, request: 0 } },
  });
});

it('repairs invalid structured output once without accepting a fabricated answer', async () => {
  const f = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(chat('{"":""}'))
    .mockResolvedValueOnce(chat('{"labels":["surface"]}'));
  const r = await generateText(
    { ...config, AI_TEXT_PROTOCOL: 'openai' },
    {
      ...request,
      json: true,
      repair: true,
      validate: (text) => {
        if (!Array.isArray(JSON.parse(text).labels)) throw new Error('invalid');
      },
    },
    f,
  );
  expect(JSON.parse(r.text).labels).toEqual(['surface']);
  expect(f).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(f.mock.calls[1]![1]!.body)).messages.at(-1).content).toContain(
    'previous reply did not pass',
  );
});
it('bounds schema repair and exposes a safe recovery message', async () => {
  const { textAiFailureMessage } = await import('../src/text');
  const f = vi.fn<typeof fetch>().mockImplementation(async () => chat('{"":""}'));
  try {
    await generateText(
      { ...config, AI_TEXT_PROTOCOL: 'openai' },
      {
        ...request,
        json: true,
        repair: true,
        validate: () => {
          throw new Error('private source text must not escape');
        },
      },
      f,
    );
    throw new Error('Expected rejection');
  } catch (error) {
    expect(textAiFailureMessage(error)).toContain('complete valid draft');
    expect(JSON.stringify(error)).not.toContain('private source text');
  }
  expect(f).toHaveBeenCalledTimes(2);
});
