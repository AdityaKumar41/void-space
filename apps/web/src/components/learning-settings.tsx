'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { UserRound, FolderLock, Building2, LogOut } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { signInWithEthereum } from '../lib/siwe';
import { useSession } from '../lib/session';
import { LearningLayout } from './learning-ui';
import { useLearningProfile } from '../lib/learning-profile';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ErrorNote, EmptyState, LoadingBlock } from '../components/ui/feedback';

export function LearningSettings() {
  const { session, signOut } = useSession();
  const profile = useLearningProfile();
  const institution = profile.data?.workspace.kind === 'organization';
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
    <LearningLayout
      title="Settings"
      description="Your account, workspace access and sign-in options."
    >
      <div className="learning-settings-content">
        <div className="learning-settings-profile">
          <span>
            <UserRound size={30} />
          </span>
          <div>
            <h2>{session?.user.fullName}</h2>
            <p>{session?.user.email}</p>
          </div>
          <button onClick={() => void signOut().catch((e) => setError(e.message))}>
            <LogOut size={16} />
            Sign out
          </button>
        </div>
        <div className="learning-settings-links">
          <Link href="/console/learn/library">
            <FolderLock size={25} />
            <div>
              <h2>Your private library</h2>
              <p>Models and sources you choose to use for learning.</p>
            </div>
          </Link>
          <Link href="/console/learn/institution">
            <Building2 size={25} />
            <div>
              <h2>{institution ? session?.tenant.name : 'Institution access'}</h2>
              <p>
                {institution
                  ? 'Your institution lessons, role and workspace membership.'
                  : 'Join with an invitation. Your personal work stays in its own workspace.'}
              </p>
            </div>
          </Link>
        </div>
        {error && <ErrorNote message={error} />}
        <details className="lesson-options">
          <summary>Advanced · wallet sign-in</summary>
          <Card className="space-y-4 p-5">
            <h2 className="font-semibold text-ink">Linked wallets</h2>
            <p className="max-w-2xl text-sm text-ink-dim">
              Link a browser wallet by signing an identity message. Linking does not send a
              transaction or request a payment. On-chain credentials also require the workspace’s
              credential service to be configured.
            </p>
            {error ? <ErrorNote message={error} /> : null}
            {providers.error ? <ErrorNote message={(providers.error as Error).message} /> : null}
            {providers.data?.wallet === false ? (
              <p className="text-sm text-ink-dim">
                Wallet linking is not enabled on this deployment. Your learning and verification
                records remain available.
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
                  <li
                    key={wallet.id}
                    className="space-y-2 rounded-control border border-hairline p-3"
                  >
                    <p className="break-all font-mono text-xs text-ink">{wallet.address}</p>
                    <p className="text-xs text-ink-dim">
                      Linked {new Date(wallet.createdAt).toLocaleDateString()}
                    </p>
                    {confirm === wallet.id ? (
                      <div className="space-y-2">
                        <p className="text-sm text-ink-dim">
                          Disconnect this wallet? It will no longer sign in to this account.
                          Existing verification records are retained.
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
        </details>
      </div>
    </LearningLayout>
  );
}
