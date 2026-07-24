import { describe, it, expect } from 'vitest';
import { resolveLocalScan, isDuplicateScan, validateScanCode, type ScanProduct } from './scanResolver';

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

describe('isDuplicateScan (anti-double-ajout d\'un SEUL scan, fenêtre courte)', () => {
  it('double-envoi instantané du même code (≤50 ms) → doublon bloqué', () => {
    expect(isDuplicateScan({ code: 'X', ts: 1000 }, 'X', 1010)).toBe(true); // +10 ms = ré-émission
  });

  it('2ᵉ scan volontaire du même article (≥300 ms) → AUTORISÉ (→ quantité +1)', () => {
    expect(isDuplicateScan({ code: 'X', ts: 1000 }, 'X', 1300)).toBe(false); // +300 ms
    expect(isDuplicateScan({ code: 'X', ts: 1000 }, 'X', 1080)).toBe(false); // +80 ms > fenêtre 50
  });

  it('code différent → toujours autorisé (scans rapides successifs)', () => {
    expect(isDuplicateScan({ code: 'X', ts: 1000 }, 'Y', 1005)).toBe(false);
  });

  it('aucun scan précédent → autorisé', () => {
    expect(isDuplicateScan({ code: null, ts: 0 }, 'X', 1000)).toBe(false);
  });
});

describe('validateScanCode (aucun scan invalide ne finit dans le silence)', () => {
  it('EAN-13, EAN-8, UPC-A, code interne WES-P → valides', () => {
    expect(validateScanCode('3760012345678')).toEqual({ ok: true, code: '3760012345678' });
    expect(validateScanCode('20123452')).toEqual({ ok: true, code: '20123452' });
    expect(validateScanCode('012345678905')).toEqual({ ok: true, code: '012345678905' });
    expect(validateScanCode('WES-P-000042')).toEqual({ ok: true, code: 'WES-P-000042' });
  });

  it('espaces externes tolérés (trim)', () => {
    expect(validateScanCode('  20123452  ')).toEqual({ ok: true, code: '20123452' });
  });

  it('trop court / vide → message « invalide ou incomplet » avec le code reçu', () => {
    const r = validateScanCode('12');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('12');
    const empty = validateScanCode('');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toContain('(vide)');
  });

  it('trop long, caractère non imprimable ou espace interne → invalide', () => {
    expect(validateScanCode('X'.repeat(40)).ok).toBe(false);
    expect(validateScanCode('ABC\u0007D').ok).toBe(false); // caractère de contrôle
    expect(validateScanCode('café-123').ok).toBe(false); // hors ASCII imprimable
    expect(validateScanCode('12 34 56').ok).toBe(false);
  });
});
