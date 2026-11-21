import { NextResponse, type NextRequest } from 'next/server';

/** Preserve direct console/QR destinations through the server-side sign-in gate. */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Always overwrite the incoming value; it must describe this request.
  headers.set('x-void-request-path', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/console/:path*'] };
