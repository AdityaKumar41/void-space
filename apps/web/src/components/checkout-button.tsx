'use client';

/**
 * Marketplace checkout / entitlement gate for a catalog listing.
 * Free assets grant entitlement immediately; priced assets use Dev or Stripe checkout.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiRequestError, apiFetch } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from './toast';

interface CheckoutResult {
  readonly orderId: string;
  readonly status: 'paid' | 'pending';
  readonly provider: 'dev' | 'stripe';
  readonly checkoutUrl: string | null;
  readonly entitled: boolean;
}

export function CheckoutButton({
  assetId,
  priceCents,
  currency,
  downloadHref,
}: {
  assetId: string;
  priceCents: number;
  currency: string;
  downloadHref: string;
}) {
  const { session } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const paymentStatus = useQuery({
    queryKey: ['commerce-status'],
    enabled: Boolean(session) && priceCents > 0,
    queryFn: () => apiFetch<{ provider: 'dev' | 'stripe' | 'disabled' }>('/commerce/status'),
  });

  const entitlement = useQuery({
    queryKey: ['commerce-entitlement', assetId],
    enabled: Boolean(session),
    queryFn: () =>
      apiFetch<{ assetId: string; entitled: boolean }>(`/commerce/entitlements/${assetId}`),
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') !== 'success') return;
    const orderId = params.get('orderId');
    const sessionId = params.get('session_id');
    if (!orderId || !session) return;
    void (async () => {
      try {
        await apiFetch(`/commerce/orders/${orderId}/confirm`, {
          method: 'POST',
          body: sessionId ? { sessionId } : {},
        });
        await queryClient.invalidateQueries({ queryKey: ['commerce-entitlement', assetId] });
        toast.success('Purchase complete', 'Your download entitlement is ready.');
      } catch (caught) {
        const err = caught as ApiRequestError;
        toast.failure('Checkout confirmation failed', err.message);
      }
    })();
  }, [assetId, queryClient, session, toast]);

  const entitled = priceCents <= 0 || entitlement.data?.entitled === true;
  const priceLabel =
    priceCents <= 0
      ? 'Free'
      : new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: currency || 'USD',
        }).format(priceCents / 100);

  async function startCheckout() {
    if (!session) {
      toast.failure('Sign in required', 'Sign in to purchase or claim this model.');
      return;
    }
    setBusy(true);
    try {
      const result = await apiFetch<CheckoutResult>('/commerce/checkout', {
        method: 'POST',
        body: { assetId },
      });
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['commerce-entitlement', assetId] });
      toast.success(
        result.provider === 'dev' ? 'Entitlement granted' : 'Purchase complete',
        priceCents <= 0
          ? 'You can download this model.'
          : result.provider === 'dev'
            ? 'Demo access granted. No payment was collected.'
            : 'Payment settled. Download is unlocked.',
      );
    } catch (caught) {
      const err = caught as ApiRequestError;
      toast.failure('Checkout failed', err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <div className="mt-5 space-y-2">
        <div className="font-mono text-[12px] text-ink-faint">{priceLabel}</div>
        <Link
          href={`/login?next=${encodeURIComponent(`/m/${assetId}`)}`}
          className="inline-flex h-10 w-full items-center justify-center rounded-control border border-brand bg-brand px-4 text-[14px] font-semibold text-white"
        >
          Sign in to {priceCents > 0 ? 'purchase' : 'download'}
        </Link>
      </div>
    );
  }

  if (entitled) {
    return (
      <div className="mt-5 space-y-2">
        <div className="font-mono text-[12px] text-ink-faint">
          {priceCents > 0 ? 'Purchased · ' : ''}
          {priceLabel}
        </div>
        <a
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-control border border-brand bg-brand px-4 text-[14px] font-semibold text-white shadow-heat hover:border-brand-warm hover:bg-brand-warm"
          href={downloadHref}
          download
        >
          Download the model
        </a>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-2">
      <div className="font-mono text-[12px] text-ink-faint">{priceLabel}</div>
      {paymentStatus.data?.provider === 'dev' ? (
        <p className="text-xs text-ink-dim">Demo checkout · no payment will be collected.</p>
      ) : null}
      {paymentStatus.data?.provider === 'disabled' || paymentStatus.isError ? (
        <p className="text-xs text-ink-dim">Paid checkout is unavailable on this deployment.</p>
      ) : null}
      <button
        type="button"
        disabled={
          busy ||
          paymentStatus.isLoading ||
          paymentStatus.isError ||
          paymentStatus.data?.provider === 'disabled'
        }
        onClick={() => void startCheckout()}
        className="inline-flex h-10 w-full items-center justify-center rounded-control border border-brand bg-brand px-4 text-[14px] font-semibold text-white shadow-heat hover:border-brand-warm hover:bg-brand-warm disabled:opacity-60"
      >
        {busy ? 'Starting checkout…' : `Buy for ${priceLabel}`}
      </button>
    </div>
  );
}
