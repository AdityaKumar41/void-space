import { z } from 'zod';

/** Server-side text generation for Ollama and OpenAI-compatible deployments. */
const unset = (value: unknown) => (typeof value === 'string' && !value.trim() ? undefined : value);
const optionalString = z.preprocess(unset, z.string().trim().min(1).optional());
const optionalUrl = z.preprocess(unset, z.string().url().optional());
export const textAiEnvSchema = z.object({
  AI_BASE_URL: optionalUrl,
  AI_TEXT_BASE_URL: optionalUrl,
  AI_TEXT_FALLBACK_MODEL: optionalString,
  AI_TEXT_MODEL: z.preprocess(unset, z.string().default('qwen2.5-coder:32b')),
  AI_TEXT_PROTOCOL: z.preprocess(unset, z.enum(['auto', 'ollama', 'openai']).default('auto')),
  AI_TEXT_API_KEY: optionalString,
  AI_TEXT_TIMEOUT_MS: z.preprocess(
    unset,
    z.coerce.number().int().min(100).max(120000).default(30000),
  ),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: optionalString,
  GEMINI_BASE_URL: optionalUrl,
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  OPENAI_BASE_URL: optionalUrl,
  OPENROUTER_API_KEY: optionalString,
  OPENROUTER_MODEL: optionalString,
  OPENROUTER_BASE_URL: optionalUrl,
});
export interface TextAiConfig {
  AI_BASE_URL?: string | undefined;
  AI_TEXT_BASE_URL?: string | undefined;
  AI_TEXT_MODEL?: string | undefined;
  AI_TEXT_FALLBACK_MODEL?: string | undefined;
  AI_TEXT_PROTOCOL?: 'auto' | 'ollama' | 'openai' | undefined;
  AI_TEXT_API_KEY?: string | undefined;
  AI_TEXT_TIMEOUT_MS?: number | undefined;
  GEMINI_API_KEY?: string | undefined;
  GEMINI_MODEL?: string | undefined;
  GEMINI_BASE_URL?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
  OPENAI_MODEL?: string | undefined;
  OPENAI_BASE_URL?: string | undefined;
  OPENROUTER_API_KEY?: string | undefined;
  OPENROUTER_MODEL?: string | undefined;
  OPENROUTER_BASE_URL?: string | undefined;
}
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: readonly ToolCall[];
}
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface TextRequest {
  messages: readonly ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  tools?: readonly {
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }[];
  /** Consumer schema validation participates in fallback, not just envelope parsing. */
  validate?: (text: string) => void;
  signal?: AbortSignal;
}
export interface TextResult {
  text: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: ToolCall[];
  finishReason: string;
}
interface Provider {
  url: string;
  protocol: 'ollama' | 'openai';
  model: string;
  key?: string | undefined;
  name: string;
}
export class TextAiError extends Error {
  constructor(readonly failures: readonly { provider: string; reason: string }[]) {
    super('No configured text provider returned a valid response');
    this.name = 'TextAiError';
  }
}
/**
 * Read the provider's error envelope and reduce it to a short, allow-listed code
 * (e.g. `insufficient_quota`, `credit_balance_exhausted`, `rate_limit_exceeded`).
 * Only [a-z0-9_] survives, so no prompt, key, URL or free-text body is retained.
 * Returns undefined when the body is missing, not JSON, or carries no usable code.
 */
