import { afterEach, expect, it, vi } from 'vitest';
import { studioHandoffUrl } from '../src/lib/studio-handoff';

afterEach(() => vi.unstubAllEnvs());

it('preserves the deployment path for a GitHub Pages session handoff', () => {
  vi.stubEnv('NEXT_PUBLIC_STUDIO_URL', 'https://example.github.io/void-space/');
  expect(studioHandoffUrl('a+b')).toBe('https://example.github.io/void-space/sso.html?token=a%2Bb');
});

it('drops query and fragment from the configured editor URL', () => {
  vi.stubEnv('NEXT_PUBLIC_STUDIO_URL', 'https://studio.example/editor/?other=1#fragment');
  expect(studioHandoffUrl('token')).toBe('https://studio.example/editor/sso.html?token=token');
});
