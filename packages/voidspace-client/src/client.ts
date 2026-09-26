/**
 * The typed client for VOID·SPACE's `/api/v1` (VS2-SRS-1.0 §3.5.2, §3.6, §3.7).
 *
 * VOID·STUDIO is a **REST client of VOID·SPACE, never a peer of its database** (§2.1, §5.3).
 * Every crossing between the two products goes through this file, which is what makes the
 * boundary auditable: if an integration question cannot be answered by a method below, then
 * VOID·STUDIO is not supposed to be doing it.
 *
 * All three crossings the SRS specifies (§3.5, §6.3) are implemented here:
 *
 *   1. **Identity** — a Developer-role API key exchanges for a short-lived bearer token
 *      (VS-SRS-2.0 FR-2.5). See `ensureToken`.
 *   2. **Asset ingestion** — publish uploads the exported GLB with Creator metadata (FR-14.2),
 *      and re-publish replaces it as a new *version* of the same asset rather than creating a
 *      disconnected second asset (FR-14.4).
 *   3. **Catalog** — an anonymous read of the published catalogue for remixing (FR-15.2).
 *
 * Two properties are deliberate and load-bearing:
 *
 *   - **It never authenticates as a person.** Machine-to-machine only, so the Studio API can
 *     publish for a tenant whether or not a Creator happens to be online.
 *   - **It sends no cookies.** `credentials: 'omit'` is set on every request, so a stray ambient
 *     session can never silently widen what this client is allowed to do.
 */
import {
  assetListQuerySchema,
  type AssetDetail,
  type AssetListQuery,
  type AssetSummary,
  type CreateAssetMetadataInput,
  type Paginated,
  type PublicCatalogPage,
  type PublicCatalogSort,
} from '@void-space/types';

import { VoidSpaceError } from './errors';
import type { VoidSpaceGateway } from './gateway';
import { buildMultipartBody, type MultipartBody } from './multipart';

/** A file to upload. Structural, so both a browser `File` and a Node `Buffer` fit. */
export interface UploadFile {
  readonly filename: string;
  readonly contentType?: string | undefined;
  readonly data: Uint8Array | ArrayBuffer | Blob;
}

export interface VoidSpaceClientOptions {
  /** Origin of the VOID·SPACE deployment, e.g. `https://void.space`. Trailing slashes are trimmed. */
  readonly baseUrl: string;
  /** A Developer-role API key (VS-SRS-2.0 FR-12.3). Exchanged for a bearer token on first use. */
  readonly apiKey: string;
  /** Injectable for tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Per-request ceiling. Defaults to 30 s — uploading a 200 MB GLB needs the headroom. */
  readonly timeoutMs?: number;
  /**
   * How long before the token's stated expiry to renew. Defaults to 60 s.
   *
   * A token valid when it leaves here but expired when it arrives is indistinguishable from a
   * bad credential, and the retry it triggers is the most confusing failure this client can
   * produce. Renewing early removes that race for the cost of one extra exchange a session.
   */
  readonly tokenRenewalMarginMs?: number;
}

interface TokenState {
  readonly token: string;
  /** Epoch milliseconds, converted once from the API's seconds-based `expiresIn`. */
  readonly expiresAtMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RENEWAL_MARGIN_MS = 60_000;

/**
 * `RequestInit` plus the one property the Fetch standard defines and `@types/node`'s copy omits.
 *
 * This package must not add `"DOM"` to `lib`: it runs inside a Node API and worker, and pulling the
 * DOM in would redeclare globals (`fetch`, `Response`, `AbortController`) that `@types/node` already
 * owns, producing errors that have nothing to do with this code. `cache` matters because it is
 * meaningful when the editor calls this client from a browser.
 */
interface FetchInit extends RequestInit {
  readonly cache?: 'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached';
}

/**
 * The body type `fetch` accepts, derived from its own signature rather than the DOM lib.
 * `BodyInit` is not a global under `lib: ["ES2022"]`.
 */
type FetchBodyInit = NonNullable<NonNullable<Parameters<typeof fetch>[1]>['body']>;


export class VoidSpaceClient implements VoidSpaceGateway {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly tokenRenewalMarginMs: number;