async function providerErrorCode(response: Response): Promise<string | undefined> {
  try {
    const parsed = (await response.json()) as
      | { error?: { code?: unknown; type?: unknown; status?: unknown } }
      | { error?: { code?: unknown; type?: unknown; status?: unknown } }[]
      | null;
    // Google's OpenAI-compatible surface wraps errors in a single-element array.
    const body = Array.isArray(parsed) ? parsed[0] : parsed;
    const raw = [body?.error?.code, body?.error?.type, body?.error?.status].find(
      (value) => typeof value === 'string',
    ) as string | undefined;
    if (typeof raw !== 'string') return undefined;
    const normalized = raw.trim().toLowerCase();
    return /^[a-z0-9_]{1,64}$/.test(normalized) ? normalized : undefined;
  } catch {
    return undefined;
  }
}
function endpoint(base: string): string {
  const url = new URL(base);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid text provider URL');
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname =
    path.endsWith('/chat/completions') || path.endsWith('/api/generate')
      ? path
      : path +
        (path.endsWith('/v1') || path.endsWith('/openai')
          ? '/chat/completions'
          : '/v1/chat/completions');
  return url.href;
}
export function textProviders(config: TextAiConfig): Provider[] {
  const providers: Provider[] = [];
  const base = config.AI_TEXT_BASE_URL?.trim() || config.AI_BASE_URL?.trim();
  if (base) {
    const url = endpoint(base);
    const protocol =
      config.AI_TEXT_PROTOCOL && config.AI_TEXT_PROTOCOL !== 'auto'
        ? config.AI_TEXT_PROTOCOL
        : new URL(url).pathname.endsWith('/api/generate')
          ? 'ollama'
          : 'openai';
    if (!config.AI_TEXT_MODEL?.trim())
      throw new Error('AI_TEXT_MODEL is required when a text endpoint is configured');
    providers.push({
      url,
      protocol,
      model: config.AI_TEXT_MODEL,
      key: config.AI_TEXT_API_KEY,
      name: 'compatible',
    });
    if (
      config.AI_TEXT_FALLBACK_MODEL?.trim() &&
      config.AI_TEXT_FALLBACK_MODEL !== config.AI_TEXT_MODEL
    )
      providers.push({
        url,
        protocol,
        model: config.AI_TEXT_FALLBACK_MODEL,
        key: config.AI_TEXT_API_KEY,
        name: 'compatible',
      });
  }
  // Built-in Google Gemini provider (free tier). Read server-side only and never
  // forwarded to another provider. Pinned to Google's OpenAI-compatible surface,
  // which keeps the shared request/response contract intact. Tried ahead of the
  // OpenAI provider, which remains as automatic fallback.
  if (config.GEMINI_API_KEY?.trim())
    providers.push({
      url: endpoint(
        config.GEMINI_BASE_URL?.trim() ||
          'https://generativelanguage.googleapis.com/v1beta/openai',
      ),
      protocol: 'openai',
      model: config.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite',
      key: config.GEMINI_API_KEY.trim(),
      name: 'gemini',
    });
  // Built-in OpenAI provider. Both are explicit: no implicit paid model. The key is
  // read server-side only and is never forwarded to another provider.
  if (config.OPENAI_API_KEY?.trim())
    providers.push({
      url: endpoint(config.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'),
      protocol: 'openai',
      model: config.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
      key: config.OPENAI_API_KEY.trim(),
      name: 'openai',
    });
  // Both are explicit: no implicit paid model or unexpected fallback destination.
  if (config.OPENROUTER_API_KEY?.trim() && config.OPENROUTER_MODEL?.trim())
    providers.push({
      url: endpoint(config.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'),
      protocol: 'openai',
      model: config.OPENROUTER_MODEL,
      key: config.OPENROUTER_API_KEY,
      name: 'openrouter',
    });
  return providers;
}
export function isTextAiConfigured(config: TextAiConfig): boolean {
  return textProviders(config).length > 0;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Malformed provider response');
  return value as Record<string, unknown>;
}
function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
function parseResult(raw: unknown, provider: Provider): TextResult {
  const body = object(raw);
  if (body.error)
    throw new Error(
      typeof body.error === 'string' && /model.*not found/i.test(body.error)
        ? 'Configured model is unavailable'
        : 'Provider reported an error',
    );
  let text: string;
  let toolCalls: ToolCall[] = [];
  let finishReason = 'stop';
  let inputTokens = 0;
  let outputTokens = 0;
  if (provider.protocol === 'ollama') {
    if (body.done !== true) throw new Error('Incomplete generation');
    text = typeof body.response === 'string' ? body.response : '';
    inputTokens = number(body.prompt_eval_count);
    outputTokens = number(body.eval_count);
    if (body.done_reason === 'length') finishReason = 'length';
  } else {
    const choices = body.choices;
    if (!Array.isArray(choices) || !choices.length) throw new Error('Missing choices');
    const choice = object(choices[0]);
    const message = object(choice.message);
    text = typeof message.content === 'string' ? message.content : '';
    finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : 'stop';
    if (Array.isArray(message.tool_calls))
      toolCalls = message.tool_calls.map((raw) => {
        const call = object(raw);
        const fn = object(call.function);
        if (
          typeof call.id !== 'string' ||
          call.type !== 'function' ||
          typeof fn.name !== 'string' ||
          typeof fn.arguments !== 'string'
        )
          throw new Error('Malformed tool call');
        // Invalid JSON arguments must not reach the editor loop.
        const args = JSON.parse(fn.arguments);
        object(args);
        return {
          id: call.id,
          type: 'function' as const,
          function: { name: fn.name, arguments: fn.arguments },
        };
      });
    const usage = body.usage ? object(body.usage) : {};
    inputTokens = number(usage.prompt_tokens);
    outputTokens = number(usage.completion_tokens);
  }
  text = text.trim();
  if (!text && !toolCalls.length) throw new Error('Empty generation');
  // A token cap with a usable sentence or a complete tool call is still an answer.
  // An empty cut-off is already rejected above.
  return {
    text,
    toolCalls,
    finishReason,
    model: typeof body.model === 'string' ? body.model : provider.model,
    provider: provider.name,
    inputTokens,
    outputTokens,
  };
}

export async function generateText(
  config: TextAiConfig,
  request: TextRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<TextResult> {
  const providers = textProviders(config);
  const failures: { provider: string; reason: string }[] = [];
  const timeout = config.AI_TEXT_TIMEOUT_MS ?? 30_000;
  const deadline = Date.now() + timeout;
  for (const [index, provider] of providers.entries()) {
    if (request.signal?.aborted) throw request.signal.reason;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      if (provider.protocol === 'ollama' && request.tools?.length)
        throw new Error('Tool calls require an OpenAI-compatible chat endpoint');
      const messages = request.messages;
      const payload =
        provider.protocol === 'ollama'
          ? {
              model: provider.model,
              stream: false,
              // Gateways may expose OpenAI-style limits around native Ollama.
              max_tokens: request.maxTokens ?? 1024,
              temperature: request.temperature ?? 0.2,
              system: messages
                .filter((m) => m.role === 'system')
                .map((m) => m.content ?? '')
                .join('\n'),
              prompt: messages
                .filter((m) => m.role !== 'system')
                .map((m) => `${m.role}: ${m.content ?? ''}`)
                .join('\n'),
              options: {
                num_predict: request.maxTokens ?? 1024,
                temperature: request.temperature ?? 0.2,
              },
              ...(request.json ? { format: 'json' } : {}),
            }
          : {
              model: provider.model,
              messages,
              stream: false,
              max_tokens: request.maxTokens ?? 1024,
              temperature: request.temperature ?? 0.2,
              ...(request.json ? { response_format: { type: 'json_object' } } : {}),
              ...(request.tools?.length ? { tools: request.tools } : {}),
            };
      const budget =
        index < providers.length - 1 ? Math.max(1, Math.floor(remaining * 0.7)) : remaining;
      const timer = AbortSignal.timeout(budget);
      const signal = request.signal ? AbortSignal.any([request.signal, timer]) : timer;
      const response = await fetchImpl(provider.url, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(provider.key ? { authorization: `Bearer ${provider.key}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const code = await providerErrorCode(response);
        throw new Error(`Provider HTTP ${response.status}${code ? ` ${code}` : ''}`);
      }
      const result = parseResult(await response.json(), provider);
      if (request.tools?.length === 0 && result.toolCalls.length)
        throw new Error('Unexpected tool calls');
      request.validate?.(result.text);
      return result;
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason;
      // Do not retain prompts, provider bodies, URLs with credentials, or API keys in failures.
      failures.push({
        provider: provider.name,
        reason:
          error instanceof Error &&
          /^(Provider HTTP \d{3}( [a-z0-9_]{1,64})?|Configured model is unavailable|Provider reported an error|Empty generation|Incomplete generation|Truncated generation)$/.test(
            error.message,
          )
            ? error.message
            : 'Invalid or unavailable response',
      });
    }
  }
  throw new TextAiError(failures);
}
