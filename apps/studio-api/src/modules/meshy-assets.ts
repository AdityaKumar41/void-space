/**
 * Hosts a downloaded Meshy result is allowed to come from.
 *
 * The task API returns a URL. Following an arbitrary one would turn the Studio
 * API into an open proxy, so only Meshy's own HTTPS hosts are accepted.
 */
export function meshyAssetUrlAllowed(raw: string): string | null {
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return null;
  }
  if (target.protocol !== 'https:' || target.username || target.password) return null;
  const host = target.hostname.toLowerCase();
  if (host !== 'meshy.ai' && !host.endsWith('.meshy.ai')) return null;
  return target.toString();
}