  private token: TokenState | null = null;
  /**
   * The in-flight exchange, shared by every concurrent caller.
   *
   * A project that publishes while polling would otherwise mint several tokens from one key and
   * race to store them. Single-flight means the key is exchanged once and every caller awaits the
   * same promise — the reasoning is the same as the refresh single-flight in
   * `apps/web/src/lib/api.ts`, and it matters more here because an API key has no rotation safety
   * net: a spent key stays spent.
   */
  private tokenInFlight: Promise<TokenState> | null = null;

  constructor(options: VoidSpaceClientOptions) {
    if (!options.baseUrl) throw new Error('VoidSpaceClient requires a baseUrl');
    if (!options.apiKey) throw new Error('VoidSpaceClient requires an apiKey');

    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.tokenRenewalMarginMs = options.tokenRenewalMarginMs ?? DEFAULT_RENEWAL_MARGIN_MS;
  }

  // --------------------------------------------------------------------- transport

  /**
   * One request, with the timeout, the no-cookie policy and the error envelope handled once.
   *
   * `retryOnCredential` exists because a token can expire between our clock check and the
   * server's view of it. It is attempted at most once; a second failure is a real credential
   * problem and is surfaced rather than looped on.
   */
  private async request<T>(
    path: string,
    init: FetchInit = {},
    options: { readonly token?: string | null; readonly retryOnCredential?: boolean } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const token = options.token === null ? null : options.token ?? (await this.ensureToken());

    // Built as a typed local rather than passed inline: an inline literal would face the excess
    // property check against `fetch`'s `RequestInit`, which does not know about `cache`.
    const requestInit: FetchInit = {
      ...init,
      signal: controller.signal,
      // Never ambient credentials: this client acts as the tenant, not as whoever happens to be
      // logged in to the browser running it.
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      },
    };

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, requestInit);

      if (response.status === 204) return undefined as T;

      const text = await response.text();
      const payload: unknown = text.length > 0 ? JSON.parse(text) : undefined;

      if (!response.ok) {
        const error = this.toError(response.status, payload, path);
        if (options.retryOnCredential !== false && error.isCredentialFailure && token) {
          this.token = null;
          return await this.request<T>(path, init, { retryOnCredential: false });
        }
        throw error;
      }

