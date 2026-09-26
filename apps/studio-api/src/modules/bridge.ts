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
    const [all, newest] = await Promise.all([
      viaUpstream('read catalogue statistics', () =>
        bridge.gateway.browsePublicCatalog({ limit: 1 }),
      ),
      viaUpstream('read the newest catalogue entries', () =>
        bridge.gateway.browsePublicCatalog({ limit: 4, sort: 'newest' }),
      ),
    ]);

    const featured = newest.items[0];

    return {
      mode: bridge.mode,
      /** Where the Studio is talking to. Shown so a mis-set URL is visible, not inferred. */
      apiBaseUrl: bridge.apiBaseUrl ?? '(in-process mock)',
      links: bridge.links,
      reachable: true,
      publish: {
        enabled: bridge.publishEnabled,
        /** The exact remedy, so the UI can tell a Creator what to ask an admin for. */
        requirement: bridge.publishEnabled
          ? null
          : 'A tenant Developer API key (VS-SRS-2.0 FR-12.3) is needed to publish. Browsing works without one.',
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
}
