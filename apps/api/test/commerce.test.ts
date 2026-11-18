import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { withTenant } from '@void-space/db';
import type { AuthPrincipal } from '@void-space/types';
import { createCommerceService } from '../src/modules/commerce/service';
import { createTestApp, DEMO, DEMO_TENANT_IDS, type TestApp } from './helpers';
import { buildApp } from '../src/app';

let context: TestApp;
let buyer: AuthPrincipal;
const orders: string[] = [];
const sellerTenantId = DEMO_TENANT_IDS.northwind;
const stripeKey = 'sk_test_regression_only';
const webhookSecret = 'whsec_regression_only';
let webhookApp: FastifyInstance;

beforeAll(async () => {
  context = await createTestApp();
  webhookApp = await buildApp({
    ...context.env,
    STRIPE_SECRET_KEY: stripeKey,
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  });
  await webhookApp.ready();
  const user = await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
    db.user.findFirstOrThrow({ where: { email: DEMO.users.auroraCreator } }),
  );
  buyer = {
    userId: user.id,
    tenantId: DEMO_TENANT_IDS.aurora,
    email: user.email,
    fullName: user.fullName,
    tenantName: 'Aurora',
    tenantSlug: 'aurora-industrial',
    roles: ['Creator'],
    permissions: [],
    authMethod: 'jwt',
    isSuperAdmin: false,
    readOnly: false,
  };
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await withTenant(sellerTenantId, (db) =>
    db.royaltyLedger.deleteMany({ where: { orderId: { in: orders } } }),
  );
  await withTenant(buyer.tenantId, async (db) => {
    await db.entitlement.deleteMany({ where: { orderId: { in: orders } } });
    await db.order.deleteMany({ where: { id: { in: orders } } });
  });
  await context.close();
  await webhookApp.close();
});

async function pendingOrder(provider: 'dev' | 'stripe' = 'stripe') {
  const id = randomUUID();
  orders.push(id);
  return withTenant(buyer.tenantId, (db) =>
    db.order.create({
      data: {
        id,
        tenantId: buyer.tenantId,
        buyerUserId: buyer.userId,
        sellerTenantId,
        assetId: randomUUID(),
        amountCents: 2500,
        currency: 'USD',
        provider,
        providerRef: `cs_test_${id}`,
      },
    }),
  );
}

function stripeResponse(order: Awaited<ReturnType<typeof pendingOrder>>, overrides = {}) {
  return Response.json({
    id: order.providerRef,
    payment_status: 'paid',
    status: 'complete',
    amount_total: order.amountCents,
    currency: 'usd',
    metadata: {
      orderId: order.id,
      assetId: order.assetId,
      buyerTenantId: buyer.tenantId,
    },
    ...overrides,
  });
}

describe('checkout confirmation', () => {
  it('never grants an entitlement for an unpaid Stripe session', async () => {
    const order = await pendingOrder();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(stripeResponse(order, { payment_status: 'unpaid', status: 'open' })),
    );
    const commerce = createCommerceService({ ...context.env, STRIPE_SECRET_KEY: stripeKey });
    await expect(commerce.markStripePaid(buyer, order.id, order.providerRef!)).rejects.toThrow();
    expect(await commerce.hasEntitlement(buyer, order.assetId)).toBe(false);
  });
  it('checks the provider amount and currency before settlement', async () => {
    const order = await pendingOrder();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(stripeResponse(order, { amount_total: 1 })));
    const commerce = createCommerceService({ ...context.env, STRIPE_SECRET_KEY: stripeKey });
    await expect(commerce.markStripePaid(buyer, order.id, order.providerRef!)).rejects.toThrow();
  });
  it('does not let another user in the same workspace confirm an order', async () => {
    const order = await pendingOrder('dev');
    const commerce = createCommerceService(context.env);
    await expect(
      commerce.confirmDevOrReturn({ ...buyer, userId: randomUUID() }, order.id),
    ).rejects.toThrow('not found');
  });
  it('never settles a pending demo order in production', async () => {
    const order = await pendingOrder('dev');
    const commerce = createCommerceService({ ...context.env, NODE_ENV: 'production' });
    await expect(commerce.confirmDevOrReturn(buyer, order.id)).rejects.toMatchObject({
      code: 'PAYMENTS_UNAVAILABLE',
    });
    expect(await commerce.hasEntitlement(buyer, order.assetId)).toBe(false);
  });
  it('rolls back buyer settlement if the seller ledger cannot be written', async () => {
    const order = await pendingOrder();
    await withTenant(buyer.tenantId, (db) =>
      db.order.update({ where: { id: order.id }, data: { sellerTenantId: randomUUID() } }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => stripeResponse(order)),
    );
    const commerce = createCommerceService({ ...context.env, STRIPE_SECRET_KEY: stripeKey });
    await expect(commerce.markStripePaid(buyer, order.id, order.providerRef!)).rejects.toThrow();
    expect(await commerce.hasEntitlement(buyer, order.assetId)).toBe(false);
    const unchanged = await withTenant(buyer.tenantId, (db) =>
      db.order.findUniqueOrThrow({ where: { id: order.id } }),
    );
    expect(unchanged.status).toBe('pending');
  });
  it('settles concurrent provider confirmations exactly once', async () => {
    const order = await pendingOrder();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => stripeResponse(order)),
    );
    const commerce = createCommerceService({ ...context.env, STRIPE_SECRET_KEY: stripeKey });
    await Promise.all(
      [1, 2, 3].map(() => commerce.markStripePaid(buyer, order.id, order.providerRef!)),
    );
    expect(await commerce.hasEntitlement(buyer, order.assetId)).toBe(true);
    const royalties = await withTenant(sellerTenantId, (db) =>
      db.royaltyLedger.findMany({ where: { orderId: order.id } }),
    );
    expect(royalties).toHaveLength(1);
    expect(royalties[0]!.sellerCents + royalties[0]!.platformCents).toBe(2500);
  });
});

describe('signed payment notifications', () => {
  function signature(payload: string, timestamp = Math.floor(Date.now() / 1000)) {
    return `t=${timestamp},v1=${createHmac('sha256', webhookSecret).update(`${timestamp}.${payload}`).digest('hex')}`;
  }
  it('rejects missing, tampered and expired signatures without a provider request', async () => {
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const signed of [
      '',
      signature(payload + ' '),
      signature(payload, Math.floor(Date.now() / 1000) - 600),
    ]) {
      const response = await webhookApp.inject({
        method: 'POST',
        url: '/api/v1/commerce/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': signed },
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fulfills a verified paid session without any browser session and tolerates repeated delivery', async () => {
    const order = await pendingOrder();
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: order.providerRef,
          payment_status: 'paid',
          metadata: { orderId: order.id, buyerTenantId: buyer.tenantId },
        },
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => stripeResponse(order)),
    );
    const responses = await Promise.all(
      [1, 2].map(() =>
        webhookApp.inject({
          method: 'POST',
          url: '/api/v1/commerce/webhook',
          headers: { 'content-type': 'application/json', 'stripe-signature': signature(payload) },
          payload,
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(await createCommerceService(context.env).hasEntitlement(buyer, order.assetId)).toBe(
      true,
    );
    expect(
      await withTenant(sellerTenantId, (db) =>
        db.royaltyLedger.count({ where: { orderId: order.id } }),
      ),
    ).toBe(1);
  });
});