      return payload as T;
    } catch (cause) {
      if (cause instanceof VoidSpaceError) throw cause;
      // An abort, a DNS failure or a refused connection all land here. Status 0 plus a synthesized
      // code keeps callers from having to tell "the API said no" apart from "we never reached it"
      // by inspecting exception types.
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      throw new VoidSpaceError(
        aborted
          ? `VOID·SPACE did not respond within ${this.timeoutMs}ms for ${path}`
          : `Could not reach VOID·SPACE at ${this.baseUrl}${path}: ${(cause as Error).message}`,
        { status: 0, code: aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR' },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Maps the API's shared error envelope (SDD §1.1) onto `VoidSpaceError`. */
  private toError(status: number, payload: unknown, path: string): VoidSpaceError {
    const body = (payload ?? {}) as {
      code?: string;
      message?: string;
      details?: unknown;
      requestId?: string;
    };
    return new VoidSpaceError(body.message ?? `${status} response for ${path}`, {
      status,
      code: body.code ?? 'UNKNOWN',
      details: body.details,
      requestId: body.requestId,
    });
  }

  // ---------------------------------------------------------------------- identity

  /**
   * Exchanges the API key for a bearer token and caches it (VS-SRS-2.0 FR-2.5).
   *
   * `expiresIn` is **seconds** in the API's `/auth/token` response, so it is converted once here
   * rather than at every comparison — mixing the two units is the kind of bug that only surfaces
   * an hour into a session.
   */
  private async ensureToken(): Promise<string> {
    if (
      this.token &&
      this.token.expiresAtMs - this.tokenRenewalMarginMs > Date.now()
    ) {
      return this.token.token;
    }
    if (this.tokenInFlight) return (await this.tokenInFlight).token;

    this.tokenInFlight = (async (): Promise<TokenState> => {
      try {
        const payload = await this.request<{ accessToken: string; expiresIn: number }>(
          '/api/v1/auth/token',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiKey: this.apiKey }),
          },
          // The exchange is the one request that cannot present a token, and a 401 from it means
          // the key itself is bad — retrying would repeat the same answer.
          { token: null, retryOnCredential: false },
        );

        const state: TokenState = {
          token: payload.accessToken,
          expiresAtMs: Date.now() + payload.expiresIn * 1000,
        };
        this.token = state;
        return state;
      } finally {
        this.tokenInFlight = null;
      }
    })();

    return (await this.tokenInFlight).token;
  }

  /**
   * Proves the credential works without touching project data.
   *
   * The publish path calls this before starting an export, so a tenant whose key was revoked
   * learns it before a Creator has waited on a long conversion job rather than after.
   */
  async verifyCredentials(): Promise<void> {
    await this.ensureToken();
  }

  // ------------------------------------------------------------------------ assets

  /**
   * Uploads an exported asset and returns its VOID·SPACE detail (FR-14.2).
   *
   * Field order matters: `buildMultipartBody` writes the metadata before the file so the API can
   * reject a bad upload before streaming it to disk (SDD §2.4).
   */
  async uploadAsset(input: {
    readonly metadata: CreateAssetMetadataInput;
    readonly file: UploadFile;
  }): Promise<AssetDetail> {
    const body = await buildMultipartBody(fieldsFromMetadata(input.metadata), {
      filename: input.file.filename,
      contentType: input.file.contentType,
      data: input.file.data,
    });

    const result = await this.request<{ asset: AssetDetail }>('/api/v1/assets', {
      method: 'POST',
      body: toBodyInit(body),
      headers: { 'content-type': body.contentType },
    });
    return result.asset;
  }

  /**
   * Adds a new *version* to an asset that already exists (FR-14.4).
   *
   * This is the difference between re-publishing an edited project as a revision of the same
   * asset and spamming the marketplace with near-duplicates — so the publish path prefers this
   * whenever a PublishRecord exists, and calls `uploadAsset` only for a first publish.
   */
  async replaceAssetVersion(
    assetId: string,
    input: { readonly metadata?: Partial<CreateAssetMetadataInput>; readonly file: UploadFile },
  ): Promise<AssetDetail> {
    const body = await buildMultipartBody(fieldsFromMetadata(input.metadata ?? {}), {
      filename: input.file.filename,
      contentType: input.file.contentType,
      data: input.file.data,
    });

    const result = await this.request<{ asset: AssetDetail }>(
      `/api/v1/assets/${encodeURIComponent(assetId)}/versions`,
      { method: 'POST', body: toBodyInit(body), headers: { 'content-type': body.contentType } },
    );
    return result.asset;
  }

  /**
   * Reads one asset in full — versions, AI suggestion, review decisions, comments, jobs and audit
   * trail (VS-SRS-2.0 FR-3.4).
   *
   * This single call is what makes FR-14.3 and FR-14.5 cheap: the review decision, a requested
   * revision and the Assessor's comment all arrive together, so the Studio's status strip needs no
   * second request to explain itself.
   */
  async getAsset(assetId: string): Promise<AssetDetail> {
    const result = await this.request<{ asset: AssetDetail }>(
      `/api/v1/assets/${encodeURIComponent(assetId)}`,
      { method: 'GET' },
    );
    return result.asset;
  }

  /** Moves an asset into the review queue (VS-SRS-2.0 FR-3.3). */
  async submitAsset(assetId: string): Promise<AssetDetail> {
    const result = await this.request<{ asset: AssetDetail }>(
      `/api/v1/assets/${encodeURIComponent(assetId)}/submit`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    );
    return result.asset;
  }

  /**
   * The tenant's asset library (VS-SRS-2.0 FR-3.5).
   *
   * The query is validated with the *shared* `assetListQuerySchema` rather than a local duplicate,
   * so an option this client accepts but the API rejects cannot exist (NFR-MAINT.3).
   */
  async listAssets(query: Partial<AssetListQuery> = {}): Promise<Paginated<AssetSummary>> {
    const parsed = assetListQuerySchema.parse(query);
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined) continue;
      search.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    return await this.request<Paginated<AssetSummary>>(`/api/v1/assets?${search.toString()}`, {
      method: 'GET',
    });
  }

  /**
   * Browses the published marketplace catalogue for remixing (FR-15.2).
   *
   * Anonymous by design — it presents no credential, because the endpoint it calls is public
   * (VS-SRS-2.0 §6.1). Attaching a token here would achieve nothing except hang a tenant off a
   * request that deliberately has no tenant.
   */
  async browsePublicCatalog(
    params: {
      readonly search?: string;
      readonly category?: string;
      readonly tag?: string;
      readonly licenseType?: string;
      readonly sort?: PublicCatalogSort;
      readonly limit?: number;
      readonly offset?: number;
    } = {},
  ): Promise<PublicCatalogPage> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, String(value));
    }
    return await this.request<PublicCatalogPage>(
      `/api/v1/public/catalog?${search.toString()}`,
      { method: 'GET' },
      { token: null },
    );
  }

  /**
   * Polls an asset until its status stops changing, or the budget runs out (FR-14.3).
   *
   * Publishing is asynchronous on VOID·SPACE's side — the licence is minted by a worker, not in the
   * request (SDD §2.6) — so the Studio must wait rather than assume. This returns the last observed
   * state instead of throwing on timeout: "still pending after N minutes" is useful information for
   * the status strip, whereas an exception would be discarded by a UI that has nothing better to show.
   */
  async waitForAssetStatus(
    assetId: string,
    options: {
      readonly until?: (asset: AssetDetail) => boolean;
      readonly timeoutMs?: number;
      readonly intervalMs?: number;
      readonly onPoll?: (asset: AssetDetail) => void;
    } = {},
  ): Promise<AssetDetail> {
    const timeoutMs = options.timeoutMs ?? 5 * 60_000;
    const intervalMs = options.intervalMs ?? 3_000;
    const deadline = Date.now() + timeoutMs;
    const settled = options.until ?? ((asset: AssetDetail) => isTerminalStatus(asset.status));

    let latest = await this.getAsset(assetId);
    while (!settled(latest) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      latest = await this.getAsset(assetId);
      options.onPoll?.(latest);
    }
    return latest;
  }
}


