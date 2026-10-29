/**
 * The VOID·SPACE bridge surface (VS2-SRS-1.0 §3.5.2, §6.1, FR-15.2).
 *
 * Three things live here, and they have different relationships to the credential:
 *
 *   /health              — this service plus VOID·SPACE reachability. No auth.
 *   /voidspace/status    — where VOID·SPACE is, whether it is up, and what it holds.
 *   /voidspace/catalog   — the published catalogue, proxied for remixing (FR-15.2).
 *
 * Note what `/voidspace/status` deliberately does *not* do: it does not talk to the
 * chain. Contract addresses, token ids and transaction hashes reach the Studio through
 * VOID·SPACE's own API, never by reading Anvil directly. That is §3.5.2's rule —
 * licensing and provenance stay exclusively in VOID·SPACE, and the Studio is strictly
 * upstream of them — and it is also why the Studio has no chain credential to protect.
 */
import { PUBLIC_CATALOG_SORTS } from '@void-space/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { VoidSpaceBridge } from '../lib/gateway';
import { viaUpstream } from '../lib/gateway';
import { parseQuery } from '../lib/http';
import { resolveSession } from '../lib/session';

const catalogQuerySchema = z.object({
  search: z.string().max(200).optional(),
  category: z.string().max(80).optional(),
  tag: z.string().max(80).optional(),
  licenseType: z.string().max(80).optional(),
  sort: z.enum(PUBLIC_CATALOG_SORTS).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

export interface BridgeRoutesOptions {
  readonly bridge: VoidSpaceBridge;
}

const BLOCKED_PROXY_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal']);

/**
 * The model proxy exists so the editor can read a mesh the browser cannot fetch
 * directly. It is not a general HTTP client: an open `?url=` would let the Studio
 * API reach whatever the caller names, including cloud metadata addresses.
 *
 * Allowed targets are the configured VOID·SPACE origins, plus loopback, which is
 * where a local IPFS gateway and the dev console live.
 */
export function modelProxyTargetAllowed(raw: string, allowedOrigins: readonly string[]): string | null {
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return null;
  }
  if (target.username || target.password) return null;
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;

  const host = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_PROXY_HOSTS.has(host)) return null;

  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (loopback) return target.toString();

  const originAllowed = allowedOrigins.some((allowed) => {
    try {
      return new URL(allowed).origin === target.origin;
    } catch {
      return false;
    }
  });
  return originAllowed ? target.toString() : null;
}

/** Reads the workspace category list without failing the rest of the status payload. */
async function workspaceCategories(bridge: VoidSpaceBridge): Promise<readonly string[]> {
  if (!bridge.publishEnabled) return [];
  try {
    return await bridge.gateway.workspaceCategories();
  } catch {
    return [];
  }
}

