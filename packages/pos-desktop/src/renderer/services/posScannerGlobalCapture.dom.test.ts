// @vitest-environment jsdom
/**
 * P0 scanner v1.8.1 — POSPage attache l'écoute douchette DIRECTEMENT au document
 * (capture), inconditionnellement, indépendamment du focus et du cycle de vie de
 * peripheralBridge. Ce test reproduit EXACTEMENT ce montage (attach au document +
 * detach au démontage) et prouve : scan sans focus reconnu ; remontage sans
 * duplication ; frappe humaine préservée.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachWedgeKeyboardListener } from './wedgeKeyboardListener';

let onScan: ReturnType<typeof vi.fn>;

/** Reproduit l'effet de POSPage : attache au document, renvoie le detach. */
function mountSaleScreen(): () => void {
  return attachWedgeKeyboardListener(document, (b) => onScan(b.code));
}

/** Rafale LENTE (E655) sur un target, terminée par Enter. */
function slowScan(target: EventTarget, code: string, gapMs = 200) {
  let t = 1_000_000;
  const spy = vi.spyOn(Date, 'now');
  for (const ch of code) { t += gapMs; spy.mockReturnValue(t); target.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true })); }
  t += gapMs; spy.mockReturnValue(t); target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  spy.mockRestore();
}

beforeEach(() => { document.body.replaceChildren(); onScan = vi.fn(); });
afterEach(() => { document.body.replaceChildren(); });

describe('POSPage — capture douchette directe au document', () => {
  it('scan LENT SANS aucun focus (activeElement = body) → reconnu', () => {
    const detach = mountSaleScreen();
    expect(document.activeElement === document.body || document.activeElement === null).toBe(true);
    slowScan(document.body, '4260421350771');
    expect(onScan).toHaveBeenCalledWith('4260421350771');
    detach();
  });

  it('scan avec un BOUTON focalisé → reconnu (indépendant du champ Recherche)', () => {
    const btn = document.createElement('button'); document.body.appendChild(btn); btn.focus();
    const detach = mountSaleScreen();
    slowScan(btn, '4260421350771');
    expect(onScan).toHaveBeenCalledWith('4260421350771');
    detach();
  });

  it('démontage + REMONTAGE → une seule écoute active (1 scan = 1 émission, jamais 2)', () => {
    const d1 = mountSaleScreen(); d1(); // écran quitté
    const d2 = mountSaleScreen();       // retour à la vente
    slowScan(document.body, '4260421350771');
    expect(onScan).toHaveBeenCalledTimes(1); // pas de doublon d'écouteur
    d2();
  });

  it('après detach, plus aucun scan capté (pas de fuite d\'écouteur)', () => {
    const detach = mountSaleScreen();
    detach();
    slowScan(document.body, '4260421350771');
    expect(onScan).not.toHaveBeenCalled();
  });

  it('frappe HUMAINE lente dans un champ focalisé → JAMAIS un scan, texte conservé', () => {
    const inp = document.createElement('input'); document.body.appendChild(inp);
    inp.addEventListener('keydown', (e) => { if (e.key.length === 1 && !e.defaultPrevented) { const s = inp.selectionStart ?? inp.value.length; inp.setRangeText(e.key, s, s, 'end'); } });
    inp.focus();
    const detach = mountSaleScreen();
    let t = 2_000_000; const spy = vi.spyOn(Date, 'now');
    for (const ch of 'lait') { t += 250; spy.mockReturnValue(t); inp.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true })); }
    t += 250; spy.mockReturnValue(t); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    spy.mockRestore();
    expect(onScan).not.toHaveBeenCalled();
    expect(inp.value).toBe('lait');
    detach();
  });
});
