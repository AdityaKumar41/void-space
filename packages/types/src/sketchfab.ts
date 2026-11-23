/** Accept model identities, never arbitrary embed HTML or download URLs. */
export function sketchfabModelId(value: string): string | null {
  const input = value.trim();
  if (/^[a-f0-9]{32}$/i.test(input)) return input.toLowerCase();
  try {
    const url = new URL(input);
    if (
      url.protocol !== 'https:' ||
      !['sketchfab.com', 'www.sketchfab.com'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const match = url.pathname.match(
      /^\/(?:3d-models\/[^/]*?|models\/)([a-f0-9]{32})(?:\/embed)?\/?$/i,
    );
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export interface SketchfabModel {
  uid: string;
  name: string;
  author: string;
  url: string;
  license: string;
  downloadable: boolean;
  thumbnail: string | null;
}

export function sketchfabEmbedUrl(uid: string): string {
  if (!/^[a-f0-9]{32}$/.test(uid)) throw new Error('Invalid Sketchfab model ID');
  return `https://sketchfab.com/models/${uid}/embed?autostart=0&preload=0`;
}
