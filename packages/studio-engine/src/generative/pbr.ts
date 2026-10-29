/**
 * Prompt-driven PBR maps that do not call a provider.
 *
 * Albedo, normal, roughness and metallic are generated together from the same
 * height field so the four channels describe one surface. The result is a draft
 * the Creator can edit. It is not a Meshy texture set, and the caller has to say so.
 */

export interface PbrMaps {
  readonly size: number;
  readonly albedo: Uint8ClampedArray;
  readonly normal: Uint8ClampedArray;
  readonly roughness: Uint8ClampedArray;
  readonly metallic: Uint8ClampedArray;
  /** Scalar the diffuse shader can read even when it has no metallic texture input. */
  readonly roughnessValue: number;
  readonly metallicValue: number;
  readonly baseColor: string;
  readonly label: string;
}

interface SurfaceProfile {
  readonly label: string;
  readonly base: readonly [number, number, number];
  readonly alt: readonly [number, number, number];
  readonly roughness: number;
  readonly metallic: number;
  readonly pattern: 'brushed' | 'grain' | 'noise' | 'weave';
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unit(hash: number): number {
  return (hash % 10_000) / 10_000;
}

function profileFor(prompt: string): SurfaceProfile {
  const text = prompt.toLowerCase();
  if (/\b(chrome|steel|metal|metallic|brushed|aluminium|aluminum)\b/.test(text)) {
    return {
      label: 'brushed metal',
      base: [176, 182, 190],
      alt: [120, 126, 136],
      roughness: 0.22,
      metallic: 0.92,
      pattern: 'brushed',
    };
  }
  if (/\b(gold|brass|bronze)\b/.test(text)) {
    return {
      label: 'brushed gold',
      base: [196, 154, 72],
      alt: [120, 84, 32],
      roughness: 0.28,
      metallic: 0.88,
      pattern: 'brushed',
    };
  }
  if (/\b(wood|timber|oak|plank)\b/.test(text)) {
    return {
      label: 'wood',
      base: [126, 84, 48],
      alt: [72, 46, 28],
      roughness: 0.62,
      metallic: 0,
      pattern: 'grain',
    };
  }
  if (/\b(rust|corroded|weathered)\b/.test(text)) {
    return {
      label: 'rust',
      base: [166, 78, 42],
      alt: [90, 48, 32],
      roughness: 0.78,
      metallic: 0.18,
      pattern: 'noise',
    };
  }
  if (/\b(fabric|cloth|canvas|weave)\b/.test(text)) {
    return {
      label: 'fabric',
      base: [70, 86, 112],
      alt: [46, 54, 72],
      roughness: 0.84,
      metallic: 0,
      pattern: 'weave',
    };
  }
  const hash = hashString(text || 'surface');
  return {
    label: 'generated surface',
    base: [40 + (hash % 140), 40 + ((hash >> 8) % 120), 40 + ((hash >> 16) % 100)],
    alt: [20 + ((hash >> 4) % 80), 20 + ((hash >> 12) % 80), 20 + ((hash >> 20) % 80)],
    roughness: 0.35 + unit(hash) * 0.4,
    metallic: /\b(shiny|gloss)\b/.test(text) ? 0.7 : 0.05,
    pattern: 'noise',
  };
}

function heightAt(profile: SurfaceProfile, x: number, y: number, size: number, salt: number): number {
  const u = x / size;
  const v = y / size;
  const n = unit(hashString(`${salt}:${x}:${y}`));
  if (profile.pattern === 'brushed') return Math.sin(v * 90) * 0.35 + (n - 0.5) * 0.15;
  if (profile.pattern === 'grain') return Math.sin(u * 18 + v * 2) * 0.4 + Math.sin(v * 40) * 0.15;
  if (profile.pattern === 'weave') return ((Math.floor(u * 16) + Math.floor(v * 16)) % 2 === 0 ? 0.35 : -0.15) + (n - 0.5) * 0.1;
  return (n - 0.5) * 0.8 + Math.sin(u * 12) * Math.cos(v * 9) * 0.25;
}

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * Math.min(1, Math.max(0, t)));
}

function hexByte(value: number): string {
  return Math.min(255, Math.max(0, value)).toString(16).padStart(2, '0');
}

export function pbrFromPrompt(prompt: string, size = 128): PbrMaps {
  const edge = Math.max(2, Math.min(512, Math.floor(size)));
  const profile = profileFor(prompt);
  const salt = hashString(prompt);
  const albedo = new Uint8ClampedArray(edge * edge * 4);
  const normal = new Uint8ClampedArray(edge * edge * 4);
  const roughness = new Uint8ClampedArray(edge * edge * 4);
  const metallic = new Uint8ClampedArray(edge * edge * 4);
  const heights: number[] = [];

  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      heights.push(heightAt(profile, x, y, edge, salt));
    }
  }

  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      const i = y * edge + x;
      const h = heights[i] ?? 0;
      const t = h * 0.5 + 0.5;
      const o = i * 4;
      albedo[o] = mix(profile.alt[0], profile.base[0], t);
      albedo[o + 1] = mix(profile.alt[1], profile.base[1], t);
      albedo[o + 2] = mix(profile.alt[2], profile.base[2], t);
      albedo[o + 3] = 255;

      const left = heights[y * edge + Math.max(0, x - 1)] ?? h;
      const right = heights[y * edge + Math.min(edge - 1, x + 1)] ?? h;
      const up = heights[Math.max(0, y - 1) * edge + x] ?? h;
      const down = heights[Math.min(edge - 1, y + 1) * edge + x] ?? h;
      const dx = (right - left) * 2;
      const dy = (down - up) * 2;
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      normal[o] = Math.round((nx / len) * 127.5 + 127.5);
      normal[o + 1] = Math.round((ny / len) * 127.5 + 127.5);
      normal[o + 2] = Math.round((nz / len) * 127.5 + 127.5);
      normal[o + 3] = 255;

      const rough = Math.round(Math.min(1, Math.max(0, profile.roughness + h * 0.15)) * 255);
      roughness[o] = rough;
      roughness[o + 1] = rough;
      roughness[o + 2] = rough;
      roughness[o + 3] = 255;

      const metal = Math.round(profile.metallic * 255);
      metallic[o] = metal;
      metallic[o + 1] = metal;
      metallic[o + 2] = metal;
      metallic[o + 3] = 255;
    }
  }

  return {
    size: edge,
    albedo,
    normal,
    roughness,
    metallic,
    roughnessValue: profile.roughness,
    metallicValue: profile.metallic,
    baseColor: `#${hexByte(profile.base[0])}${hexByte(profile.base[1])}${hexByte(profile.base[2])}`,
    label: profile.label,
  };
}
