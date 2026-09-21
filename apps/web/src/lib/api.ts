/**
 * Server-side API access (SRS §3.1).
 *
 * The browser never talks to the database, IPFS or the chain directly: every
 * operation goes through the Fastify API. Server components call the *internal*
 * URL so local development does not need to trust the self-signed edge
 * certificate; client components use the relative `/api/v1` path through nginx.
 */
export const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
export const API_PUBLIC_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api/v1';

export interface ApiFetchResult<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly data: T | null;
  readonly error: string | null;
}

/**
 * Fetches a JSON resource from the API with no caching, forwarding cookies when
 * called from a request scope (needed for authenticated server components).
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { readonly cookieHeader?: string } = {},
): Promise<ApiFetchResult<T>> {
  const url = path.startsWith('http') ? path : `${API_INTERNAL_URL}${path}`;
  const { cookieHeader, ...rest } = init;

  try {
    const response = await fetch(url, {
      ...rest,
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...(rest.headers ?? {}),
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: null,
        error: `${response.status} ${response.statusText}`,
      };
    }
    return { ok: true, status: response.status, data: (await response.json()) as T, error: null };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: (error as Error).message };
  }
}
