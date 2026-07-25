import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  subscribeScanDiag,
  getScanDiag,
  setScanDiagAttached,
  reportScanDiagKeydown,
  reportScanDiagScan,
} from './scanDiag';

// L'état est un singleton module ; on le remet à un état connu au départ de
// chaque test en rejouant des mutations (pas de reset exposé volontairement —
// c'est un diagnostic, pas une API métier).
beforeEach(() => {
  setScanDiagAttached(false);
});

describe('scanDiag — observabilité douchette', () => {
  it('subscribe reçoit immédiatement un instantané, puis chaque mutation', () => {
    const seen: number[] = [];
    const off = subscribeScanDiag((s) => seen.push(s.keydownCount));
    const before = getScanDiag().keydownCount;
    reportScanDiagKeydown('4', 'BODY');
    expect(getScanDiag().keydownCount).toBe(before + 1);
    // Au moins l'instantané initial + la notification après keydown.
    expect(seen.length).toBeGreaterThanOrEqual(2);
    off();
  });

  it('après désabonnement, plus aucune notification', () => {
    const cb = vi.fn();
    const off = subscribeScanDiag(cb);
    off();
    cb.mockClear();
    reportScanDiagScan('123456789');
    expect(cb).not.toHaveBeenCalled();
  });

  it('reportScanDiagScan met à jour dernier scan + incrémente le compteur', () => {
    const before = getScanDiag().scanCount;
    reportScanDiagScan('4260421350771');
    const s = getScanDiag();
    expect(s.lastScan).toBe('4260421350771');
    expect(s.scanCount).toBe(before + 1);
  });

  it('reportScanDiagKeydown mémorise la dernière touche et l’élément actif', () => {
    reportScanDiagKeydown('X', 'INPUT');
    const s = getScanDiag();
    expect(s.lastKey).toBe('X');
    expect(s.lastActive).toBe('INPUT');
  });

  it('setScanDiagAttached bascule l’état attaché', () => {
    setScanDiagAttached(true);
    expect(getScanDiag().attached).toBe(true);
    setScanDiagAttached(false);
    expect(getScanDiag().attached).toBe(false);
  });
});
