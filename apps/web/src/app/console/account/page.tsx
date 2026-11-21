'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { signInWithEthereum } from '../../../lib/siwe';
import { useSession } from '../../../lib/session';
import { useToast } from '../../../components/toast';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { ErrorNote, EmptyState, LoadingBlock } from '../../../components/ui/feedback';

export default function AccountPage() {
  const { session } = useSession();
  const client = useQueryClient();
  const toast = useToast();
  const wallets = useQuery({
    queryKey: ['account-wallets'],
    queryFn: () =>
      apiFetch<{ wallets: { id: string; address: string; createdAt: string }[] }>('/auth/wallets'),
  });
  const providers = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => apiFetch<{ wallet: boolean }>('/auth/providers'),
  });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function link() {
    setBusy(true);
    setError(null);
    try {
      // Renew the session before the dual-purpose sign-in/link endpoint.
      await apiFetch('/auth/me');
      await signInWithEthereum();
      await client.invalidateQueries({ queryKey: ['account-wallets'] });
      toast.success(
        'Wallet linked',
        'It is available for wallet sign-in and optional credential issuance.',
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function unlink(id: string) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/auth/wallets/${id}`, { method: 'DELETE' });
      await client.invalidateQueries({ queryKey: ['account-wallets'] });
      setConfirm(null);
      toast.success('Wallet disconnected');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Your account</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Account and wallets</h1>
        <p className="mt-3 text-ink-dim">
          {session?.user.fullName} · {session?.user.email}
        </p>
        <p className="mt-1 text-sm text-ink-dim">
          {session?.tenant.name} · {session?.user.roles.join(', ')}
        </p>
      </header>
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold text-ink">Linked wallets</h2>
        <p className="max-w-2xl text-sm text-ink-dim">
          Link a browser wallet by signing an identity message. Linking does not send a transaction
          or request a payment. On-chain credentials also require the workspace’s credential service
          to be configured.
        </p>
        {error ? <ErrorNote message={error} /> : null}
        {providers.error ? <ErrorNote message={(providers.error as Error).message} /> : null}
        {providers.data?.wallet === false ? (
          <p className="text-sm text-ink-dim">
            Wallet linking is not enabled on this deployment. Your learning and verification records
            remain available.
          </p>
        ) : null}
        <Button disabled={busy || !providers.data?.wallet} onClick={() => void link()}>
          {busy ? 'Working…' : 'Link browser wallet'}
        </Button>
        {wallets.isLoading ? (
          <LoadingBlock label="Loading linked wallets" />
        ) : wallets.error ? (
          <ErrorNote message={(wallets.error as Error).message} />
        ) : wallets.data?.wallets.length === 0 ? (
          <EmptyState
            title="No linked wallets"
            hint="You can continue using lessons, practice and application credentials without a wallet."
          />
        ) : (
          <ul className="space-y-3">
            {wallets.data?.wallets.map((wallet) => (
              <li key={wallet.id} className="space-y-2 rounded-control border border-hairline p-3">
                <p className="break-all font-mono text-xs text-ink">{wallet.address}</p>
                <p className="text-xs text-ink-dim">
                  Linked {new Date(wallet.createdAt).toLocaleDateString()}
                </p>
                {confirm === wallet.id ? (
                  <div className="space-y-2">
                    <p className="text-sm text-ink-dim">
                      Disconnect this wallet? It will no longer sign in to this account. Existing
                      verification records are retained.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={busy} onClick={() => void unlink(wallet.id)}>
                        Confirm disconnect
                      </Button>
                      <Button disabled={busy} onClick={() => setConfirm(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    disabled={busy || !providers.data?.wallet}
                    onClick={() => setConfirm(wallet.id)}
                  >
                    Disconnect wallet
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
