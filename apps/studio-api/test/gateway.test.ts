import './env';

import { MockVoidSpaceClient } from '@void-space/voidspace-client';
import { describe, expect, it } from 'vitest';

import { UpstreamError, ValidationError } from '../src/lib/errors';
import { buildVoidSpaceBridge, buildVoidSpaceLinks, viaUpstream } from '../src/lib/gateway';
import { applyStudioTestEnv } from './harness';

/**
 * The bridge's construction rules (§3.5.2, §9.1).
 *
 * These are the decisions that are cheap to get wrong and expensive to notice: whether a missing
 * credential disables *publishing* or the whole integration, and whether a mis-set URL fails at boot
 * or at the first publish. Both are asserted here because neither can be seen from a passing UI.
 */
describe('the VOID·SPACE bridge', () => {
  it('refuses to start in live mode without a base URL', () => {
    // Failing at boot is the point: the alternative is a service that looks healthy and 404s on the
    // first publish, after a Creator has been told their work is ready.
    expect(() =>
      buildVoidSpaceBridge(
        applyStudioTestEnv({
          VOIDSPACE_CLIENT_MODE: 'live',
          STUDIO_VOIDSPACE_API_BASE_URL: undefined,
        }),
      ),
    ).toThrow(/STUDIO_VOIDSPACE_API_BASE_URL/);
  });

  it('disables publishing — not browsing — when no tenant key is configured', () => {
    const bridge = buildVoidSpaceBridge(
      applyStudioTestEnv({
        VOIDSPACE_CLIENT_MODE: 'live',
        STUDIO_VOIDSPACE_API_BASE_URL: 'https://void.example',
        STUDIO_VOIDSPACE_API_KEY: undefined,
      }),
    );

    expect(bridge.mode).toBe('live');
    expect(bridge.publishEnabled).toBe(false);

    let thrown: unknown;
    try {
      bridge.requirePublishCredential();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    const error = thrown as ValidationError;
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    // The remedy is named in full: which key, where to mint it, and the setting to place it in.
    expect(error.message).toContain('STUDIO_VOIDSPACE_API_KEY');
    expect(error.message).toContain('FR-12.3');
    expect(error.details).toEqual({ missing: 'STUDIO_VOIDSPACE_API_KEY' });
  });

  it('turns publishing on once a key exists', () => {
    const bridge = buildVoidSpaceBridge(
      applyStudioTestEnv({
        VOIDSPACE_CLIENT_MODE: 'live',
        STUDIO_VOIDSPACE_API_BASE_URL: 'https://void.example',
        STUDIO_VOIDSPACE_API_KEY: 'vs_dev_key',
      }),
    );

    expect(bridge.publishEnabled).toBe(true);
    expect(bridge.apiBaseUrl).toBe('https://void.example');
    expect(() => bridge.requirePublishCredential()).not.toThrow();
    // Without this the bridge would be a real HTTP client pretending to be the simulator.
    expect(bridge.gateway).not.toBeInstanceOf(MockVoidSpaceClient);
  });

  it('simulates the whole flow in mock mode, with no credential and no VOID·SPACE', () => {
    const bridge = buildVoidSpaceBridge(applyStudioTestEnv({ VOIDSPACE_CLIENT_MODE: 'mock' }));

    expect(bridge.mode).toBe('mock');
    expect(bridge.gateway).toBeInstanceOf(MockVoidSpaceClient);
    expect(bridge.apiBaseUrl).toBeUndefined();
    // Mock mode is a simulator, not a degraded state: nothing is missing, so nothing is refused.
    expect(bridge.publishEnabled).toBe(true);
    expect(() => bridge.requirePublishCredential()).not.toThrow();
  });

  it('carries the publish poll cadence from configuration (FR-14.3)', () => {
    const bridge = buildVoidSpaceBridge(
      applyStudioTestEnv({
        VOIDSPACE_CLIENT_MODE: 'mock',
        STUDIO_PUBLISH_POLL_INTERVAL_MS: '45000',
      }),
    );

    expect(bridge.pollIntervalMs).toBe(45_000);
  });

  it('builds links a Creator can follow into VOID·SPACE', () => {
    const links = buildVoidSpaceLinks(
      applyStudioTestEnv({ VOIDSPACE_CONSOLE_URL: 'https://void.example/' }),
    );

    // The trailing slash is trimmed, so a base copied out of an address bar does not produce
    // `//catalog/...` — a URL that 404s on some proxies and not others.
    expect(links.consoleUrl).toBe('https://void.example');
    expect(links.catalogUrl).toBe('https://void.example/catalog');
    expect(links.assetUrl('asset-1')).toBe('https://void.example/catalog/asset-1');
  });
});

describe('upstream failures', () => {
  it('reports which system failed instead of a bare "fetch failed"', async () => {
    let thrown: unknown;
    try {
      await viaUpstream('browse the public catalogue', async () => {
        throw new TypeError('fetch failed');
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UpstreamError);
    const error = thrown as UpstreamError;
    // 502 rather than 500: VOID·SPACE being down is a diagnosable dependency state, and the UI
    // retries this differently from a bug on our side.
    expect(error.statusCode).toBe(502);
    expect(error.code).toBe('UPSTREAM_FAILURE');
    expect(error.message).toContain('browse the public catalogue');
    expect(error.message).toContain('fetch failed');
    expect(error.details).toEqual({ operation: 'browse the public catalogue' });
  });

  it('passes a successful result straight through', async () => {
    await expect(viaUpstream('read a value', async () => 42)).resolves.toBe(42);
  });
});
