'use client';

/**
 * Asset console (SRS FR-3.4, FR-3.3, FR-4.2, FR-7.5, FR-9.1, §6.3).
 *
 * The single screen where the whole lifecycle is visible and operable: the 3D preview served
 * from the cached IPFS gateway, the AI suggestion with explicit accept controls (never applied
 * silently, FR-7.5), the review decision form, publish, versions, the comment thread and the
 * asset's slice of the audit ledger.
 *
 * Actions are rendered from the capabilities the API computed for this caller, so a Creator
 * never sees an approve button that would 403.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AssetStatus } from '@void-space/types';

import { ApiRequestError, apiFetch } from '../../../../lib/api';
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  formatRelative,
  shortCid,
  shortId,
} from '../../../../lib/format';
import { ModelViewer } from '../../../../components/model-viewer';
import { BackLink, ErrorNote, Loading, Panel, StatusPill, Tag } from '../../../../components/ui-kit';

interface AssetDetailView {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly status: AssetStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly creator: { id: string; fullName: string; email: string } | null;
  readonly currentVersion: {
    readonly id: string;
    readonly versionNumber: number;
    readonly format: string;
    readonly sizeBytes: number;
    readonly polycount: number | null;
    readonly pinStatus: string;
    readonly ipfsCid: string | null;
    readonly gatewayUrl: string | null;
  } | null;
  readonly license: {
    readonly tokenId: string;
    readonly txHash: string;
    readonly blockNumber: string | null;
    readonly gasUsed: string | null;
    readonly status: string;
    readonly ipfsMetadataCid: string | null;
    readonly mintedAt: string;
  } | null;
  readonly xrModuleUrl: string | null;
  readonly xrManifestRef: string | null;
  readonly canDelete: boolean;
  readonly canPublish: boolean;
  readonly canRevoke: boolean;
  readonly versions: readonly {
    readonly id: string;
    readonly versionNumber: number;
    readonly format: string;
    readonly sizeBytes: number;
    readonly polycount: number | null;
    readonly pinStatus: string;
    readonly ipfsCid: string | null;
    readonly createdAt: string;
    readonly isCurrent: boolean;
  }[];
  readonly aiSuggestion: {
    readonly suggestedTags: readonly string[];
    readonly suggestedDescription: string;
    readonly qualityFlags: readonly string[];
    readonly confidence: number;
    readonly modelVersion: string;
    readonly promptVersion: string;
    readonly latencyMs: number | null;
    readonly acceptedTags: readonly string[];
    readonly acceptedDescription: string | null;
  } | null;
  readonly decisions: readonly {
    readonly id: string;
    readonly decision: string;
    readonly comment: string | null;
    readonly createdAt: string;
    readonly assessor: { id: string; fullName: string } | null;
  }[];
  readonly comments: readonly {
    readonly id: string;
    readonly body: string;
    readonly createdAt: string;
    readonly author: { id: string; fullName: string; roles: readonly string[] } | null;
    readonly replies: readonly {
      readonly id: string;
      readonly body: string;
      readonly createdAt: string;
      readonly author: { id: string; fullName: string; roles: readonly string[] } | null;
    }[];
  }[];
  readonly jobs: readonly {
    readonly id: string;
    readonly queue: string;
    readonly status: string;
    readonly attempts: number;
    readonly error: string | null;
    readonly createdAt: string;
  }[];
  readonly auditTrail: readonly {
    readonly id: string;
    readonly action: string;
    readonly actorId: string | null;
    readonly createdAt: string;
    readonly txHash: string | null;
  }[];
}

/** §3.6 — the permissions that gate each control on this screen. */
const PERMISSIONS = {
  decide: 'review:decide',
  publish: 'asset:publish',
  revoke: 'asset:revoke-license',
  submit: 'asset:upload-own',
  comment: 'catalog:view',
  delete: 'asset:delete-own-unpublished',
} as const;

