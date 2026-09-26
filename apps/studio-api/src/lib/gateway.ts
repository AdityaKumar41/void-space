/**
 * The VOID·SPACE bridge: the one place this service decides *how* it talks to
 * VOID·SPACE, and the only module permitted to construct a gateway (§5.3).
 *
 * Two implementations satisfy the interface (§9.1):
 *
 *   - `VoidSpaceClient`       — real HTTP against a deployed VOID·SPACE.
 *   - `MockVoidSpaceClient`   — an in-memory simulation of the publish/review lifecycle,
 *                               so the whole of §4.14 is exercisable with no VOID·SPACE
 *                               running at all.
 *
 * The mode is an explicit environment value (`VOIDSPACE_CLIENT_MODE`) rather than an
 * inference from "is a URL set?". Inferring it would mean a deployment that lost its
 * API key silently fell back to a simulator and reported successful publishes that
 * never happened — the single worst failure this service could have.
 */
import {
  MockVoidSpaceClient,
  VoidSpaceClient,
  type VoidSpaceGateway,
} from '@void-space/voidspace-client';

import type { StudioApiEnv } from '../env';
import { UpstreamError, ValidationError } from './errors';

/** Where a published asset can be viewed. Surfaced to the UI so a publish has a destination. */
export interface VoidSpaceLinks {
  readonly consoleUrl: string;
  /** The catalogue entry a published asset will appear under once approved. */
  readonly catalogUrl: string;
  readonly assetUrl: (assetId: string) => string;
}

export function buildVoidSpaceLinks(env: StudioApiEnv): VoidSpaceLinks {
  const base = env.VOIDSPACE_CONSOLE_URL.replace(/\/+$/, '');
  return {
    consoleUrl: base,
    catalogUrl: `${base}/catalog`,
    // `/catalog/<id>` is the public entry point (§6.1), so this is the link a Creator
    // can share — not an internal admin route that requires their own session.
    assetUrl: (assetId: string) => `${base}/catalog/${assetId}`,
  };
}

export interface VoidSpaceBridge {
  readonly mode: 'mock' | 'live';
  readonly gateway: VoidSpaceGateway;
  readonly apiBaseUrl: string | undefined;
  readonly links: VoidSpaceLinks;
  /**
   * Whether a tenant credential is configured, i.e. whether publishing can work.
   *
   * A boolean rather than a nullable gateway, because catalogue browsing is
   * *anonymous by design* — `browsePublicCatalog` sends `token: null` and never
   * exchanges the key (§3.5.2's read path, FR-15.2). So the Studio can show the
   * marketplace before any credential exists, and only Publish needs one. Modelling
   * this as "no gateway at all" would break browsing for no reason.
   */
  readonly publishEnabled: boolean;
  /** Throws with a message that names the fix when publishing is attempted without a credential. */
  requirePublishCredential(): void;
  /** The largest export this service will forward, in bytes. */
  readonly maxUploadBytes: number;
  /**
   * How often a client should re-read a publish's status (FR-14.3), in milliseconds.
   *
   * Carried on the bridge because it is part of the same description of *where* VOID·SPACE is and how
   * the Studio talks to it — the editor renders it in the panel and polls on it, and a second source
   * for the value is how the two drift apart.
   */
  readonly pollIntervalMs: number;
}

export function buildVoidSpaceBridge(env: StudioApiEnv): VoidSpaceBridge {
  const links = buildVoidSpaceLinks(env);

  if (env.VOIDSPACE_CLIENT_MODE === 'mock') {
    return {
      mode: 'mock',
      gateway: new MockVoidSpaceClient(),
      apiBaseUrl: undefined,
      links,
      publishEnabled: true,
      requirePublishCredential: () => undefined,
      maxUploadBytes: env.STUDIO_MAX_UPLOAD_BYTES,
      pollIntervalMs: env.STUDIO_PUBLISH_POLL_INTERVAL_MS,
    };
  }

  if (!env.STUDIO_VOIDSPACE_API_BASE_URL) {
    throw new Error(
      '[studio-api] VOIDSPACE_CLIENT_MODE=live requires STUDIO_VOIDSPACE_API_BASE_URL. ' +
        "Set it to VOID·SPACE's /api/v1 root, or set VOIDSPACE_CLIENT_MODE=mock to run the " +
        'publish flow against the §9.1 simulator.',
    );
  }

  const apiKey = env.STUDIO_VOIDSPACE_API_KEY;
  const publishEnabled = typeof apiKey === 'string' && apiKey.length > 0;

  const gateway = new VoidSpaceClient({
    baseUrl: env.STUDIO_VOIDSPACE_API_BASE_URL,
    /*
     * The client requires a key, so a placeholder stands in when none is configured.
     * That is safe *only* because nothing that needs a credential can reach the network
     * without passing `requirePublishCredential` first, which every authenticated call
     * site does. The alternative — a nullable gateway — would disable anonymous
     * catalogue browsing, which needs no credential at all.
     */
    apiKey: publishEnabled ? apiKey! : 'unconfigured',
  });

  return {
    mode: 'live',
    gateway,
    apiBaseUrl: env.STUDIO_VOIDSPACE_API_BASE_URL,
    links,
    publishEnabled,
    maxUploadBytes: env.STUDIO_MAX_UPLOAD_BYTES,
    pollIntervalMs: env.STUDIO_PUBLISH_POLL_INTERVAL_MS,
    requirePublishCredential: () => {
      if (publishEnabled) return;
      throw new ValidationError(
        'Publishing to VOID·SPACE needs a tenant Developer API key, and none is configured. ' +
          'Create one in VOID·SPACE under Developer → API keys (VS-SRS-2.0 FR-12.3), then set ' +
          'STUDIO_VOIDSPACE_API_KEY. Browsing the catalogue works without one.',
        { missing: 'STUDIO_VOIDSPACE_API_KEY' },
      );
    },
  };
}

/**
 * Wraps a bridge call so an upstream failure is reported as such.
 *
 * Without this, a `fetch` rejection inside the client surfaces as a 500 with the
 * message "fetch failed" — which tells a Creator nothing, and tells an operator less:
 * it does not say *which* system is unwell. The Studio being up while VOID·SPACE is
 * down is a normal, diagnosable state and should read like one.
 */
export async function viaUpstream<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UpstreamError(`VOID·SPACE could not complete "${what}": ${message}`, {
      operation: what,
    });
  }
}
