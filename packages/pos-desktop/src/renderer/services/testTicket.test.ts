import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTestTicket, computeTestTotals, computeTestVat } from './testTicket';

/**
 * Le ticket de test doit être COMPLET, sinon il ne prouve rien.
 *
 * L'ancien contenait une ligne à 0,00 € sans logo ni QR : il pesait quelques
 * centaines d'octets là où un ticket réel en pèse des dizaines de milliers.
 * Comparer une sortie blanche à ce squelette était sans valeur diagnostique.
 */

describe('totaux du ticket de diagnostic', () => {
  const t = buildTestTicket(null, null);

  it('plusieurs articles, dont au moins un avec quantité > 1', () => {
    expect(t.items.length).toBeGreaterThanOrEqual(4);
    expect(t.items.some((i) => i.quantity > 1)).toBe(true);
  });

  it('sous-total = somme des lignes', () => {
    const { subtotal } = computeTestTotals(t.items);
    expect(subtotal).toBeCloseTo(19.0, 2);
    expect(t.subtotal).toBe(subtotal);
  });

  it('remise prise en compte dans le total', () => {
    expect(t.discount).toBeCloseTo(0.5, 2);
    expect(t.total).toBeCloseTo(18.5, 2);
  });

  it('rendu monnaie cohérent avec les espèces reçues', () => {
    expect(t.cashReceived).toBe(19);
    expect(t.change).toBeCloseTo(0.5, 2);
  });

  it('aucun arrondi flottant parasite (montants au centime)', () => {
    for (const v of [t.subtotal, t.discount, t.total, t.change]) {
      expect(Math.round(v * 100) / 100).toBe(v);
    }
  });
});

describe('ventilation TVA', () => {
  const rows = computeTestVat(buildTestTicket(null, null).items);

  it('un bloc par taux réellement présent (5,5 % et 20 %)', () => {
    expect(rows.map((r) => r.rate)).toEqual([5.5, 20]);
  });

  it('HT + TVA = TTC pour chaque taux', () => {
    for (const r of rows) expect(r.ht + r.tva).toBeCloseTo(r.ttc, 2);
  });

  it('la somme des TTC égale le total du ticket', () => {
    const t = buildTestTicket(null, null);
    expect(rows.reduce((s, r) => s + r.ttc, 0)).toBeCloseTo(t.total, 2);
  });

  it('la remise est déduite du TTC ventilé (jamais de TVA sur un montant non encaissé)', () => {
    const at20 = rows.find((r) => r.rate === 20)!;
    // 3,60 + (3,00 − 0,50) = 6,10
    expect(at20.ttc).toBeCloseTo(6.1, 2);
  });
});

describe('champs de rendu (logo, QR, marquage)', () => {
  it('transporte le logo et le QR quand ils sont fournis', () => {
    const t = buildTestTicket('data:image/png;base64,AAAA', 'data:image/png;base64,BBBB');
    expect(t.logoDataUrl).toBe('data:image/png;base64,AAAA');
    expect(t.qrDataUrl).toBe('data:image/png;base64,BBBB');
    expect(t.qrContent).toBeTruthy();
  });

  it('sans QR, aucun contenu QR fantôme', () => {
    expect(buildTestTicket(null, null).qrContent).toBeNull();
  });

  it('porte TOUJOURS le marqueur de test (jamais confondable avec un ticket fiscal)', () => {
    expect(buildTestTicket(null, null).testMarker).toMatch(/SANS VALEUR FISCALE/);
    expect(buildTestTicket('data:image/png;base64,A', 'data:image/png;base64,B').testMarker)
      .toMatch(/SANS VALEUR FISCALE/);
  });

  it('respecte la largeur papier demandée', () => {
    expect(buildTestTicket(null, null, 58).paperWidthMm).toBe(58);
    expect(buildTestTicket(null, null, 80).paperWidthMm).toBe(80);
  });
});

describe('journalisation et garde de l’écran diagnostic', () => {
  const pageSrc = readFileSync(join(__dirname, '..', 'pages', 'PrinterDiagnosticsPage.tsx'), 'utf8');
  const bridgeSrc = readFileSync(join(__dirname, 'peripheralBridge.ts'), 'utf8');

  it('le bouton « Impression test » utilise le ticket COMPLET', () => {
    expect(pageSrc).toMatch(/buildTestTicket\(logo, qr, getPaperWidthMm\(\)\)/);
  });

  it('garde SYNCHRONE anti-double-clic (un état React arriverait trop tard)', () => {
    expect(pageSrc).toMatch(/if \(printBusyRef\.current\) return;/);
    expect(pageSrc).toMatch(/printBusyRef\.current = true;/);
    expect(pageSrc).toMatch(/printBusyRef\.current = false;/);
  });

  it('la ligne de succès porte tous les champs de diagnostic exigés', () => {
    expect(bridgeSrc).toMatch(/\[PERIPH\] Desktop OS print success/);
    for (const field of ['buildMs', 'htmlBytes', 'printerName', 'pageSize', 'paperWidthMm', 'status']) {
      expect(bridgeSrc).toContain(field);
    }
  });

  it('un échec est journalisé sous [PERIPH] avec le même bloc structuré', () => {
    expect(bridgeSrc).toMatch(/\[PERIPH\] Desktop OS print failed', JSON\.stringify\(diag\)/);
  });

  it('les exceptions de l’écran sont journalisées sous [PERIPH]', () => {
    expect(pageSrc).toMatch(/console\.error\('\[PERIPH\] Test print — exception'/);
  });

  it('htmlBytes est lisible À L’ÉCRAN (diagnostic sans DevTools)', () => {
    expect(pageSrc).toMatch(/Diagnostic de la dernière impression/);
    expect(pageSrc).toMatch(/Ticket QUASI VIDE/);
    expect(pageSrc).toMatch(/Ticket COMPLET/);
  });
});