export default function AssetConsolePage() {
  const params = useParams<{ id: string }>();
  const assetId = params.id;
  const queryClient = useQueryClient();

  const [comment, setComment] = useState('');
  const [decisionComment, setDecisionComment] = useState('');
  const [acceptTags, setAcceptTags] = useState(true);
  const [acceptDescription, setAcceptDescription] = useState(false);
  const [licenseType, setLicenseType] = useState('Commercial-Use');
  const [petition, setPetition] = useState<{ key: string; label: string } | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);

  const query = useQuery<AssetDetailView>({
    queryKey: ['asset', assetId],
    queryFn: () => apiFetch<{ asset: AssetDetailView }>(`/assets/${assetId}`).then((result) => result.asset),
    // In-flight work (pin, enrich, mint, publish) updates server-side while the operator watches.
    refetchInterval: (query) => {
      const data = query.state.data;
      const busy =
        data !== undefined &&
        (data.currentVersion?.pinStatus !== 'pinned' ||
          data.jobs.some(
            (job: { status: string }) =>
              job.status === 'queued' || job.status === 'active' || job.status === 'delayed',
          ));
      return busy ? 4_000 : false;
    },
  });

  const me = useQuery<{ user: { permissions: readonly string[] } }>({
    queryKey: ['session-minimal'],
    queryFn: () => apiFetch<{ user: { permissions: readonly string[] } }>('/auth/me'),
    staleTime: 30_000,
  });

  const permissions = me.data?.user.permissions ?? [];
  const may = (permission: string) => permissions.includes(permission);

  /**
   * Runs a mutation while locking the other actions.
   *
   * `key` identifies the pressed control so only that button shows the in-flight label; the
   * lock itself is global, since these mutations all change the same asset.
   */
  async function act(action: () => Promise<unknown>, key: string, label: string) {
    setError(null);
    setPetition({ key, label });
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['asset', assetId] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (caught) {
      const apiError = caught as ApiRequestError;
      setError({ message: apiError.message, code: apiError.code });
    } finally {
      setPetition(null);
    }
  }

  if (query.isLoading) return <Loading label="LOADING ASSET" />;
  if (query.error || !query.data) {
    return (
      <div className="space-y-3">
        <BackLink href="/library">LIBRARY</BackLink>
        <ErrorNote message={(query.error as Error)?.message ?? 'Asset not found'} />
      </div>
    );
  }

  const asset = query.data;
  const version = asset.currentVersion;
  const inReview = asset.status === 'pending' || asset.status === 'needs_manual_review';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <BackLink href="/library">LIBRARY</BackLink>
          <h1 className="vs-display mt-2 truncate text-4xl">{asset.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusPill status={asset.status} />
            <span className="vs-label">
              {asset.category} / {asset.creator?.fullName ?? 'UNKNOWN'} / UPDATED {formatRelative(asset.updatedAt)}
            </span>
          </div>
        </div>
        <div className="vs-label text-right">
          ASSET {shortId(asset.id, 12)}
          <div className="mt-1">{asset.currentVersion ? `V${asset.currentVersion.versionNumber} / ${asset.currentVersion.format}` : '—'}</div>
        </div>
      </div>

      {error ? <ErrorNote message={error.message} code={error.code} /> : null}

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Panel
            title="3D preview"
            right={version?.gatewayUrl ? <span className="vs-data">/IPFS/{shortCid(version.ipfsCid)}</span> : 'AWAITING PIN'}
            className="h-[420px]"
          >
            <div className="h-[380px]">
              <ModelViewer cid={version?.ipfsCid ?? null} format={version?.format ?? '.glb'} />
            </div>
          </Panel>

          <Panel title="Integrity" right="FR-8.1 / FR-9.6">
            <div className="vs-grid-lines grid-cols-2 md:grid-cols-4">
              <div className="p-3">
                <div className="vs-label">Polycount</div>
                <div className="vs-display vs-num mt-1 text-xl">{formatNumber(version?.polycount ?? null)}</div>
              </div>
              <div className="p-3">
                <div className="vs-label">Size</div>
                <div className="vs-display vs-num mt-1 text-xl">{formatBytes(version?.sizeBytes ?? 0)}</div>
              </div>
              <div className="p-3">
                <div className="vs-label">Pin state</div>
                <div className="vs-display mt-1 text-xl uppercase">{version?.pinStatus ?? '—'}</div>
              </div>
              <div className="p-3">
                <div className="vs-label">Versions</div>
                <div className="vs-display vs-num mt-1 text-xl">{asset.versions.length}</div>
              </div>
            </div>
            <div className="vs-rule" />
            <dl className="p-3">
              <div className="flex justify-between gap-4 py-1">
                <dt className="vs-label">CID</dt>
                <dd className="vs-data truncate" title={version?.ipfsCid ?? ''}>
                  {version?.ipfsCid ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-1">
                <dt className="vs-label">Gateway</dt>
                <dd className="vs-data truncate">
                  {version?.gatewayUrl ? (
                    <a className="vs-link" href={version.gatewayUrl} target="_blank" rel="noreferrer">
                      {version.gatewayUrl}
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4 py-1">
                <dt className="vs-label">Licence token</dt>
                <dd className="vs-data">
                  {asset.license ? `#${asset.license.tokenId} / ${asset.license.status.toUpperCase()}` : 'NOT LICENSED'}
                </dd>
              </div>
              {asset.license ? (
                <div className="flex justify-between gap-4 py-1">
                  <dt className="vs-label">Tx</dt>
                  <dd className="vs-data truncate" title={asset.license.txHash}>
                    {asset.license.txHash} / GAS {asset.license.gasUsed ?? '—'}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4 py-1">
                <dt className="vs-label">XR module</dt>
                <dd className="vs-data truncate">
                  {asset.xrModuleUrl ? (
                    <a className="vs-link" href={asset.xrModuleUrl} target="_blank" rel="noreferrer">
                      {asset.xrManifestRef ?? asset.xrModuleUrl}
                    </a>
                  ) : (
                    'NOT PUBLISHED'
                  )}
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Review history" right={`${asset.decisions.length} DECISIONS`}>
            {asset.decisions.length === 0 ? (
              <div className="vs-data p-3 opacity-60">NO DECISIONS RECORDED</div>
            ) : (
              <table className="vs-table">
                <thead>
                  <tr>
                    <th>Decision</th>
                    <th>Assessor</th>
                    <th>Comment</th>
                    <th className="text-right">When</th>
                  </tr>
                </thead>
                <tbody>
                  {asset.decisions.map((decision) => (
                    <tr key={decision.id}>
                      <td className="vs-data uppercase">{decision.decision}</td>
                      <td className="opacity-80">{decision.assessor?.fullName ?? '—'}</td>
                      <td className="opacity-80">{decision.comment ?? '—'}</td>
                      <td className="vs-data whitespace-nowrap text-right opacity-70">
                        {formatRelative(decision.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Discussion" right={`${asset.comments.length} THREADS`}>
            <div className="p-3">
              {asset.comments.length === 0 ? (
                <div className="vs-data opacity-60">NO COMMENTS</div>
              ) : (
                <ul className="space-y-3">
                  {asset.comments.map((thread) => (
                    <li key={thread.id}>
                      <div className="vs-data opacity-60">
                        {thread.author?.fullName ?? 'SYSTEM'} / {thread.author?.roles.join('+') ?? ''} /{' '}
                        {formatRelative(thread.createdAt)}
                      </div>
                      <div className="mt-1">{thread.body}</div>
                      {thread.replies.map((reply) => (
                        <div key={reply.id} className="mt-2 border-l pl-3" style={{ borderColor: 'var(--vs-accent)' }}>
                          <div className="vs-data opacity-60">
                            {reply.author?.fullName ?? 'SYSTEM'} / {formatRelative(reply.createdAt)}
                          </div>
                          <div className="mt-1">{reply.body}</div>
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              )}

              {may(PERMISSIONS.comment) ? (
                <div className="mt-4">
                  <textarea
                    className="vs-textarea"
                    rows={2}
                    placeholder="Add a comment on this asset"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                  <button
                    type="button"
                    className="vs-btn mt-2"
                    disabled={comment.trim().length === 0 || petition !== null}
                    onClick={() =>
                      void act(async () => {
                        await apiFetch(`/assets/${assetId}/comments`, {
                          method: 'POST',
                          body: { body: comment.trim() },
                        });
                        setComment('');
                      }, 'comment', 'POSTING COMMENT')
                    }
                  >
                    {petition?.key === 'comment' ? petition.label : 'POST COMMENT'}
                  </button>
                </div>
              ) : null}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="AI classification" right={asset.aiSuggestion ? `CONF ${(asset.aiSuggestion.confidence * 100).toFixed(0)}%` : 'PENDING'}>
            {asset.aiSuggestion ? (
              <div className="p-3">
                <div className="vs-data opacity-60">
                  {asset.aiSuggestion.modelVersion} / PROMPT {asset.aiSuggestion.promptVersion}
                  {asset.aiSuggestion.latencyMs !== null ? ` / ${asset.aiSuggestion.latencyMs} MS` : ''}
                </div>

                <div className="mt-3">
                  <div className="vs-label">Suggested tags</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {asset.aiSuggestion.suggestedTags.map((tag) => (
                      <Tag key={tag} tone={asset.aiSuggestion?.acceptedTags.includes(tag) ? 'accent' : 'default'}>
                        {tag}
                      </Tag>
                    ))}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="vs-label">Suggested description</div>
                  <p className="mt-1 text-[12px] leading-relaxed opacity-90">
                    {asset.aiSuggestion.suggestedDescription}
                  </p>
                  {asset.aiSuggestion.acceptedDescription ? (
                    <div className="vs-data vs-signal mt-1">ACCEPTED BY REVIEW</div>
                  ) : null}
                </div>

                {asset.aiSuggestion.qualityFlags.length > 0 ? (
                  <div className="mt-3">
                    <div className="vs-label">Quality flags</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {asset.aiSuggestion.qualityFlags.map((flag) => (
                        <Tag key={flag} tone="accent">
                          {flag}
                        </Tag>
                      ))}
                    </div>
                  </div>
                ) : null}

                {may(PERMISSIONS.decide) && inReview ? (
                  <div className="mt-4 space-y-2 border-t pt-3" style={{ borderColor: 'var(--vs-line-strong)' }}>
                    <div className="vs-label">Adoption on decision</div>
                    <label className="vs-data flex items-center gap-2">
                      <input type="checkbox" checked={acceptTags} onChange={(event) => setAcceptTags(event.target.checked)} />
                      MERGE AI TAGS INTO ASSET
                    </label>
                    <label className="vs-data flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={acceptDescription}
                        onChange={(event) => setAcceptDescription(event.target.checked)}
                      />
                      RECORD AI DESCRIPTION
                    </label>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="vs-cursor vs-data p-3 opacity-70">ENRICHMENT PENDING</div>
            )}
          </Panel>

          {may(PERMISSIONS.decide) && inReview ? (
            <Panel title="Review decision" right="FR-4.2">
              <div className="p-3">
                <textarea
                  className="vs-textarea"
                  rows={3}
                  placeholder="Comment (required when rejecting or requesting changes)"
                  value={decisionComment}
                  onChange={(event) => setDecisionComment(event.target.value)}
                />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    className="vs-btn vs-btn-primary justify-center"
                    disabled={petition !== null}
                    onClick={() =>
                      void act(
                        () =>
                          apiFetch(`/assets/${assetId}/decisions`, {
                            method: 'POST',
                            body: {
                              decision: 'approved',
                              comment: decisionComment.trim() || undefined,
                              acceptAiTags: acceptTags,
                              acceptAiDescription: acceptDescription,
                            },
                          }),
                        'approve',
                        'APPROVING',
                      )
                    }
                  >
                    APPROVE
                  </button>
                  <button
                    type="button"
                    className="vs-btn justify-center"
                    disabled={petition !== null || decisionComment.trim().length === 0}
                    onClick={() =>
                      void act(
                        () =>
                          apiFetch(`/assets/${assetId}/decisions`, {
                            method: 'POST',
                            body: { decision: 'revision', comment: decisionComment.trim() },
                          }),
                        'revision',
                        'REQUESTING CHANGES',
                      )
                    }
                  >
                    REVISION
                  </button>
                  <button
                    type="button"
                    className="vs-btn justify-center"
                    disabled={petition !== null || decisionComment.trim().length === 0}
                    onClick={() =>
                      void act(
                        () =>
                          apiFetch(`/assets/${assetId}/decisions`, {
                            method: 'POST',
                            body: { decision: 'rejected', comment: decisionComment.trim() },
                          }),
                        'reject',
                        'REJECTING',
                      )
                    }
                  >
                    REJECT
                  </button>
                </div>
              </div>
            </Panel>
          ) : null}

          {may(PERMISSIONS.publish) && asset.status === 'approved' ? (
            <Panel title="Publish" right="FR-9.1">
              <div className="p-3">
                <label className="block">
                  <span className="vs-label">Licence type</span>
                  <select className="vs-select mt-1" value={licenseType} onChange={(event) => setLicenseType(event.target.value)}>
                    {['CC0', 'CC-BY', 'CC-BY-SA', 'Commercial-Use', 'Internal-Only'].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="vs-label mt-3">
                  Mints an ERC-721 licence on Anvil, pins the licence document to IPFS, then
                  pushes the module to EoN Reality.
                </div>
                <button
                  type="button"
                  className="vs-btn vs-btn-primary mt-3 w-full justify-center"
                  disabled={petition !== null || version?.pinStatus !== 'pinned'}
                  onClick={() =>
                    void act(
                      () =>
                        apiFetch(`/assets/${assetId}/publish`, {
                          method: 'POST',
                          body: { licenseType, publishToXr: true },
                        }),
                      'publish',
                      'MINTING LICENCE',
                    )
                  }
                >
                  {petition?.key === 'publish'
                    ? petition.label
                    : version?.pinStatus === 'pinned'
                      ? 'PUBLISH + MINT'
                      : 'WAITING FOR IPFS PIN'}
                </button>
              </div>
            </Panel>
          ) : null}

          {may(PERMISSIONS.revoke) && asset.canRevoke ? (
            <Panel title="Takedown" right="FR-9.5">
              <div className="p-3">
                <div className="vs-label">Flags the licence revoked on chain. History is retained.</div>
                <button
                  type="button"
                  className="vs-btn mt-3 w-full justify-center"
                  disabled={petition !== null}
                  onClick={() =>
                    void act(
                      () =>
                        apiFetch(`/assets/${assetId}/license/revoke`, {
                          method: 'POST',
                          body: { reason: 'Revoked from the operations console' },
                        }),
                      'revoke',
                      'REVOKING',
                    )
                  }
                >
                  {petition?.key === 'revoke' ? petition.label : 'REVOKE LICENCE'}
                </button>
              </div>
            </Panel>
          ) : null}

          <Panel title="Pipeline jobs" right="§3.10">
            {asset.jobs.length === 0 ? (
              <div className="vs-data p-3 opacity-60">NO JOBS</div>
            ) : (
              <table className="vs-table">
                <thead>
                  <tr>
                    <th>Queue</th>
                    <th>State</th>
                    <th className="text-right">Attempt</th>
                  </tr>
                </thead>
                <tbody>
                  {asset.jobs.map((job) => (
                    <tr key={job.id}>
                      <td className="vs-data">{job.queue}</td>
                      <td
                        className="vs-data uppercase"
                        style={{
                          color:
                            job.status === 'completed'
                              ? 'var(--vs-published)'
                              : job.status === 'failed'
                                ? 'var(--vs-accent)'
                                : 'var(--vs-fg-dim)',
                        }}
                      >
                        {job.status}
                      </td>
                      <td className="vs-num text-right">{job.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Versions" right={asset.versions.length > 1 ? 'IMMUTABLE HISTORY' : 'INITIAL' }>
            <table className="vs-table">
              <thead>
                <tr>
                  <th>Ver</th>
                  <th>Format</th>
                  <th className="text-right">Poly</th>
                  <th className="text-right">Size</th>
                </tr>
              </thead>
              <tbody>
                {asset.versions.map((item) => (
                  <tr key={item.id}>
                    <td className="vs-data">
                      v{item.versionNumber} {item.isCurrent ? <span className="vs-accent">●</span> : null}
                    </td>
                    <td className="vs-data">{item.format}</td>
                    <td className="vs-num text-right">{formatNumber(item.polycount)}</td>
                    <td className="vs-num text-right">{formatBytes(item.sizeBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Ledger slice" right={`${asset.auditTrail.length} EVENTS`}>
            <div className="p-3">
              <ul className="space-y-2">
                {asset.auditTrail.slice(0, 12).map((entry) => (
                  <li key={entry.id} className="flex items-baseline justify-between gap-3">
                    <span className="vs-data">{entry.action}</span>
                    <span className="vs-label whitespace-nowrap">
                      {entry.txHash ? 'CHAIN / ' : ''}
                      {formatDateTime(entry.createdAt).slice(5)}
                    </span>
                  </li>
                ))}
              </ul>
              {may('audit:view') ? (
                <Link href="/audit" className="vs-link">
                  FULL LEDGER &gt;&gt;
                </Link>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
