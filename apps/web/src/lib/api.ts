/**
 * API client (SRS §3.1).
 *
 * The browser never talks to Postgres, IPFS or the chain directly: every call goes through
 * the Fastify API, and in the local stack that request leaves the page at `https://localhost`
 * and is proxied by nginx. Cookies are httpOnly (FR-2.3), so the client simply asks the
 * browser to include them — there is no token to store and nothing to leak to JavaScript.
 */
import type { ApiError } from '@void-space/types';

export const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
export const API_PUBLIC_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api/v1';

/** An API failure carrying the stable `code` the UI branches on. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(status: number, body: Partial<ApiError>, fallback: string) {
    super(body.message ?? fallback);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.code ?? 'UNKNOWN';
    this.details = body.details;
    this.requestId = body.requestId;
  }
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  /** Absolute URL used by server components; defaults to the proxied browser path. */
  readonly baseUrl?: string;
  readonly cookieHeader?: string;
  readonly suppressErrorLog?: boolean;
}

async function parse<T>(response: Response, path: string): Promise<T> {
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const body = (payload ?? {}) as Partial<ApiError>;
    throw new ApiRequestError(response.status, body, `${response.status} ${response.statusText} for ${path}`);
  }

  return payload as T;
}

/**
 * Calls the API. `credentials: 'include'` is what makes cookie auth work from the browser;
 * from a server component the cookie header is forwarded explicitly instead.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = options.baseUrl ?? API_PUBLIC_BASE;
  const url = path.startsWith('http') ? path : `${base}${path}`;

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.cookieHeader ? { cookie: options.cookieHeader } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    cache: 'no-store',
    ...(options.cookieHeader ? {} : { credentials: 'include' as RequestCredentials }),
  });

  return parse<T>(response, path);
}

/** Uploads multipart form data (asset binaries, FR-3.1) with progress reporting. */
export async function apiUpload<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  // `fetch` cannot report upload progress, so the body is sent through XHR for the one call
  // where a 200 MB ceiling makes progress feedback matter.
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${API_PUBLIC_BASE}${path}`);
    request.withCredentials = true;
    request.responseType = 'text';

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    request.onerror = () => reject(new ApiRequestError(0, {}, 'Network error during upload'));
    request.onload = () => {
      let payload: unknown;
      try {
        payload = request.responseText.length > 0 ? JSON.parse(request.responseText) : undefined;
      } catch {
        payload = undefined;
      }

      if (request.status >= 200 && request.status < 300) {
        resolve(payload as T);
        return;
      }
      reject(
        new ApiRequestError(request.status, (payload ?? {}) as Partial<ApiError>, 'Upload failed'),
      );
    };

    request.send(form);
  });
}
