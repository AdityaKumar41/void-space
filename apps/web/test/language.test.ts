import { describe, expect, it } from 'vitest';

import { translate } from '../src/lib/language';

describe('UI language catalog', () => {
  it('translates supported Telugu and Hindi messages', () => {
    expect(translate('te', 'Translate lesson')).toBe('పాఠాన్ని అనువదించండి');
    expect(translate('hi', 'Translate lesson')).toBe('पाठ का अनुवाद करें');
  });

  it('interpolates values and falls back to the source message', () => {
    expect(translate('te', 'Step {current} of {total}', { current: 2, total: 5 })).toBe(
      'దశ 2 / 5',
    );
    expect(translate('hi', 'Uncatalogued message')).toBe('Uncatalogued message');
  });
});
