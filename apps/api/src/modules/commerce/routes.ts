/**
 * Commerce routes — checkout, entitlements, Stripe return confirmation.
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

import type { ApiEnv } from '../../env';
import { UnauthenticatedError } from '../../lib/errors';
import { parseBody, parseParams } from '../../lib/http';
import { createCommerceService } from './service';
import { commerceWebhookRoutes } from './webhook';

const checkoutBody = z.object({ assetId: z.string().uuid() });
const orderParams = z.object({ orderId: z.string().uuid() });
const confirmBody = z.object({
  sessionId: z.string().min(1).max(200).optional(),
});

export async function commerceRoutes(
  app: FastifyInstance,
  options: { env: ApiEnv },
): Promise<void> {
  const commerce = createCommerceService(options.env);
  await app.register(commerceWebhookRoutes, { env: options.env });

  app.get('/commerce/status', { preHandler: app.authenticate }, async (_request, reply) => {
    return reply.status(200).send({
      provider: commerce.stripeConfigured
        ? 'stripe'
        : options.env.NODE_ENV === 'production'
          ? 'disabled'
          : 'dev',
      stripeConfigured: commerce.stripeConfigured,
    });
  });

  app.get('/commerce/entitlements', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = request.principal;
    if (!principal) throw new UnauthenticatedError();
    const items = await commerce.listEntitlements(principal);
    return reply.status(200).send({ items, total: items.length });
  });

  app.get(
    '/commerce/entitlements/:assetId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new UnauthenticatedError();
      const { assetId } = parseParams(z.object({ assetId: z.string().uuid() }), request.params);
      const entitled = await commerce.hasEntitlement(principal, assetId);
      return reply.status(200).send({ assetId, entitled });
    },
  );

  app.post('/commerce/checkout', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = request.principal;
    if (!principal) throw new UnauthenticatedError();
    const { assetId } = parseBody(checkoutBody, request.body);
    const result = await commerce.checkout(principal, assetId);
    return reply.status(result.status === 'paid' ? 200 : 201).send(result);
  });

  app.post(
    '/commerce/orders/:orderId/confirm',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new UnauthenticatedError();
      const { orderId } = parseParams(orderParams, request.params);
      const body = parseBody(confirmBody, request.body ?? {});
      const result = body.sessionId
        ? await commerce.markStripePaid(principal, orderId, body.sessionId)
        : await commerce.confirmDevOrReturn(principal, orderId);
      return reply.status(200).send(result);
    },
  );
}
