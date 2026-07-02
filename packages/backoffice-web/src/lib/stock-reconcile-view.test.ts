import { describe, it, expect } from 'vitest';
import { driftLevel, sortForDisplay, reconSummary, ReconRow } from './stock-reconcile-view';

// P322 (cycle I5) — display rules of the reconciliation screen.

const row = (over: Partial<ReconRow>): ReconRow => ({
  productId: over.productId ?? Math.random().toString(36),
  productName: over.productName ?? 'p',
  counter: over.counter ?? 0,
  journalNet: over.journalNet ?? null,
  balance: over.balance !== undefined ? over.balance : null,
  balanceDrift: over.balanceDrift !== undefined ? over.balanceDrift : null,
});

describe('stock-reconcile-view', () => {
  it('classifies rows: drift / no-balance / ok', () => {
    expect(driftLevel(row({ balance: 25, balanceDrift: 15 }))).toBe('drift');
    expect(driftLevel(row({ balance: null }))).toBe('no-balance');
    expect(driftLevel(row({ balance: 40, balanceDrift: 0 }))).toBe('ok');
  });

  it('sorts drifting rows first, biggest absolute drift on top', () => {
    const rows = [
      row({ productName: 'aligné', balance: 10, balanceDrift: 0 }),
      row({ productName: 'petit-drift', balance: 12, balanceDrift: 2 }),
      row({ productName: 'gros-drift', balance: 50, balanceDrift: -40 }),
      row({ productName: 'sans-balance' }),
    ];
    expect(sortForDisplay(rows).map((r) => r.productName)).toEqual([
      'gros-drift', 'petit-drift', 'sans-balance', 'aligné',
    ]);
  });

  it('summary is calm at 0 drift and alarming otherwise', () => {
    expect(reconSummary([row({})], 0)).toContain('aucune dérive');
    expect(reconSummary([row({}), row({})], 1)).toContain('1 en dérive');
    expect(reconSummary([], 0)).toBe('Aucun produit actif.');
  });
});
