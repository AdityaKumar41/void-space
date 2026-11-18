/**
 * Commercial marketplace settlement: orders, entitlements, royalty ledger.
 * Dev adapter settles immediately. Stripe adapter creates a Checkout Session when configured.
 */
import { randomUUID } from 'node:crypto';

import { getPublicCatalogListing, recordAudit, withTenant } from '@void-space/db';
import type { AuthPrincipal } from '@void-space/types';

import type { ApiEnv } from '../../env';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';

type PurchaseActor = Pick<AuthPrincipal, 'userId' | 'tenantId' | 'fullName' | 'email'>;

export interface CheckoutResult {
  readonly orderId: string;
  readonly status: 'paid' | 'pending';
  readonly provider: 'dev' | 'stripe';
  readonly checkoutUrl: string | null;
  readonly entitled: boolean;
}

export interface EntitlementView {
  readonly id: string;
  readonly assetId: string;
  readonly grantedAt: string;
  readonly orderId: string | null;
}

export function createCommerceService(env: ApiEnv) {
  const stripeConfigured = Boolean(
    env.STRIPE_SECRET_KEY?.startsWith('sk_') &&
    (env.NODE_ENV !== 'production' || env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')),
  );

  async function hasEntitlement(
    principal: Pick<AuthPrincipal, 'userId' | 'tenantId'>,
    assetId: string,
  ): Promise<boolean> {
    return withTenant(principal.tenantId, async (db) => {
      const row = await db.entitlement.findFirst({
        where: {
          tenantId: principal.tenantId,
          userId: principal.userId,
          assetId,
          revokedAt: null,
        },
        select: { id: true },
      });
      return Boolean(row);
    });
  }

  async function listEntitlements(principal: AuthPrincipal): Promise<EntitlementView[]> {
    return withTenant(principal.tenantId, async (db) => {
      const rows = await db.entitlement.findMany({
        where: { tenantId: principal.tenantId, userId: principal.userId, revokedAt: null },
        orderBy: { grantedAt: 'desc' },
      });
      return rows.map((row) => ({
        id: row.id,
        assetId: row.assetId,
        grantedAt: row.grantedAt.toISOString(),
        orderId: row.orderId,
      }));
    });
  }

  async function fulfillPaidOrder(
    principal: PurchaseActor,
    orderId: string,
    providerRef?: string,
  ): Promise<void> {
    await withTenant(principal.tenantId, async (db) => {
      // Serialize retries before reading status. Both the buyer entitlement and
      // seller ledger must commit with the payment transition.
      await db.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid AND tenant_id = ${principal.tenantId}::uuid AND buyer_user_id = ${principal.userId}::uuid FOR UPDATE`;
      const order = await db.order.findFirst({
        where: { id: orderId, tenantId: principal.tenantId, buyerUserId: principal.userId },
      });
      if (!order) throw new NotFoundError('Order');
      if (order.status === 'paid') return null;
      if (order.status !== 'pending')
        throw new ConflictError('Order cannot be settled in its current state');

      const platformCents = Math.floor((order.amountCents * env.PLATFORM_FEE_BPS) / 10_000);
      const sellerCents = order.amountCents - platformCents;

      await db.order.update({
        where: { id: orderId },
        data: {
          status: 'paid',
          paidAt: new Date(),
          providerRef: providerRef ?? order.providerRef,
        },
      });

      await db.entitlement.upsert({
        where: {
          tenantId_userId_assetId: {
            tenantId: order.tenantId,
            userId: order.buyerUserId,
            assetId: order.assetId,
          },
        },
        create: {
          tenantId: order.tenantId,
          userId: order.buyerUserId,
          assetId: order.assetId,
          orderId: order.id,
          sellerTenantId: order.sellerTenantId,
        },
        update: { revokedAt: null, orderId: order.id },
      });

      await recordAudit(
        {
          action: 'commerce.order_paid',
          entityType: 'order',
          entityId: order.id,
          actorId: principal.userId,
          actorLabel: `${principal.fullName} <${principal.email}>`,
          afterState: { assetId: order.assetId, amountCents: order.amountCents },
        },
        db,
      );

      // The seller scope comes only from the stored order, after buyer ownership
      // was verified. Restore the caller's RLS scope before leaving this transaction.
      await db.$executeRaw`SELECT set_config('app.current_tenant_id', ${order.sellerTenantId}, true)`;
      await db.royaltyLedger.create({
        data: {
          id: randomUUID(),
          tenantId: order.sellerTenantId,
          orderId: order.id,
          assetId: order.assetId,
          amountCents: order.amountCents,
          currency: order.currency,
          platformBps: env.PLATFORM_FEE_BPS,
          sellerCents,
          platformCents,
        },
      });
      await db.$executeRaw`SELECT set_config('app.current_tenant_id', ${principal.tenantId}, true)`;
    });
  }

  async function checkout(principal: AuthPrincipal, assetId: string): Promise<CheckoutResult> {
    if (principal.roles.includes('Viewer') && principal.roles.length === 1) {
      throw new ForbiddenError('Read-only accounts cannot purchase', 'READ_ONLY');
    }

    const listing = await getPublicCatalogListing(assetId);
    if (!listing) throw new NotFoundError('Catalog listing');

    if (listing.priceCents <= 0) {
      // Free listing — grant entitlement without an order settlement rail.
      return withTenant(principal.tenantId, async (db) => {
        const entitlement = await db.entitlement.upsert({
          where: {
            tenantId_userId_assetId: {
              tenantId: principal.tenantId,
              userId: principal.userId,
              assetId,
            },
          },
          create: {
            tenantId: principal.tenantId,
            userId: principal.userId,
            assetId,
            sellerTenantId: listing.tenantId,
          },
          update: { revokedAt: null },
        });
        return {
          orderId: entitlement.id,
          status: 'paid' as const,
          provider: 'dev' as const,
          checkoutUrl: null,
          entitled: true,
        };
      });
    }

    const already = await hasEntitlement(principal, assetId);
    if (already) {
      throw new ConflictError('You already hold an entitlement for this asset', 'ALREADY_ENTITLED');
    }

    if (stripeConfigured && env.STRIPE_SECRET_KEY) {
      const orderId = randomUUID();
      const successUrl = `${env.PUBLIC_WEB_ORIGIN}/m/${assetId}?checkout=success&orderId=${orderId}`;
      const cancelUrl = `${env.PUBLIC_WEB_ORIGIN}/m/${assetId}?checkout=cancelled`;

      const session = await createStripeCheckoutSession({
        secretKey: env.STRIPE_SECRET_KEY,
        amountCents: listing.priceCents,
        currency: listing.currency.toLowerCase(),
        assetName: listing.name,
        successUrl,
        cancelUrl,
        metadata: { orderId, assetId, buyerTenantId: principal.tenantId },
      });

      await withTenant(principal.tenantId, async (db) => {
        await db.order.create({
          data: {
            id: orderId,
            tenantId: principal.tenantId,
            buyerUserId: principal.userId,
            sellerTenantId: listing.tenantId,
            assetId,
            amountCents: listing.priceCents,
            currency: listing.currency,
            status: 'pending',
            provider: 'stripe',
            providerRef: session.id,
            checkoutUrl: session.url,
          },
        });
      });

      return {
        orderId,
        status: 'pending',
        provider: 'stripe',
        checkoutUrl: session.url,
        entitled: false,
      };
    }

    if (env.NODE_ENV === 'production') {
      throw new ConflictError(
        'Paid checkout is unavailable until a payment provider is configured',
        'PAYMENTS_UNAVAILABLE',
      );
    }
    // Dev adapter — settle immediately on local stacks only.
    const orderId = randomUUID();
    await withTenant(principal.tenantId, async (db) => {
      await db.order.create({
        data: {
          id: orderId,
          tenantId: principal.tenantId,
          buyerUserId: principal.userId,
          sellerTenantId: listing.tenantId,
          assetId,
          amountCents: listing.priceCents,
          currency: listing.currency,
          status: 'pending',
          provider: 'dev',
          providerRef: `dev_${orderId.slice(0, 8)}`,
        },
      });
    });
    await fulfillPaidOrder(principal, orderId, `dev_${orderId.slice(0, 8)}`);
    return {
      orderId,
      status: 'paid',
      provider: 'dev',
      checkoutUrl: null,
      entitled: true,
    };
  }

  async function confirmDevOrReturn(
    principal: AuthPrincipal,
    orderId: string,
  ): Promise<CheckoutResult> {
    const order = await withTenant(principal.tenantId, (db) =>
      db.order.findFirst({
        where: { id: orderId, tenantId: principal.tenantId, buyerUserId: principal.userId },
      }),
    );
    if (!order) throw new NotFoundError('Order');
    if (order.provider === 'stripe' && order.status !== 'paid') {
      if (!order.providerRef) throw new ValidationError('Order has no Stripe session');
      return markStripePaid(principal, orderId, order.providerRef);
    }
    if (order.status !== 'paid' && order.provider === 'dev') {
      if (env.NODE_ENV === 'production') {
        throw new ConflictError(
          'Demo orders cannot be settled in production',
          'PAYMENTS_UNAVAILABLE',
        );
      }
      await fulfillPaidOrder(principal, orderId);
    }
    const entitled = await hasEntitlement(principal, order.assetId);
    return {
      orderId: order.id,
      status: order.status === 'paid' || entitled ? 'paid' : 'pending',
      provider: order.provider,
      checkoutUrl: order.checkoutUrl,
      entitled,
    };
  }

  /**
   * Stripe webhook / return-path confirmation. Looks up the order by provider ref under the
   * buyer tenant encoded in metadata (called after Stripe redirects back).
   */
  async function markStripePaid(
    principal: PurchaseActor,
    orderId: string,
    sessionId: string,
  ): Promise<CheckoutResult> {
    const order = await withTenant(principal.tenantId, (db) =>
      db.order.findFirst({
        where: { id: orderId, tenantId: principal.tenantId, buyerUserId: principal.userId },
      }),
    );
    if (!order) throw new NotFoundError('Order');
    if (order.provider !== 'stripe') {
      throw new ValidationError('Order is not a Stripe checkout', 'WRONG_PROVIDER');
    }
    if (!order.providerRef || order.providerRef !== sessionId) {
      throw new ValidationError('Stripe session does not match this order');
    }
    if (!env.STRIPE_SECRET_KEY)
      throw new ConflictError('Payment provider is not configured', 'PAYMENTS_UNAVAILABLE');
    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new ValidationError('Could not verify payment with Stripe');
    const session = (await response.json()) as {
      id?: string;
      status?: string;
      payment_status?: string;
      amount_total?: number;
      currency?: string;
      metadata?: Record<string, string>;
    };
    if (
      session.id !== sessionId ||
      session.status !== 'complete' ||
      session.payment_status !== 'paid'
    ) {
      throw new ConflictError('Payment has not completed', 'PAYMENT_PENDING');
    }
    if (
      session.amount_total !== order.amountCents ||
      session.currency?.toUpperCase() !== order.currency.toUpperCase() ||
      session.metadata?.orderId !== order.id ||
      session.metadata?.assetId !== order.assetId ||
      session.metadata?.buyerTenantId !== order.tenantId
    ) {
      throw new ValidationError('Verified payment does not match this order');
    }
    await fulfillPaidOrder(principal, orderId, order.providerRef ?? sessionId);
    return {
      orderId,
      status: 'paid',
      provider: 'stripe',
      checkoutUrl: null,
      entitled: true,
    };
  }

  async function confirmStripeWebhook(
    tenantId: string,
    orderId: string,
    sessionId: string,
  ): Promise<CheckoutResult> {
    const order = await withTenant(tenantId, (db) =>
      db.order.findFirst({
        where: { id: orderId, tenantId, provider: 'stripe', providerRef: sessionId },
        include: { buyer: { select: { id: true, fullName: true, email: true } } },
      }),
    );
    if (!order) throw new NotFoundError('Order');
    return markStripePaid(
      {
        tenantId,
        userId: order.buyer.id,
        fullName: order.buyer.fullName,
        email: order.buyer.email,
      },
      orderId,
      sessionId,
    );
  }

  return {
    checkout,
    hasEntitlement,
    listEntitlements,
    confirmDevOrReturn,
    markStripePaid,
    confirmStripeWebhook,
    stripeConfigured,
  };
}

async function createStripeCheckoutSession(input: {
  secretKey: string;
  amountCents: number;
  currency: string;
  assetName: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}): Promise<{ id: string; url: string }> {
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', `${input.successUrl}&session_id={CHECKOUT_SESSION_ID}`);
  body.set('cancel_url', input.cancelUrl);
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', input.currency);
  body.set('line_items[0][price_data][unit_amount]', String(input.amountCents));
  body.set('line_items[0][price_data][product_data][name]', input.assetName);
  for (const [key, value] of Object.entries(input.metadata)) {
    body.set(`metadata[${key}]`, value);
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ValidationError(`Stripe checkout failed: ${text.slice(0, 200)}`, 'STRIPE_ERROR');
  }
  const json = (await response.json()) as { id: string; url: string };
  if (!json.id || !json.url) {
    throw new ValidationError('Stripe returned an incomplete checkout session', 'STRIPE_ERROR');
  }
  return { id: json.id, url: json.url };
}