/**
 * Lifecycle states from which no further VOID·SPACE-side change arrives on its own
 * (VS-SRS-2.0 §5.1).
 *
 * `pending` and `in_review` are deliberately absent — those are the states worth polling, and
 * listing them here would make the poll return on its first read.
 */
const TERMINAL_ASSET_STATUSES: readonly string[] = [
  'published',
  'rejected',
  'revision',
  'needs_manual_review',
];

function isTerminalStatus(status: string): boolean {
  return TERMINAL_ASSET_STATUSES.includes(status);
}

/**
 * Flattens upload metadata into multipart text fields.
 *
 * Every multipart field is a string, so the API parses these back in `metadataFromFields`. Anything
 * non-scalar is therefore serialized explicitly rather than being stringified by accident — which
 * would send `[object Object]` for `metadata` and look like an accepted upload with empty fields.
 * Arrays join with a comma because that is what the API's parser splits on.
 */
function fieldsFromMetadata(metadata: Partial<CreateAssetMetadataInput>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) fields[key] = value.join(',');
    else if (typeof value === 'object') fields[key] = JSON.stringify(value);
    else fields[key] = String(value);
  }
  return fields;
}

/**
 * Handing a `Uint8Array` to `fetch` widens it to the body type, which the DOM and Node type
 * definitions disagree about. One cast here keeps that disagreement out of every call site.
 */
function toBodyInit(body: MultipartBody): FetchBodyInit {
  return body.body as unknown as FetchBodyInit;
}

