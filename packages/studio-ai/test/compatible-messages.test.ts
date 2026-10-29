import { describe, expect, it, vi } from 'vitest';
import { CompatibleMessagesTransport } from '../src/compatible-messages';
import { ClaudeClient } from '../src/claude';
import { InMemoryInvocationSink } from '../src/policy';
import type { HttpTransport, TransportRequest } from '../src/transport';
describe('Studio compatible tool transport', () => {
  it('translates a full editor tool round trip and retains redaction and invocation logging', async () => {
    const calls: TransportRequest[] = [];
    const transport: HttpTransport = {
      request: vi.fn(async (request) => {
        calls.push(request);
        return {
          status: 200,
          headers: {},
          body: {
            model: 'served-qwen',
            choices: [
              {
                message:
                  calls.length === 1
                    ? {
                        content: null,
                        tool_calls: [
                          {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'inspect', arguments: '{"id":"mesh-1"}' },
                          },
                        ],
                      }
                    : { content: 'Inspection complete.' },
                finish_reason: calls.length === 1 ? 'tool_calls' : 'stop',
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 6 },
          },
        };
      }),
    };
    const sink = new InMemoryInvocationSink();
    const client = new ClaudeClient({
      apiKey: 'internal',
      providerName: 'compatible',
      transport: new CompatibleMessagesTransport(
        { AI_TEXT_BASE_URL: 'https://qwen.example/api/generate', AI_TEXT_MODEL: 'qwen-model' },
        transport,
      ),
      sink,
    });
    const base = {
      tenantId: 'tenant-1',
      feature: 'copilot' as const,
      promptVersion: 'test',
      system: 'Inspect only.',
      maxTokens: 100,
    };
    const first = await client.createMessage({
      ...base,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Inspect mesh-1.' }] }],
      tools: [{ name: 'inspect', description: 'Read mesh', input_schema: { type: 'object' } }],
    });
    expect(first.content).toEqual([
      { type: 'tool_use', id: 'call-1', name: 'inspect', input: { id: 'mesh-1' } },
    ]);
    const second = await client.createMessage({
      ...base,
      messages: [
        { role: 'assistant', content: first.content },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'Mesh inspected.' }],
        },
      ],
    });
    expect(second.content).toEqual([{ type: 'text', text: 'Inspection complete.' }]);
    expect(calls[0]?.url).toBe('https://qwen.example/v1/chat/completions');
    const body = JSON.parse(calls[1]!.body!);
    expect(body.messages).toContainEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: 'Mesh inspected.',
    });
    expect(calls[0]?.headers).not.toHaveProperty('x-api-key');
    expect(sink.entries[0]).toMatchObject({
      provider: 'compatible',
      model: 'served-qwen',
      ok: true,
    });
  });
});
