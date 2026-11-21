import {
  HotKey,
  KeyMap,
} from '../../scripts/path.ux/scripts/path-controller/util/simple_events'
test('Command is one modifier and matches undo and shifted redo independently', () => {
  let undo = 0,
    redo = 0
  const map = new KeyMap([
    new HotKey('Z', ['meta'], () => undo++),
    new HotKey('Z', ['meta', 'shift'], () => redo++),
  ])
  expect(
    map.handle({}, new KeyboardEvent('keydown', {keyCode: 90, metaKey: true}))
  ).toBe(true)
  expect(
    map.handle(
      {},
      new KeyboardEvent('keydown', {keyCode: 90, metaKey: true, shiftKey: true})
    )
  ).toBe(true)
  expect(
    map.handle(
      {},
      new KeyboardEvent('keydown', {keyCode: 90, metaKey: true, altKey: true})
    )
  ).toBe(false)
  expect({undo, redo}).toEqual({undo: 1, redo: 1})
})
test('Control undo does not match Command or unmodified keys', () => {
  let count = 0
  const map = new KeyMap([new HotKey('Z', ['ctrl'], () => count++)])
  expect(
    map.handle({}, new KeyboardEvent('keydown', {keyCode: 90, ctrlKey: true}))
  ).toBe(true)
  expect(
    map.handle({}, new KeyboardEvent('keydown', {keyCode: 90, metaKey: true}))
  ).toBe(false)
  expect(map.handle({}, new KeyboardEvent('keydown', {keyCode: 90}))).toBe(
    false
  )
  expect(count).toBe(1)
})
