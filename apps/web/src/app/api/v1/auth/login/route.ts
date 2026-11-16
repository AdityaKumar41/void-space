import { randomUUID } from 'node:crypto';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

function errorResponse(
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
): Response {
  const error =
    statusCode === 502
      ? 'Bad Gateway'
      : statusCode === 503
        ? 'Service Unavailable'
        : statusCode === 504
          ? 'Gateway Timeout'
          : 'Internal Server Error';

  return Response.json(
    {
      statusCode,
      error,
      code,
      message,
      requestId,
      timestamp: new Date().toISOString(),
    },
    { status: statusCode },
  );
}

export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get('x-request-id') ?? randomUUID();
  const headers = new Headers();
  for (const name of ['accept', 'content-type', 'cookie', 'authorization', 'user-agent']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-request-id', requestId);

  let upstream: Response;
  try {
    const body = await request.arrayBuffer();
    upstream = await fetch(`${API_INTERNAL_URL.replace(/\/+$/, '')}/api/v1/auth/login`, {
      method: 'POST',
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch (error) {
    console.error('Authentication API proxy failed', error);
    return errorResponse(
      503,
      'AUTHENTICATION_UNAVAILABLE',
      'The authentication service is temporarily unavailable. Please try again.',
      requestId,
    );
  }

  const text = await upstream.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    const statusCode = upstream.ok ? 502 : upstream.status;
    return errorResponse(
      statusCode,
      'AUTHENTICATION_UPSTREAM_ERROR',
      'The authentication service returned an invalid response. Please try again.',
      requestId,
    );
  }

  const responseHeaders = new Headers();
  for (const [name, value] of upstream.headers) {
    if (
      ![
        'connection',
        'content-encoding',
        'content-length',
        'keep-alive',
        'transfer-encoding',
      ].includes(name.toLowerCase()) &&
      name.toLowerCase() !== 'set-cookie'
    ) {
      responseHeaders.append(name, value);
    }
  }
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', cookie);
  }

  return new Response(JSON.stringify(payload), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
