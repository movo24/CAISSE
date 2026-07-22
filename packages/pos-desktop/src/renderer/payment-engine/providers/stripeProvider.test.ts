import { describe, it, expect, vi } from 'vitest';
import { StripeProvider, stripeErrorToOutcome } from './stripeProvider';
import { newPaymentIdentifiers } from '../identifiers';
import type { PaymentAttempt } from '../types';

function makeAttempt(amount = 1000): PaymentAttempt {
  const ids = newPaymentIdentifiers();
  return {
    globalPaymentId: ids.globalPaymentId,
    attemptId: ids.attemptId,
    idempotencyKey: ids.idempotencyKey,
    amountMinorUnits: amount,
    currency: 'eur',
    storeId: 'store-1',
  };
}

interface FakeSdkOpts {
  readers?: unknown[];
  collectError?: { message: string; code?: string };
  processError?: { message: string; code?: string };
  collectNever?: boolean;
}

function makeFakes(opts: FakeSdkOpts = {}) {
  const terminal = {
    discoverReaders: vi.fn(async () => ({
      discoveredReaders: opts.readers ?? [{ id: 'reader-1', label: 'WisePad 3' }],
    })),
    connectReader: vi.fn(async (r: unknown) => ({ reader: r })),
    collectPaymentMethod: vi.fn(async (clientSecret: string) => {
      if (opts.collectNever) return new Promise(() => {});
      if (opts.collectError) return { error: opts.collectError };
      return { paymentIntent: { id: 'pi_from_secret', clientSecret } };
    }),
    processPayment: vi.fn(async () => {
      if (opts.processError) return { error: opts.processError };
      return { paymentIntent: { status: 'succeeded' } };
    }),
    cancelCollectPaymentMethod: vi.fn(async () => ({})),
    disconnectReader: vi.fn(async () => ({})),
  };
  const createPaymentIntent = vi.fn(async (data: { ticketNumber: string }) => ({
    data: { clientSecret: 'secret_1', paymentIntentId: `pi_${data.ticketNumber}` },
  }));
  const api = {
    connectionToken: vi.fn(async () => ({ data: { secret: 'ct_1' } })),
    createPaymentIntent,
    getPaymentIntent: vi.fn(async (id: string) => ({
      data: { id, status: 'succeeded', amount: 1000, currency: 'eur' },
    })),
  };
  const provider = new StripeProvider({
    loadTerminal: async () => ({ create: () => terminal }),
    api: api as never,
    simulated: true,
    sleep: async () => {},
  });
  return { terminal, api, provider };
}

describe('StripeProvider — extraction à comportement identique', () => {
  it('collecte nominale : PI créé avec la clé DÉTERMINISTE de l\'attempt → approved + providerRef', async () => {
    const { provider, api } = makeFakes();
    await provider.init({ provider: 'stripe' });
    await provider.connect();

    const attempt = makeAttempt();
    const res = await provider.collect(attempt);

    expect(res.outcome).toBe('approved');
    expect(res.providerRef).toBe(`pi_${attempt.idempotencyKey}`);
    expect(api.createPaymentIntent).toHaveBeenCalledWith({
      amount: 1000,
      ticketNumber: attempt.idempotencyKey,
      currency: 'eur',
    });
  });

  it('backend PI en échec ×2 puis succès : retry transparent, même clé à chaque essai', async () => {
    const { provider, api } = makeFakes();
    api.createPaymentIntent
      .mockRejectedValueOnce(new Error('502'))
      .mockRejectedValueOnce(new Error('502'));
    await provider.init({ provider: 'stripe' });
    await provider.connect();

    const attempt = makeAttempt();
    const res = await provider.collect(attempt);

    expect(res.outcome).toBe('approved');
    expect(api.createPaymentIntent).toHaveBeenCalledTimes(3);
    const keys = api.createPaymentIntent.mock.calls.map((c) => (c[0] as { ticketNumber: string }).ticketNumber);
    expect(new Set(keys).size).toBe(1); // clé identique sur tous les retries
  });

  it('carte refusée : outcome declined + message FR, la réf PI est conservée', async () => {
    const { provider } = makeFakes({ processError: { message: 'Card declined', code: 'card_declined' } });
    await provider.init({ provider: 'stripe' });
    await provider.connect();

    const res = await provider.collect(makeAttempt());
    expect(res.outcome).toBe('declined');
    expect(res.errorMessage).toBe('Carte refusee. Demandez au client un autre moyen de paiement.');
    expect(res.providerRef).toBeTruthy();
  });

  it('aucun lecteur découvert : connect() échoue avec le message existant', async () => {
    const { provider } = makeFakes({ readers: [] });
    await provider.init({ provider: 'stripe' });
    await expect(provider.connect()).rejects.toThrow(/Aucun lecteur carte détecté/);
  });

  it('ré-entrée : un second collect pendant une collecte est refusé sans double débit', async () => {
    const { provider } = makeFakes({ collectNever: true });
    await provider.init({ provider: 'stripe' });
    await provider.connect();

    void provider.collect(makeAttempt());
    await Promise.resolve();
    const second = await provider.collect(makeAttempt());
    expect(second.outcome).toBe('declined');
    expect(second.errorMessage).toMatch(/deja en cours/);
  });

  it('getStatus : succeeded → approved ; 404 → not_found', async () => {
    const { provider, api } = makeFakes();
    await provider.init({ provider: 'stripe' });

    const ok = await provider.getStatus('pi_x');
    expect(ok.state).toBe('approved');

    api.getPaymentIntent.mockRejectedValueOnce({ response: { status: 404 } });
    const missing = await provider.getStatus('pi_y');
    expect(missing.state).toBe('not_found');
  });

  it('capabilities : capture revendiquée (vérifiée serveur), refund non disponible (P4)', () => {
    const { provider } = makeFakes();
    const caps = provider.capabilities();
    expect(caps.claimsCapture).toBe(true);
    expect(caps.refund).toBe(false);
    expect(caps.statusQuery).toBe(true);
  });
});

describe('stripeErrorToOutcome — classement canonique', () => {
  it('timeout / réseau / annulation / refus', () => {
    expect(stripeErrorToOutcome({ code: 'timed_out' })).toBe('timeout');
    expect(stripeErrorToOutcome({ message: "Delai d'attente depasse (2 min). Veuillez reessayer." })).toBe('timeout');
    expect(stripeErrorToOutcome({ code: 'network_error' })).toBe('communication_error');
    expect(stripeErrorToOutcome({ message: 'Failed to fetch' })).toBe('communication_error');
    expect(stripeErrorToOutcome({ message: 'Collection canceled by user' })).toBe('cancelled');
    expect(stripeErrorToOutcome({ code: 'card_declined', message: 'Card declined' })).toBe('declined');
    expect(stripeErrorToOutcome({ message: 'anything else' })).toBe('declined');
  });
});
