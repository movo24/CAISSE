import { BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { StripeTerminalService } from './stripe-terminal.service';

function mockStripe() {
  return {
    terminal: { connectionTokens: { create: jest.fn().mockResolvedValue({ secret: 'pst_x' }) } },
    paymentIntents: {
      create: jest.fn().mockResolvedValue({ id: 'pi_1', client_secret: 'cs_1' }),
      retrieve: jest.fn(),
    },
  } as unknown as Stripe;
}

describe('StripeTerminalService', () => {
  it('fails gracefully (BadRequest) when Stripe is not configured', async () => {
    const svc = new StripeTerminalService(null as unknown as Stripe);
    await expect(svc.createConnectionToken()).rejects.toThrow(BadRequestException);
  });

  it('isConfigured reflects Stripe availability (drives POS card-button gating)', () => {
    expect(new StripeTerminalService(null as unknown as Stripe).isConfigured()).toBe(false);
    expect(new StripeTerminalService(mockStripe()).isConfigured()).toBe(true);
  });

  it('createPaymentIntent uses a DETERMINISTIC idempotency key (same inputs → same key)', async () => {
    const stripe = mockStripe();
    const svc = new StripeTerminalService(stripe);
    await svc.createPaymentIntent(1500, 'EUR', 's1', 'T-1', 'e1');
    await svc.createPaymentIntent(1500, 'EUR', 's1', 'T-1', 'e1');
    const create = (stripe.paymentIntents.create as jest.Mock);
    const key1 = create.mock.calls[0][1].idempotencyKey;
    const key2 = create.mock.calls[1][1].idempotencyKey;
    expect(key1).toBe(key2);
    // a different ticket → different key
    await svc.createPaymentIntent(1500, 'EUR', 's1', 'T-2', 'e1');
    expect(create.mock.calls[2][1].idempotencyKey).not.toBe(key1);
  });

  it('getPaymentIntent rejects cross-store access', async () => {
    const stripe = mockStripe();
    (stripe.paymentIntents.retrieve as jest.Mock).mockResolvedValue({
      id: 'pi_1', status: 'succeeded', amount: 1500, currency: 'eur', metadata: { storeId: 'OTHER' },
    });
    const svc = new StripeTerminalService(stripe);
    await expect(svc.getPaymentIntent('pi_1', 's1')).rejects.toThrow(BadRequestException);
  });

  it('getPaymentIntent returns the PI for the owning store', async () => {
    const stripe = mockStripe();
    (stripe.paymentIntents.retrieve as jest.Mock).mockResolvedValue({
      id: 'pi_1', status: 'succeeded', amount: 1500, currency: 'eur', metadata: { storeId: 's1' },
    });
    const svc = new StripeTerminalService(stripe);
    const res = await svc.getPaymentIntent('pi_1', 's1');
    expect(res.id).toBe('pi_1');
    expect(res.status).toBe('succeeded');
  });
});
