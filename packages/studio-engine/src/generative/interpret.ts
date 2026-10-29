/**
 * A local reading of a short instruction, used when the model returns no tool call.
 *
 * The phrases are the ones the Copilot panel offers and the obvious "add a cube"
 * shape. Anything else returns an empty list so the panel can show the model's
 * prose instead of inventing an edit.
 */

export interface LocalToolCall {
  readonly name: 'addPrimitive' | 'setMaterialProperty' | 'deleteObject' | 'generateTexture';
  readonly input: Record<string, unknown>;
}

const COLORS: Readonly<Record<string, string>> = {
  red: '#c44536',
  blue: '#3b82f6',
  green: '#3f8f6b',
  wood: '#8b5a2b',
  rust: '#a34b2a',
  white: '#f4f4f5',
  black: '#1c1c1f',
};

function kindFrom(text: string): 'cube' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'torus' | null {
  if (/\b(sphere|ball|orb)\b/.test(text)) return 'sphere';
  if (/\b(cylinder|pipe|tube|column)\b/.test(text)) return 'cylinder';
  if (/\b(cone|funnel)\b/.test(text)) return 'cone';
  if (/\b(plane|floor|ground)\b/.test(text)) return 'plane';
  if (/\b(torus|ring|donut|doughnut)\b/.test(text)) return 'torus';
  if (/\b(cube|box|crate)\b/.test(text)) return 'cube';
  return null;
}

function locationFrom(text: string): [number, number, number] {
  const match = text.match(/at\s+(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function colorFrom(text: string): string | null {
  for (const [word, hex] of Object.entries(COLORS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return hex;
  }
  return null;
}

/**
 * The configured text model often answers a scene prompt with a fenced JSON
 * dump. That dump is not the reply the editor applies.
 */
export function readableCopilotText(value: string): string {
  const withoutFences = value.replace(/```[\s\S]*?```/g, '\n').replace(/`([^`\n]+)`/g, '$1');
  const lines = withoutFences
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[\[{]/.test(line) && !/^[\]}],;]+$/.test(line))
    .filter((line) => !/^\d+\.\s*[A-Za-z_]+\s*:?\s*$/.test(line))
    .filter((line) => !/^(addPrimitive|setMaterialProperty|generateTexture|deleteObject)\b\s*:?\s*$/i.test(line))
    .filter((line) => !/\b(addPrimitive|setMaterialProperty|generateTexture|deleteObject)\s*\(/i.test(line))
    .filter((line) => !/here are the (two |following )?(tool )?calls:?\s*$/i.test(line));
  const text = lines.join('\n').replace(/[ \t]{2,}/g, ' ').trim();
  if (/```/.test(value) && text.length < 180 && /\b(code|function|json|tool)\b/i.test(text)) return '';
  return text;
}

export function interpretInstruction(
  text: string,
  scene: { readonly selection: readonly string[] },
): LocalToolCall[] {
  const lower = text.trim().toLowerCase();
  if (!lower) return [];

  const selection = scene.selection.filter((id) => id.length > 0);
  const calls: LocalToolCall[] = [];
  const wantsAdd = /\b(add|create|make|put|spawn|place)\b/.test(lower);
  const kind = kindFrom(lower);

  if (wantsAdd && kind) {
    calls.push({
      name: 'addPrimitive',
      input: {
        kind,
        name: /\bcrate\b/.test(lower) ? 'Crate' : kind.charAt(0).toUpperCase() + kind.slice(1),
        location: locationFrom(lower),
        scale: [1, 1, 1],
      },
    });
  }

  const target = calls.length > 0 ? '$last' : (selection[0] ?? '$active');
  const metallic = /\b(chrome|metallic|metal|steel|brushed)\b/.test(lower);
  const color = colorFrom(lower);
  const canPaint = calls.length > 0 || selection.length > 0;

  if (canPaint && (metallic || color)) {
    // A named colour stays the colour. "Red metal" must not be repainted as grey chrome.
    calls.push({
      name: 'setMaterialProperty',
      input: { objectId: target, property: 'baseColor', value: color ?? '#c5c9d1' },
    });
  }
  if (canPaint && metallic) {
    calls.push({ name: 'setMaterialProperty', input: { objectId: target, property: 'metallic', value: 0.92 } });
    calls.push({ name: 'setMaterialProperty', input: { objectId: target, property: 'roughness', value: 0.2 } });
    calls.push({
      name: 'generateTexture',
      input: { objectId: target, prompt: text.trim().slice(0, 400) },
    });
  }

  if (/\b(delete|remove)\b/.test(lower) && selection[0] && !wantsAdd) {
    calls.push({ name: 'deleteObject', input: { objectId: selection[0], recursive: /\brecursive\b/.test(lower) } });
  }

  return calls;
}