export async function bridgeRoutes(
  app: FastifyInstance,
  options: BridgeRoutesOptions,
): Promise<void> {
  const { bridge } = options;

  /**
   * Studio health, including whether VOID·SPACE is reachable.
   *
   * The upstream probe is included rather than kept separate because the only thing a
   * reader of "Studio is up" can usefully do next is wonder whether the half of the
   * product that matters is also up. Reporting both in one place makes the degraded
   * state a single fact instead of two lookups.
   */
  app.get('/health', async () => {
    let voidspace: { status: 'up' | 'down'; mode: 'mock' | 'live'; detail: string };
    try {
      const page = await bridge.gateway.browsePublicCatalog({ limit: 1 });
      voidspace = { status: 'up', mode: bridge.mode, detail: `${page.total} published assets` };
    } catch (error) {
      voidspace = {
        status: 'down',
        mode: bridge.mode,
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      status: voidspace.status === 'up' ? 'ok' : 'degraded',
      service: 'void-studio-api',
      version: '1.0.0',
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: {
        voidspace,
        // The Studio's own database is not probed here: every authenticated route would
        // have failed loudly by now if it were unreachable, and a redundant query on a
        // health endpoint is a connection taken from real traffic.
        publishCredential: bridge.publishEnabled ? 'configured' : 'absent',
      },
    };
  });

  /**
   * The two-platform link, as data. This is what the Studio UI renders to show a
   * Creator *where* their work goes and *what* is already there.
   */
  app.get('/voidspace/status', async () => {
    let all = { total: 0 };
    let newest: { readonly items: readonly any[] } = { items: [] };
    let reachable = true;

    try {
      const [allRes, newestRes] = await Promise.all([
        bridge.gateway.browsePublicCatalog({ limit: 1 }),
        bridge.gateway.browsePublicCatalog({ limit: 4, sort: 'newest' }),
      ]);
      all = allRes;
      newest = newestRes;
    } catch {
      reachable = false;
    }

    const featured = newest.items[0];

    // A key that is present but rejected must not read as "publishing enabled".
    // The panel would otherwise let a Creator export a scene and fail at the last step.
    let credentialOk = bridge.publishEnabled;
    let credentialProblem: string | null = null;
    if (bridge.mode === 'live' && bridge.publishEnabled) {
      try {
        await bridge.gateway.verifyCredentials();
      } catch (error) {
        credentialOk = false;
        credentialProblem =
          error instanceof Error
            ? error.message
            : 'VOID·SPACE rejected the publish credential.';
      }
    }

    return {
      mode: bridge.mode,
      /** Where the Studio is talking to. Shown so a mis-set URL is visible, not inferred. */
      apiBaseUrl: bridge.apiBaseUrl ?? '(in-process mock)',
      links: bridge.links,
      reachable,
      publish: {
        enabled: credentialOk,
        /** The exact remedy, so the UI can tell a Creator what to ask an admin for. */
        requirement: credentialOk
          ? null
          : credentialProblem ??
            'A tenant Developer API key (VS-SRS-2.0 FR-12.3) is needed to publish. Browsing works without one.',
        /**
         * FR-14.3, and the reason it is here rather than in the editor: publishing is asynchronous
         * on VOID·SPACE's side, so a status is only ever as fresh as the last read. One value
         * governs every client, and slowing the poll down does not need a new bundle.
         */
        pollIntervalMs: bridge.pollIntervalMs,
      },
      catalog: {
        publishedAssets: all.total,
        categories: [...new Set(newest.items.map((item) => item.category))].filter(Boolean),
        /**
         * What a publish form may offer. Empty when the credential cannot read the
         * workspace; the editor then falls back to the platform defaults.
         */
        allowedCategories: credentialOk ? await workspaceCategories(bridge) : [],
      },
      /**
       * Provenance of the newest asset, taken from VOID·SPACE rather than the chain — it
       * shows the licence/token/transaction trail exists without the Studio holding a
       * chain credential (§3.5.2).
       */
      provenance: featured
        ? {
            assetId: featured.assetId,
            name: featured.name,
            contractAddress: featured.contractAddress,
            tokenId: featured.tokenId,
            txHash: featured.txHash,
            ipfsCid: featured.ipfsCid,
            licenseType: featured.licenseType,
            url: bridge.links.assetUrl(featured.assetId),
          }
        : null,
    };
  });

  app.get('/voidspace/catalog', async (request: FastifyRequest) => {
    const query = parseQuery(catalogQuerySchema, request.query);
    const page = await viaUpstream('browse the public catalogue', () =>
      bridge.gateway.browsePublicCatalog(query),
    );

    return {
      ...page,
      /**
       * Each item gains a `url` into the VOID·SPACE console, so the Studio can turn a
       * catalogue row into a link a Creator can follow. FR-15.3 requires an imported
       * marketplace asset to carry its licence terms forward, which needs a destination
       * to attribute it to.
       */
      items: page.items.map((item) => ({ ...item, url: bridge.links.assetUrl(item.assetId) })),
      consoleUrl: bridge.links.consoleUrl,
    };
  });

  /**
   * The tenant developer key stays on this server.
   *
   * An earlier build exchanged that key and returned the bearer to the browser so the
   * editor could publish without a Creator session. That made every person who could
   * open the editor able to publish as the tenant. Creators launch from VOID·SPACE,
   * which attaches their own token. This route remains so an old panel fails closed
   * instead of looking like a missing feature.
   */
  app.get('/auth/token', async (_request, reply) => {
    return reply.status(404).send({
      error:
        'Open VOID·STUDIO from the VOID·SPACE console. The tenant publish credential is not handed to the browser.',
    });
  });

  /**
   * Session verification probe for the Studio editor.
   * If an Authorization header is present with a valid VOID·SPACE token,
   * returns authenticated user and tenant info. Otherwise returns { authenticated: false }.
   */
  app.get('/auth/session', async (request: FastifyRequest) => {
    try {
      const session = await resolveSession(app, request);
      return {
        authenticated: true,
        user: {
          id: session.userId,
          displayName: session.displayName,
          roles: session.roles,
          permissions: session.permissions,
        },
        tenant: {
          id: session.tenantId,
        },
      };
    } catch {
      return { authenticated: false };
    }
  });

  /**
   * Proxies 3D model assets for the Studio editor.
   * Eliminates any cross-origin browser blocking or disk-cache poisoning
   * when fetching meshes from VOID·SPACE or IPFS.
   */
  app.get('/voidspace/model-proxy', async (request: FastifyRequest, reply) => {
    const { url } = request.query as { url?: string };
    if (!url) {
      return reply.status(400).send({ error: 'Missing url query parameter' });
    }

    const allowedOrigins = [
      bridge.links.consoleUrl,
      ...(bridge.apiBaseUrl?.startsWith('http') ? [bridge.apiBaseUrl] : []),
    ];
    const target = modelProxyTargetAllowed(url, allowedOrigins);
    if (!target) {
      return reply.status(400).send({ error: 'That model URL is not on VOID·SPACE.' });
    }

    try {
      const upstream = await fetch(target, {
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });

      if (upstream.status >= 300 && upstream.status < 400) {
        return reply.status(502).send({ error: 'The model host redirected, which this proxy does not follow.' });
      }

      if (!upstream.ok) {
        return reply.status(upstream.status).send({ error: `Upstream returned HTTP ${upstream.status}` });
      }

      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const arrayBuffer = await upstream.arrayBuffer();

      reply.header('content-type', contentType);
      reply.header('access-control-allow-origin', '*');
      reply.header('cross-origin-resource-policy', 'cross-origin');
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      return reply.send(Buffer.from(arrayBuffer));
    } catch (err: any) {
      return reply.status(502).send({ error: `Proxy fetch failed: ${err.message}` });
    }
  });
}
