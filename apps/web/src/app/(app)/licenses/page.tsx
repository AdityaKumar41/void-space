'use client';

/** Licence registry (SRS §6.5, FR-9.6, FR-9.7). Every mint, with its chain evidence. */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '../../../lib/api';
import { formatDateTime, shortCid } from '../../../lib/format';
import { EmptyState, ErrorNote, Loading, Panel } from '../../../components/ui-kit';

interface LicenceRow {
  readonly tokenId: string;
  readonly contractAddress: string;
  readonly txHash: string;
  readonly blockNumber: string | null;
  readonly gasUsed: string | null;
  readonly ipfsCid: string;
  readonly status: 'active' | 'revoked';
  readonly revokedReason: string | null;
  readonly mintedAt: string;
  readonly tokenUri: string | null;
  readonly asset: { id: string; name: string; status: string } | null;
  readonly explorer: { txUrl: string | null; addressUrl: string | null };
}

export default function LicencesPage() {
  const licences = useQuery<{ licenses: readonly LicenceRow[]; total: number }>({
    queryKey: ['licenses'],
    queryFn: () => apiFetch<{ licenses: readonly LicenceRow[]; total: number }>('/licenses'),
  });

  const active = licences.data?.licenses.filter((row) => row.status === 'active').length ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="vs-display text-4xl">Licence registry</h1>
        <div className="vs-label mt-1">
          {licences.data ? `${licences.data.total} TOKENS / ${active} ACTIVE` : 'QUERYING'} / ERC-721 / ANVIL 31337
        </div>
      </div>

      <Panel title="Mint ledger">
        {licences.isLoading ? <Loading /> : null}
        {licences.error ? <ErrorNote message={(licences.error as Error).message} /> : null}
        {licences.data && licences.data.licenses.length === 0 ? (
          <EmptyState title="No licences minted" hint="PUBLISH AN APPROVED ASSET" />
        ) : null}

        {licences.data && licences.data.licenses.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="vs-table">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Asset</th>
                  <th>State</th>
                  <th>Block</th>
                  <th>Gas</th>
                  <th>Metadata</th>
                  <th>Tx</th>
                  <th className="text-right">Minted</th>
                </tr>
              </thead>
              <tbody>
                {licences.data.licenses.map((row) => (
                  <tr key={row.tokenId}>
                    <td className="vs-display vs-num text-lg">#{row.tokenId}</td>
                    <td>
                      {row.asset ? (
                        <Link href={`/assets/${row.asset.id}`} className="vs-link">
                          {row.asset.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="vs-data uppercase" style={{ color: row.status === 'active' ? 'var(--vs-published)' : 'var(--vs-accent)' }}>
                      {row.status}
                      {row.revokedReason ? <div className="vs-label mt-1">{row.revokedReason}</div> : null}
                    </td>
                    <td className="vs-num">{row.blockNumber ?? '—'}</td>
                    <td className="vs-num">{row.gasUsed ?? '—'}</td>
                    <td className="vs-data opacity-80" title={row.ipfsCid}>
                      {row.tokenUri ? (
                        <a className="vs-link" href={row.tokenUri} target="_blank" rel="noreferrer">
                          {shortCid(row.ipfsCid)}
                        </a>
                      ) : (
                        shortCid(row.ipfsCid)
                      )}
                    </td>
                    <td className="vs-data opacity-70" title={row.txHash}>
                      {row.txHash.slice(0, 14)}…
                    </td>
                    <td className="vs-data whitespace-nowrap text-right opacity-70">{formatDateTime(row.mintedAt).slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
