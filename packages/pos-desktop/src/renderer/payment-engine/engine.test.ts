import { describe, it, expect } from 'vitest';
import { PaymentEngine, EngineBusyError, AttemptBlockedError } from './engine';
import { MockProvider } from './providers/mockProvider';
import { canTransition, PaymentAttemptStatus } from './states';

const input = (saleKey: string, amount = 1000) => ({
  saleKey,
  amountMinorUnits: amount,
  saleId: `sale-${saleKey}`,
  storeId: 'store-1',
});

describe('PaymentEngine — flux nominal', () => {
  it('approbation : APPROVED, journal de transitions toutes légales', async () => {
    const mock = new MockProvider();
    mock.script([{ outcome: 'approved', providerRef: 'mock_pi_1' }]);
    const engine = new PaymentEngine(mock);

    const out = await engine.startPayment(input('s1'));

    expect(out.status).toBe('APPROVED');
    expect(out.result?.providerRef).toBe('mock_pi_1');
    expect(out.message).toBe('Paiement accepté');
    // Le mock ne prouve jamais une capture (jambe pendingCapture côté vente).
    expect(engine.claimsCapture).toBe(false);

    const seq = engine.journal().map((e) => e.to);
    expect(seq[0]).toBe('CREATED');
    expect(seq[seq.length - 1]).toBe('APPROVED');
    // Chaque transition consécutive du journal est légale dans la matrice.
    for (let i = 1; i < seq.length; i++) {
      expect(canTransition(seq[i - 1] as PaymentAttemptStatus, seq[i] as PaymentAttemptStatus)).toBe(true);
    }
    // Identifiants générés par le moteur, clé déterministe dérivée de l'attempt.
    expect(out.attempt.globalPaymentId).toBeTruthy();
    expect(out.attempt.idempotencyKey).toBe(`pay_${out.attempt.attemptId}`);
  });

  it('refus : DECLINED, puis relance AUTORISÉE avec même GlobalPaymentId et attempt neuf', async () => {
    const mock = new MockProvider();
    mock.script([
      { outcome: 'declined', errorMessage: 'Carte refusee.' },
      { outcome: 'approved', providerRef: 'mock_pi_2' },
    ]);
    const engine = new PaymentEngine(mock);

    const first = await engine.startPayment(input('s2'));
    expect(first.status).toBe('DECLINED');
    expect(first.message).toBe('Paiement refusé');

    const retry = await engine.startPayment(input('s2'));
    expect(retry.status).toBe('APPROVED');
    expect(retry.attempt.globalPaymentId).toBe(first.attempt.globalPaymentId);
    expect(retry.attempt.attemptId).not.toBe(first.attempt.attemptId);
    expect(retry.attempt.idempotencyKey).not.toBe(first.attempt.idempotencyKey);
  });

  it('annulation caisse pendant la collecte : CANCELLED, relance possible', async () => {
    const mock = new MockProvider();
    const engine = new PaymentEngine(mock);

    const pending = engine.startPayment(input('s3'));
    await Promise.resolve(); // laisse collect() s'installer
    await engine.cancelActive();
    const out = await pending;

    expect(out.status).toBe('CANCELLED');
    mock.script([{ outcome: 'approved', providerRef: 'mock_pi_3' }]);
    const retry = await engine.startPayment(input('s3'));
    expect(retry.status).toBe('APPROVED');
  });
});

