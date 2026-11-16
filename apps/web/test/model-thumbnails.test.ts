import { describe, expect, it } from 'vitest';

import { isThumbnailModelFormat } from '../src/lib/model-thumbnails';

describe('isThumbnailModelFormat', () => {
  it.each(['glb', '.glb', 'GLB', '.GLTF', 'gltf'])('accepts %s', (format) => {
    expect(isThumbnailModelFormat(format)).toBe(true);
  });

  it.each(['obj', '.fbx', 'stl', '', null, undefined])('rejects %s', (format) => {
    expect(isThumbnailModelFormat(format)).toBe(false);
  });
});
