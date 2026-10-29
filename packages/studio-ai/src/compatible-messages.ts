/** Adapts the editor's existing Messages/tool loop to compatible chat providers. */
import { generateText, type ChatMessage, type TextAiConfig } from './text';
import type { HttpTransport, TransportRequest, TransportResponse } from './transport';

export class CompatibleMessagesTransport implements HttpTransport {
  constructor(
    private readonly config: TextAiConfig,
    private readonly transport: HttpTransport,
  ) {}
  async request(request: TransportRequest): Promise<TransportResponse> {
    const body = JSON.parse(request.body ?? '{}') as {
      system?: string;
      messages?: {
        role: 'user' | 'assistant';
        content: {
          type: string;
          text?: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: string;
        }[];
      }[];
      tools?: { name: string; description: string; input_schema: Record<string, unknown> }[];
      max_tokens?: number;
      temperature?: number;
    };
    const messages: ChatMessage[] = [];
    if (body.system) messages.push({ role: 'system', content: body.system });
    for (const message of body.messages ?? []) {
      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n');
      if (message.role === 'assistant') {
        const calls = message.content
          .filter((block) => block.type === 'tool_use')
          .map((block) => {
            if (!block.id || !block.name) throw new Error('Invalid editor tool call');
            return {
              id: block.id,
              type: 'function' as const,
              function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
            };
          });
        messages.push({
          role: 'assistant',
          content: text || null,
          ...(calls.length ? { tool_calls: calls } : {}),
        });
      } else {
        for (const block of message.content.filter((block) => block.type === 'tool_result')) {
          if (!block.tool_use_id) throw new Error('Missing editor tool result identity');
          messages.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: block.content ?? '',
          });
        }
        if (text) messages.push({ role: 'user', content: text });
      }
    }
    // /api/generate is text-only. Editor tool calls use this same host's chat API.
    const base = this.config.AI_TEXT_BASE_URL ?? this.config.AI_BASE_URL;
    const config =
      base && new URL(base).pathname.endsWith('/api/generate')
        ? {
            ...this.config,
            AI_TEXT_BASE_URL: new URL('/v1/chat/completions', base).href,
            AI_TEXT_PROTOCOL: 'openai' as const,
          }
        : this.config;
    const fetchImpl: typeof fetch = async (url, init) => {
      const response = await this.transport.request({
        url: String(url),
        method: 'POST',
        headers: init?.headers as Record<string, string>,
        body: String(init?.body ?? ''),
        signal: init?.signal ?? request.signal,
      });
      return Response.json(response.body, { status: response.status });
    };
    const result = await generateText(
      config,
      {
        messages,
        maxTokens: body.max_tokens,
        temperature: body.temperature,
        signal: request.signal,
        tools: body.tools?.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          },
        })),
      },
      fetchImpl,
    );
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: {
        id: 'compatible-message',
        model: result.model,
        provider: result.provider,
        stop_reason: result.toolCalls.length ? 'tool_use' : 'end_turn',
        content: [
          ...(result.text ? [{ type: 'text', text: result.text }] : []),
          ...result.toolCalls.map((call) => ({
            type: 'tool_use',
            id: call.id,
            name: call.function.name,
            input: JSON.parse(call.function.arguments),
          })),
        ],
        usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens },
      },
    };
  }
}
