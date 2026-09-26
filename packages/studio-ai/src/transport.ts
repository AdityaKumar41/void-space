/**
 * The HTTP seam for every AI provider call (VS2-SRS-1.0 §7.5).
 *
 * The Anthropic and Meshy SDKs are deliberately **not** dependencies. Three reasons, in order of
 * weight:
 *
 *   1. **Testability.** §7.5 requires a hard timeout and a per-tenant rate limit on every AI call. A
 *      timeout is the one behaviour you cannot verify against a real provider, and a suite that talks
 *      to api.anthropic.com is a suite that fails when someone else's deploy is slow. With the
 *      transport injected, every one of those rules is asserted against a fake in milliseconds.
 *   2. **Blast radius.** A provider SDK is a large transitive dependency in the API *and* the worker.
 *      The Messages endpoint this product needs is one POST with a JSON body, and the tool-use loop is
 *      ours to control anyway (§7.1: the command system applies, not the model).
 *   3. **The §7.5 logging requirement.** Every request/response pair must be logged with its model and
 *      prompt-template version for auditability. Owning the transport is what makes that unavoidable
 *      rather than opt-in — there is no second code path that could skip it.
 */

export interface TransportRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  /** Pre-serialized. The transport does not decide how a body is encoded. */
  readonly body?: string;
  readonly signal: AbortSignal;
}

export interface TransportResponse {
  readonly status: number;
  /** Parsed JSON when the content type said JSON; the raw text otherwise. */
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

export interface HttpTransport {
  request(request: TransportRequest): Promise<TransportResponse>;
}

/**
 * A provider call that did not produce a usable answer.
 *
 * `kind` is the discriminator callers branch on, not the status code: a 429 and a 529 mean the same
 * thing operationally here (back off), while a 400 and a 422 both mean "your request was wrong".
 */
export type ProviderFailureKind =
  /** The request never completed: DNS, refused connection, or our own timeout. */
  | 'TRANSPORT'
  /** The provider rejected the request. Retrying changes nothing. */
  | 'INVALID_REQUEST'
  /** The credential was refused. */
  | 'UNAUTHORIZED'
  /** Rate limited or overloaded. Retrying later may work. */
  | 'RATE_LIMITED'
  /** The provider failed on its side. */
  | 'PROVIDER_ERROR'
  /** The answer arrived but was not the shape the caller required. */
  | 'MALFORMED_RESPONSE';

export class AiProviderError extends Error {
  readonly kind: ProviderFailureKind;
  readonly status: number;
  readonly provider: string;
  readonly details: unknown;

  constructor(
    provider: string,
    kind: ProviderFailureKind,
    message: string,
    options: { readonly status?: number; readonly details?: unknown } = {},
  ) {
    super(message);
    this.name = 'AiProviderError';
    this.provider = provider;
    this.kind = kind;
    this.status = options.status ?? 0;
    this.details = options.details;
  }

  /**
   * Whether repeating the identical request could plausibly succeed.
   *
   * `MALFORMED_RESPONSE` is included, and that is not obvious: the request was fine and the provider
   * answered, so a second attempt is a genuinely new sample. Excluding it would make a model that
   * emits one bad JSON block fail a Creator's instruction permanently.
   */
  get isRetryable(): boolean {
    return (
      this.kind === 'TRANSPORT' ||
      this.kind === 'RATE_LIMITED' ||
      this.kind === 'PROVIDER_ERROR' ||
      this.kind === 'MALFORMED_RESPONSE'
    );
  }
}

/** Maps an HTTP status onto the failure taxonomy. One place, so no caller invents its own rule. */
export function classifyStatus(status: number): ProviderFailureKind {
  if (status === 401 || status === 403) return 'UNAUTHORIZED';
  if (status === 429) return 'RATE_LIMITED';
  // 529 is Anthropic's "overloaded"; it belongs with 5xx rather than being special-cased by name.
  if (status >= 500) return 'PROVIDER_ERROR';
  if (status >= 400) return 'INVALID_REQUEST';
  return 'PROVIDER_ERROR';
}

/**
 * The production transport.
 *
 * It does exactly one thing: perform the request and hand back a parsed body. Timeouts, retries and
 * rate limits belong to the caller, because they are policy (§7.5) and policy lives in `policy.ts`
 * where it can be read and changed without touching HTTP mechanics.
 */
export class FetchTransport implements HttpTransport {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.fetchImpl = fetchImpl;
  }

  async request(request: TransportRequest): Promise<TransportResponse> {
    // Built as a typed local rather than passed inline: an inline literal faces the excess property
    // check against `fetch`'s `RequestInit`, which does not know about `cache`.
    const init: FetchInit = {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: request.signal,
      // Provider calls are never cached: a repeated Copilot instruction against the same scene
      // summary is a new question, and a cached answer would make the assistant look as though it
      // ignored the second request.
      cache: 'no-store',
    };

    const response = await this.fetchImpl(request.url, init);

    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';

    let body: unknown = text;
    if (contentType.includes('json') && text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        // A provider that declares JSON and sends something else is a malformed *response*, not a
        // transport failure — the distinction decides whether retrying is worthwhile.
        throw new AiProviderError(
          'http',
          'MALFORMED_RESPONSE',
          'Response declared JSON but did not parse',
          { status: response.status, details: text.slice(0, 500) },
        );
      }
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    return { status: response.status, body, headers };
  }
}

/** Which provider a failure came from, for the error message and the audit trail. */
export type AiProviderName = 'anthropic' | 'meshy';

/**
 * `RequestInit` plus `cache`, which the Fetch standard defines and `@types/node`'s copy omits.
 *
 * This package must not add `"DOM"` to `lib` — it runs in the API and the worker, and pulling the DOM
 * in would redeclare globals (`fetch`, `Response`, `AbortController`) that `@types/node` already owns.
 */
interface FetchInit extends RequestInit {
  readonly cache?: 'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached';
}

