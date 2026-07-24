// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { peripheralBridge } from './peripheralBridge';

/**
 * RÉGRESSION P0 — attache du listener douchette malgré la course d'init.
 *
 * Bug corrigé : `POSPage` monte deux effets frères :
 *   1) `peripheralBridge.init(platform)`  — async, NON awaité (fire-and-forget) ;
 *   2) `peripheralBridge.startBarcodeListener(cb)` — synchrone, juste après.
 * L'ancien `init()` ne fixait `scanner.type = 'keyboard_wedge'` qu'APRÈS
 * `await detectPrinter()` puis `detectScanner()`. Au moment où l'effet (2)
 * s'exécutait, le type valait encore `'none'` → `startBarcodeListener` n'attachait
 * PAS l'écoute clavier globale → chaque scan était tapé dans le champ ayant le
 * focus (barre « Recherche produits »). Cause racine du P0.
 *
 * Ce test reproduit EXACTEMENT cet ordre (init non awaité, puis abonnement
 * synchrone) et prouve que la rafale est désormais captée et routée au panier,
 * sans rien laisser dans le champ focalisé. Avant le correctif, `onBarcode`
 * n'était jamais appelé et le code restait dans l'input.
 */

let input: HTMLInputElement;
let onBarcode: ReturnType<typeof vi.fn>;
let off: () => void;

/** Modélise l'insertion navigateur : insère le caractère si non empêché/stoppé. */
function mimicInsertion(e: KeyboardEvent) {
  if (e.key.length === 1 && !e.defaultPrevented) {
    const s = input.selectionStart ?? input.value.length;
    input.setRangeText(e.key, s, s, 'end');
  }
}

/** Rafale « douchette » : caractères quasi simultanés (Date.now réel, écart ~0) + Entrée. */
function scan(str: string) {
  for (const ch of str) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
  }
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.replaceChildren();
  const form = document.createElement('form');
  input = document.createElement('input');
  input.placeholder = 'Rechercher un produit';
  form.appendChild(input);
  document.body.appendChild(form);
  input.addEventListener('keydown', mimicInsertion);
  onBarcode = vi.fn();
});

afterEach(() => {
  off?.();
  peripheralBridge.destroy();
});

describe('peripheralBridge — attache du wedge malgré la course d’init (P0)', () => {
  it('init() NON awaité puis startBarcodeListener() synchrone : la rafale est captée, rien ne reste dans le champ', () => {
    // Reproduit l'ordre des effets de POSPage : init fire-and-forget…
    void peripheralBridge.init('windows');
    // …puis abonnement SYNCHRONE, avant que la détection asynchrone ne se termine.
    off = peripheralBridge.startBarcodeListener((r) => onBarcode(r.code));

    input.focus();
    scan('3760012345678');

    expect(onBarcode).toHaveBeenCalledTimes(1);
    expect(onBarcode.mock.calls[0][0]).toBe('3760012345678');
    expect(input.value).toBe(''); // aucune fuite dans la barre de recherche
  });

  it('deux produits différents scannés à la suite → deux signaux distincts', () => {
    void peripheralBridge.init('windows');
    off = peripheralBridge.startBarcodeListener((r) => onBarcode(r.code));
    input.focus();

    scan('3760012345678');
    scan('3011234567890');

    expect(onBarcode).toHaveBeenCalledTimes(2);
    expect(onBarcode.mock.calls.map((c) => c[0])).toEqual(['3760012345678', '3011234567890']);
    expect(input.value).toBe('');
  });

  it('frappe humaine lente dans la barre : jamais interprétée comme un scan, texte conservé', async () => {
    void peripheralBridge.init('windows');
    off = peripheralBridge.startBarcodeListener((r) => onBarcode(r.code));
    input.focus();

    // Écart > maxInterKeyMs (50) entre chaque touche → frappe humaine.
    for (const ch of 'lait') {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 70));
    }

    expect(onBarcode).not.toHaveBeenCalled();
    expect(input.value).toBe('lait'); // la recherche manuelle fonctionne normalement
  });

  it('tablette AVEC caméra : la détection retire l’écoute clavier (la caméra scanne, pas de double chemin)', async () => {
    // Sur tablette, detectScanner sonde une caméra ; si présente → mode caméra et
    // l'écoute clavier globale (attachée par défaut) est retirée.
    (navigator as any).mediaDevices = {
      enumerateDevices: () => Promise.resolve([{ kind: 'videoinput' }]),
    };
    await peripheralBridge.init('ipad');
    off = peripheralBridge.startBarcodeListener((r) => onBarcode(r.code));
    // Ré-exécute la détection (déjà faite dans init) — idempotente ; garantit l'état caméra.
    await peripheralBridge.init('ipad');

    input.focus();
    scan('3760012345678');

    // Aucune capture clavier : la caméra gère le scan sur ce poste.
    expect(onBarcode).not.toHaveBeenCalled();
    delete (navigator as any).mediaDevices;
  });
});
