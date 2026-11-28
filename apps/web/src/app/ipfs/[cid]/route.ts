/** Compatibility for saved model URLs. No IPFS service is contacted. */
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  if (!/^[a-zA-Z0-9]{32,120}$/.test(cid)) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  for (const key of ['cookie', 'authorization', 'range']) {
    const value = request.headers.get(key); if (value) headers.set(key, value);
  }
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://localhost:4000'}/api/v1/content/${cid}`, {
      headers, cache: 'no-store', signal: AbortSignal.timeout(30000),
    });
    const output = new Headers();
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
      const value = response.headers.get(key); if (value) output.set(key, value);
    }
    output.set('cache-control', 'private, no-store');
    return new Response(response.body, { status: response.status, headers: output });
  } catch { return new Response('Content storage unavailable', { status: 503 }); }
}
