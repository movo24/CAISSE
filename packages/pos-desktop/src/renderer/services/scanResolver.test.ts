import { describe, it, expect } from 'vitest';
import { resolveLocalScan, isDuplicateScan, type ScanProduct } from './scanResolver';

const catalogue: ScanProduct[] = [
  { id: 'p1', ean: '3760012345678', name: 'Coca 33cl', priceMinorUnits: 150, isActive: true },
  { id: 'p2', ean: '20123452', name: 'Bonbon vrac', priceMinorUnits: 90, isActive: false },
];

describe('resolveLocalScan (catalogue local, hors-ligne)', () => {
  it('produit existant et vendable → add', () => {
    const r = resolveLocalScan('3760012345678', catalogue);
    expect(r.status).toBe('add');
    expect(r.status === 'add' && r.product.id).toBe('p1');
  });

  it('produit désactivé → refused avec motif clair', () => {
    const r = resolveLocalScan('20123452', catalogue);
    expect(r.status).toBe('refused');
    expect(r.status === 'refused' && r.reason).toMatch(/désactivé/i);
  });

  it('code inconnu → unknown (aucun faux produit)', () => {
    const r = resolveLocalScan('0000000000000', catalogue);
    expect(r).toEqual({ status: 'unknown', code: '0000000000000' });
  });

  it('tolère les espaces autour du code', () => {
    expect(resolveLocalScan('  3760012345678 ', catalogue).status).toBe('add');
  });
});

describe('isDuplicateScan (anti-double-ajout d\'un seul scan)', () => {
  it('même code ré-émis dans la fenêtre → doublon (bloqué)', () => {
    expect(isDuplicateScan({ code: 'X', ts: 1000 }, 'X', 1050)).toBe(true); // +50 ms
  });

  it('même code après la fenêtre → autorisé (re-scan volontaire → +1)', () => {
    expect(isDuplicateScan({ code: 'X', ts: 1000 }, 'X', 1300)).toBe(false); // +300 ms
  });

  it('code différent → toujours autorisé (scans rapides successifs)', () => {
    expect(isDuplicateScan({ code: 'X', ts: 1000 }, 'Y', 1010)).toBe(false);
  });

  it('aucun scan précédent → autorisé', () => {
    expect(isDuplicateScan({ code: null, ts: 0 }, 'X', 1000)).toBe(false);
  });
});
