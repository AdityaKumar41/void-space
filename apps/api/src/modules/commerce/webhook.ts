import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiEnv } from '../../env';
import { ServiceUnavailableError, ValidationError } from '../../lib/errors';
import { createCommerceService } from './service';
import { assertJsonBudget } from '../../lib/json-budget';

function verifySignature(body: Buffer, header: string | undefined, secret: string): void {
  const parts = (header ?? '').split(',').map((part) => part.trim().split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  ) {
    throw new ValidationError('Invalid or expired payment webhook signature');
  }
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest();
  const valid = parts.some(
    ([key, value]) =>
      key === 'v1' &&
      value &&
      /^[a-f0-9]{64}$/i.test(value) &&
      timingSafeEqual(expected, Buffer.from(value, 'hex')),
  );
  if (!valid) throw new ValidationError('Invalid payment webhook signature');
}

const eventSchema = z.object({ type: z.string(), data: z.object({ object: z.unknown() }) });
const paidSessionSchema = z.object({
  id: z.string().min(1).max(200),
  payment_status: z.string(),
  metadata: z.object({ orderId: z.string().uuid(), buyerTenantId: z.string().uuid() }),
});

/** Encapsulation preserves the raw JSON bytes only for this signed endpoint. */
export async function commerceWebhookRoutes(app: FastifyInstance, options: { env: ApiEnv }) {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) =>
    done(null, body),
  );
  const commerce = createCommerceService(options.env);
  app.post('/commerce/webhook', { bodyLimit: 1_048_576 }, async (request) => {
    const secret = options.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !options.env.STRIPE_SECRET_KEY)
      throw new ServiceUnavailableError('Payments are not configured');
    if (!Buffer.isBuffer(request.body)) throw new ValidationError('A raw JSON event is required');
    const header = request.headers['stripe-signature'];
    verifySignature(request.body, typeof header === 'string' ? header : undefined, secret);
    let payload: unknown;
    try {
      payload = JSON.parse(request.body.toString('utf8'));
    } catch {
      throw new ValidationError('Invalid payment event JSON');
    }
    assertJsonBudget(payload);
    const event = eventSchema.safeParse(payload);
    if (!event.success) throw new ValidationError('Invalid payment event');
    if (
      !['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(
        event.data.type,
      )
    )
      return { received: true };
    const session = paidSessionSchema.safeParse(event.data.data.object);
    if (!session.success) throw new ValidationError('Payment event is missing order metadata');
    if (session.data.payment_status !== 'paid') return { received: true };
    // A valid signature establishes the sender. The shared fulfillment path
    // still retrieves Stripe's current session and verifies amount and identity.
    await commerce.confirmStripeWebhook(
      session.data.metadata.buyerTenantId,
      session.data.metadata.orderId,
      session.data.id,
    );
    return { received: true };
  });
}
