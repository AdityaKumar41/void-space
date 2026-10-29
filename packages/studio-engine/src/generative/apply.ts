/**
 * Turns accepted Copilot calls into editor operations.
 *
 * One instruction is one undo step at the call site: this function applies the
 * whole list and returns one command id. `$last` means the object the previous
 * call in this list created. `$active` means the editor's current selection.
 */

import { buildPrimitive, type LocalPrimitiveKind, type MeshBuffers } from './mesh';

export interface SceneObjectRef {
  readonly id: string;
  readonly name: string;
  readonly childCount: number;
}

export interface TransformChange {
  readonly translate?: readonly [number, number, number];
  readonly rotateDegrees?: readonly [number, number, number];
  readonly scale?: readonly [number, number, number];
}

export interface PbrAssignment {
  readonly albedo: Uint8ClampedArray;
  readonly normal: Uint8ClampedArray;
  readonly roughness: Uint8ClampedArray;
  readonly metallic: Uint8ClampedArray;
  readonly size: number;
  readonly roughnessValue: number;
  readonly metallicValue: number;
  readonly baseColor: string;
}

export interface CommandEditor {
  list(): readonly SceneObjectRef[];
  activeId(): string | null;
  addMesh(
    name: string,
    buffers: MeshBuffers,
    location: readonly [number, number, number],
    scale: readonly [number, number, number],
  ): string;
  importGlb(
    name: string,
    bytes: Uint8Array,
    location: readonly [number, number, number],
    scale: readonly [number, number, number],
  ): string;
  setTransform(id: string, change: TransformChange): void;
  setMaterial(id: string, property: string, value: number | string): void;
  deleteObject(id: string, recursive: boolean): void;
  groupObjects(ids: readonly string[], name: string): string;
  applyMaps(objectId: string, maps: PbrAssignment): void;
}

export type SceneCommand =
  | { readonly kind: 'call'; readonly name: string; readonly input: Record<string, unknown> }
  | {
      readonly kind: 'mesh';
      readonly name: string;
      readonly buffers?: MeshBuffers;
      readonly glb?: Uint8Array;
      readonly location: readonly [number, number, number];
      readonly scale: readonly [number, number, number];
      readonly note: string;
    }
  | { readonly kind: 'maps'; readonly objectId: string; readonly maps: PbrAssignment; readonly note: string }
  | { readonly kind: 'skip'; readonly summary: string };

export interface CommandResult {
  readonly ok: boolean;
  readonly summary: string;
}

export interface ApplyBatch {
  readonly commandId: string;
  readonly results: readonly CommandResult[];
}

function asVec3(value: unknown, fallback: readonly [number, number, number]): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const nums = value.map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number.NaN));
  if (nums.some((item) => Number.isNaN(item))) return fallback;
  return [nums[0]!, nums[1]!, nums[2]!];
}

function resolveId(raw: unknown, lastId: string | null, editor: CommandEditor): string | null {
  if (raw === '$last') return lastId;
  if (raw === '$active') return editor.activeId() ?? lastId;
  if (typeof raw === 'string' && raw.length > 0) {
    return editor.list().some((object) => object.id === raw) ? raw : null;
  }
  return null;
}

function objectById(editor: CommandEditor, id: string): SceneObjectRef | undefined {
  return editor.list().find((object) => object.id === id);
}

