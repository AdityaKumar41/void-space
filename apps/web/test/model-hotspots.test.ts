import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { hotspotAnchor } from '../src/lib/model-hotspots';
describe('labels follow real model components', () => {
  it('anchors generated zero-offset labels to distinct mesh centres instead of piling at the model origin', () => {
    const center = new Vector3(0, 0, 0),
      left = { labelCenter: new Vector3(-2, 1, 0), worldOffset: new Vector3(-1, 0.5, 0) },
      right = { labelCenter: new Vector3(3, 0, 0), worldOffset: new Vector3(1, 0, 0) };
    expect(hotspotAnchor([0, 0, 0], center, 10, left, false).toArray()).toEqual([-2, 1, 0]);
    expect(hotspotAnchor([0, 0, 0], center, 10, right, false).toArray()).toEqual([3, 0, 0]);
    expect(hotspotAnchor([0, 0, 0], center, 10, left, true).toArray()).toEqual([-3, 1.5, 0]);
    expect(left.labelCenter.toArray()).toEqual([-2, 1, 0]);
  });
  it('preserves authored surface positions and uses world offsets for transformed component separation', () => {
    expect(
      hotspotAnchor(
        [0.2, 0.1, -0.1],
        new Vector3(1, 2, 3),
        10,
        { labelCenter: new Vector3(9, 9, 9), worldOffset: new Vector3(0, 2, 0) },
        true,
      ).toArray(),
    ).toEqual([3, 5, 2]);
    expect(hotspotAnchor([0, 0, 0], new Vector3(1, 2, 3), 10, undefined, false).toArray()).toEqual([
      1, 2, 3,
    ]);
  });
});
