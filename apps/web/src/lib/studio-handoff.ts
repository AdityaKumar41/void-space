/**
 * Where a VOID·SPACE session is handed to VOID·STUDIO.
 *
 * The editor cannot read this site's cookie: it runs on its own origin, and its
 * isolation policy drops `window.opener`. The handoff is a same-origin page on
 * the editor (`/sso.html`) that stores the token and closes. Only the origin is
 * and deployment path are taken from configuration so Pages subpaths are preserved.
 */
const FALLBACK_STUDIO_ORIGIN = 'http://localhost:5007';

export function studioHandoffUrl(token: string, studioUrl?: string | null): string {
  const candidate = process.env.NEXT_PUBLIC_STUDIO_URL || studioUrl || FALLBACK_STUDIO_ORIGIN;
  let origin = FALLBACK_STUDIO_ORIGIN;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      origin = url.origin + url.pathname.replace(/\/+$/, '');
    }
  } catch {
    origin = FALLBACK_STUDIO_ORIGIN;
  }
  return `${origin}/sso.html?token=${encodeURIComponent(token)}`;
}
