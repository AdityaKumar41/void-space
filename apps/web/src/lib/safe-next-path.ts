/** Keep return destinations within this application, including URL normalization rules. */
export function safeNextPath(value: string | string[] | undefined, fallback = '/console'): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith('/') || /[\\\u0000-\u0020\u007f]/.test(candidate))
    return fallback;
  try {
    const base = 'https://void-space.invalid';
    const url = new URL(candidate, base);
    if (url.origin !== base || url.pathname.startsWith('/login')) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
