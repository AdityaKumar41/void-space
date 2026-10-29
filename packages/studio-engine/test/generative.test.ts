import { describe, expect, it } from 'vitest';

import {
  applySceneCommands,
  buildPrimitive,
  heightfieldFromLuminance,
  interpretInstruction,
  readableCopilotText,
  pbrFromPrompt,
  primitiveForPrompt,
  type CommandEditor,
  type MeshBuffers,
  type PbrAssignment,
  type SceneCommand,
  type SceneObjectRef,
} from '../src/generative';

function fakeEditor(): CommandEditor & { objects: SceneObjectRef[]; maps: string[] } {
  const objects: SceneObjectRef[] = [{ id: 'crate', name: 'Crate', childCount: 0 }];
  const maps: string[] = [];
  let next = 1;
  return {
    objects,
    maps,
    list: () => objects,
    activeId: () => objects[0]?.id ?? null,
    addMesh: (name) => {
      const id = `new-${next++}`;
      objects.push({ id, name, childCount: 0 });
      return id;
    },
    importGlb: (name) => {
      const id = `glb-${next++}`;
      objects.push({ id, name, childCount: 0 });
      return id;
    },
    setTransform: () => undefined,
    setMaterial: () => undefined,
    deleteObject: (id) => {
      const index = objects.findIndex((object) => object.id === id);
      if (index >= 0) objects.splice(index, 1);
    },
    groupObjects: (_ids, name) => name,
    applyMaps: (id) => {
      maps.push(id);
    },
  };
}

describe('local generative meshes', () => {
  it('builds a closed cube whose corner normal points outward', () => {
    const cube = buildPrimitive('cube');
    expect(cube.indices.length).toBe(36);
    let outward = false;
    for (let i = 0; i < cube.positions.length; i += 3) {
      if (cube.positions[i] > 0 && cube.positions[i + 1] > 0 && cube.positions[i + 2] > 0) {
        outward = cube.normals[i] > 0 && cube.normals[i + 1] > 0 && cube.normals[i + 2] > 0;
      }
    }
    expect(outward).toBe(true);
    const sphere = buildPrimitive('sphere');
    let north = -1;
    for (let i = 1; i < sphere.positions.length; i += 3) {
      if (sphere.positions[i] > north) north = sphere.positions[i];
    }
    const northIndex = sphere.positions.findIndex((_, index) => index % 3 === 1 && sphere.positions[index] === north);
    expect(sphere.normals[northIndex]).toBeGreaterThan(0.5);
  });

  it('raises the brighter pixel of a relief mesh', () => {
    const mesh = heightfieldFromLuminance(new Float32Array([0, 1, 0, 0]), 2, 2, 2, 1);
    const heights = [];
    for (let i = 1; i < mesh.positions.length; i += 3) heights.push(mesh.positions[i]);
    expect(Math.max(...heights)).toBeCloseTo(1);
    expect(Math.min(...heights)).toBeCloseTo(0);
    expect(mesh.indices.length).toBe(6);
  });

  it('picks a sphere for a ball prompt and a cube otherwise', () => {
    expect(primitiveForPrompt('a ceramic ball')).toBe('sphere');
    expect(primitiveForPrompt('industrial crate')).toBe('cube');
  });

  it('builds four coordinated PBR channels for chrome', () => {
    const maps = pbrFromPrompt('brushed chrome', 8);
    expect(maps.albedo.length).toBe(8 * 8 * 4);
    expect(maps.normal.length).toBe(maps.albedo.length);
    expect(maps.metallicValue).toBeGreaterThan(0.8);
    expect(maps.roughnessValue).toBeLessThan(0.4);
    expect(maps.label).toBe('brushed metal');
  });
});

