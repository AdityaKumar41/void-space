import {modelingModesForData, objectDataKind} from '../../scripts/core/modeling_modes'
const modes = [
  {name: 'pan', uiname: 'Pan', hideFromModeMenu: true},
  {name: 'leafmesh', uiname: 'Edit Mode', dataKinds: ['leafmesh']},
  {name: 'object', uiname: 'Object Mode'},
  {name: 'sculptcore', uiname: 'Sculpt Mode', dataKinds: ['litemesh']},
  {name: 'boxmodel', uiname: 'Edit Mode', dataKinds: ['litemesh']},
]
test('a LiteMesh exposes one Edit mode and its real Sculpt mode', () => {
  expect(modelingModesForData(modes, 'litemesh').map((m) => m.name)).toEqual(['object', 'boxmodel', 'sculptcore'])
})
test('LeafMesh exposes its own edit tools, while cameras, lights and no selection stay in Object mode', () => {
  expect(modelingModesForData(modes, 'leafmesh').map((m) => m.name)).toEqual(['object', 'leafmesh'])
  for (const kind of ['camera', 'light', undefined])
    expect(modelingModesForData(modes, kind).map((m) => m.name)).toEqual(['object'])
})
test('data kind comes from the registered data contract rather than an object display name', () => {
  class Mesh {
    static dataDefine() {
      return {dataKind: 'litemesh'}
    }
  }
  expect(objectDataKind(new Mesh())).toBe('litemesh')
  expect(objectDataKind({lib_type: 'leafmesh', name: 'Camera'})).toBe('leafmesh')
  expect(objectDataKind(undefined)).toBeUndefined()
})
