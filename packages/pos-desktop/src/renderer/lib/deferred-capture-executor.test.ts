/** P353 — exécuteur de capture différée : orchestration prouvée sous mock (TPE injecté). */
import { describe, it, expect, vi } from 'vitest';
import { processDeferredCaptures, DeferredCaptureDeps, QueueEntryLike } from './deferred-capture-executor';
import { buildDeferredCaptureOrder } from './deferred-card-policy';

const order = (saleId: string, amount = 4200) =>
  buildDeferredCaptureOrder({ saleClientId: saleId, amountMinorUnits: amount, now: new Date('2026-07-02T12:00:00Z') });

const entry = (id: string, saleId: string, status = 'local_pending'): QueueEntryLike => ({
  id, type: 'payment', status, payload: order(saleId),
});

const mkDeps = (outcomes: Record<string, 'captured' | 'declined' | 'error' | Error>): DeferredCaptureDeps & {
  calls: { capture: string[]; finalized: string[]; voided: string[]; statuses: Array<[string, string]>; notices: string[] };
} => {
  const calls = { capture: [] as string[], finalized: [] as string[], voided: [] as string[], statuses: [] as Array<[string, string]>, notices: [] as string[] };
  return {
    calls,
    capture: vi.fn(async (o) => {
      calls.capture.push(o.idempotencyKey);
      const r = outcomes[o.saleClientId];
      if (r instanceof Error) throw r;
      return r;
    }),
    finalizeSale: vi.fn(async (id) => { calls.finalized.push(id); }),
    voidPendingSale: vi.fn(async (id) => { calls.voided.push(id); }),
    updateEntryStatus: (id, st) => { calls.statuses.push([id, st]); },
    notify: (m) => { calls.notices.push(m); },
  };
};

describe('processDeferredCaptures', () => {
  it('captured → finalise la vente PUIS marque synced, avec la clé idempotente de l’ordre', async () => {
    const deps = mkDeps({ 'sale-1': 'captured' });
    const r = await processDeferredCaptures([entry('e1', 'sale-1')], deps);
    expect(r).toEqual({ processed: 1, captured: 1, declined: 0, retried: 0 });
    expect(deps.calls.capture).toEqual(['defcap:sale-1:4200']);
    expect(deps.calls.finalized).toEqual(['sale-1']);
    expect(deps.calls.statuses).toEqual([['e1', 'synced']]);
    expect(deps.calls.notices.some((n) => n.includes('réussie'))).toBe(true);
  });

  it('declined → vente en attente ABANDONNÉE (jamais finalisée), entrée failed, opérateur prévenu', async () => {
    const deps = mkDeps({ 'sale-2': 'declined' });
    const r = await processDeferredCaptures([entry('e2', 'sale-2')], deps);
    expect(r.declined).toBe(1);
    expect(deps.calls.finalized).toEqual([]);
    expect(deps.calls.voided).toEqual(['sale-2']);
    expect(deps.calls.statuses).toEqual([['e2', 'failed']]);
    expect(deps.calls.notices.some((n) => n.includes('REFUSÉE'))).toBe(true);
  });

  it('error ET exception du client → retry (local_pending), vente intacte', async () => {
    const deps = mkDeps({ 'sale-3': 'error', 'sale-4': new Error('TPE injoignable') });
    const r = await processDeferredCaptures([entry('e3', 'sale-3'), entry('e4', 'sale-4')], deps);
    expect(r.retried).toBe(2);
    expect(deps.calls.finalized).toEqual([]);
    expect(deps.calls.voided).toEqual([]);
    expect(deps.calls.statuses).toEqual([['e3', 'local_pending'], ['e4', 'local_pending']]);
  });

  it('capture OK mais finalisation KO → PAS synced (rejouable), aucune double charge possible (même clé)', async () => {
    const deps = mkDeps({ 'sale-5': 'captured' });
    (deps.finalizeSale as any).mockRejectedValueOnce(new Error('réseau retombé'));
    const r1 = await processDeferredCaptures([entry('e5', 'sale-5')], deps);
    expect(r1.retried).toBe(1);
    expect(deps.calls.statuses).toEqual([['e5', 'local_pending']]);

    // rejeu : MÊME clé de capture envoyée (idempotence Stripe) puis synced
    const r2 = await processDeferredCaptures([entry('e5', 'sale-5')], deps);
    expect(r2.captured).toBe(1);
    expect(deps.calls.capture).toEqual(['defcap:sale-5:4200', 'defcap:sale-5:4200']);
    expect(deps.calls.finalized).toEqual(['sale-5']);
  });

  it('ne retraite jamais les entrées synced/failed ni les autres types de file', async () => {
    const deps = mkDeps({});
    const r = await processDeferredCaptures(
      [
        entry('done', 's-a', 'synced'),
        entry('dead', 's-b', 'failed'),
        { id: 'tk', type: 'ticket', status: 'local_pending', payload: { kind: 'card_deferred_capture' } },
        { id: 'other', type: 'payment', status: 'local_pending', payload: { kind: 'autre' } },
      ],
      deps,
    );
    expect(r.processed).toBe(0);
    expect(deps.calls.capture).toEqual([]);
  });

  it('traite plusieurs ordres séquentiellement et rapporte fidèlement', async () => {
    const deps = mkDeps({ a: 'captured', b: 'declined', c: 'error' });
    const r = await processDeferredCaptures(
      [entry('ea', 'a', 'local_pending'), entry('eb', 'b'), entry('ec', 'c')],
      deps,
    );
    expect(r).toEqual({ processed: 3, captured: 1, declined: 1, retried: 1 });
    expect(deps.calls.notices).toHaveLength(3); // jamais d'échec silencieux
  });
});
