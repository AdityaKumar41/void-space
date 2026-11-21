import { expect, it } from 'vitest';
import { safeNextPath } from '../src/lib/safe-next-path';
it('preserves room and field-guide return destinations', () => {
  expect(safeNextPath('/console/spaces?room=room-1')).toBe('/console/spaces?room=room-1');
  expect(safeNextPath(['/console/field-guides?guide=guide-1'])).toBe(
    '/console/field-guides?guide=guide-1',
  );
});
it('rejects off-site, normalized off-site and authentication destinations', () => {
  for (const value of [
    '//evil.test',
    '/\\evil.test',
    '/\t/evil.test',
    'https://evil.test',
    '/login?next=/console',
    '/console/../login',
    undefined,
  ])
    expect(safeNextPath(value)).toBe('/console');
});