describe('PaymentEngine — anti-double-débit', () => {
  it('double-clic : le second startPayment lève EngineBusyError (verrou synchrone)', async () => {
    const mock = new MockProvider();
    const engine = new PaymentEngine(mock);

    const pending = engine.startPayment(input('s4'));
    await expect(engine.startPayment(input('s4'))).rejects.toBeInstanceOf(EngineBusyError);
    mock.resolveApproved();
    await pending;
  });

  it('timeout SANS référence provider : rien n\'a pu être débité → DECLINED, relance possible', async () => {
    const mock = new MockProvider();
    mock.script([{ outcome: 'timeout' }]);
    const engine = new PaymentEngine(mock);

    const out = await engine.startPayment(input('s5'));
    expect(out.status).toBe('DECLINED');
    // La vérification a bien eu lieu (passage par VERIFICATION_REQUIRED).
    expect(engine.journal().map((e) => e.to)).toContain('VERIFICATION_REQUIRED');
    expect(engine.journal().map((e) => e.to)).toContain('TIMEOUT');

    mock.script([{ outcome: 'approved', providerRef: 'mock_pi_5' }]);
    await expect(engine.startPayment(input('s5'))).resolves.toMatchObject({ status: 'APPROVED' });
  });

  it('coupure AVEC référence + statut provider "approved" : le paiement a réellement abouti → APPROVED', async () => {
    const mock = new MockProvider();
    mock.script([{ outcome: 'communication_error', providerRef: 'mock_pi_6' }]);
    mock.scriptStatus('mock_pi_6', { state: 'approved', providerRef: 'mock_pi_6', amountMinorUnits: 1000 });
    const engine = new PaymentEngine(mock);

    const out = await engine.startPayment(input('s6'));
    expect(out.status).toBe('APPROVED');
    // Le résultat porte l'approbation résolue — la jambe carte doit porter la réf.
    expect(out.result?.outcome).toBe('approved');
    expect(out.result?.providerRef).toBe('mock_pi_6');
  });

  it('coupure AVEC référence + provider muet : reste en VERIFICATION_REQUIRED et BLOQUE toute relance', async () => {
    const mock = new MockProvider();
    mock.script([{ outcome: 'communication_error', providerRef: 'mock_pi_7' }]);
    mock.scriptStatus('mock_pi_7', { state: 'unknown', providerRef: 'mock_pi_7' });
    const engine = new PaymentEngine(mock);

    const out = await engine.startPayment(input('s7'));
    expect(out.status).toBe('VERIFICATION_REQUIRED');
    expect(out.message).toBe('Vérification nécessaire');

    // Règle owner / D-PE5 : tant que le doute n'est pas levé, AUCUNE relance.
    await expect(engine.startPayment(input('s7'))).rejects.toBeInstanceOf(AttemptBlockedError);
  });

  it('résultat UNKNOWN → vérification, jamais une nouvelle collecte automatique', async () => {
    const mock = new MockProvider();
    mock.script([{ outcome: 'unknown', providerRef: 'mock_pi_8' }]);
    mock.scriptStatus('mock_pi_8', { state: 'not_found', providerRef: 'mock_pi_8' });
    const engine = new PaymentEngine(mock);

    const out = await engine.startPayment(input('s8'));
    // not_found → rien débité → refus franc, relance permise.
    expect(out.status).toBe('DECLINED');
    const seq = engine.journal().map((e) => e.to);
    expect(seq).toContain('UNKNOWN');
    expect(seq).toContain('VERIFICATION_REQUIRED');
    // Une seule collecte provider : le journal ne repart jamais en arrière.
    expect(seq.filter((s) => s === 'WAITING_FOR_CUSTOMER').length).toBe(1);
  });

  it('les tentatives de ventes DIFFÉRENTES ne se bloquent pas entre elles', async () => {
    const mock = new MockProvider();
    mock.script([{ outcome: 'communication_error', providerRef: 'mock_pi_9' }]);
    mock.scriptStatus('mock_pi_9', { state: 'unknown' });
    const engine = new PaymentEngine(mock);

    await engine.startPayment(input('s9'));
    mock.script([{ outcome: 'approved', providerRef: 'mock_pi_10' }]);
    await expect(engine.startPayment(input('s10'))).resolves.toMatchObject({ status: 'APPROVED' });
  });
});

describe('PaymentEngine — journal §3.9', () => {
  it('chaque entrée porte ids, provider, montant, acteur, horodatage', async () => {
    const mock = new MockProvider();
    mock.script([{ outcome: 'approved', providerRef: 'mock_pi_11' }]);
    const engine = new PaymentEngine(mock, { actor: 'cashier' });

    const out = await engine.startPayment(input('s11', 4242));
    for (const e of engine.journal()) {
      expect(e.globalPaymentId).toBe(out.attempt.globalPaymentId);
      expect(e.attemptId).toBe(out.attempt.attemptId);
      expect(e.provider).toBe('mock');
      expect(e.amountMinorUnits).toBe(4242);
      expect(e.actor).toBe('cashier');
      expect(Date.parse(e.at)).not.toBeNaN();
    }
  });
});