describe('local instruction reading', () => {
  it('turns the crate chip into a cube plus a metal and a texture', () => {
    const calls = interpretInstruction('Create metallic industrial crate', { selection: [] });
    expect(calls.map((call) => call.name)).toEqual([
      'addPrimitive',
      'setMaterialProperty',
      'setMaterialProperty',
      'setMaterialProperty',
      'generateTexture',
    ]);
    expect(calls[0]?.input.kind).toBe('cube');
    expect(calls[1]?.input.objectId).toBe('$last');
    expect(calls[1]?.input.value).toBe('#c5c9d1');
  });

  it('hides a fenced tool dump and keeps a normal sentence', () => {
    const dump = 'To create a red metal crate, I will use the `addPrimitive` function. Here\'s the code:\n```json\n[{"name":"addPrimitive"}]\n```';
    expect(readableCopilotText(dump)).toBe('');
    expect(
      readableCopilotText(
        'To create a red metal crate, I will first add a cube.\nHere are the tool calls:\n1. addPrimitive(kind="cube", name="Crate")\n2. setMaterialProperty(objectId="Crate", property="baseColor", value="#8b5a2b")\nThe result is a red metal crate added to the scene.',
      ),
    ).toBe(
      'To create a red metal crate, I will first add a cube.\nThe result is a red metal crate added to the scene.',
    );
    expect(readableCopilotText('The crate is a cube with a metal surface.\nIt sits at the origin.')).toBe(
      'The crate is a cube with a metal surface.\nIt sits at the origin.',
    );
  });

  it('keeps a named colour on a metal object', () => {
    const calls = interpretInstruction('Create a red metal crate', { selection: [] });
    const color = calls.find((call) => call.input.property === 'baseColor');
    expect(color?.input.value).toBe('#c44536');
    expect(calls.some((call) => call.input.property === 'metallic')).toBe(true);
  });

  it('does not invent an edit for an audit request', () => {
    expect(interpretInstruction('Check topology and polygon budget', { selection: [] })).toEqual([]);
  });

  it('paints the selection when asked for chrome', () => {
    const calls = interpretInstruction('Apply brushed chrome PBR material', { selection: ['obj-1'] });
    expect(calls[0]?.input.objectId).toBe('obj-1');
    expect(calls.some((call) => call.name === 'generateTexture')).toBe(true);
  });
});

describe('applying a command batch', () => {
  it('adds a primitive and assigns maps to it in one batch', () => {
    const editor = fakeEditor();
    const maps: PbrAssignment = {
      albedo: new Uint8ClampedArray(16),
      normal: new Uint8ClampedArray(16),
      roughness: new Uint8ClampedArray(16),
      metallic: new Uint8ClampedArray(16),
      size: 2,
      roughnessValue: 0.2,
      metallicValue: 0.9,
      baseColor: '#cccccc',
    };
    const commands: SceneCommand[] = [
      { kind: 'call', name: 'addPrimitive', input: { kind: 'cube', name: 'Crate', location: [1, 0, 0], scale: [1, 1, 1] } },
      { kind: 'maps', objectId: '$last', maps, note: 'Local brushed metal maps assigned.' },
    ];
    const batch = applySceneCommands(editor, commands, 'cmd-1');
    expect(batch.commandId).toBe('cmd-1');
    expect(batch.results.every((result) => result.ok)).toBe(true);
    expect(editor.maps).toEqual(['new-1']);
    expect(editor.objects.some((object) => object.name === 'Crate')).toBe(true);
  });

  it('refuses a modifier because this editor has no stack', () => {
    const batch = applySceneCommands(
      fakeEditor(),
      [{ kind: 'call', name: 'applyModifier', input: { objectId: 'crate', modifier: 'Decimate' } }],
      'cmd-2',
    );
    expect(batch.results[0]?.ok).toBe(false);
    expect(batch.results[0]?.summary).toMatch(/no modifier stack/);
  });

  it('imports a prepared mesh buffer', () => {
    const buffers: MeshBuffers = buildPrimitive('sphere');
    const editor = fakeEditor();
    const batch = applySceneCommands(
      editor,
      [
        {
          kind: 'mesh',
          name: 'Relief',
          buffers,
          location: [0, 0, 0],
          scale: [1, 1, 1],
          note: 'Local relief mesh from the image.',
        },
      ],
      'cmd-3',
    );
    expect(batch.results[0]?.ok).toBe(true);
    expect(editor.objects.some((object) => object.name === 'Relief')).toBe(true);
  });
});
