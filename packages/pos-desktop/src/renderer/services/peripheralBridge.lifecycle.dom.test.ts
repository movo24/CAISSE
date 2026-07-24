// @vitest-environment jsdom
/**
 * ENQUÊTE scanner (owner, 3ᵉ passe) — le scan « marche puis cesse » sans focus.
 * On reproduit le CYCLE DE VIE réel de POSPage sur le singleton peripheralBridge :
 *   init (fire-and-forget) + startBarcodeListener → [usage] → destroy + off
 *   (démontage) → RE-montage (init + startBarcodeListener) → scan LENT sans focus.
 *
 * But : distinguer un vrai bug de cycle de vie (le listener ne survit pas au
 * remontage / se duplique / est détaché) d'un simple décalage de version installée.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { peripheralBridge } from './peripheralBridge';

let onBarcode: ReturnType<typeof vi.fn>;

/** Un « montage » de POSPage : init non-awaité PUIS abonnement synchrone. */
function mountPOS(): () => void {
  void peripheralBridge.init('windows');
  const off = peripheralBridge.startBarcodeListener((r) => onBarcode(r.code));
  return () => { off(); peripheralBridge.destroy(); };
}

/** Rafale LENTE sans focus : touches sur document.body (aucun champ éditable). */
function slowScanNoField(code: string, gapMs = 200) {
  let t = 1_000_000;
  const spy = vi.spyOn(Date, 'now');
  for (const ch of code) {
    t += gapMs;
    spy.mockReturnValue(t);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
  }
  t += gapMs;
  spy.mockReturnValue(t);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  spy.mockRestore();
}

beforeEach(() => {
  document.body.replaceChildren();
  onBarcode = vi.fn();
});
afterEach(() => {
  peripheralBridge.destroy();
});

describe('Scanner — survie au cycle de vie POSPage', () => {
  it('montage simple : scan LENT sans focus reconnu (mode « aucun champ »)', () => {
    const unmount = mountPOS();
    slowScanNoField('4260421350771');
    expect(onBarcode).toHaveBeenCalledWith('4260421350771');
    unmount();
  });

  it('« marche puis cesse » : après démontage + REMONTAGE, le scan sans focus marche TOUJOURS', () => {
    const unmount1 = mountPOS();
    slowScanNoField('4260421350771');
    expect(onBarcode).toHaveBeenCalledTimes(1); // marche
    unmount1(); // navigation ailleurs (démontage)

    onBarcode.mockClear();
    const unmount2 = mountPOS(); // retour à la vente (remontage)
    slowScanNoField('4260421350771');
    expect(onBarcode).toHaveBeenCalledTimes(1); // marche ENCORE (pas de « puis cesse »)
    unmount2();
  });

  it('aucune DUPLICATION d’écouteur après plusieurs cycles (1 scan = 1 émission)', () => {
    for (let i = 0; i < 3; i++) { const u = mountPOS(); u(); } // cycles rapides
    const unmount = mountPOS();
    slowScanNoField('4260421350771');
    expect(onBarcode).toHaveBeenCalledTimes(1); // pas 2, 3, 4… malgré les cycles
    unmount();
  });

  it('20 scans successifs sans perte', () => {
    const unmount = mountPOS();
    for (let i = 0; i < 20; i++) {
      onBarcode.mockClear();
      slowScanNoField('4260421350771');
      expect(onBarcode).toHaveBeenCalledTimes(1);
    }
    unmount();
  });
});

describe('Scanner — scénarios écran de vente (owner)', () => {
  /** Rafale sans focus sur un target donné (body, bouton, div panier…). */
  function slowScanOn(target: EventTarget, code: string, gapMs = 200) {
    let t = 2_000_000;
    const spy = vi.spyOn(Date, 'now');
    for (const ch of code) { t += gapMs; spy.mockReturnValue(t); target.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true })); }
    t += gapMs; spy.mockReturnValue(t); target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    spy.mockRestore();
  }

  it('scan après « clic sur un bouton » (focus sur un bouton, non éditable) → reconnu', () => {
    const btn = document.createElement('button'); document.body.appendChild(btn); btn.focus();
    const unmount = mountPOS();
    slowScanOn(btn, '4260421350771');
    expect(onBarcode).toHaveBeenCalledWith('4260421350771'); // bouton = non éditable → mode « aucun champ »
    unmount();
  });

  it('scan après « clic dans le panier » (div non éditable focalisée) → reconnu', () => {
    const cart = document.createElement('div'); cart.tabIndex = 0; document.body.appendChild(cart); cart.focus();
    const unmount = mountPOS();
    slowScanOn(cart, '4260421350771');
    expect(onBarcode).toHaveBeenCalledWith('4260421350771');
    unmount();
  });

  it('frappe HUMAINE lente dans un CHAMP focalisé → JAMAIS un scan (saisie préservée)', () => {
    const inp = document.createElement('input'); document.body.appendChild(inp);
    inp.addEventListener('keydown', (e) => { if (e.key.length === 1 && !e.defaultPrevented) { const s = inp.selectionStart ?? inp.value.length; inp.setRangeText(e.key, s, s, 'end'); } });
    inp.focus();
    const unmount = mountPOS();
    // 4 caractères à 250 ms (humain) → aucun scan, texte conservé.
    let t = 3_000_000; const spy = vi.spyOn(Date, 'now');
    for (const ch of 'lait') { t += 250; spy.mockReturnValue(t); inp.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true })); }
    t += 250; spy.mockReturnValue(t); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    spy.mockRestore();
    expect(onBarcode).not.toHaveBeenCalled();
    expect(inp.value).toBe('lait');
    unmount();
  });

  it('scan RAPIDE dans le champ Recherche focalisé → reconnu, rien laissé dans le champ', () => {
    const inp = document.createElement('input'); inp.placeholder = 'Rechercher un produit'; document.body.appendChild(inp);
    inp.addEventListener('keydown', (e) => { if (e.key.length === 1 && !e.defaultPrevented) { const s = inp.selectionStart ?? inp.value.length; inp.setRangeText(e.key, s, s, 'end'); } });
    inp.focus();
    const unmount = mountPOS();
    let t = 4_000_000; const spy = vi.spyOn(Date, 'now');
    for (const ch of '4260421350771') { t += 5; spy.mockReturnValue(t); inp.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true })); }
    t += 5; spy.mockReturnValue(t); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    spy.mockRestore();
    expect(onBarcode).toHaveBeenCalledWith('4260421350771');
    expect(inp.value).toBe(''); // buffer-avant-insertion : rien ne fuit
    unmount();
  });
});