export function applySceneCommands(editor: CommandEditor, commands: readonly SceneCommand[], commandId: string): ApplyBatch {
  const results: CommandResult[] = [];
  let lastId: string | null = editor.activeId();

  for (const command of commands) {
    try {
      if (command.kind === 'skip') {
        results.push({ ok: false, summary: command.summary });
        continue;
      }

      if (command.kind === 'mesh') {
        const id = command.glb
          ? editor.importGlb(command.name, command.glb, command.location, command.scale)
          : editor.addMesh(command.name, command.buffers!, command.location, command.scale);
        lastId = id;
        results.push({ ok: true, summary: `${command.note} Added “${command.name}”.` });
        continue;
      }

      if (command.kind === 'maps') {
        const id = resolveId(command.objectId, lastId, editor);
        if (!id) {
          results.push({ ok: false, summary: 'No object is selected, so the PBR maps were not assigned.' });
          continue;
        }
        editor.applyMaps(id, command.maps);
        results.push({ ok: true, summary: command.note });
        continue;
      }

      const input = command.input;
      if (command.name === 'addPrimitive') {
        const kind = input.kind;
        if (typeof kind !== 'string') {
          results.push({ ok: false, summary: 'addPrimitive did not name a primitive.' });
          continue;
        }
        const buffers = buildPrimitive(kind as LocalPrimitiveKind);
        const name = typeof input.name === 'string' ? input.name : kind;
        const id = editor.addMesh(name, buffers, asVec3(input.location, [0, 0, 0]), asVec3(input.scale, [1, 1, 1]));
        lastId = id;
        results.push({ ok: true, summary: `Added ${name}.` });
        continue;
      }

      if (command.name === 'setTransform') {
        const id = resolveId(input.objectId, lastId, editor);
        if (!id) {
          results.push({ ok: false, summary: 'setTransform could not find that object.' });
          continue;
        }
        editor.setTransform(id, {
          ...(input.translate === undefined ? {} : { translate: asVec3(input.translate, [0, 0, 0]) }),
          ...(input.rotate === undefined ? {} : { rotateDegrees: asVec3(input.rotate, [0, 0, 0]) }),
          ...(input.scale === undefined ? {} : { scale: asVec3(input.scale, [1, 1, 1]) }),
        });
        results.push({ ok: true, summary: `Moved ${objectById(editor, id)?.name ?? id}.` });
        continue;
      }

      if (command.name === 'setMaterialProperty') {
        const id = resolveId(input.objectId, lastId, editor);
        if (!id) {
          results.push({ ok: false, summary: 'No object is selected, so the material was not changed.' });
          continue;
        }
        const property = String(input.property ?? '');
        const value = input.value;
        if (typeof value !== 'number' && typeof value !== 'string') {
          results.push({ ok: false, summary: `${property} had no usable value.` });
          continue;
        }
        editor.setMaterial(id, property, value);
        results.push({ ok: true, summary: `Set ${property} on ${objectById(editor, id)?.name ?? id}.` });
        continue;
      }

      if (command.name === 'deleteObject') {
        const id = resolveId(input.objectId, lastId, editor);
        if (!id) {
          results.push({ ok: false, summary: 'deleteObject could not find that object.' });
          continue;
        }
        const found = objectById(editor, id);
        if (found && found.childCount > 0 && input.recursive !== true) {
          results.push({ ok: false, summary: `${found.name} has children. Say recursive to delete them too.` });
          continue;
        }
        editor.deleteObject(id, input.recursive === true);
        if (lastId === id) lastId = null;
        results.push({ ok: true, summary: `Deleted ${found?.name ?? id}.` });
        continue;
      }

      if (command.name === 'groupObjects') {
        const ids = Array.isArray(input.objectIds) ? input.objectIds.filter((item): item is string => typeof item === 'string') : [];
        if (ids.length < 2) {
          results.push({ ok: false, summary: 'Grouping needs at least two objects.' });
          continue;
        }
        const name = typeof input.name === 'string' ? input.name : 'Group';
        editor.groupObjects(ids, name);
        results.push({ ok: true, summary: `Grouped ${ids.length} objects as ${name}.` });
        continue;
      }

      if (command.name === 'applyModifier') {
        results.push({
          ok: false,
          summary: 'This editor has no modifier stack, so the modifier was not applied.',
        });
        continue;
      }

      results.push({ ok: false, summary: `${command.name} is not applied in the viewport.` });
    } catch (error) {
      results.push({
        ok: false,
        summary: error instanceof Error ? error.message : 'The command could not be applied.',
      });
    }
  }

  return { commandId, results };
}
